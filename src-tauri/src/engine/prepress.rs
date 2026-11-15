//! Print production: widening hairlines, converting colours by the device formulas, and adding
//! or removing printer marks.
//!
//! Each tool rewrites page content and the form XObjects it draws. A form used by several
//! pages is rewritten once, with the graphics state of the first place it is drawn. Nothing
//! here applies an ICC profile, and what a tool cannot change is counted in its report rather
//! than passed over silently.

use super::content::{deref, Resources, MAX_FORM_DEPTH};
use super::edit::page_media_box;
use super::geometry::{number, Matrix, Rect};
use super::{
    add_page_resource, encode_operations, images, load, own_page_resources, page_operations, save,
    set_page_content, stream_operations,
};
use lopdf::content::Operation;
use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, Stream};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

const MAX_GRAPHICS_STACK: usize = 1024;
/// Marks a content stream or a page entry as belonging to NavPDF's printer marks.
const MARKS_KEY: &[u8] = b"NavPDFPrinterMarks";
const REGISTRATION: &[u8] = b"NavPDFRegistration";
const MARKS_FONT: &[u8] = b"NavPDFMarks";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ColorTarget {
    Gray,
    Rgb,
    Cmyk,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MarkOptions {
    pub trim_marks: bool,
    pub bleed_marks: bool,
    pub registration_marks: bool,
    pub color_bars: bool,
    pub page_information: bool,
    /// Line weight in points, from 0.1 to 2.
    pub weight: f64,
    /// The document's name and the date, printed in the page information line.
    pub file_name: String,
    pub date: String,
}

impl Default for MarkOptions {
    fn default() -> Self {
        Self {
            trim_marks: true,
            bleed_marks: false,
            registration_marks: false,
            color_bars: false,
            page_information: false,
            weight: 0.25,
            file_name: String::new(),
            date: String::new(),
        }
    }
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PrepressEdit {
    /// Strokes thinner than `threshold` points on the page get `width` points.
    FixHairlines {
        threshold: f64,
        width: f64,
        #[serde(default)]
        pages: Vec<u32>,
    },
    ConvertColors {
        target: ColorTarget,
        /// Also convert 8-bit grey, RGB and CMYK pictures.
        #[serde(default)]
        images: bool,
        #[serde(default)]
        pages: Vec<u32>,
    },
    AddPrinterMarks {
        #[serde(default)]
        options: MarkOptions,
        #[serde(default)]
        pages: Vec<u32>,
    },
    RemovePrinterMarks,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepressReport {
    /// Pages the tool looked at.
    pub pages: usize,
    /// Strokes widened, colours converted, or pages given or cleared of marks.
    pub changed: usize,
    pub images_converted: usize,
    /// What was found and deliberately not changed, each with a count.
    pub left_alone: Vec<String>,
    pub message: String,
}

/// Applies one print production edit. The bytes are `None` when nothing needed changing.
pub fn apply(
    bytes: &[u8],
    edit: &PrepressEdit,
) -> Result<(Option<Vec<u8>>, PrepressReport), String> {
    let mut doc = load(bytes)?;
    let expected = doc.get_pages().len();
    let report = match edit {
        PrepressEdit::FixHairlines {
            threshold,
            width,
            pages,
        } => fix_hairlines(&mut doc, *threshold, *width, pages)?,
        PrepressEdit::ConvertColors {
            target,
            images,
            pages,
        } => convert_colors(&mut doc, *target, *images, pages)?,
        PrepressEdit::AddPrinterMarks { options, pages } => add_marks(&mut doc, options, pages)?,
        PrepressEdit::RemovePrinterMarks => remove_all_marks(&mut doc),
    };
    if report.changed == 0 && report.images_converted == 0 {
        return Ok((None, report));
    }
    let output = save(&mut doc)?;
    if load(&output)?.get_pages().len() != expected {
        return Err("The changed document did not keep its pages. Nothing was changed.".into());
    }
    Ok((Some(output), report))
}

/// The chosen pages in document order, or every page when none are named.
fn selected_pages(doc: &Document, pages: &[u32]) -> Result<Vec<(u32, ObjectId)>, String> {
    let all = doc.get_pages();
    if pages.is_empty() {
        return Ok(all.into_iter().collect());
    }
    let wanted: HashSet<u32> = pages.iter().copied().collect();
    if let Some(missing) = wanted.iter().find(|page| !all.contains_key(page)) {
        return Err(format!("Page {missing} is outside the document."));
    }
    Ok(all
        .into_iter()
        .filter(|(page, _)| wanted.contains(page))
        .collect())
}

fn plural(count: usize, one: &str, many: &str) -> String {
    format!("{count} {}", if count == 1 { one } else { many })
}

fn real(value: f64) -> Object {
    Object::Real(value as f32)
}

/// The form XObject a `Do` operator draws, with its id.
fn form_of<'a>(
    doc: &'a Document,
    resources: &Resources<'a>,
    op: &Operation,
) -> Option<(ObjectId, &'a Stream)> {
    let (id, stream) = xobject_of(doc, resources, op)?;
    is_subtype(stream, b"Form").then_some((id, stream))
}

fn xobject_of<'a>(
    doc: &'a Document,
    resources: &Resources<'a>,
    op: &Operation,
) -> Option<(ObjectId, &'a Stream)> {
    let name = op.operands.first()?.as_name().ok()?;
    let (id, object) = resources.lookup(doc, b"XObject", name)?;
    Some((id?, object.as_stream().ok()?))
}

fn is_subtype(stream: &Stream, kind: &[u8]) -> bool {
    stream
        .dict
        .get(b"Subtype")
        .and_then(Object::as_name)
        .is_ok_and(|name| name == kind)
}

fn form_matrix(doc: &Document, form: &Stream) -> Matrix {
    form.dict
        .get(b"Matrix")
        .ok()
        .map(|object| deref(doc, object))
        .and_then(|object| object.as_array().ok())
        .and_then(|values| Matrix::from_objects(values))
        .unwrap_or(Matrix::IDENTITY)
}

/// Replaces rewritten page and form content in the document.
fn store(
    doc: &mut Document,
    pages: Vec<(ObjectId, Vec<Operation>)>,
    forms: HashMap<ObjectId, Vec<Operation>>,
) -> Result<(), String> {
    for (page, ops) in pages {
        set_page_content(doc, page, encode_operations(ops)?)?;
    }
    for (id, ops) in forms {
        let content = encode_operations(ops)?;
        if let Ok(Object::Stream(stream)) = doc.get_object_mut(id) {
            stream.set_plain_content(content);
            let _ = stream.compress();
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------
// Hairlines
// ---------------------------------------------------------------------------------------

struct Hairlines<'a> {
    doc: &'a Document,
    threshold: f64,
    width: f64,
    forms: HashMap<ObjectId, Vec<Operation>>,
    visited: HashSet<ObjectId>,
    fixed: usize,
}

impl<'a> Hairlines<'a> {
    /// Rewrites one stream; the flag says whether any stroke in it was widened.
    fn rewrite(
        &mut self,
        ops: Vec<Operation>,
        resources: &Resources<'a>,
        base: Matrix,
        line_width: f64,
        depth: usize,
    ) -> Result<(Vec<Operation>, bool), String> {
        let mut state = (base, line_width);
        let mut stack: Vec<(Matrix, f64)> = Vec::new();
        let mut output = Vec::with_capacity(ops.len());
        let mut changed = false;
        for op in ops {
            match op.operator.as_str() {
                "q" => {
                    if stack.len() >= MAX_GRAPHICS_STACK {
                        return Err("A page nests its graphics state too deeply to change.".into());
                    }
                    stack.push(state);
                }
                "Q" => state = stack.pop().unwrap_or(state),
                "cm" => {
                    if let Some(matrix) = Matrix::from_objects(&op.operands) {
                        state.0 = matrix.then(&state.0);
                    }
                }
                "w" => {
                    if let Some(width) = op.operands.first().and_then(number) {
                        state.1 = width;
                    }
                }
                "gs" => {
                    let width = op
                        .operands
                        .first()
                        .and_then(|name| name.as_name().ok())
                        .and_then(|name| resources.lookup(self.doc, b"ExtGState", name))
                        .and_then(|(_, state)| state.as_dict().ok())
                        .and_then(|state| state.get(b"LW").ok())
                        .and_then(|width| number(deref(self.doc, width)));
                    if let Some(width) = width {
                        state.1 = width;
                    }
                }
                "Do" => {
                    if let Some((id, form)) = form_of(self.doc, resources, &op) {
                        if depth >= MAX_FORM_DEPTH {
                            return Err(
                                "Nested form objects are too deep to process safely.".into()
                            );
                        }
                        if self.visited.insert(id) {
                            let nested = Resources::for_form(self.doc, &form.dict, resources);
                            let base = form_matrix(self.doc, form).then(&state.0);
                            let (ops, changed) = self.rewrite(
                                stream_operations(form)?,
                                &nested,
                                base,
                                state.1,
                                depth + 1,
                            )?;
                            if changed {
                                self.forms.insert(id, ops);
                            }
                        }
                    }
                }
                "S" | "s" | "B" | "B*" | "b" | "b*" => {
                    let (ctm, width) = state;
                    let scale = (ctm.a * ctm.d - ctm.b * ctm.c).abs().sqrt();
                    if scale.is_finite() && scale > 0.0 && width * scale < self.threshold {
                        // The width is restored afterwards, so nothing later is affected.
                        output.push(Operation::new("w", vec![real(self.width / scale)]));
                        output.push(op);
                        output.push(Operation::new("w", vec![real(width)]));
                        self.fixed += 1;
                        changed = true;
                        continue;
                    }
                }
                _ => {}
            }
            output.push(op);
        }
        Ok((output, changed))
    }
}

fn fix_hairlines(
    doc: &mut Document,
    threshold: f64,
    width: f64,
    pages: &[u32],
) -> Result<PrepressReport, String> {
    if !(threshold > 0.0 && threshold <= 72.0 && width >= threshold && width <= 72.0) {
        return Err(
            "Choose a hairline limit above zero and a replacement width at least as wide, up to one inch."
                .into(),
        );
    }
    let selected = selected_pages(doc, pages)?;
    let mut tool = Hairlines {
        doc,
        threshold,
        width,
        forms: HashMap::new(),
        visited: HashSet::new(),
        fixed: 0,
    };
    let mut rewritten = Vec::new();
    for (_, page) in &selected {
        let ops = page_operations(doc, *page)?;
        let resources = Resources::for_page(doc, *page);
        let (ops, changed) = tool.rewrite(ops, &resources, Matrix::IDENTITY, 1.0, 0)?;
        if changed {
            rewritten.push((*page, ops));
        }
    }
    let (fixed, forms) = (tool.fixed, tool.forms);
    store(doc, rewritten, forms)?;
    Ok(PrepressReport {
        pages: selected.len(),
        changed: fixed,
        message: if fixed == 0 {
            "No strokes thinner than the limit were found.".into()
        } else {
            format!("{} widened.", plural(fixed, "stroke", "strokes"))
        },
        ..PrepressReport::default()
    })
}

// ---------------------------------------------------------------------------------------
// Colour conversion
// ---------------------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Space {
    Gray,
    Rgb,
    Cmyk,
    /// Separation, DeviceN, Indexed, Lab, patterns and anything unreadable.
    Other,
}

impl Space {
    fn components(self) -> usize {
        match self {
            Space::Gray => 1,
            Space::Rgb => 3,
            Space::Cmyk => 4,
            Space::Other => 0,
        }
    }
}

impl ColorTarget {
    fn space(self) -> Space {
        match self {
            ColorTarget::Gray => Space::Gray,
            ColorTarget::Rgb => Space::Rgb,
            ColorTarget::Cmyk => Space::Cmyk,
        }
    }

    fn device_name(self) -> &'static str {
        match self {
            ColorTarget::Gray => "DeviceGray",
            ColorTarget::Rgb => "DeviceRGB",
            ColorTarget::Cmyk => "DeviceCMYK",
        }
    }

    fn operator(self, stroking: bool) -> &'static str {
        match (self, stroking) {
            (ColorTarget::Gray, false) => "g",
            (ColorTarget::Gray, true) => "G",
            (ColorTarget::Rgb, false) => "rg",
            (ColorTarget::Rgb, true) => "RG",
            (ColorTarget::Cmyk, false) => "k",
            (ColorTarget::Cmyk, true) => "K",
        }
    }
}

/// Converts one colour between device spaces by the formulas of ISO 32000-1, 10.3, with
/// black generation and undercolour removal both equal to the black component.
fn convert(color: &[f64], from: Space, to: ColorTarget) -> Vec<f64> {
    let unit = |value: f64| value.clamp(0.0, 1.0);
    let rgb = match (from, color) {
        (Space::Gray, [gray]) => [unit(*gray); 3],
        (Space::Rgb, [r, g, b]) => [unit(*r), unit(*g), unit(*b)],
        (Space::Cmyk, [c, m, y, k]) => [1.0 - unit(c + k), 1.0 - unit(m + k), 1.0 - unit(y + k)],
        _ => return color.to_vec(),
    };
    match (from, to) {
        (Space::Gray, ColorTarget::Gray)
        | (Space::Rgb, ColorTarget::Rgb)
        | (Space::Cmyk, ColorTarget::Cmyk) => color.iter().map(|value| unit(*value)).collect(),
        // Grey goes to black ink alone, never to a four-colour mix.
        (Space::Gray, ColorTarget::Cmyk) => vec![0.0, 0.0, 0.0, 1.0 - rgb[0]],
        (Space::Cmyk, ColorTarget::Gray) => {
            let [c, m, y, k] = [color[0], color[1], color[2], color[3]].map(unit);
            vec![1.0 - unit(0.3 * c + 0.59 * m + 0.11 * y + k)]
        }
        (_, ColorTarget::Gray) => vec![unit(0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2])],
        (_, ColorTarget::Rgb) => rgb.to_vec(),
        (_, ColorTarget::Cmyk) => {
            let [c, m, y] = rgb.map(|value| 1.0 - value);
            let k = c.min(m).min(y);
            vec![c - k, m - k, y - k, k]
        }
    }
}

/// The device space a colour space stands for, by name or by an array's family.
fn classify(doc: &Document, space: &Object) -> Space {
    match deref(doc, space) {
        Object::Name(name) => match name.as_slice() {
            b"DeviceGray" | b"G" | b"CalGray" => Space::Gray,
            b"DeviceRGB" | b"RGB" | b"CalRGB" => Space::Rgb,
            b"DeviceCMYK" | b"CMYK" => Space::Cmyk,
            _ => Space::Other,
        },
        Object::Array(parts) => match parts.first().and_then(|family| family.as_name().ok()) {
            Some(b"CalGray") => Space::Gray,
            Some(b"CalRGB") => Space::Rgb,
            Some(b"ICCBased") => parts
                .get(1)
                .and_then(|profile| deref(doc, profile).as_stream().ok())
                .and_then(|profile| profile.dict.get(b"N").ok())
                .and_then(|count| deref(doc, count).as_i64().ok())
                .map_or(Space::Other, |count| match count {
                    1 => Space::Gray,
                    3 => Space::Rgb,
                    4 => Space::Cmyk,
                    _ => Space::Other,
                }),
            _ => Space::Other,
        },
        _ => Space::Other,
    }
}

#[derive(Clone, Copy)]
struct Colors {
    fill: Space,
    stroke: Space,
}

struct Converter<'a> {
    doc: &'a Document,
    target: ColorTarget,
    forms: HashMap<ObjectId, Vec<Operation>>,
    visited: HashSet<ObjectId>,
    images: HashSet<ObjectId>,
    converted: usize,
    left: BTreeMap<&'static str, usize>,
}

impl<'a> Converter<'a> {
    fn leave(&mut self, what: &'static str) {
        *self.left.entry(what).or_default() += 1;
    }

    fn rewrite(
        &mut self,
        ops: Vec<Operation>,
        resources: &Resources<'a>,
        inherited: Colors,
        depth: usize,
    ) -> Result<(Vec<Operation>, bool), String> {
        let mut state = inherited;
        let mut stack: Vec<Colors> = Vec::new();
        let mut output = Vec::with_capacity(ops.len());
        let mut changed = false;
        for op in ops {
            let operator = op.operator.as_str();
            let numbers: Option<Vec<f64>> = op.operands.iter().map(number).collect();
            let device = match operator {
                "g" | "G" => Some(Space::Gray),
                "rg" | "RG" => Some(Space::Rgb),
                "k" | "K" => Some(Space::Cmyk),
                _ => None,
            };
            let stroking = operator.starts_with(|first: char| first.is_ascii_uppercase());
            match (operator, device) {
                ("q", _) => {
                    if stack.len() >= MAX_GRAPHICS_STACK {
                        return Err("A page nests its graphics state too deeply to change.".into());
                    }
                    stack.push(state);
                }
                ("Q", _) => state = stack.pop().unwrap_or(state),
                (_, Some(space)) => {
                    let converted = numbers
                        .filter(|values| values.len() == space.components())
                        .map(|values| convert(&values, space, self.target));
                    let Some(converted) = converted else {
                        output.push(op);
                        continue;
                    };
                    if stroking {
                        state.stroke = self.target.space();
                    } else {
                        state.fill = self.target.space();
                    }
                    if space != self.target.space() {
                        self.converted += 1;
                        changed = true;
                    }
                    output.push(Operation::new(
                        self.target.operator(stroking),
                        converted.into_iter().map(real).collect(),
                    ));
                    continue;
                }
                ("cs" | "CS", _) => {
                    let space = op
                        .operands
                        .first()
                        .and_then(|name| name.as_name().ok())
                        .map_or(Space::Other, |name| {
                            match classify(self.doc, &Object::Name(name.to_vec())) {
                                Space::Other => resources
                                    .lookup(self.doc, b"ColorSpace", name)
                                    .map_or(Space::Other, |(_, space)| classify(self.doc, space)),
                                device => device,
                            }
                        });
                    if stroking {
                        state.stroke = space;
                    } else {
                        state.fill = space;
                    }
                    if space == Space::Other {
                        self.leave(
                            "Colours in Separation, DeviceN, Indexed, Lab or pattern spaces",
                        );
                    } else {
                        // The device space needs no resource; the colours that follow are
                        // converted as they are set.
                        output.push(Operation::new(
                            operator,
                            vec![Object::Name(self.target.device_name().into())],
                        ));
                        continue;
                    }
                }
                ("sc" | "scn" | "SC" | "SCN", _) => {
                    let space = if stroking { state.stroke } else { state.fill };
                    let converted = numbers
                        .filter(|values| {
                            space != Space::Other && values.len() == space.components()
                        })
                        .map(|values| convert(&values, space, self.target));
                    if let Some(converted) = converted {
                        if space != self.target.space() {
                            self.converted += 1;
                            changed = true;
                        }
                        output.push(Operation::new(
                            if stroking { "SC" } else { "sc" },
                            converted.into_iter().map(real).collect(),
                        ));
                        continue;
                    }
                }
                ("sh", _) => self.leave("Shadings"),
                ("BI", _) => self.leave("Inline images"),
                ("Do", _) => match xobject_of(self.doc, resources, &op) {
                    Some((id, form)) if is_subtype(form, b"Form") => {
                        if depth >= MAX_FORM_DEPTH {
                            return Err(
                                "Nested form objects are too deep to process safely.".into()
                            );
                        }
                        if self.visited.insert(id) {
                            let nested = Resources::for_form(self.doc, &form.dict, resources);
                            let (ops, changed) =
                                self.rewrite(stream_operations(form)?, &nested, state, depth + 1)?;
                            if changed {
                                self.forms.insert(id, ops);
                            }
                        }
                    }
                    Some((id, image)) if is_subtype(image, b"Image") => {
                        self.images.insert(id);
                    }
                    _ => {}
                },
                _ => {}
            }
            output.push(op);
        }
        Ok((output, changed))
    }
}

/// Converts interleaved 8-bit samples between device spaces.
fn convert_pixels(pixels: &[u8], from: Space, to: ColorTarget) -> Vec<u8> {
    let mut output = Vec::with_capacity(pixels.len() / from.components() * to.space().components());
    let mut color = [0.0_f64; 4];
    for pixel in pixels.chunks_exact(from.components()) {
        for (slot, sample) in color.iter_mut().zip(pixel) {
            *slot = f64::from(*sample) / 255.0;
        }
        output.extend(
            convert(&color[..pixel.len()], from, to)
                .into_iter()
                .map(|value| (value * 255.0).round() as u8),
        );
    }
    output
}

/// A picture in the target space, or why it is left as it is. `None` means it already is.
fn converted_image(
    doc: &Document,
    image: &Stream,
    target: ColorTarget,
) -> Result<Option<Stream>, &'static str> {
    if image.dict.has(b"ImageMask") {
        return Ok(None);
    }
    let space = image
        .dict
        .get(b"ColorSpace")
        .map_or(Space::Other, |space| classify(doc, space));
    if space == target.space() {
        return Ok(None);
    }
    if space == Space::Other {
        return Err("Pictures in Indexed, Separation, DeviceN or Lab colour");
    }
    let raster = images::decode(doc, image).map_err(|_| "Pictures that could not be decoded")?;
    if raster.components != space.components() {
        return Err("Pictures that could not be decoded");
    }
    let mut template = image.dict.clone();
    template.remove(b"Decode");
    template.set("ColorSpace", target.device_name());
    let converted = images::Raster {
        components: target.space().components(),
        pixels: convert_pixels(&raster.pixels, space, target),
        ..raster
    };
    // A photograph stays a JPEG; four-colour pictures are written without loss.
    if converted.source == images::Source::Jpeg && converted.components != 4 {
        if let Ok(stream) = images::encode_jpeg(&converted, &template, 90) {
            return Ok(Some(stream));
        }
    }
    Ok(Some(images::encode_flate(&converted, &template)))
}

fn convert_colors(
    doc: &mut Document,
    target: ColorTarget,
    with_images: bool,
    pages: &[u32],
) -> Result<PrepressReport, String> {
    let selected = selected_pages(doc, pages)?;
    let mut tool = Converter {
        doc,
        target,
        forms: HashMap::new(),
        visited: HashSet::new(),
        images: HashSet::new(),
        converted: 0,
        left: BTreeMap::new(),
    };
    let device_gray = Colors {
        fill: Space::Gray,
        stroke: Space::Gray,
    };
    let mut rewritten = Vec::new();
    for (_, page) in &selected {
        let ops = page_operations(doc, *page)?;
        let resources = Resources::for_page(doc, *page);
        let (ops, changed) = tool.rewrite(ops, &resources, device_gray, 0)?;
        if changed {
            rewritten.push((*page, ops));
        }
    }
    let mut pictures: Vec<(ObjectId, Stream)> = Vec::new();
    let mut found: Vec<ObjectId> = tool.images.iter().copied().collect();
    found.sort_unstable();
    for id in found {
        let Ok(image) = doc.get_object(id).and_then(Object::as_stream) else {
            continue;
        };
        if !with_images {
            let space = image
                .dict
                .get(b"ColorSpace")
                .map_or(Space::Other, |space| classify(doc, space));
            if space != target.space() && !image.dict.has(b"ImageMask") {
                tool.leave("Pictures (not chosen for conversion)");
            }
            continue;
        }
        match converted_image(doc, image, target) {
            Ok(Some(stream)) => pictures.push((id, stream)),
            Ok(None) => {}
            Err(reason) => tool.leave(reason),
        }
    }
    let Converter {
        forms,
        converted,
        left,
        ..
    } = tool;
    store(doc, rewritten, forms)?;
    let images_converted = pictures.len();
    for (id, stream) in pictures {
        doc.objects.insert(id, Object::Stream(stream));
    }
    let name = match target {
        ColorTarget::Gray => "grey",
        ColorTarget::Rgb => "RGB",
        ColorTarget::Cmyk => "CMYK",
    };
    Ok(PrepressReport {
        pages: selected.len(),
        changed: converted,
        images_converted,
        left_alone: left
            .into_iter()
            .map(|(what, count)| format!("{what}: {count}"))
            .collect(),
        message: if converted == 0 && images_converted == 0 {
            format!("Nothing needed converting to {name}.")
        } else {
            format!(
                "{} and {} converted to {name}.",
                plural(converted, "colour", "colours"),
                plural(images_converted, "picture", "pictures"),
            )
        },
    })
}

// ---------------------------------------------------------------------------------------
// Printer marks
// ---------------------------------------------------------------------------------------

/// Marks start this far outside the trim edge, are this long, and need this much room.
const MARK_GAP: f64 = 9.0;
const MARK_LENGTH: f64 = 18.0;
const MARK_MARGIN: f64 = 36.0;
const PAGE_BOXES: [&[u8]; 3] = [b"MediaBox", b"CropBox", b"TrimBox"];

fn rect_object(rect: &Rect) -> Object {
    rect.to_array()
        .into_iter()
        .map(real)
        .collect::<Vec<_>>()
        .into()
}

/// A box stored on the page itself, or inherited for the crop box.
fn page_box(doc: &Document, page: ObjectId, key: &[u8]) -> Option<Rect> {
    let mut current = Some(page);
    for _ in 0..64 {
        let node = doc.get_dictionary(current?).ok()?;
        let rect = node
            .get(key)
            .ok()
            .and_then(|object| deref(doc, object).as_array().ok())
            .and_then(|values| Rect::from_objects(values));
        if rect.is_some() {
            return rect;
        }
        // Only the media and crop boxes are inherited from the page tree.
        if key != b"CropBox" {
            return None;
        }
        current = node.get(b"Parent").and_then(Object::as_reference).ok();
    }
    None
}

/// The page's content streams as a list of references.
fn content_entries(doc: &Document, page: ObjectId) -> Vec<Object> {
    match doc
        .get_dictionary(page)
        .ok()
        .and_then(|page| page.get(b"Contents").ok())
    {
        Some(Object::Array(entries)) => entries.clone(),
        Some(reference @ Object::Reference(id)) => match doc.get_object(*id) {
            Ok(Object::Array(entries)) => entries.clone(),
            _ => vec![reference.clone()],
        },
        _ => Vec::new(),
    }
}

fn is_marks_stream(doc: &Document, entry: &Object) -> bool {
    deref(doc, entry)
        .as_stream()
        .is_ok_and(|stream| stream.dict.has(MARKS_KEY))
}

/// Takes NavPDF's printer marks off a page and puts its boxes back as they were.
fn remove_marks(doc: &mut Document, page: ObjectId) -> bool {
    let entries = content_entries(doc, page);
    let kept: Vec<Object> = entries
        .iter()
        .filter(|entry| !is_marks_stream(doc, entry))
        .cloned()
        .collect();
    let Ok(dict) = doc.get_dictionary_mut(page) else {
        return false;
    };
    let saved = match dict.remove(MARKS_KEY) {
        Some(Object::Dictionary(saved)) => Some(saved),
        _ => None,
    };
    if saved.is_none() && kept.len() == entries.len() {
        return false;
    }
    dict.set("Contents", kept);
    if let Some(saved) = saved {
        for key in PAGE_BOXES {
            match saved.get(key) {
                Ok(original) => dict.set(key.to_vec(), original.clone()),
                Err(_) => {
                    dict.remove(key);
                }
            }
        }
    }
    if let Ok(Object::Dictionary(resources)) = dict.get_mut(b"Resources") {
        for (category, name) in [
            (b"ColorSpace".as_slice(), REGISTRATION),
            (b"Font", MARKS_FONT),
        ] {
            if let Ok(Object::Dictionary(entries)) = resources.get_mut(category) {
                entries.remove(name);
            }
        }
    }
    true
}

fn remove_all_marks(doc: &mut Document) -> PrepressReport {
    let pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
    let cleared = pages
        .iter()
        .filter(|page| remove_marks(doc, **page))
        .count();
    PrepressReport {
        pages: pages.len(),
        changed: cleared,
        message: if cleared == 0 {
            "This document has no printer marks added by NavPDF.".into()
        } else {
            format!(
                "Printer marks removed from {}.",
                plural(cleared, "page", "pages")
            )
        },
        ..PrepressReport::default()
    }
}

/// Printable ASCII for the page information line, with string delimiters escaped.
fn literal(text: &str) -> String {
    text.chars()
        .take(160)
        .map(|character| match character {
            '(' | ')' | '\\' => format!("\\{character}"),
            ' '..='~' => character.to_string(),
            _ => "_".into(),
        })
        .collect()
}

/// The drawing for one page's marks around its trim and bleed boxes.
fn marks_content(options: &MarkOptions, trim: &Rect, bleed: &Rect, gap: f64, info: &str) -> String {
    let mut out = format!(
        "Q\nq\n/{reg} CS /{reg} cs 1 SCN 1 scn\n{weight:.2} w\n",
        reg = String::from_utf8_lossy(REGISTRATION),
        weight = options.weight,
    );
    let corner_marks = |out: &mut String, corners: &Rect| {
        for (x, sx) in [(corners.x0, -1.0), (corners.x1, 1.0)] {
            for (y, sy) in [(corners.y0, -1.0), (corners.y1, 1.0)] {
                // Each mark starts clear of the trim edge it runs away from.
                let (from_x, from_y) = (
                    if sx < 0.0 {
                        trim.x0 - gap
                    } else {
                        trim.x1 + gap
                    },
                    if sy < 0.0 {
                        trim.y0 - gap
                    } else {
                        trim.y1 + gap
                    },
                );
                out.push_str(&format!(
                    "{from_x:.2} {y:.2} m {:.2} {y:.2} l S\n{x:.2} {from_y:.2} m {x:.2} {:.2} l S\n",
                    from_x + sx * MARK_LENGTH,
                    from_y + sy * MARK_LENGTH,
                ));
            }
        }
    };
    if options.trim_marks {
        corner_marks(&mut out, trim);
    }
    if options.bleed_marks && bleed != trim {
        out.push_str("[2 2] 0 d\n");
        corner_marks(&mut out, bleed);
        out.push_str("[] 0 d\n");
    }
    if options.registration_marks {
        let (mid_x, mid_y) = ((trim.x0 + trim.x1) / 2.0, (trim.y0 + trim.y1) / 2.0);
        let offset = gap + MARK_LENGTH / 2.0;
        // A circle of radius 5 as four curves, crossed by two lines.
        let (r, k) = (5.0, 5.0 * 0.552_284_75);
        for (x, y) in [
            (mid_x, trim.y1 + offset),
            (mid_x, trim.y0 - offset),
            (trim.x0 - offset, mid_y),
            (trim.x1 + offset, mid_y),
        ] {
            out.push_str(&format!(
                "{:.2} {y:.2} m {:.2} {:.2} {:.2} {:.2} {x:.2} {:.2} c {:.2} {:.2} {:.2} {:.2} {:.2} {y:.2} c \
                 {:.2} {:.2} {:.2} {:.2} {x:.2} {:.2} c {:.2} {:.2} {:.2} {:.2} {:.2} {y:.2} c S\n\
                 {:.2} {y:.2} m {:.2} {y:.2} l S\n{x:.2} {:.2} m {x:.2} {:.2} l S\n",
                x + r, x + r, y + k, x + k, y + r, y + r,
                x - k, y + r, x - r, y + k, x - r,
                x - r, y - k, x - k, y - r, y - r,
                x + k, y - r, x + r, y - k, x + r,
                x - 8.0, x + 8.0, y - 8.0, y + 8.0,
            ));
        }
    }
    if options.color_bars {
        const INKS: [[f64; 4]; 7] = [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
            [0.0, 0.0, 0.0, 0.75],
            [0.0, 0.0, 0.0, 0.5],
            [0.0, 0.0, 0.0, 0.25],
        ];
        for (index, [c, m, y, k]) in INKS.iter().enumerate() {
            out.push_str(&format!(
                "{c} {m} {y} {k} k {:.2} {:.2} 9 9 re f\n",
                trim.x0 + MARK_MARGIN + index as f64 * 9.0,
                trim.y0 - gap - 13.5,
            ));
        }
    }
    if options.page_information && !info.is_empty() {
        out.push_str(&format!(
            "/{reg} cs 1 scn\nBT /{font} 6 Tf {:.2} {:.2} Td ({info}) Tj ET\n",
            trim.x0 + MARK_MARGIN,
            trim.y1 + gap + 6.0,
            reg = String::from_utf8_lossy(REGISTRATION),
            font = String::from_utf8_lossy(MARKS_FONT),
        ));
    }
    out.push_str("Q\n");
    out
}

fn add_marks(
    doc: &mut Document,
    options: &MarkOptions,
    pages: &[u32],
) -> Result<PrepressReport, String> {
    if !(options.trim_marks
        || options.bleed_marks
        || options.registration_marks
        || options.color_bars
        || options.page_information)
    {
        return Err("Choose at least one kind of printer mark.".into());
    }
    if !(0.1..=2.0).contains(&options.weight) {
        return Err("Choose a line weight between 0.1 and 2 points.".into());
    }
    let selected = selected_pages(doc, pages)?;
    let total = doc.get_pages().len();
    // The registration colour prints on every plate: the /All separation.
    let registration = doc.add_object(vec![
        Object::Name(b"Separation".to_vec()),
        Object::Name(b"All".to_vec()),
        Object::Name(b"DeviceCMYK".to_vec()),
        Object::Dictionary(dictionary! {
            "FunctionType" => 2,
            "Domain" => vec![0.into(), 1.into()],
            "C0" => vec![0.into(), 0.into(), 0.into(), 0.into()],
            "C1" => vec![1.into(), 1.into(), 1.into(), 1.into()],
            "N" => 1,
        }),
    ]);
    let font = doc.add_object(dictionary! {
        "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
        "Encoding" => "WinAnsiEncoding",
    });
    for (number, page) in &selected {
        // Adding again replaces the marks already there.
        remove_marks(doc, *page);
        let media = Rect::from_objects(&page_media_box(doc, *page).map(real))
            .filter(Rect::is_valid)
            .ok_or_else(|| format!("Page {number} has no usable page size."))?;
        let crop = page_box(doc, *page, b"CropBox").filter(Rect::is_valid);
        let visible = crop.unwrap_or(media);
        let trim = page_box(doc, *page, b"TrimBox")
            .filter(Rect::is_valid)
            .unwrap_or(visible);
        let bleed = page_box(doc, *page, b"BleedBox")
            .filter(Rect::is_valid)
            .unwrap_or(trim);
        // Marks stay clear of the bleed, so a wide bleed pushes them further out.
        let beyond = [
            trim.x0 - bleed.x0,
            bleed.x1 - trim.x1,
            trim.y0 - bleed.y0,
            bleed.y1 - trim.y1,
        ]
        .into_iter()
        .fold(0.0_f64, f64::max);
        let gap = MARK_GAP.max(beyond + 3.0);
        let needed = trim.inflate(MARK_MARGIN.max(gap + MARK_LENGTH + 9.0));
        let info = literal(&format!(
            "{}   Page {number} of {total}   {}",
            options.file_name.trim(),
            options.date.trim()
        ));
        let content = marks_content(options, &trim, &bleed, gap, &info);

        let mut saved = Dictionary::new();
        {
            let dict = doc
                .get_dictionary(*page)
                .map_err(|_| "A page could not be read.")?;
            for key in PAGE_BOXES {
                if let Ok(own) = dict.get(key) {
                    saved.set(key.to_vec(), own.clone());
                }
            }
        }
        let marker = |content: &str| {
            let mut stream = Stream::new(Dictionary::new(), content.as_bytes().to_vec());
            let _ = stream.compress();
            stream.dict.set(MARKS_KEY, true);
            stream
        };
        // The page's own drawing is isolated, so it cannot change how the marks are drawn.
        let before = doc.add_object(marker("q\n"));
        let after = doc.add_object(marker(&content));
        let mut entries = vec![Object::Reference(before)];
        entries.extend(content_entries(doc, *page));
        entries.push(Object::Reference(after));

        own_page_resources(doc, *page)?;
        add_page_resource(doc, *page, b"ColorSpace", REGISTRATION, registration)?;
        add_page_resource(doc, *page, b"Font", MARKS_FONT, font)?;
        let dict = doc
            .get_dictionary_mut(*page)
            .map_err(|_| "A page could not be updated.")?;
        dict.set("Contents", entries);
        dict.set(MARKS_KEY, saved);
        // The page grows where the marks would fall outside it; the trim box keeps the
        // finished size.
        dict.set("MediaBox", rect_object(&media.union(&needed)));
        if crop.is_some() || !media.contains(&needed) {
            dict.set("CropBox", rect_object(&visible.union(&needed)));
        }
        dict.set("TrimBox", rect_object(&trim));
    }
    Ok(PrepressReport {
        pages: selected.len(),
        changed: selected.len(),
        message: format!(
            "Printer marks added to {}.",
            plural(selected.len(), "page", "pages")
        ),
        ..PrepressReport::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::content::tests::page_document;
    use lopdf::content::Content;

    fn bytes(doc: &mut Document) -> Vec<u8> {
        save(doc).unwrap()
    }

    fn page_ops(doc: &Document) -> Vec<Operation> {
        page_operations(doc, doc.get_pages()[&1]).unwrap()
    }

    fn text(ops: &[Operation]) -> String {
        String::from_utf8(encode_operations(ops.to_vec()).unwrap()).unwrap()
    }

    fn run(doc: &mut Document, edit: PrepressEdit) -> (Document, PrepressReport) {
        let (output, report) = apply(&bytes(doc), &edit).unwrap();
        (load(&output.expect("a changed document")).unwrap(), report)
    }

    /// The numbers given to each `w` operator, in order.
    fn widths(ops: &[Operation]) -> Vec<f64> {
        ops.iter()
            .filter(|op| op.operator == "w")
            .map(|op| (number(&op.operands[0]).unwrap() * 1000.0).round() / 1000.0)
            .collect()
    }

    fn hairlines(pages: Vec<u32>) -> PrepressEdit {
        PrepressEdit::FixHairlines {
            threshold: 0.216,
            width: 0.72,
            pages,
        }
    }

    #[test]
    fn hairlines_are_measured_after_every_transformation_and_widths_are_restored() {
        let (mut doc, _) = page_document(
            "0 w 10 10 m 90 10 l S \
             2 w 10 20 m 90 20 l S \
             q 0.05 0 0 0.05 0 0 cm 2 w 0 600 m 900 600 l S Q \
             q 10 0 0 10 0 0 cm 0.01 w 1 4 m 9 4 l S Q \
             0.1 w 10 50 m 90 50 l B \
             10 60 m 90 60 l f \
             BT /F1 12 Tf 72 700 Td (Kept) Tj ET",
            dictionary! {},
        );
        let (fixed, report) = run(&mut doc, hairlines(vec![]));
        assert_eq!((report.changed, report.pages), (4, 1));
        assert_eq!(report.message, "4 strokes widened.");
        let ops = page_ops(&fixed);
        // A zero width, a width thin only once scaled down, a width still thin when drawn
        // ten times larger and a thin filled stroke become 0.72 pt on the page. Each is
        // followed by the width it replaced; the 2 pt line and the fill are untouched.
        assert_eq!(
            widths(&ops),
            vec![0.0, 0.72, 0.0, 2.0, 2.0, 14.4, 2.0, 0.01, 0.072, 0.01, 0.1, 0.72, 0.1]
        );
        assert!(fixed.extract_text(&[1]).unwrap().contains("Kept"));

        // Nothing is thin any more, so a second pass changes nothing.
        let (unchanged, again) = apply(&bytes(&mut doc.clone()), &hairlines(vec![])).unwrap();
        assert!(unchanged.is_some() && again.changed == 4);
        let (none, report) = apply(&save(&mut fixed.clone()).unwrap(), &hairlines(vec![])).unwrap();
        assert!(none.is_none());
        assert_eq!(
            report.message,
            "No strokes thinner than the limit were found."
        );
    }

    #[test]
    fn hairlines_inside_forms_use_the_size_the_form_is_drawn_at() {
        let (mut doc, page) = page_document("q 0.1 0 0 0.1 0 0 cm /Fm Do Q", dictionary! {});
        let form = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject", "Subtype" => "Form",
                "BBox" => vec![0.into(), 0.into(), 100.into(), 100.into()],
                "Matrix" => vec![2.into(), 0.into(), 0.into(), 2.into(), 0.into(), 0.into()],
            },
            b"1 w 0 0 m 100 100 l S".to_vec(),
        ));
        let resources = doc.get_dictionary_mut(page).unwrap().get_mut(b"Resources");
        resources
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("XObject", dictionary! {"Fm" => form});
        let (fixed, report) = run(&mut doc, hairlines(vec![]));
        assert_eq!(report.changed, 1);
        // The page itself did not change; the form's 1-unit line is 0.2 pt on the page.
        assert!(widths(&page_ops(&fixed)).is_empty());
        let stream = fixed.get_object(form).unwrap().as_stream().unwrap();
        assert_eq!(
            widths(&stream_operations(stream).unwrap()),
            vec![1.0, 3.6, 1.0]
        );
        assert!(stream.dict.has(b"BBox") && stream.dict.has(b"Matrix"));
    }

    #[test]
    fn hairline_settings_and_pages_are_checked() {
        let (mut doc, _) = page_document("0 w 0 0 m 9 9 l S", dictionary! {});
        let source = bytes(&mut doc);
        for (threshold, width) in [
            (0.0, 1.0),
            (-1.0, 1.0),
            (1.0, 0.5),
            (1.0, 100.0),
            (f64::NAN, 1.0),
        ] {
            let edit = PrepressEdit::FixHairlines {
                threshold,
                width,
                pages: vec![],
            };
            assert!(apply(&source, &edit).is_err(), "{threshold} {width}");
        }
        assert!(apply(&source, &hairlines(vec![2]))
            .unwrap_err()
            .contains("outside the document"));
    }

    fn colors(target: ColorTarget, images: bool) -> PrepressEdit {
        PrepressEdit::ConvertColors {
            target,
            images,
            pages: vec![],
        }
    }

    #[test]
    fn device_formulas_convert_between_grey_rgb_and_cmyk() {
        let close = |a: Vec<f64>, b: &[f64]| {
            assert_eq!(a.len(), b.len());
            for (x, y) in a.iter().zip(b) {
                assert!((x - y).abs() < 1e-9, "{a:?} {b:?}");
            }
        };
        close(
            convert(&[1.0, 0.0, 0.0], Space::Rgb, ColorTarget::Gray),
            &[0.3],
        );
        close(
            convert(&[0.0, 0.0, 0.0], Space::Rgb, ColorTarget::Cmyk),
            &[0.0, 0.0, 0.0, 1.0],
        );
        close(
            convert(&[1.0, 0.5, 0.0], Space::Rgb, ColorTarget::Cmyk),
            &[0.0, 0.5, 1.0, 0.0],
        );
        close(
            convert(&[0.25], Space::Gray, ColorTarget::Cmyk),
            &[0.0, 0.0, 0.0, 0.75],
        );
        close(
            convert(&[0.25], Space::Gray, ColorTarget::Rgb),
            &[0.25, 0.25, 0.25],
        );
        close(
            convert(&[0.0, 0.0, 0.0, 1.0], Space::Cmyk, ColorTarget::Gray),
            &[0.0],
        );
        close(
            convert(&[0.2, 0.4, 0.6, 0.1], Space::Cmyk, ColorTarget::Rgb),
            &[0.7, 0.5, 0.3],
        );
        close(
            convert(&[2.0, -1.0, 0.5], Space::Rgb, ColorTarget::Rgb),
            &[1.0, 0.0, 0.5],
        );
    }

    #[test]
    fn colour_operators_are_rewritten_and_special_spaces_are_counted() {
        let (mut doc, _) = page_document(
            "1 0 0 rg 0 0 10 10 re f \
             q 0 0 0 1 K 0 0 m 9 9 l S Q \
             /CS0 cs 0 1 0 sc 0 0 10 10 re f \
             /Spot CS 0.5 SCN 0 0 m 9 9 l S \
             /DeviceRGB cs 0 0 1 scn \
             0.5 g /Sh sh \
             BT /F1 12 Tf 72 700 Td (Kept) Tj ET",
            dictionary! {
                "ColorSpace" => dictionary! {
                    "CS0" => vec![Object::Name(b"CalRGB".to_vec()), dictionary! {}.into()],
                    "Spot" => vec![
                        Object::Name(b"Separation".to_vec()), Object::Name(b"Gold".to_vec()),
                        Object::Name(b"DeviceCMYK".to_vec()), dictionary! {}.into(),
                    ],
                },
            },
        );
        let (gray, report) = run(&mut doc, colors(ColorTarget::Gray, false));
        // Red, black ink, calibrated green and device blue; the grey was grey already.
        assert_eq!(report.changed, 4);
        assert_eq!(
            report.left_alone,
            vec![
                "Colours in Separation, DeviceN, Indexed, Lab or pattern spaces: 1",
                "Shadings: 1",
            ]
        );
        let content = text(&page_ops(&gray));
        for expected in [
            "0.3 g",
            "0 G",
            "/DeviceGray cs",
            "0.59 sc",
            "/Spot CS",
            "0.5 SCN",
            "0.11 sc",
            "0.5 g",
        ] {
            assert!(content.contains(expected), "{expected} in {content}");
        }
        assert!(!content.contains("rg") && !content.contains(" K"));
        assert!(gray.extract_text(&[1]).unwrap().contains("Kept"));

        let (cmyk, report) = run(&mut doc, colors(ColorTarget::Cmyk, false));
        assert_eq!(report.changed, 4);
        let content = text(&page_ops(&cmyk));
        for expected in [
            "0 1 1 0 k",
            "0 0 0 1 K",
            "/DeviceCMYK cs",
            "1 0 1 0 sc",
            "0 0 0 0.5 k",
        ] {
            assert!(content.contains(expected), "{expected} in {content}");
        }
    }

    #[test]
    fn the_colour_space_in_effect_is_restored_with_the_graphics_state() {
        let (mut doc, _) = page_document(
            "/DeviceRGB cs q /Spot cs 0.5 scn Q 1 0 0 scn 0 0 9 9 re f",
            dictionary! {
                "ColorSpace" => dictionary! {
                    "Spot" => vec![
                        Object::Name(b"Separation".to_vec()), Object::Name(b"Gold".to_vec()),
                        Object::Name(b"DeviceGray".to_vec()), dictionary! {}.into(),
                    ],
                },
            },
        );
        let (gray, report) = run(&mut doc, colors(ColorTarget::Gray, false));
        assert_eq!(report.changed, 1);
        let content = text(&page_ops(&gray));
        assert!(content.contains("/Spot cs") && content.contains("0.5 scn"));
        assert!(content.contains("0.3 sc"), "{content}");
    }

    fn with_image(space: Object, pixels: Vec<u8>, extra: Dictionary) -> (Document, ObjectId) {
        let (mut doc, page) = page_document("q 100 0 0 100 0 0 cm /Im Do Q", dictionary! {});
        let mut dict = dictionary! {
            "Type" => "XObject", "Subtype" => "Image", "Width" => 2, "Height" => 1,
            "BitsPerComponent" => 8, "ColorSpace" => space,
        };
        dict.extend(&extra);
        let image = doc.add_object(Stream::new(dict, pixels));
        let resources = doc.get_dictionary_mut(page).unwrap().get_mut(b"Resources");
        resources
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("XObject", dictionary! {"Im" => image});
        (doc, image)
    }

    fn samples(doc: &Document, image: ObjectId) -> (Vec<u8>, Vec<u8>) {
        let stream = doc.get_object(image).unwrap().as_stream().unwrap();
        let space = stream.dict.get(b"ColorSpace").unwrap().as_name().unwrap();
        (space.to_vec(), crate::engine::stream_bytes(stream).unwrap())
    }

    #[test]
    fn pictures_are_converted_only_when_asked_and_keep_their_masks() {
        let mask = dictionary! {"Interpolate" => true};
        let (mut doc, image) =
            with_image("DeviceRGB".into(), vec![255, 0, 0, 0, 0, 0], mask.clone());
        let (untouched, report) =
            apply(&bytes(&mut doc), &colors(ColorTarget::Gray, false)).unwrap();
        assert!(untouched.is_none());
        assert_eq!(
            report.left_alone,
            vec!["Pictures (not chosen for conversion): 1"]
        );

        let (gray, report) = run(&mut doc, colors(ColorTarget::Gray, true));
        assert_eq!((report.changed, report.images_converted), (0, 1));
        assert_eq!(samples(&gray, image), (b"DeviceGray".to_vec(), vec![77, 0]));
        let stream = gray.get_object(image).unwrap().as_stream().unwrap();
        assert!(stream.dict.has(b"Interpolate"));

        let (cmyk, _) = run(&mut doc, colors(ColorTarget::Cmyk, true));
        assert_eq!(
            samples(&cmyk, image),
            (b"DeviceCMYK".to_vec(), vec![0, 255, 255, 0, 0, 0, 0, 255])
        );

        // Already in the target space: nothing to do, and nothing to report.
        let (same, report) = apply(&bytes(&mut doc), &colors(ColorTarget::Rgb, true)).unwrap();
        assert!(same.is_none() && report.left_alone.is_empty());
    }

    #[test]
    fn pictures_that_cannot_be_converted_are_reported() {
        let indexed: Object = vec![
            Object::Name(b"Indexed".to_vec()),
            Object::Name(b"DeviceRGB".to_vec()),
            1.into(),
            Object::string_literal(vec![0_u8, 0, 0, 255, 255, 255]),
        ]
        .into();
        let (mut doc, _) = with_image(indexed, vec![0, 1], dictionary! {});
        let (output, report) = apply(&bytes(&mut doc), &colors(ColorTarget::Gray, true)).unwrap();
        assert!(output.is_none());
        assert_eq!(
            report.left_alone,
            vec!["Pictures in Indexed, Separation, DeviceN or Lab colour: 1"]
        );

        let (mut doc, _) = with_image("DeviceRGB".into(), vec![1, 2, 3], dictionary! {});
        let (_, report) = apply(&bytes(&mut doc), &colors(ColorTarget::Gray, true)).unwrap();
        assert_eq!(
            report.left_alone,
            vec!["Pictures that could not be decoded: 1"]
        );
    }

    fn marks(options: MarkOptions) -> PrepressEdit {
        PrepressEdit::AddPrinterMarks {
            options,
            pages: vec![],
        }
    }

    fn every_mark() -> MarkOptions {
        MarkOptions {
            trim_marks: true,
            bleed_marks: true,
            registration_marks: true,
            color_bars: true,
            page_information: true,
            weight: 0.5,
            file_name: "Brochure (final) \\ Résumé.pdf".into(),
            date: "2026-11-15".into(),
        }
    }

    fn rect(doc: &Document, key: &[u8]) -> Option<[f64; 4]> {
        let page = doc.get_dictionary(doc.get_pages()[&1]).unwrap();
        let values = page.get(key).ok()?.as_array().ok()?;
        Some(Rect::from_objects(values)?.to_array())
    }

    fn all_content(doc: &Document) -> String {
        String::from_utf8_lossy(&doc.get_page_content(doc.get_pages()[&1])).into_owned()
    }

    #[test]
    fn printer_marks_sit_outside_the_trim_and_the_page_grows_to_hold_them() {
        let (mut doc, page) = page_document("BT /F1 12 Tf 72 700 Td (Kept) Tj ET", dictionary! {});
        doc.get_dictionary_mut(page).unwrap().set(
            "BleedBox",
            vec![(-9).into(), (-9).into(), 621.into(), 801.into()],
        );
        let (marked, report) = run(&mut doc, marks(every_mark()));
        assert_eq!(report.message, "Printer marks added to 1 page.");
        // The bleed reaches 9 pt out, so marks start 12 pt out and the page grows by 39 pt.
        assert_eq!(
            rect(&marked, b"MediaBox"),
            Some([-39.0, -39.0, 651.0, 831.0])
        );
        assert_eq!(
            rect(&marked, b"CropBox"),
            Some([-39.0, -39.0, 651.0, 831.0])
        );
        assert_eq!(rect(&marked, b"TrimBox"), Some([0.0, 0.0, 612.0, 792.0]));
        let content = all_content(&marked);
        // The page's drawing is wrapped, then the marks follow in the registration colour.
        assert!(content.trim_start().starts_with('q'));
        assert!(content.contains("/NavPDFRegistration CS"));
        assert!(content.contains("0.50 w"));
        assert!(
            content.contains("-12.00 0.00 m -30.00 0.00 l S"),
            "{content}"
        );
        assert!(content.contains("[2 2] 0 d"));
        assert!(content.contains("1 0 0 0 k"));
        assert!(content
            .contains("(Brochure \\(final\\) \\\\ R_sum_.pdf   Page 1 of 1   2026-11-15) Tj"));
        // Nothing is drawn inside the trim box: every coordinate pair of the mark lines
        // has a point outside it.
        let ops = Content::decode(content.as_bytes()).unwrap().operations;
        let start = ops.iter().position(|op| op.operator == "CS").unwrap();
        for op in ops[start..]
            .iter()
            .filter(|op| matches!(op.operator.as_str(), "m" | "l"))
        {
            let (x, y) = (
                number(&op.operands[0]).unwrap(),
                number(&op.operands[1]).unwrap(),
            );
            assert!(
                !(0.01..611.99).contains(&x) || !(0.01..791.99).contains(&y),
                "{x} {y}"
            );
        }
        assert!(marked.extract_text(&[1]).unwrap().contains("Kept"));

        // Adding again replaces the marks instead of stacking them.
        let (again, _) = run(&mut marked.clone(), marks(MarkOptions::default()));
        assert_eq!(
            all_content(&again)
                .matches("/NavPDFRegistration CS")
                .count(),
            1
        );
        assert_eq!(
            rect(&again, b"MediaBox"),
            Some([-39.0, -39.0, 651.0, 831.0])
        );
        assert!(!all_content(&again).contains("[2 2] 0 d"));

        // Removing puts the page back: its boxes, its content and its resources.
        let (cleared, report) = run(&mut again.clone(), PrepressEdit::RemovePrinterMarks);
        assert_eq!(report.message, "Printer marks removed from 1 page.");
        assert_eq!(rect(&cleared, b"MediaBox"), Some([0.0, 0.0, 612.0, 792.0]));
        assert_eq!(rect(&cleared, b"CropBox"), None);
        assert_eq!(rect(&cleared, b"TrimBox"), None);
        assert_eq!(
            all_content(&cleared).trim(),
            "BT /F1 12 Tf 72 700 Td (Kept) Tj ET"
        );
        let page = cleared.get_dictionary(cleared.get_pages()[&1]).unwrap();
        assert!(!page.has(MARKS_KEY));
        let resources = page.get(b"Resources").unwrap().as_dict().unwrap();
        assert!(!resources
            .get(b"Font")
            .unwrap()
            .as_dict()
            .unwrap()
            .has(MARKS_FONT));
        let (none, report) = apply(
            &save(&mut cleared.clone()).unwrap(),
            &PrepressEdit::RemovePrinterMarks,
        )
        .unwrap();
        assert!(none.is_none());
        assert!(report.message.contains("no printer marks"));
    }

    #[test]
    fn a_page_with_room_keeps_its_size_and_marks_need_a_choice() {
        let (mut doc, page) = page_document("0 0 m 9 9 l S", dictionary! {});
        doc.get_dictionary_mut(page).unwrap().set(
            "TrimBox",
            vec![50.into(), 50.into(), 562.into(), 742.into()],
        );
        let (marked, _) = run(&mut doc, marks(MarkOptions::default()));
        assert_eq!(rect(&marked, b"MediaBox"), Some([0.0, 0.0, 612.0, 792.0]));
        assert_eq!(rect(&marked, b"CropBox"), None);
        assert_eq!(rect(&marked, b"TrimBox"), Some([50.0, 50.0, 562.0, 742.0]));
        let (cleared, _) = run(&mut marked.clone(), PrepressEdit::RemovePrinterMarks);
        assert_eq!(rect(&cleared, b"TrimBox"), Some([50.0, 50.0, 562.0, 742.0]));

        let nothing = MarkOptions {
            trim_marks: false,
            ..MarkOptions::default()
        };
        assert!(apply(&bytes(&mut doc), &marks(nothing)).is_err());
        let heavy = MarkOptions {
            weight: 5.0,
            ..MarkOptions::default()
        };
        assert!(apply(&bytes(&mut doc), &marks(heavy)).is_err());
    }

    #[test]
    fn edits_arrive_in_their_json_shape() {
        let edit: PrepressEdit = serde_json::from_str(
            r#"{"kind":"addPrinterMarks","options":{"colorBars":true,"fileName":"a.pdf"},"pages":[1]}"#,
        )
        .unwrap();
        let PrepressEdit::AddPrinterMarks { options, pages } = edit else {
            panic!("wrong edit");
        };
        assert!(options.color_bars && options.trim_marks && pages == vec![1]);
        assert!(matches!(
            serde_json::from_str(r#"{"kind":"convertColors","target":"cmyk","images":true}"#)
                .unwrap(),
            PrepressEdit::ConvertColors {
                target: ColorTarget::Cmyk,
                images: true,
                ..
            }
        ));
        assert!(matches!(
            serde_json::from_str(r#"{"kind":"fixHairlines","threshold":0.2,"width":0.7}"#).unwrap(),
            PrepressEdit::FixHairlines { .. }
        ));
    }
}
