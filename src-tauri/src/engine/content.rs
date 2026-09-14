//! Content-stream interpreter that places text glyphs, images, forms and paths in user space.

use super::fonts::FontInfo;
use super::geometry::{number, Matrix, Rect};
use lopdf::content::Operation;
use lopdf::{Dictionary, Document, Object, ObjectId};
use std::collections::{HashMap, HashSet};

/// Form XObjects nested deeper than this are rejected rather than skipped.
pub const MAX_FORM_DEPTH: usize = 12;
const MAX_GRAPHICS_STACK: usize = 1024;
/// Smallest glyph or image extent in user space, so degenerate boxes still overlap regions.
const MIN_EXTENT: f64 = 0.1;
const UNBOUNDED: Rect = Rect {
    x0: -1e9,
    y0: -1e9,
    x1: 1e9,
    y1: 1e9,
};

pub fn deref<'a>(doc: &'a Document, object: &'a Object) -> &'a Object {
    doc.dereference(object)
        .map(|(_, resolved)| resolved)
        .unwrap_or(object)
}

/// Resource dictionaries in lookup order, nearest definition first.
#[derive(Clone, Default)]
pub struct Resources<'a> {
    dicts: Vec<&'a Dictionary>,
}

/// A page's resource dictionary followed by each ancestor's, direct or referenced.
/// Ancestors are consulted leniently even when the page defines its own resources.
pub fn page_resource_dictionaries(doc: &Document, page_id: ObjectId) -> Vec<&Dictionary> {
    const MAX_TREE_DEPTH: usize = 64;
    let mut dicts = Vec::new();
    let mut visited = HashSet::new();
    let mut current = Some(page_id);
    while let Some(id) = current {
        if !visited.insert(id) || visited.len() > MAX_TREE_DEPTH {
            break;
        }
        let Ok(node) = doc.get_dictionary(id) else {
            break;
        };
        if let Some(resources) = node
            .get(b"Resources")
            .ok()
            .map(|object| deref(doc, object))
            .and_then(|object| object.as_dict().ok())
        {
            dicts.push(resources);
        }
        current = node.get(b"Parent").and_then(Object::as_reference).ok();
    }
    dicts
}

impl<'a> Resources<'a> {
    pub fn for_page(doc: &'a Document, page_id: ObjectId) -> Self {
        Self {
            dicts: page_resource_dictionaries(doc, page_id),
        }
    }

    pub fn for_form(doc: &'a Document, form: &'a Dictionary, parent: &Resources<'a>) -> Self {
        let mut dicts: Vec<&'a Dictionary> = form
            .get(b"Resources")
            .ok()
            .map(|object| deref(doc, object))
            .and_then(|object| object.as_dict().ok())
            .into_iter()
            .collect();
        dicts.extend(parent.dicts.iter().copied());
        Self { dicts }
    }

    pub fn lookup(
        &self,
        doc: &'a Document,
        category: &[u8],
        name: &[u8],
    ) -> Option<(Option<ObjectId>, &'a Object)> {
        self.dicts.iter().find_map(|dict| {
            let entries = deref(doc, dict.get(category).ok()?).as_dict().ok()?;
            doc.dereference(entries.get(name).ok()?).ok()
        })
    }

    /// Every entry in a category, nearest definition first.
    pub fn entries(&self, doc: &'a Document, category: &[u8]) -> Vec<(Vec<u8>, &'a Object)> {
        let mut seen = HashSet::new();
        let mut entries = Vec::new();
        for dict in &self.dicts {
            let Some(names) = dict
                .get(category)
                .ok()
                .map(|object| deref(doc, object))
                .and_then(|object| object.as_dict().ok())
            else {
                continue;
            };
            for (name, value) in names.iter() {
                if seen.insert(name.clone()) {
                    entries.push((name.clone(), deref(doc, value)));
                }
            }
        }
        entries
    }
}

#[derive(Clone, Debug)]
pub struct Glyph {
    /// Index of the string inside a `TJ` array (0 for other text operators).
    pub element: usize,
    pub start: usize,
    pub len: usize,
    pub bbox: Rect,
    /// Advance in `TJ` adjustment units, including character and word spacing.
    pub advance: f64,
    pub exact: bool,
    pub text: String,
}

#[derive(Clone, Debug)]
pub enum ItemKind {
    Text {
        font: Vec<u8>,
        size: f64,
        glyphs: Vec<Glyph>,
        segmentable: bool,
        invisible: bool,
    },
    Image {
        name: Option<Vec<u8>>,
        id: Option<ObjectId>,
        ctm: Matrix,
    },
    Form {
        name: Vec<u8>,
        id: ObjectId,
        ctm: Matrix,
    },
    Path {
        start: usize,
        clip: bool,
    },
    Shading,
}

#[derive(Clone, Debug)]
pub struct Item {
    pub op: usize,
    pub bbox: Rect,
    /// Inside marked content or an XObject whose optional content group is off.
    pub hidden: bool,
    pub kind: ItemKind,
}

#[derive(Clone)]
struct GraphicsState {
    ctm: Matrix,
    font: Option<Vec<u8>>,
    size: f64,
    char_spacing: f64,
    word_spacing: f64,
    horizontal_scale: f64,
    leading: f64,
    rise: f64,
    render_mode: i64,
}

enum TextPart<'o> {
    Bytes(&'o [u8]),
    Adjust(f64),
}

/// Interprets one content stream without descending into form XObjects.
pub fn scan<'a>(
    doc: &'a Document,
    ops: &[Operation],
    resources: &Resources<'a>,
    base: Matrix,
    hidden_ocgs: &HashSet<ObjectId>,
) -> Vec<Item> {
    Scanner {
        doc,
        resources,
        hidden_ocgs,
        fonts: HashMap::new(),
    }
    .run(ops, base)
}

/// Visits every item in a content stream, descending into form XObjects.
pub fn walk<'a>(
    doc: &'a Document,
    ops: &[Operation],
    resources: &Resources<'a>,
    base: Matrix,
    hidden_ocgs: &HashSet<ObjectId>,
    depth: usize,
    visit: &mut dyn FnMut(&Item),
) -> Result<(), String> {
    for item in scan(doc, ops, resources, base, hidden_ocgs) {
        visit(&item);
        let ItemKind::Form { id, ctm, .. } = &item.kind else {
            continue;
        };
        if depth >= MAX_FORM_DEPTH {
            return Err("Nested form objects are too deep to process safely.".into());
        }
        let Ok(stream) = doc.get_object(*id).and_then(Object::as_stream) else {
            continue;
        };
        let nested = Resources::for_form(doc, &stream.dict, resources);
        let ops = super::stream_operations(stream)?;
        walk(doc, &ops, &nested, *ctm, hidden_ocgs, depth + 1, visit)?;
    }
    Ok(())
}

struct Scanner<'a, 'r> {
    doc: &'a Document,
    resources: &'r Resources<'a>,
    hidden_ocgs: &'r HashSet<ObjectId>,
    fonts: HashMap<Vec<u8>, Option<FontInfo<'a>>>,
}

impl<'a> Scanner<'a, '_> {
    fn run(&mut self, ops: &[Operation], base: Matrix) -> Vec<Item> {
        let mut items = Vec::new();
        let mut gs = GraphicsState {
            ctm: base,
            font: None,
            size: 0.0,
            char_spacing: 0.0,
            word_spacing: 0.0,
            horizontal_scale: 1.0,
            leading: 0.0,
            rise: 0.0,
            render_mode: 0,
        };
        let mut stack: Vec<GraphicsState> = Vec::new();
        let (mut tm, mut tlm) = (Matrix::IDENTITY, Matrix::IDENTITY);
        let mut path_start: Option<usize> = None;
        let mut path_points: Vec<(f64, f64)> = Vec::new();
        let mut clip = false;
        let mut marked: Vec<bool> = Vec::new();

        for (index, op) in ops.iter().enumerate() {
            let args = &op.operands;
            let arg = |i: usize| args.get(i).and_then(number);
            let hidden = marked.iter().any(|flag| *flag);
            match op.operator.as_str() {
                "q" => {
                    if stack.len() < MAX_GRAPHICS_STACK {
                        stack.push(gs.clone());
                    }
                }
                "Q" => {
                    if let Some(previous) = stack.pop() {
                        gs = previous;
                    }
                }
                "cm" => {
                    if let Some(matrix) = Matrix::from_objects(args) {
                        gs.ctm = matrix.then(&gs.ctm);
                    }
                }
                "BT" => {
                    tm = Matrix::IDENTITY;
                    tlm = Matrix::IDENTITY;
                }
                "Tc" => gs.char_spacing = arg(0).unwrap_or(gs.char_spacing),
                "Tw" => gs.word_spacing = arg(0).unwrap_or(gs.word_spacing),
                "Tz" => gs.horizontal_scale = arg(0).map_or(gs.horizontal_scale, |v| v / 100.0),
                "TL" => gs.leading = arg(0).unwrap_or(gs.leading),
                "Ts" => gs.rise = arg(0).unwrap_or(gs.rise),
                "Tr" => {
                    gs.render_mode = args
                        .first()
                        .and_then(|o| o.as_i64().ok())
                        .unwrap_or(gs.render_mode)
                }
                "Tf" => {
                    gs.font = args
                        .first()
                        .and_then(|o| o.as_name().ok())
                        .map(<[u8]>::to_vec);
                    gs.size = arg(1).unwrap_or(gs.size);
                }
                "Td" | "TD" => {
                    if let (Some(tx), Some(ty)) = (arg(0), arg(1)) {
                        if op.operator == "TD" {
                            gs.leading = -ty;
                        }
                        tlm = Matrix::translate(tx, ty).then(&tlm);
                        tm = tlm;
                    }
                }
                "Tm" => {
                    if let Some(matrix) = Matrix::from_objects(args) {
                        tm = matrix;
                        tlm = matrix;
                    }
                }
                "T*" => {
                    tlm = Matrix::translate(0.0, -gs.leading).then(&tlm);
                    tm = tlm;
                }
                "Tj" | "'" | "\"" | "TJ" => {
                    if op.operator == "\"" {
                        gs.word_spacing = arg(0).unwrap_or(gs.word_spacing);
                        gs.char_spacing = arg(1).unwrap_or(gs.char_spacing);
                    }
                    if op.operator == "'" || op.operator == "\"" {
                        tlm = Matrix::translate(0.0, -gs.leading).then(&tlm);
                        tm = tlm;
                    }
                    let parts = text_parts(op);
                    items.push(self.show_text(index, &parts, &mut tm, &gs, hidden));
                }
                "Do" => {
                    if let Some(item) = self.xobject(index, args, &gs, hidden) {
                        items.push(item);
                    }
                }
                "BI" => items.push(Item {
                    op: index,
                    bbox: image_bounds(&gs.ctm),
                    hidden,
                    kind: ItemKind::Image {
                        name: None,
                        id: None,
                        ctm: gs.ctm,
                    },
                }),
                "m" | "l" | "c" | "v" | "y" => {
                    path_start.get_or_insert(index);
                    let values: Vec<f64> = args.iter().filter_map(number).collect();
                    for pair in values.chunks_exact(2) {
                        path_points.push(gs.ctm.apply(pair[0], pair[1]));
                    }
                }
                "re" => {
                    path_start.get_or_insert(index);
                    if let (Some(x), Some(y), Some(w), Some(h)) = (arg(0), arg(1), arg(2), arg(3)) {
                        for (px, py) in [(x, y), (x + w, y), (x, y + h), (x + w, y + h)] {
                            path_points.push(gs.ctm.apply(px, py));
                        }
                    }
                }
                "W" | "W*" => clip = true,
                "S" | "s" | "f" | "F" | "f*" | "B" | "B*" | "b" | "b*" | "n" => {
                    if let Some(start) = path_start.take() {
                        let bbox = if path_points.is_empty() {
                            UNBOUNDED
                        } else {
                            Rect::bounding(path_points.iter().copied())
                        };
                        items.push(Item {
                            op: index,
                            bbox,
                            hidden,
                            kind: ItemKind::Path { start, clip },
                        });
                    }
                    path_points.clear();
                    clip = false;
                }
                "sh" => items.push(Item {
                    op: index,
                    bbox: UNBOUNDED,
                    hidden,
                    kind: ItemKind::Shading,
                }),
                "BDC" => {
                    let flag = self.marked_content_hidden(args);
                    marked.push(flag);
                }
                "BMC" => marked.push(false),
                "EMC" => {
                    marked.pop();
                }
                _ => {}
            }
        }
        items
    }

    fn load_font(&mut self, name: &[u8]) {
        if self.fonts.contains_key(name) {
            return;
        }
        let info = self
            .resources
            .lookup(self.doc, b"Font", name)
            .and_then(|(_, object)| object.as_dict().ok())
            .map(|dict| FontInfo::load(self.doc, dict));
        self.fonts.insert(name.to_vec(), info);
    }

    fn show_text(
        &mut self,
        op: usize,
        parts: &[(usize, TextPart<'_>)],
        tm: &mut Matrix,
        gs: &GraphicsState,
        hidden: bool,
    ) -> Item {
        let font_name = gs.font.clone().unwrap_or_default();
        self.load_font(&font_name);
        let font = self.fonts.get(&font_name).and_then(Option::as_ref);
        let size = gs.size;
        let scale = gs.horizontal_scale;
        let (ascent, descent, vertical) = font.map_or((750.0, -250.0, false), |f| {
            (f.ascent, f.descent, f.vertical)
        });
        let mut glyphs = Vec::new();
        let mut segmentable = font.is_some();
        for (element, part) in parts {
            match part {
                TextPart::Adjust(amount) => {
                    let shift = -(amount / 1000.0) * size;
                    let step = if vertical {
                        Matrix::translate(0.0, shift)
                    } else {
                        Matrix::translate(shift * scale, 0.0)
                    };
                    *tm = step.then(tm);
                }
                TextPart::Bytes(bytes) => {
                    let segments = match font.and_then(|f| f.segments(bytes)) {
                        Some(segments) => segments,
                        None => {
                            segmentable = false;
                            vec![(0, bytes.len())]
                        }
                    };
                    for (start, len) in segments {
                        let code = &bytes[start..start + len];
                        let (width, mut exact) = match font {
                            Some(f) if segmentable => f.width(code),
                            _ => (super::fonts::ESTIMATED_WIDTH * len.max(1) as f64, false),
                        };
                        let word = if len == 1 && code[0] == b' ' {
                            gs.word_spacing
                        } else {
                            0.0
                        };
                        let local = if vertical {
                            exact = false;
                            Rect::new(-size / 2.0, -size, size / 2.0, 0.0)
                        } else {
                            Rect::new(
                                0.0,
                                descent / 1000.0 * size + gs.rise,
                                width / 1000.0 * size * scale,
                                ascent / 1000.0 * size + gs.rise,
                            )
                        };
                        let bbox = tm
                            .then(&gs.ctm)
                            .transform_rect(&local)
                            .with_min_extent(MIN_EXTENT);
                        let advance = if size.abs() > f64::EPSILON {
                            width + (gs.char_spacing + word) * 1000.0 / size
                        } else {
                            exact = false;
                            width
                        };
                        let step = if vertical {
                            Matrix::translate(0.0, -size + gs.char_spacing + word)
                        } else {
                            Matrix::translate(
                                (width / 1000.0 * size + gs.char_spacing + word) * scale,
                                0.0,
                            )
                        };
                        *tm = step.then(tm);
                        glyphs.push(Glyph {
                            element: *element,
                            start,
                            len,
                            bbox,
                            advance,
                            exact,
                            text: font.map(|f| f.text(code)).unwrap_or_default(),
                        });
                    }
                }
            }
        }
        let bbox = glyphs
            .iter()
            .map(|glyph| glyph.bbox)
            .reduce(|a, b| a.union(&b))
            .unwrap_or_else(|| {
                let (x, y) = tm.then(&gs.ctm).apply(0.0, 0.0);
                Rect::new(x, y, x, y).with_min_extent(MIN_EXTENT)
            });
        Item {
            op,
            bbox,
            hidden,
            kind: ItemKind::Text {
                font: font_name,
                size,
                glyphs,
                segmentable,
                invisible: matches!(gs.render_mode, 3 | 7),
            },
        }
    }

    fn xobject(
        &self,
        op: usize,
        args: &[Object],
        gs: &GraphicsState,
        hidden: bool,
    ) -> Option<Item> {
        let name = args.first()?.as_name().ok()?;
        let (id, object) = self.resources.lookup(self.doc, b"XObject", name)?;
        let stream = object.as_stream().ok()?;
        let hidden = hidden || self.optional_content_hidden(stream.dict.get(b"OC").ok());
        let array = |key: &[u8]| {
            stream
                .dict
                .get(key)
                .ok()
                .map(|object| deref(self.doc, object))
                .and_then(|object| object.as_array().ok())
        };
        match stream.dict.get(b"Subtype").and_then(Object::as_name).ok()? {
            b"Image" => Some(Item {
                op,
                bbox: image_bounds(&gs.ctm),
                hidden,
                kind: ItemKind::Image {
                    name: Some(name.to_vec()),
                    id,
                    ctm: gs.ctm,
                },
            }),
            b"Form" => {
                let matrix = array(b"Matrix")
                    .and_then(|values| Matrix::from_objects(values))
                    .unwrap_or(Matrix::IDENTITY);
                let ctm = matrix.then(&gs.ctm);
                let bbox = array(b"BBox")
                    .and_then(|values| Rect::from_objects(values))
                    .map_or(UNBOUNDED, |bbox| ctm.transform_rect(&bbox));
                Some(Item {
                    op,
                    bbox,
                    hidden,
                    kind: ItemKind::Form {
                        name: name.to_vec(),
                        id: id?,
                        ctm,
                    },
                })
            }
            _ => None,
        }
    }

    fn marked_content_hidden(&self, args: &[Object]) -> bool {
        if args.first().and_then(|o| o.as_name().ok()) != Some(b"OC".as_slice()) {
            return false;
        }
        match args.get(1) {
            Some(Object::Name(name)) => self
                .resources
                .lookup(self.doc, b"Properties", name)
                .is_some_and(|(id, object)| {
                    id.is_some_and(|id| self.hidden_ocgs.contains(&id))
                        || self.optional_content_hidden(Some(object))
                }),
            other => self.optional_content_hidden(other),
        }
    }

    /// An optional content group or membership dictionary that references a hidden group.
    fn optional_content_hidden(&self, value: Option<&Object>) -> bool {
        let Some((id, object)) = value.and_then(|value| self.doc.dereference(value).ok()) else {
            return false;
        };
        if id.is_some_and(|id| self.hidden_ocgs.contains(&id)) {
            return true;
        }
        match object
            .as_dict()
            .ok()
            .and_then(|dict| dict.get(b"OCGs").ok())
        {
            Some(Object::Reference(group)) => self.hidden_ocgs.contains(group),
            Some(Object::Array(groups)) => groups.iter().any(
                |group| matches!(group, Object::Reference(id) if self.hidden_ocgs.contains(id)),
            ),
            _ => false,
        }
    }
}

fn string_part(object: Option<&Object>) -> Vec<(usize, TextPart<'_>)> {
    match object {
        Some(Object::String(bytes, _)) => vec![(0, TextPart::Bytes(bytes.as_slice()))],
        _ => Vec::new(),
    }
}

fn text_parts(op: &Operation) -> Vec<(usize, TextPart<'_>)> {
    match op.operator.as_str() {
        "TJ" => match op.operands.first() {
            Some(Object::Array(elements)) => elements
                .iter()
                .enumerate()
                .filter_map(|(index, element)| match element {
                    Object::String(bytes, _) => Some((index, TextPart::Bytes(bytes.as_slice()))),
                    other => number(other).map(|amount| (index, TextPart::Adjust(amount))),
                })
                .collect(),
            _ => Vec::new(),
        },
        "\"" => string_part(op.operands.get(2)),
        _ => string_part(op.operands.first()),
    }
}

fn image_bounds(ctm: &Matrix) -> Rect {
    ctm.transform_rect(&Rect::new(0.0, 0.0, 1.0, 1.0))
        .with_min_extent(MIN_EXTENT)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use lopdf::content::Content;
    use lopdf::{dictionary, Stream};

    /// A one-page document whose resources hold Helvetica as /F1 plus caller extras.
    pub fn page_document(content: &str, extra_resources: Dictionary) -> (Document, ObjectId) {
        let mut doc = Document::with_version("1.7");
        let pages = doc.new_object_id();
        let font = doc.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
            "Encoding" => "WinAnsiEncoding",
        });
        let mut resources = dictionary! {"Font" => dictionary! {"F1" => font}};
        resources.extend(&extra_resources);
        let contents = doc.add_object(Stream::new(dictionary! {}, content.as_bytes().to_vec()));
        let page = doc.add_object(dictionary! {
            "Type" => "Page", "Parent" => pages, "Contents" => contents, "Resources" => resources,
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
        });
        doc.objects.insert(
            pages,
            Object::Dictionary(
                dictionary! {"Type" => "Pages", "Kids" => vec![page.into()], "Count" => 1},
            ),
        );
        let catalog = doc.add_object(dictionary! {"Type" => "Catalog", "Pages" => pages});
        doc.trailer.set("Root", catalog);
        (doc, page)
    }

    fn items(doc: &Document, page: ObjectId) -> Vec<Item> {
        let ops = Content::decode(&doc.get_page_content(page))
            .unwrap()
            .operations;
        scan(
            doc,
            &ops,
            &Resources::for_page(doc, page),
            Matrix::IDENTITY,
            &HashSet::new(),
        )
    }

    #[test]
    fn text_glyphs_follow_font_metrics_and_adjustments() {
        let (doc, page) = page_document(
            "BT /F1 10 Tf 100 700 Td (AB) Tj [(A) -1000 (B)] TJ ET",
            dictionary! {},
        );
        let found = items(&doc, page);
        let ItemKind::Text {
            glyphs,
            segmentable,
            ..
        } = &found[0].kind
        else {
            panic!("expected text")
        };
        assert!(*segmentable);
        assert_eq!(glyphs.len(), 2);
        assert!((glyphs[0].bbox.x0 - 100.0).abs() < 1e-9);
        assert!((glyphs[0].bbox.x1 - 106.67).abs() < 1e-9);
        assert!((glyphs[1].bbox.x0 - 106.67).abs() < 1e-9);
        assert!(
            (glyphs[0].bbox.y0 - 697.5).abs() < 1e-9 && (glyphs[0].bbox.y1 - 707.5).abs() < 1e-9
        );
        assert_eq!(glyphs[0].text, "A");
        assert!(glyphs.iter().all(|glyph| glyph.exact));
        // The TJ run starts after "AB" and moves one em right after its first glyph.
        let ItemKind::Text { glyphs, .. } = &found[1].kind else {
            panic!("expected text")
        };
        assert!((glyphs[0].bbox.x0 - 113.34).abs() < 1e-9);
        assert!((glyphs[1].bbox.x0 - 130.01).abs() < 1e-9);
        assert_eq!((glyphs[0].element, glyphs[1].element), (0, 2));
    }

    #[test]
    fn images_forms_paths_and_hidden_layers_are_located() {
        let (mut doc, page) = page_document("", dictionary! {});
        let hidden_group = doc.add_object(dictionary! {"Type" => "OCG", "Name" => "Hidden"});
        let image = doc.add_object(Stream::new(
            dictionary! {"Type" => "XObject", "Subtype" => "Image", "Width" => 1, "Height" => 1},
            vec![0],
        ));
        let form = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject", "Subtype" => "Form",
                "BBox" => vec![0.into(), 0.into(), 10.into(), 10.into()],
                "Matrix" => vec![2.into(), 0.into(), 0.into(), 2.into(), 50.into(), 60.into()],
            },
            b"0 0 5 5 re f".to_vec(),
        ));
        let content = doc.add_object(Stream::new(
            dictionary! {},
            b"q 200 0 0 100 10 20 cm /Im1 Do Q /Fm1 Do 5 5 20 30 re f /OC /L1 BDC 0 0 m 1 1 l S EMC"
                .to_vec(),
        ));
        {
            let page_dict = doc.get_dictionary_mut(page).unwrap();
            page_dict.set("Contents", content);
            let resources = page_dict
                .get_mut(b"Resources")
                .unwrap()
                .as_dict_mut()
                .unwrap();
            resources.set("XObject", dictionary! {"Im1" => image, "Fm1" => form});
            resources.set("Properties", dictionary! {"L1" => hidden_group});
        }
        let ops = Content::decode(&doc.get_page_content(page))
            .unwrap()
            .operations;
        let hidden = HashSet::from([hidden_group]);
        let resources = Resources::for_page(&doc, page);
        let found = scan(&doc, &ops, &resources, Matrix::IDENTITY, &hidden);
        assert!(matches!(found[0].kind, ItemKind::Image { .. }));
        assert_eq!(found[0].bbox, Rect::new(10.0, 20.0, 210.0, 120.0));
        assert!(matches!(found[1].kind, ItemKind::Form { .. }));
        assert_eq!(found[1].bbox, Rect::new(50.0, 60.0, 70.0, 80.0));
        assert!(matches!(
            found[2].kind,
            ItemKind::Path {
                start: 5,
                clip: false
            }
        ));
        assert_eq!(found[2].bbox, Rect::new(5.0, 5.0, 25.0, 35.0));
        assert!(found[3].hidden && !found[2].hidden);

        let mut boxes = Vec::new();
        walk(
            &doc,
            &ops,
            &resources,
            Matrix::IDENTITY,
            &hidden,
            0,
            &mut |item| boxes.push(item.bbox),
        )
        .unwrap();
        assert!(boxes.contains(&Rect::new(50.0, 60.0, 60.0, 70.0)));
    }
}
