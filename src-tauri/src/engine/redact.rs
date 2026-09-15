//! Permanent redaction: removes content inside marked regions, sanitizes hidden data and
//! audits the rewritten output before it may replace the working document.

use super::content::{self, deref, Glyph, ItemKind, Resources};
use super::geometry::{Matrix, Rect};
use super::images::{self, Source};
use lopdf::content::Operation;
use lopdf::{Dictionary, Document, Object, ObjectId, Stream};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::sync::atomic::AtomicBool;

const MAX_REGIONS: usize = 10_000;
const MAX_TERMS: usize = 500;
const MAX_TERM_CHARS: usize = 1_000;
/// Lossy JPEG samples inside a redacted area must decode within this distance of black.
const JPEG_BLACK_TOLERANCE: u8 = 48;
/// Extra blackened samples around JPEG regions so block artifacts stay outside the audit.
const JPEG_FILL_MARGIN: usize = 16;
const REDACTION_JPEG_QUALITY: u8 = 92;
/// Compact-text term matching ignores word boundaries, so it only applies to longer terms.
const MIN_COMPACT_TERM_CHARS: usize = 6;
const UNMEASURABLE_TEXT: &str = "Redaction was blocked because text near a marked area uses a font whose character codes cannot be measured, so its removal cannot be verified. The document is unchanged.";
const MARKUP_SUBTYPES: &[&[u8]] = &[
    b"Text",
    b"FreeText",
    b"Line",
    b"Square",
    b"Circle",
    b"Polygon",
    b"PolyLine",
    b"Highlight",
    b"Underline",
    b"Squiggly",
    b"StrikeOut",
    b"Stamp",
    b"Caret",
    b"Ink",
    b"Popup",
    b"FileAttachment",
    b"Sound",
    b"Redact",
];
const UNSAFE_ACTIONS: &[&[u8]] = &[
    b"JavaScript",
    b"Launch",
    b"SubmitForm",
    b"ImportData",
    b"Rendition",
    b"RichMediaExecute",
    b"GoToE",
    b"GoToR",
];

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionInput {
    pub page: u32,
    pub rect: [f64; 4],
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SanitizeOptions {
    pub remove_metadata: bool,
    pub remove_attachments: bool,
    pub remove_scripts: bool,
    pub remove_comments: bool,
    pub remove_bookmarks: bool,
    pub remove_hidden_content: bool,
}

impl Default for SanitizeOptions {
    fn default() -> Self {
        Self {
            remove_metadata: true,
            remove_attachments: true,
            remove_scripts: true,
            remove_comments: false,
            remove_bookmarks: false,
            remove_hidden_content: true,
        }
    }
}

/// Deliberately has no `Debug` implementation: terms are sensitive and must not reach logs.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactionRequest {
    pub regions: Vec<RegionInput>,
    #[serde(default)]
    pub terms: Vec<String>,
    #[serde(default)]
    pub options: SanitizeOptions,
    #[serde(default)]
    pub acknowledge_signatures: bool,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditReport {
    pub passed: bool,
    pub regions_checked: usize,
    pub residual_region_items: usize,
    pub terms_checked: usize,
    pub residual_terms: usize,
    pub streams_scanned: usize,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactionReport {
    pub pages: Vec<u32>,
    pub removed_glyphs: usize,
    pub pixel_redacted_images: usize,
    pub removed_images: usize,
    pub removed_paths: usize,
    pub removed_annotations: usize,
    pub hidden_annotations_removed: usize,
    pub removed_form_fields: usize,
    pub rewritten_forms: usize,
    pub sanitized: Vec<String>,
    pub warnings: Vec<String>,
    pub audit: AuditReport,
}

/// The regions and terms a redacted output must keep passing. Deliberately has no `Debug`
/// implementation because the terms are sensitive.
#[derive(Clone, Default)]
pub struct AuditSpec {
    pub regions: BTreeMap<u32, Vec<Rect>>,
    pub terms: Vec<String>,
}

impl AuditSpec {
    /// Validates a request's regions and terms without loading the document.
    pub fn from_request(request: &RedactionRequest) -> Result<Self, String> {
        let terms = validated_terms(request)?;
        Ok(Self {
            regions: region_map(&request.regions)?,
            terms,
        })
    }

    /// Adds another pass's regions and terms so earlier redactions keep being audited.
    pub fn merge(&mut self, other: AuditSpec) {
        for (page, rects) in other.regions {
            self.regions.entry(page).or_default().extend(rects);
        }
        for term in other.terms {
            if !self.terms.contains(&term) {
                self.terms.push(term);
            }
        }
    }
}

type ResourceAddition = (Vec<u8>, Vec<u8>, ObjectId);

/// Applies redactions to a fresh copy and returns it only when the independent audit passes.
pub fn apply(
    bytes: &[u8],
    request: &RedactionRequest,
    cancel: &AtomicBool,
) -> Result<(Vec<u8>, RedactionReport), String> {
    let terms = validated_terms(request)?;
    let mut doc = super::load(bytes)?;
    let pages = doc.get_pages();
    let regions = group_regions(&pages, &request.regions)?;
    let options = request.options;
    let mut report = RedactionReport::default();
    clear_signatures(&mut doc, request.acknowledge_signatures, &mut report)?;
    let hidden = if options.remove_hidden_content {
        hidden_groups(&doc)
    } else {
        HashSet::new()
    };

    for (&number, &page_id) in &pages {
        super::check_cancelled(cancel)?;
        let page_regions = regions.get(&number).map(Vec::as_slice).unwrap_or_default();
        if page_regions.is_empty() && !options.remove_hidden_content {
            continue;
        }
        if !page_regions.is_empty() {
            reject_tiling_pattern_content(&doc, page_id, number)?;
            reject_shading_content(&doc, page_id, number)?;
        }
        redact_page(
            &mut doc,
            page_id,
            page_regions,
            &hidden,
            options.remove_hidden_content,
            &mut report,
        )?;
        if !page_regions.is_empty() {
            report.pages.push(number);
            let removed = filter_annotations(&mut doc, page_id, |_doc, annotation| {
                annotation_rect(annotation)
                    .is_some_and(|rect| page_regions.iter().any(|region| region.overlaps(&rect)))
            });
            report.removed_annotations += removed.count;
            report.removed_form_fields += prune_fields(&mut doc, &removed.ids);
        }
    }
    sanitize_document(&mut doc, &pages, &options, &mut report)?;
    doc.prune_objects();
    let output = super::save(&mut doc)?;
    super::check_cancelled(cancel)?;
    report.audit = audit(&output, &regions, &terms)?;
    if !report.audit.passed {
        return Err(format!(
            "Redaction was blocked because the audit found {} marked item(s) still inside a region and {} audit term(s) still present in text, metadata, attachments or hidden data. The document is unchanged.",
            report.audit.residual_region_items, report.audit.residual_terms
        ));
    }
    Ok((output, report))
}

fn validated_terms(request: &RedactionRequest) -> Result<Vec<String>, String> {
    if request.regions.len() > MAX_REGIONS {
        return Err("Too many redaction regions for one pass (limit 10,000).".into());
    }
    if request.terms.len() > MAX_TERMS {
        return Err("Too many audit terms for one pass (limit 500).".into());
    }
    let terms: Vec<String> = request
        .terms
        .iter()
        .map(|term| term.trim().to_owned())
        .filter(|term| !term.is_empty())
        .collect();
    if terms
        .iter()
        .any(|term| term.chars().count() > MAX_TERM_CHARS)
    {
        return Err("Audit terms can be at most 1,000 characters long.".into());
    }
    Ok(terms)
}

fn group_regions(
    pages: &BTreeMap<u32, ObjectId>,
    inputs: &[RegionInput],
) -> Result<BTreeMap<u32, Vec<Rect>>, String> {
    if let Some(missing) = inputs.iter().find(|input| !pages.contains_key(&input.page)) {
        return Err(format!(
            "Page {} does not exist in this document.",
            missing.page
        ));
    }
    region_map(inputs)
}

fn region_map(inputs: &[RegionInput]) -> Result<BTreeMap<u32, Vec<Rect>>, String> {
    let mut regions: BTreeMap<u32, Vec<Rect>> = BTreeMap::new();
    for input in inputs {
        let [x0, y0, x1, y1] = input.rect;
        let rect = Rect::new(x0, y0, x1, y1);
        if !rect.is_valid() || rect.width() <= 0.0 || rect.height() <= 0.0 {
            return Err("A redaction region is empty or invalid.".into());
        }
        regions.entry(input.page).or_default().push(rect);
    }
    Ok(regions)
}

/// New objects allocated while the document is only borrowed immutably.
struct Plan {
    next_id: u32,
    objects: Vec<(ObjectId, Object)>,
}

impl Plan {
    fn allocate(&mut self, object: Object) -> ObjectId {
        self.next_id += 1;
        let id = (self.next_id, 0);
        self.objects.push((id, object));
        id
    }

    fn resource_name(&self, doc: &Document, resources: &Resources<'_>, prefix: &str) -> Vec<u8> {
        let mut index = self.next_id;
        loop {
            let name = format!("NavRedact{prefix}{index}").into_bytes();
            if resources.lookup(doc, b"XObject", &name).is_none() {
                return name;
            }
            index += 1;
        }
    }
}

struct Rewriter<'a, 'p> {
    doc: &'a Document,
    regions: &'p [Rect],
    hidden: &'p HashSet<ObjectId>,
    remove_hidden: bool,
    plan: &'p mut Plan,
    report: &'p mut RedactionReport,
}

fn redact_page(
    doc: &mut Document,
    page_id: ObjectId,
    regions: &[Rect],
    hidden: &HashSet<ObjectId>,
    remove_hidden: bool,
    report: &mut RedactionReport,
) -> Result<(), String> {
    let ops = super::page_operations(doc, page_id)?;
    let mut plan = Plan {
        next_id: doc.max_id,
        objects: Vec::new(),
    };
    let mut additions = Vec::new();
    let (new_ops, changed) = {
        let document: &Document = doc;
        let resources = Resources::for_page(document, page_id);
        let mut rewriter = Rewriter {
            doc: document,
            regions,
            hidden,
            remove_hidden,
            plan: &mut plan,
            report,
        };
        rewriter.rewrite(&ops, &resources, Matrix::IDENTITY, 0, &mut additions)?
    };
    if !changed && regions.is_empty() {
        return Ok(());
    }
    for (id, object) in plan.objects {
        doc.objects.insert(id, object);
    }
    doc.max_id = doc.max_id.max(plan.next_id);
    let unclosed = open_graphics_states(&new_ops);
    let mut stream = b"q\n".to_vec();
    stream.extend(super::encode_operations(new_ops)?);
    stream.extend_from_slice(b"\n");
    // Close any states the original content left open so the boxes use default user space.
    stream.extend(std::iter::repeat_n(b"Q\n".as_slice(), unclosed + 1).flatten());
    for rect in regions {
        stream.extend(
            format!(
                "q 0 0 0 rg {:.4} {:.4} {:.4} {:.4} re f Q\n",
                rect.x0,
                rect.y0,
                rect.width(),
                rect.height()
            )
            .as_bytes(),
        );
    }
    super::set_page_content(doc, page_id, stream)?;
    if !additions.is_empty() {
        super::own_page_resources(doc, page_id)?;
        for (category, name, id) in additions {
            super::add_page_resource(doc, page_id, &category, &name, id)?;
        }
    }
    Ok(())
}

fn open_graphics_states(ops: &[Operation]) -> usize {
    ops.iter()
        .fold(0_usize, |depth, op| match op.operator.as_str() {
            "q" => depth + 1,
            "Q" => depth.saturating_sub(1),
            _ => depth,
        })
}

impl<'a> Rewriter<'a, '_> {
    fn overlaps(&self, rect: &Rect) -> bool {
        self.regions.iter().any(|region| region.overlaps(rect))
    }

    fn rewrite(
        &mut self,
        ops: &[Operation],
        resources: &Resources<'a>,
        base: Matrix,
        depth: usize,
        additions: &mut Vec<ResourceAddition>,
    ) -> Result<(Vec<Operation>, bool), String> {
        let items = content::scan(self.doc, ops, resources, base, self.hidden);
        let mut replacements: BTreeMap<usize, Vec<Operation>> = BTreeMap::new();
        let mut dropped = vec![false; ops.len()];
        for item in &items {
            let hidden = self.remove_hidden && item.hidden;
            match &item.kind {
                ItemKind::Text {
                    glyphs,
                    segmentable,
                    invisible,
                    size,
                    ..
                } => {
                    let remove: Vec<bool> = if hidden || (self.remove_hidden && *invisible) {
                        vec![true; glyphs.len()]
                    } else if *segmentable && glyphs.iter().all(|glyph| glyph.exact) {
                        glyphs
                            .iter()
                            .map(|glyph| self.overlaps(&glyph.bbox))
                            .collect()
                    } else {
                        let near = self.overlaps(&item.bbox.inflate(size.abs().max(1.0)));
                        if near && !*segmentable {
                            // Estimated advances would also misplace later glyphs in both the
                            // rewrite and the audit, so this text cannot be verified.
                            return Err(UNMEASURABLE_TEXT.into());
                        }
                        // Measurable but approximate metrics: remove the whole string.
                        vec![near; glyphs.len()]
                    };
                    if remove.iter().any(|removed| *removed) {
                        self.report.removed_glyphs +=
                            remove.iter().filter(|removed| **removed).count();
                        replacements.insert(item.op, rewrite_text(&ops[item.op], glyphs, &remove));
                    }
                }
                ItemKind::Image { name, id, ctm } => {
                    let hits: Vec<Rect> = self
                        .regions
                        .iter()
                        .filter(|region| region.overlaps(&item.bbox))
                        .copied()
                        .collect();
                    if !hidden && hits.is_empty() {
                        continue;
                    }
                    let redacted = match (name, id, hidden) {
                        (Some(_), Some(id), false) => self.redact_image(*id, ctm, &hits)?,
                        _ => None,
                    };
                    let replacement = match redacted {
                        Some(new_id) => {
                            let new_name = self.plan.resource_name(self.doc, resources, "Im");
                            additions.push((b"XObject".to_vec(), new_name.clone(), new_id));
                            self.report.pixel_redacted_images += 1;
                            vec![Operation::new("Do", vec![Object::Name(new_name)])]
                        }
                        None => {
                            self.report.removed_images += 1;
                            Vec::new()
                        }
                    };
                    replacements.insert(item.op, replacement);
                }
                ItemKind::Form { id, ctm, .. } => {
                    if hidden {
                        replacements.insert(item.op, Vec::new());
                        continue;
                    }
                    if !self.remove_hidden && !self.overlaps(&item.bbox) {
                        continue;
                    }
                    if depth >= content::MAX_FORM_DEPTH {
                        return Err("Nested form objects are too deep to redact safely.".into());
                    }
                    let Some(new_id) = self.rewrite_form(*id, ctm, resources, depth)? else {
                        continue;
                    };
                    let new_name = self.plan.resource_name(self.doc, resources, "Fm");
                    additions.push((b"XObject".to_vec(), new_name.clone(), new_id));
                    replacements.insert(
                        item.op,
                        vec![Operation::new("Do", vec![Object::Name(new_name)])],
                    );
                    self.report.rewritten_forms += 1;
                }
                ItemKind::Path { start, clip } => {
                    if *clip {
                        continue;
                    }
                    if hidden || self.overlaps(&item.bbox) {
                        dropped[*start..=item.op].fill(true);
                        self.report.removed_paths += 1;
                    }
                }
                ItemKind::Shading => {
                    if hidden {
                        replacements.insert(item.op, Vec::new());
                    }
                }
            }
        }
        let changed = !replacements.is_empty() || dropped.contains(&true);
        let mut output = Vec::with_capacity(ops.len());
        for (index, op) in ops.iter().enumerate() {
            if dropped[index] {
                continue;
            }
            match replacements.remove(&index) {
                Some(new_ops) => output.extend(new_ops),
                None => output.push(op.clone()),
            }
        }
        Ok((output, changed))
    }

    /// A page-private copy of a form whose content was redacted, or `None` when unchanged.
    fn rewrite_form(
        &mut self,
        id: ObjectId,
        ctm: &Matrix,
        resources: &Resources<'a>,
        depth: usize,
    ) -> Result<Option<ObjectId>, String> {
        let stream = self
            .doc
            .get_object(id)
            .and_then(Object::as_stream)
            .map_err(|_| "A form object could not be read.")?;
        let nested = Resources::for_form(self.doc, &stream.dict, resources);
        let form_ops = super::stream_operations(stream)?;
        let mut nested_additions = Vec::new();
        let (new_ops, changed) =
            self.rewrite(&form_ops, &nested, *ctm, depth + 1, &mut nested_additions)?;
        if !changed {
            return Ok(None);
        }
        let mut dict = stream.dict.clone();
        let mut own_resources = dict
            .get(b"Resources")
            .ok()
            .map(|object| deref(self.doc, object))
            .and_then(|object| object.as_dict().ok())
            .cloned()
            .unwrap_or_default();
        for (category, name, target) in nested_additions {
            let mut entries = own_resources
                .get(&category)
                .ok()
                .map(|object| deref(self.doc, object))
                .and_then(|object| object.as_dict().ok())
                .cloned()
                .unwrap_or_default();
            entries.set(name, Object::Reference(target));
            own_resources.set(category, entries);
        }
        dict.set("Resources", own_resources);
        for key in [b"Filter".as_slice(), b"DecodeParms", b"Length"] {
            dict.remove(key);
        }
        let mut clone = Stream::new(dict, super::encode_operations(new_ops)?);
        let _ = clone.compress();
        Ok(Some(self.plan.allocate(Object::Stream(clone))))
    }

    /// A page-private copy of the image with the regions blackened, or `None` when the
    /// samples cannot be redacted and the placement must be removed instead.
    fn redact_image(
        &mut self,
        id: ObjectId,
        ctm: &Matrix,
        hits: &[Rect],
    ) -> Result<Option<ObjectId>, String> {
        let Ok(stream) = self.doc.get_object(id).and_then(Object::as_stream) else {
            return Ok(None);
        };
        let mut raster = match images::decode(self.doc, stream) {
            Ok(raster) => raster,
            Err(reason) => {
                self.warn(format!(
                    "An image was removed entirely because {reason}, so it could not be redacted pixel by pixel."
                ));
                return Ok(None);
            }
        };
        let margin = if raster.source == Source::Jpeg {
            JPEG_FILL_MARGIN
        } else {
            0
        };
        let black = raster.black();
        let mut filled = false;
        for hit in hits {
            if let Some(region) = images::pixel_region(ctm, hit, raster.width, raster.height) {
                raster.fill(expand(region, margin, raster.width, raster.height), &black);
                filled = true;
            }
        }
        if !filled {
            return Ok(None);
        }
        let mut template = stream.dict.clone();
        if let Ok(mask_reference) = stream.dict.get(b"SMask") {
            let Ok(mask_id) = mask_reference.as_reference() else {
                return Ok(None);
            };
            let Ok(mask) = self.doc.get_object(mask_id).and_then(Object::as_stream) else {
                return Ok(None);
            };
            let Ok(mut alpha) = images::decode(self.doc, mask) else {
                return Ok(None);
            };
            if alpha.components != 1 {
                return Ok(None);
            }
            // A soft mask can outline hidden content, so the redacted area becomes opaque.
            for hit in hits {
                if let Some(region) = images::pixel_region(ctm, hit, alpha.width, alpha.height) {
                    let region = expand(region, margin, alpha.width, alpha.height);
                    alpha.fill(region, &[255]);
                }
            }
            let mask_stream = images::encode_flate(&alpha, &mask.dict);
            template.set(
                "SMask",
                Object::Reference(self.plan.allocate(Object::Stream(mask_stream))),
            );
        }
        let redacted = match raster.source {
            Source::Jpeg => images::encode_jpeg(&raster, &template, REDACTION_JPEG_QUALITY)
                .map_err(|reason| format!("A redacted image could not be encoded: {reason}."))?,
            _ => images::encode_flate(&raster, &template),
        };
        Ok(Some(self.plan.allocate(Object::Stream(redacted))))
    }

    fn warn(&mut self, message: String) {
        if !self.report.warnings.contains(&message) {
            self.report.warnings.push(message);
        }
    }
}

fn expand(
    region: images::PixelRegion,
    margin: usize,
    width: usize,
    height: usize,
) -> images::PixelRegion {
    let (x0, y0, x1, y1) = region;
    (
        x0.saturating_sub(margin),
        y0.saturating_sub(margin),
        (x1 + margin).min(width),
        (y1 + margin).min(height),
    )
}

/// Rebuilds a text-showing operation without the removed glyphs, replacing each with a
/// `TJ` adjustment of the same advance so the remaining text keeps its position.
pub(super) fn rewrite_text(op: &Operation, glyphs: &[Glyph], remove: &[bool]) -> Vec<Operation> {
    let elements: Vec<Object> = match op.operator.as_str() {
        "TJ" => op
            .operands
            .first()
            .and_then(|o| o.as_array().ok())
            .cloned()
            .unwrap_or_default(),
        "\"" => op.operands.get(2).cloned().into_iter().collect(),
        _ => op.operands.first().cloned().into_iter().collect(),
    };
    let mut array = Vec::new();
    for (index, element) in elements.iter().enumerate() {
        let Object::String(bytes, format) = element else {
            array.push(element.clone());
            continue;
        };
        let mut kept = Vec::new();
        let mut adjustment = 0.0;
        for (glyph, removed) in glyphs
            .iter()
            .zip(remove)
            .filter(|(glyph, _)| glyph.element == index)
        {
            if *removed {
                if !kept.is_empty() {
                    array.push(Object::String(std::mem::take(&mut kept), *format));
                }
                adjustment -= glyph.advance;
            } else {
                if adjustment != 0.0 {
                    array.push(Object::Real(adjustment as f32));
                    adjustment = 0.0;
                }
                kept.extend_from_slice(&bytes[glyph.start..glyph.start + glyph.len]);
            }
        }
        if adjustment != 0.0 {
            array.push(Object::Real(adjustment as f32));
        }
        if !kept.is_empty() {
            array.push(Object::String(kept, *format));
        }
    }
    let show = Operation::new("TJ", vec![Object::Array(array)]);
    match op.operator.as_str() {
        "'" => vec![Operation::new("T*", vec![]), show],
        "\"" => vec![
            Operation::new("Tw", op.operands.first().cloned().into_iter().collect()),
            Operation::new("Tc", op.operands.get(1).cloned().into_iter().collect()),
            Operation::new("T*", vec![]),
            show,
        ],
        _ => vec![show],
    }
}

fn catalog_id(doc: &Document) -> Result<ObjectId, String> {
    doc.trailer
        .get(b"Root")
        .and_then(Object::as_reference)
        .map_err(|_| "The document catalog is missing.".into())
}

fn clear_signatures(
    doc: &mut Document,
    acknowledged: bool,
    report: &mut RedactionReport,
) -> Result<(), String> {
    let signed: Vec<ObjectId> = doc
        .objects
        .iter()
        .filter(|(_, object)| {
            object.as_dict().is_ok_and(|dict| {
                dict.get(b"FT")
                    .and_then(Object::as_name)
                    .is_ok_and(|kind| kind == b"Sig")
                    && dict.has(b"V")
            })
        })
        .map(|(id, _)| *id)
        .collect();
    let catalog = catalog_id(doc)?;
    let certified = doc.get_dictionary(catalog).is_ok_and(|c| c.has(b"Perms"));
    if signed.is_empty() && !certified {
        return Ok(());
    }
    if !acknowledged {
        return Err(
            "This PDF is digitally signed. Applying redactions invalidates its signatures; confirm to continue."
                .into(),
        );
    }
    for id in signed {
        if let Ok(field) = doc.get_dictionary_mut(id) {
            field.remove(b"V");
        }
    }
    if let Ok(catalog) = doc.get_dictionary_mut(catalog) {
        catalog.remove(b"Perms");
    }
    report
        .sanitized
        .push("Digital signature values, which the redaction invalidates".into());
    Ok(())
}

/// Optional content groups that the default configuration hides.
fn hidden_groups(doc: &Document) -> HashSet<ObjectId> {
    let Some(properties) = catalog_id(doc)
        .ok()
        .and_then(|id| doc.get_dictionary(id).ok())
        .and_then(|catalog| catalog.get(b"OCProperties").ok())
        .map(|object| deref(doc, object))
        .and_then(|object| object.as_dict().ok())
    else {
        return HashSet::new();
    };
    let references = |dict: Option<&Dictionary>, key: &[u8]| -> HashSet<ObjectId> {
        dict.and_then(|d| d.get(key).ok())
            .map(|object| deref(doc, object))
            .and_then(|object| object.as_array().ok())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_reference().ok())
                    .collect()
            })
            .unwrap_or_default()
    };
    let config = properties
        .get(b"D")
        .ok()
        .map(|object| deref(doc, object))
        .and_then(|object| object.as_dict().ok());
    let mut hidden = references(config, b"OFF");
    let base_off = config
        .and_then(|d| d.get(b"BaseState").ok())
        .and_then(|state| state.as_name().ok())
        == Some(b"OFF".as_slice());
    if base_off {
        let visible = references(config, b"ON");
        hidden.extend(
            references(Some(properties), b"OCGs")
                .into_iter()
                .filter(|group| !visible.contains(group)),
        );
    }
    hidden
}

fn reject_tiling_pattern_content(
    doc: &Document,
    page_id: ObjectId,
    number: u32,
) -> Result<(), String> {
    let resources = Resources::for_page(doc, page_id);
    for (_, pattern) in resources.entries(doc, b"Pattern") {
        let Ok(stream) = pattern.as_stream() else {
            continue;
        };
        let paints_objects = super::stream_operations(stream).is_ok_and(|ops| {
            ops.iter()
                .any(|op| matches!(op.operator.as_str(), "Tj" | "TJ" | "'" | "\"" | "Do" | "BI"))
        });
        if paints_objects {
            return Err(format!(
                "Page {number} paints text or objects through a tiling pattern, which redaction does not support. The document is unchanged."
            ));
        }
    }
    Ok(())
}

fn reject_shading_content(doc: &Document, page_id: ObjectId, number: u32) -> Result<(), String> {
    let ops = super::page_operations(doc, page_id)?;
    let resources = Resources::for_page(doc, page_id);
    let mut found = false;
    content::walk(
        doc,
        &ops,
        &resources,
        Matrix::IDENTITY,
        &HashSet::new(),
        0,
        &mut |item| {
            if matches!(item.kind, ItemKind::Shading) {
                found = true;
            }
        },
    )?;
    if found {
        return Err(format!(
            "Page {number} paints a shading fill, which redaction does not support safely. The document is unchanged."
        ));
    }
    Ok(())
}

fn annotation_rect(annotation: &Dictionary) -> Option<Rect> {
    annotation
        .get(b"Rect")
        .and_then(Object::as_array)
        .ok()
        .and_then(|values| Rect::from_objects(values))
}

struct RemovedAnnotations {
    count: usize,
    ids: HashSet<ObjectId>,
}

/// Removes matching annotations, and popups belonging to removed annotations, from a page.
fn filter_annotations(
    doc: &mut Document,
    page_id: ObjectId,
    should_remove: impl Fn(&Document, &Dictionary) -> bool,
) -> RemovedAnnotations {
    let mut removed = RemovedAnnotations {
        count: 0,
        ids: HashSet::new(),
    };
    let kept = {
        let Some(entries) = doc
            .get_dictionary(page_id)
            .ok()
            .and_then(|page| page.get(b"Annots").ok())
            .map(|object| deref(doc, object))
            .and_then(|object| object.as_array().ok())
        else {
            return removed;
        };
        fn resolve<'a>(
            doc: &'a Document,
            entry: &'a Object,
        ) -> Option<(Option<ObjectId>, &'a Dictionary)> {
            doc.dereference(entry)
                .ok()
                .and_then(|(id, object)| object.as_dict().ok().map(|dict| (id, dict)))
        }
        let resolve = |entry| resolve(doc, entry);
        let mut kept = Vec::new();
        for entry in entries {
            match resolve(entry) {
                Some((id, annotation)) if should_remove(doc, annotation) => {
                    removed.count += 1;
                    removed.ids.extend(id);
                }
                _ => kept.push(entry.clone()),
            }
        }
        fn parent_of(doc: &Document, entry: &Object) -> Option<ObjectId> {
            let annotation = match entry {
                Object::Reference(id) => doc.get_dictionary(*id).ok()?,
                Object::Dictionary(dict) => dict,
                _ => return None,
            };
            annotation
                .get(b"Parent")
                .and_then(Object::as_reference)
                .ok()
        }
        let before = kept.len();
        kept.retain(|entry| {
            !parent_of(doc, entry).is_some_and(|parent| removed.ids.contains(&parent))
        });
        removed.count += before - kept.len();
        kept
    };
    if removed.count == 0 {
        return removed;
    }
    if let Ok(page) = doc.get_dictionary_mut(page_id) {
        if kept.is_empty() {
            page.remove(b"Annots");
        } else {
            page.set("Annots", Object::Array(kept));
        }
    }
    removed
}

fn annotation_hidden_by_layers(
    doc: &Document,
    annot: &Dictionary,
    hidden: &HashSet<ObjectId>,
) -> bool {
    let Some(oc_obj) = annot.get(b"OC").ok() else {
        return false;
    };
    let oc_id = oc_obj.as_reference().ok();
    let oc_dict = match oc_obj {
        Object::Reference(id) => doc.get_dictionary(*id).ok(),
        Object::Dictionary(dict) => Some(dict),
        _ => None,
    };
    let Some(dict) = oc_dict else {
        if let Some(id) = oc_id {
            return hidden.contains(&id);
        }
        return false;
    };

    let is_ocmd = dict
        .get(b"Type")
        .and_then(Object::as_name)
        .is_ok_and(|t| t == b"OCMD");
    if !is_ocmd {
        if let Some(id) = oc_id {
            return hidden.contains(&id);
        }
        return false;
    }

    let ocgs: Vec<ObjectId> = match dict.get(b"OCGs").ok() {
        Some(Object::Reference(id)) => vec![*id],
        Some(Object::Array(arr)) => arr
            .iter()
            .filter_map(|item| item.as_reference().ok())
            .collect(),
        _ => Vec::new(),
    };
    if ocgs.is_empty() {
        return false;
    }

    let policy = dict.get(b"P").and_then(Object::as_name).unwrap_or(b"AnyOn");

    let is_off = |id: &ObjectId| hidden.contains(id);
    let is_on = |id: &ObjectId| !hidden.contains(id);

    let is_visible = match policy {
        b"AllOn" => ocgs.iter().all(is_on),
        b"AnyOff" => ocgs.iter().any(is_off),
        b"AllOff" => ocgs.iter().all(is_off),
        _ => ocgs.iter().any(is_on),
    };

    !is_visible
}

/// Removes deleted widget annotations from the interactive form tree, then removes ancestor
/// fields left without any widget so a field value cannot survive its removed appearance.
fn prune_fields(doc: &mut Document, removed: &HashSet<ObjectId>) -> usize {
    const MAX_FIELD_DEPTH: usize = 16;
    let mut removed = removed.clone();
    let mut count = prune_field_references(doc, &removed);
    for _ in 0..MAX_FIELD_DEPTH {
        let orphaned: HashSet<ObjectId> = doc
            .objects
            .iter()
            .filter(|(id, _)| !removed.contains(id))
            .filter(|(_, object)| {
                object.as_dict().is_ok_and(|field| {
                    matches!(field.get(b"Kids"), Ok(Object::Array(kids)) if kids.is_empty())
                        && (field.has(b"FT") || field.has(b"T") || field.has(b"V"))
                })
            })
            .map(|(id, _)| *id)
            .collect();
        if orphaned.is_empty() {
            break;
        }
        removed.extend(orphaned.iter().copied());
        count += prune_field_references(doc, &orphaned);
    }
    count
}

fn prune_field_references(doc: &mut Document, removed: &HashSet<ObjectId>) -> usize {
    fn prune(dict: &mut Dictionary, removed: &HashSet<ObjectId>) -> usize {
        let mut count = 0;
        for key in [b"Fields".as_slice(), b"Kids"] {
            if let Ok(Object::Array(items)) = dict.get_mut(key) {
                let before = items.len();
                items.retain(|item| !matches!(item, Object::Reference(id) if removed.contains(id)));
                count += before - items.len();
            }
        }
        if let Ok(Object::Dictionary(form)) = dict.get_mut(b"AcroForm") {
            count += prune(form, removed);
        }
        count
    }
    if removed.is_empty() {
        return 0;
    }
    doc.objects
        .values_mut()
        .filter_map(|object| object.as_dict_mut().ok())
        .map(|dict| prune(dict, removed))
        .sum()
}

fn remove_keys(object: &mut Object, keys: &[&[u8]]) {
    fn strip(dict: &mut Dictionary, keys: &[&[u8]]) {
        for key in keys {
            dict.remove(key);
        }
        for (_, value) in dict.iter_mut() {
            remove_keys(value, keys);
        }
    }
    match object {
        Object::Dictionary(dict) => strip(dict, keys),
        Object::Stream(stream) => strip(&mut stream.dict, keys),
        Object::Array(items) => items.iter_mut().for_each(|item| remove_keys(item, keys)),
        _ => {}
    }
}

fn is_unsafe_action(action: &Dictionary) -> bool {
    action
        .get(b"S")
        .and_then(Object::as_name)
        .is_ok_and(|kind| UNSAFE_ACTIONS.contains(&kind))
}

fn strip_actions(object: &mut Object, unsafe_ids: &HashSet<ObjectId>) {
    fn strip(dict: &mut Dictionary, unsafe_ids: &HashSet<ObjectId>) {
        for key in [b"A".as_slice(), b"OpenAction", b"Next"] {
            let unsafe_action = match dict.get(key) {
                Ok(Object::Reference(id)) => unsafe_ids.contains(id),
                Ok(Object::Dictionary(action)) => is_unsafe_action(action),
                _ => false,
            };
            if unsafe_action {
                dict.remove(key);
            }
        }
        for (_, value) in dict.iter_mut() {
            strip_actions(value, unsafe_ids);
        }
    }
    match object {
        Object::Dictionary(dict) => strip(dict, unsafe_ids),
        Object::Stream(stream) => strip(&mut stream.dict, unsafe_ids),
        Object::Array(items) => items
            .iter_mut()
            .for_each(|item| strip_actions(item, unsafe_ids)),
        _ => {}
    }
}

fn names_dictionary(doc: &mut Document, catalog: ObjectId) -> Option<&mut Dictionary> {
    let reference = doc
        .get_dictionary(catalog)
        .ok()
        .and_then(|c| c.get(b"Names").ok())
        .and_then(|names| names.as_reference().ok());
    match reference {
        Some(id) => doc.get_dictionary_mut(id).ok(),
        None => doc
            .get_dictionary_mut(catalog)
            .ok()
            .and_then(|c| c.get_mut(b"Names").ok())
            .and_then(|names| names.as_dict_mut().ok()),
    }
}

fn remove_page_annotations(
    doc: &mut Document,
    pages: &BTreeMap<u32, ObjectId>,
    subtypes: &[&[u8]],
) -> usize {
    pages
        .values()
        .map(|page_id| {
            filter_annotations(doc, *page_id, |_doc, annotation| {
                annotation
                    .get(b"Subtype")
                    .and_then(Object::as_name)
                    .is_ok_and(|subtype| subtypes.contains(&subtype))
            })
            .count
        })
        .sum()
}

fn sanitize_document(
    doc: &mut Document,
    pages: &BTreeMap<u32, ObjectId>,
    options: &SanitizeOptions,
    report: &mut RedactionReport,
) -> Result<(), String> {
    let catalog = catalog_id(doc)?;
    let mut catalog_keys: Vec<&[u8]> = vec![b"StructTreeRoot", b"MarkInfo"];
    let mut keys: Vec<&[u8]> = vec![b"Thumb", b"StructParents", b"StructParent", b"XFA"];
    if options.remove_metadata {
        doc.trailer.remove(b"Info");
        keys.extend([b"Metadata".as_slice(), b"PieceInfo", b"LastModified"]);
        report
            .sanitized
            .push("Document information, XMP metadata and private application data".into());
    }
    if options.remove_attachments {
        if let Some(names) = names_dictionary(doc, catalog) {
            names.remove(b"EmbeddedFiles");
        }
        catalog_keys.push(b"Collection");
        keys.push(b"AF");
        report.removed_annotations += remove_page_annotations(doc, pages, &[b"FileAttachment"]);
        report
            .sanitized
            .push("Embedded files and file attachment annotations".into());
    }
    if options.remove_scripts {
        if let Some(names) = names_dictionary(doc, catalog) {
            names.remove(b"JavaScript");
        }
        keys.push(b"AA");
        let unsafe_ids: HashSet<ObjectId> = doc
            .objects
            .iter()
            .filter(|(_, object)| object.as_dict().is_ok_and(is_unsafe_action))
            .map(|(id, _)| *id)
            .collect();
        for object in doc.objects.values_mut() {
            strip_actions(object, &unsafe_ids);
        }
        report
            .sanitized
            .push("JavaScript, launch, remote and form submission actions".into());
    }
    if options.remove_comments {
        report.removed_annotations += remove_page_annotations(doc, pages, MARKUP_SUBTYPES);
        report
            .sanitized
            .push("Comments and markup annotations".into());
    }
    if options.remove_bookmarks {
        catalog_keys.push(b"Outlines");
        report.sanitized.push("Bookmarks".into());
    }
    if options.remove_hidden_content {
        let hidden = hidden_groups(doc);
        let mut hidden_annots_removed = 0;
        for page_id in pages.values() {
            let removed = filter_annotations(doc, *page_id, |doc, annotation| {
                annotation_hidden_by_layers(doc, annotation, &hidden)
            });
            hidden_annots_removed += removed.count;
            report.removed_form_fields += prune_fields(doc, &removed.ids);
        }
        report.hidden_annotations_removed += hidden_annots_removed;
        report.removed_annotations += hidden_annots_removed;
        catalog_keys.push(b"OCProperties");
        report
            .sanitized
            .push("Hidden layers and invisible text, including OCR search layers".into());
    }
    {
        let catalog = doc
            .get_dictionary_mut(catalog)
            .map_err(|_| "The document catalog is missing.")?;
        for key in &catalog_keys {
            catalog.remove(key);
        }
        let outline_mode = catalog
            .get(b"PageMode")
            .and_then(Object::as_name)
            .is_ok_and(|mode| mode == b"UseOutlines");
        if options.remove_bookmarks && outline_mode {
            catalog.set("PageMode", "UseNone");
        }
    }
    for object in doc.objects.values_mut() {
        remove_keys(object, &keys);
    }
    report.sanitized.push(
        "Tagged structure, form XML data and page thumbnails, which can repeat redacted content"
            .into(),
    );
    Ok(())
}

/// Reloads a sanitized output and checks every region and audit term independently of the
/// rewrite that produced it.
pub fn audit(
    bytes: &[u8],
    regions: &BTreeMap<u32, Vec<Rect>>,
    terms: &[String],
) -> Result<AuditReport, String> {
    let doc = super::load(bytes)?;
    let mut report = AuditReport {
        regions_checked: regions.values().map(Vec::len).sum(),
        terms_checked: terms.len(),
        ..AuditReport::default()
    };
    let nothing_hidden = HashSet::new();
    let mut page_texts = String::new();
    for (number, page_id) in doc.get_pages() {
        let rects = regions.get(&number).map(Vec::as_slice).unwrap_or_default();
        if !terms.is_empty() {
            // A second, independent text decoder, so a term the interpreter misreads is found.
            if let Ok(text) = doc.extract_text(&[number]) {
                page_texts.push(' ');
                page_texts.push_str(&text);
            }
        }
        let ops = super::page_operations(&doc, page_id)?;
        let resources = Resources::for_page(&doc, page_id);
        let mut images_to_check: Vec<(ObjectId, Matrix, Rect)> = Vec::new();
        let mut residual = 0;
        content::walk(
            &doc,
            &ops,
            &resources,
            Matrix::IDENTITY,
            &nothing_hidden,
            0,
            &mut |item| {
                let in_region = rects.iter().any(|rect| rect.overlaps(&item.bbox));
                match &item.kind {
                    ItemKind::Text { glyphs, .. } => {
                        page_texts.push(' ');
                        page_texts.extend(glyphs.iter().map(|glyph| glyph.text.as_str()));
                        residual += glyphs
                            .iter()
                            .filter(|glyph| rects.iter().any(|rect| rect.overlaps(&glyph.bbox)))
                            .count();
                    }
                    ItemKind::Image {
                        id: Some(id), ctm, ..
                    } if in_region => {
                        images_to_check.push((*id, *ctm, item.bbox));
                    }
                    ItemKind::Image { id: None, .. } if in_region => residual += 1,
                    ItemKind::Path { clip: false, .. }
                        if in_region
                            && !rects
                                .iter()
                                .any(|rect| rect.inflate(0.01).contains(&item.bbox)) =>
                    {
                        residual += 1
                    }
                    _ => {}
                }
            },
        )?;
        for (id, ctm, bbox) in images_to_check {
            let raster = doc
                .get_object(id)
                .and_then(Object::as_stream)
                .ok()
                .and_then(|stream| images::decode(&doc, stream).ok());
            let Some(raster) = raster else {
                residual += 1;
                continue;
            };
            let tolerance = if raster.source == Source::Jpeg {
                JPEG_BLACK_TOLERANCE
            } else {
                0
            };
            for rect in rects.iter().filter(|rect| rect.overlaps(&bbox)) {
                if let Some(region) = images::pixel_region(&ctm, rect, raster.width, raster.height)
                {
                    if !raster.is_black(region, tolerance) {
                        residual += 1;
                    }
                }
            }
        }
        if let Ok(annotations) = doc.get_page_annotations(page_id) {
            residual += annotations
                .iter()
                .filter(|annotation| {
                    annotation_rect(annotation)
                        .is_some_and(|rect| rects.iter().any(|r| r.overlaps(&rect)))
                })
                .count();
        }
        report.residual_region_items += residual;
    }
    if !terms.is_empty() {
        report.residual_terms =
            residual_terms(&doc, &page_texts, terms, &mut report.streams_scanned);
    }
    report.passed = report.residual_region_items == 0 && report.residual_terms == 0;
    Ok(report)
}

fn collect_strings(object: &Object, strings: &mut String) {
    match object {
        Object::String(..) => {
            strings.push(' ');
            strings.push_str(&lopdf::decode_text_string(object).unwrap_or_default());
        }
        Object::Array(items) => items.iter().for_each(|item| collect_strings(item, strings)),
        Object::Dictionary(dict) => dict
            .iter()
            .for_each(|(_, value)| collect_strings(value, strings)),
        Object::Stream(stream) => stream
            .dict
            .iter()
            .for_each(|(_, value)| collect_strings(value, strings)),
        _ => {}
    }
}

fn residual_terms(
    doc: &Document,
    page_texts: &str,
    terms: &[String],
    streams_scanned: &mut usize,
) -> usize {
    let normalize = |text: &str| {
        text.split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase()
    };
    let compact = |text: &str| text.split_whitespace().collect::<String>().to_lowercase();
    let mut strings = String::from(page_texts);
    for object in doc.objects.values() {
        collect_strings(object, &mut strings);
    }
    for (_, value) in doc.trailer.iter() {
        collect_strings(value, &mut strings);
    }
    let text = normalize(&strings);
    let compact_text = compact(&strings);
    let mut found: Vec<bool> = terms
        .iter()
        .map(|term| {
            let compact_term = compact(term);
            text.contains(&normalize(term))
                || (compact_term.chars().count() >= MIN_COMPACT_TERM_CHARS
                    && compact_text.contains(&compact_term))
        })
        .collect();
    let needles: Vec<(Vec<u8>, Vec<u8>)> = terms
        .iter()
        .map(|term| {
            let utf16 = term.encode_utf16().flat_map(u16::to_be_bytes).collect();
            (term.to_lowercase().into_bytes(), utf16)
        })
        .collect();
    for object in doc.objects.values() {
        let Object::Stream(stream) = object else {
            continue;
        };
        *streams_scanned += 1;
        if found.iter().all(|hit| *hit) {
            continue;
        }
        // Decode one stream at a time and drop it before the next, so memory is bounded by the
        // largest stream rather than the sum of all streams.
        let decoded = super::stream_bytes(stream).ok();
        let bytes = decoded.as_deref().unwrap_or(&stream.content);
        for (hit, (lower, utf16)) in found.iter_mut().zip(&needles) {
            *hit = *hit || contains_ignore_ascii_case(bytes, lower) || contains(bytes, utf16);
        }
    }
    found.into_iter().filter(|hit| *hit).count()
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty()
        && haystack
            .windows(needle.len())
            .any(|window| window == needle)
}

/// `needle` is already lower-cased; only ASCII letters in `haystack` are folded.
fn contains_ignore_ascii_case(haystack: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty()
        && haystack.windows(needle.len()).any(|window| {
            window
                .iter()
                .zip(needle)
                .all(|(byte, expected)| byte.to_ascii_lowercase() == *expected)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::content::tests::page_document;
    use lopdf::dictionary;

    const LINE: &str = "BT /F1 20 Tf 72 700 Td (Name: SECRET-CANARY visible) Tj ET";

    fn request(regions: Vec<RegionInput>, terms: &[&str]) -> RedactionRequest {
        RedactionRequest {
            regions,
            terms: terms.iter().map(|term| (*term).to_owned()).collect(),
            options: SanitizeOptions::default(),
            acknowledge_signatures: false,
        }
    }

    fn region(page: u32, rect: Rect) -> RegionInput {
        RegionInput {
            page,
            rect: rect.to_array(),
        }
    }

    /// Visits every item on page `number` of a saved document.
    fn visit(bytes: &[u8], number: u32, visit: &mut dyn FnMut(&Document, &content::Item)) {
        let doc = crate::engine::load(bytes).unwrap();
        let page = doc.get_pages()[&number];
        let ops = crate::engine::page_operations(&doc, page).unwrap();
        let resources = Resources::for_page(&doc, page);
        content::walk(
            &doc,
            &ops,
            &resources,
            Matrix::IDENTITY,
            &HashSet::new(),
            0,
            &mut |item| visit(&doc, item),
        )
        .unwrap();
    }

    fn glyph_boxes(bytes: &[u8]) -> Vec<(String, Rect)> {
        let mut boxes = Vec::new();
        visit(bytes, 1, &mut |_, item| {
            if let ItemKind::Text { glyphs, .. } = &item.kind {
                boxes.extend(glyphs.iter().map(|glyph| (glyph.text.clone(), glyph.bbox)));
            }
        });
        boxes
    }

    fn decompressed(bytes: &[u8]) -> Vec<u8> {
        Document::load_mem(bytes)
            .unwrap()
            .objects
            .values()
            .filter_map(|object| object.as_stream().ok())
            .flat_map(|stream| crate::engine::stream_bytes(stream).unwrap_or_default())
            .collect()
    }

    fn startxref(bytes: &[u8]) -> String {
        let text = String::from_utf8_lossy(bytes);
        let position = text.rfind("startxref").unwrap();
        text[position + 9..]
            .split_whitespace()
            .next()
            .unwrap()
            .to_owned()
    }

    #[test]
    fn glyphs_inside_the_region_are_removed_and_neighbors_keep_their_positions() {
        let (mut doc, _) = page_document(LINE, dictionary! {});
        let source = crate::engine::save(&mut doc).unwrap();
        let boxes = glyph_boxes(&source);
        let secret = boxes[6..19]
            .iter()
            .map(|(_, b)| *b)
            .reduce(|a, b| a.union(&b))
            .unwrap();
        let visible_before = boxes.iter().find(|(text, _)| text == "v").unwrap().1;
        let tight = Rect::new(secret.x0 + 0.1, secret.y0, secret.x1 - 0.1, secret.y1);
        let (output, report) = apply(
            &source,
            &request(vec![region(1, tight)], &["SECRET-CANARY"]),
            &AtomicBool::new(false),
        )
        .unwrap();
        let text = crate::engine::load(&output)
            .unwrap()
            .extract_text(&[1])
            .unwrap();
        assert!(
            !text.contains("SECRET") && text.contains("Name:") && text.contains("visible"),
            "{text}"
        );
        assert!(!contains(&decompressed(&output), b"SECRET"));
        assert_eq!(report.removed_glyphs, 13);
        assert!(report.audit.passed && report.audit.terms_checked == 1);
        let visible_after = glyph_boxes(&output)
            .into_iter()
            .find(|(text, _)| text == "v")
            .unwrap()
            .1;
        assert!((visible_after.x0 - visible_before.x0).abs() < 1e-3);
    }

    #[test]
    fn surviving_terms_signatures_cancellation_and_bad_pages_block_the_output() {
        let (mut doc, _) = page_document(LINE, dictionary! {});
        let source = crate::engine::save(&mut doc).unwrap();
        let name = glyph_boxes(&source)[0..5]
            .iter()
            .map(|(_, b)| *b)
            .reduce(|a, b| a.union(&b))
            .unwrap();
        let error = apply(
            &source,
            &request(vec![region(1, name)], &["SECRET-CANARY"]),
            &AtomicBool::new(false),
        )
        .unwrap_err();
        assert!(
            error.contains("blocked") && !error.contains("SECRET"),
            "{error}"
        );

        let field =
            doc.add_object(dictionary! {"FT" => "Sig", "V" => dictionary! {"Type" => "Sig"}});
        let catalog = catalog_id(&doc).unwrap();
        doc.get_dictionary_mut(catalog)
            .unwrap()
            .set("AcroForm", dictionary! {"Fields" => vec![field.into()]});
        let signed = crate::engine::save(&mut doc).unwrap();
        let mut ask = request(vec![region(1, name)], &[]);
        assert!(apply(&signed, &ask, &AtomicBool::new(false))
            .unwrap_err()
            .contains("signed"));
        ask.acknowledge_signatures = true;
        let (_, report) = apply(&signed, &ask, &AtomicBool::new(false)).unwrap();
        assert!(report
            .sanitized
            .iter()
            .any(|entry| entry.contains("signature")));
        assert!(apply(&signed, &ask, &AtomicBool::new(true))
            .unwrap_err()
            .contains("cancelled"));
        assert!(apply(
            &signed,
            &request(vec![region(9, name)], &[]),
            &AtomicBool::new(false)
        )
        .is_err());
    }

    #[test]
    fn overlapping_vector_paths_are_removed_before_the_redaction_overlay_is_added() {
        let (mut doc, _) = page_document("0 0 m 200 0 l 200 100 l 0 100 l h f", dictionary! {});
        let source = crate::engine::save(&mut doc).unwrap();
        let (output, report) = apply(
            &source,
            &request(vec![region(1, Rect::new(80.0, 20.0, 120.0, 80.0))], &[]),
            &AtomicBool::new(false),
        )
        .unwrap();

        assert_eq!(report.removed_paths, 1);
        assert!(report.audit.passed);
        let mut paths = 0;
        visit(&output, 1, &mut |_, item| {
            if matches!(item.kind, ItemKind::Path { clip: false, .. }) {
                paths += 1;
            }
        });
        assert_eq!(paths, 1, "only the black redaction overlay should remain");
    }

    #[test]
    fn shading_content_is_rejected_for_region_redaction() {
        let (mut doc, _) = page_document("/Sh1 sh", dictionary! {});
        let source = crate::engine::save(&mut doc).unwrap();
        let error = apply(
            &source,
            &request(vec![region(1, Rect::new(80.0, 20.0, 120.0, 80.0))], &[]),
            &AtomicBool::new(false),
        )
        .unwrap_err();
        assert!(error.contains("shading") && error.contains("unchanged"));
    }

    #[test]
    fn metadata_attachments_scripts_hidden_layers_and_prior_revisions_are_removed() {
        let (mut doc, page) = page_document(
            "BT /F1 12 Tf 72 700 Td (Public) Tj ET /OC /L1 BDC BT /F1 12 Tf 72 600 Td (LAYER-CANARY) Tj ET EMC BT 3 Tr /F1 12 Tf 72 500 Td (OCR-CANARY) Tj ET",
            dictionary! {},
        );
        let layer = doc.add_object(dictionary! {"Type" => "OCG", "Name" => "Private"});
        let info = doc.add_object(dictionary! {"Title" => Object::string_literal("INFO-CANARY")});
        doc.trailer.set("Info", info);
        let file = doc.add_object(Stream::new(
            dictionary! {"Type" => "EmbeddedFile"},
            b"ATTACHMENT-CANARY".to_vec(),
        ));
        let script = doc.add_object(
            dictionary! {"S" => "JavaScript", "JS" => Object::string_literal("SCRIPT-CANARY")},
        );
        let catalog = catalog_id(&doc).unwrap();
        {
            let catalog = doc.get_dictionary_mut(catalog).unwrap();
            catalog.set("OpenAction", script);
            catalog.set(
                "OCProperties",
                dictionary! {"OCGs" => vec![layer.into()], "D" => dictionary! {"OFF" => vec![layer.into()]}},
            );
            catalog.set(
                "Names",
                dictionary! {"EmbeddedFiles" => dictionary! {"Names" => vec![
                    Object::string_literal("canary.txt"),
                    dictionary! {"EF" => dictionary! {"F" => file}}.into(),
                ]}},
            );
        }
        doc.get_dictionary_mut(page)
            .unwrap()
            .get_mut(b"Resources")
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("Properties", dictionary! {"L1" => layer});

        // The first revision's content holds REVISION-CANARY; an incremental update replaces it.
        let content_id = doc
            .get_dictionary(page)
            .unwrap()
            .get(b"Contents")
            .unwrap()
            .as_reference()
            .unwrap();
        let current =
            crate::engine::stream_bytes(doc.get_object(content_id).unwrap().as_stream().unwrap())
                .unwrap();
        let mut prior = doc.clone();
        prior.objects.insert(
            content_id,
            Object::Stream(Stream::new(
                dictionary! {},
                b"BT /F1 12 Tf 72 400 Td (REVISION-CANARY) Tj ET".to_vec(),
            )),
        );
        let mut file_bytes = crate::engine::save(&mut prior).unwrap();
        let object_offset = file_bytes.len() + 1;
        file_bytes.extend(
            format!(
                "\n{} 0 obj\n<< /Length {} >>\nstream\n",
                content_id.0,
                current.len()
            )
            .as_bytes(),
        );
        file_bytes.extend(&current);
        file_bytes.extend(b"\nendstream\nendobj\n");
        let xref_offset = file_bytes.len();
        let previous = startxref(&file_bytes);
        file_bytes.extend(
            format!(
                "xref\n0 1\n0000000000 65535 f \n{} 1\n{:010} 00000 n \ntrailer\n<< /Size {} /Root {} 0 R /Info {} 0 R /Prev {} >>\nstartxref\n{}\n%%EOF\n",
                content_id.0, object_offset, doc.max_id + 1, catalog.0, info.0, previous, xref_offset
            )
            .as_bytes(),
        );
        assert!(contains(&file_bytes, b"REVISION-CANARY"));
        assert!(crate::engine::load(&file_bytes)
            .unwrap()
            .extract_text(&[1])
            .unwrap()
            .contains("Public"));

        let terms = [
            "LAYER-CANARY",
            "OCR-CANARY",
            "INFO-CANARY",
            "ATTACHMENT-CANARY",
            "SCRIPT-CANARY",
            "REVISION-CANARY",
        ];
        let (output, report) = apply(
            &file_bytes,
            &request(Vec::new(), &terms),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert!(report.audit.passed, "{:?}", report.audit);
        let raw = decompressed(&output);
        for term in terms {
            assert!(
                !contains(&raw, term.as_bytes()) && !contains(&output, term.as_bytes()),
                "{term}"
            );
        }
        assert!(crate::engine::load(&output)
            .unwrap()
            .extract_text(&[1])
            .unwrap()
            .contains("Public"));
    }

    #[test]
    fn images_are_blackened_on_a_private_copy_and_shared_forms_are_cloned() {
        let (mut doc, page) = page_document("", dictionary! {});
        let image = doc.add_object(Stream::new(
            dictionary! {"Type" => "XObject", "Subtype" => "Image", "Width" => 8, "Height" => 8,
            "ColorSpace" => "DeviceGray", "BitsPerComponent" => 8},
            vec![200; 64],
        ));
        let fonts = doc
            .get_dictionary(page)
            .unwrap()
            .get(b"Resources")
            .unwrap()
            .as_dict()
            .unwrap()
            .get(b"Font")
            .unwrap()
            .clone();
        let form = doc.add_object(Stream::new(
            dictionary! {"Type" => "XObject", "Subtype" => "Form",
            "BBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
            "Resources" => dictionary! {"Font" => fonts}},
            b"BT /F1 12 Tf 300 100 Td (FORM-CANARY) Tj ET".to_vec(),
        ));
        let content = doc.add_object(Stream::new(
            dictionary! {},
            b"q 100 0 0 100 0 0 cm /Im1 Do Q /Fm1 Do".to_vec(),
        ));
        {
            let page_dict = doc.get_dictionary_mut(page).unwrap();
            page_dict.set("Contents", content);
            page_dict
                .get_mut(b"Resources")
                .unwrap()
                .as_dict_mut()
                .unwrap()
                .set("XObject", dictionary! {"Im1" => image, "Fm1" => form});
        }
        // A second page shares the content, image and form.
        let pages_id = doc
            .get_dictionary(page)
            .unwrap()
            .get(b"Parent")
            .unwrap()
            .as_reference()
            .unwrap();
        let second = doc.add_object(doc.get_dictionary(page).unwrap().clone());
        {
            let pages = doc.get_dictionary_mut(pages_id).unwrap();
            pages.set("Kids", vec![page.into(), second.into()]);
            pages.set("Count", 2);
        }
        let source = crate::engine::save(&mut doc).unwrap();
        let regions = vec![
            region(1, Rect::new(0.0, 50.0, 50.0, 100.0)),
            region(1, Rect::new(290.0, 90.0, 420.0, 120.0)),
        ];
        let (output, report) =
            apply(&source, &request(regions, &[]), &AtomicBool::new(false)).unwrap();
        assert_eq!(
            (report.pixel_redacted_images, report.rewritten_forms),
            (1, 1)
        );

        let mut page_one_pixels = None;
        visit(&output, 1, &mut |result, item| match &item.kind {
            ItemKind::Image { id: Some(id), .. } => {
                let stream = result.get_object(*id).unwrap().as_stream().unwrap();
                page_one_pixels = Some(images::decode(result, stream).unwrap().pixels);
            }
            ItemKind::Text { glyphs, .. } => {
                assert!(glyphs.is_empty(), "form text survived on page 1")
            }
            _ => {}
        });
        let pixels = page_one_pixels.unwrap();
        assert_eq!(
            (pixels[0], pixels[63]),
            (0, 200),
            "only the upper-left samples are blackened"
        );

        let mut page_two_text = String::new();
        let mut page_two_pixels = None;
        visit(&output, 2, &mut |result, item| match &item.kind {
            ItemKind::Image { id: Some(id), .. } => {
                let stream = result.get_object(*id).unwrap().as_stream().unwrap();
                page_two_pixels = Some(images::decode(result, stream).unwrap().pixels);
            }
            ItemKind::Text { glyphs, .. } => {
                page_two_text.extend(glyphs.iter().map(|g| g.text.clone()))
            }
            _ => {}
        });
        assert_eq!(
            page_two_text, "FORM-CANARY",
            "the other page keeps the shared form"
        );
        assert!(page_two_pixels.unwrap().iter().all(|value| *value == 200));
    }

    #[test]
    fn removing_a_widget_also_removes_its_parent_field_value() {
        let (mut doc, page) =
            page_document("BT /F1 12 Tf 72 700 Td (Public) Tj ET", dictionary! {});
        let widget = doc.new_object_id();
        let value: Vec<u8> = [0xFE, 0xFF]
            .into_iter()
            .chain("FIELD-CANARY".encode_utf16().flat_map(u16::to_be_bytes))
            .collect();
        let field = doc.add_object(dictionary! {
            "FT" => "Tx",
            "T" => Object::string_literal("synthetic"),
            "V" => Object::String(value, lopdf::StringFormat::Hexadecimal),
            "Kids" => vec![widget.into()],
        });
        doc.objects.insert(
            widget,
            Object::Dictionary(dictionary! {
                "Type" => "Annot", "Subtype" => "Widget", "Parent" => field,
                "Rect" => vec![72.into(), 400.into(), 300.into(), 424.into()],
            }),
        );
        doc.get_dictionary_mut(page)
            .unwrap()
            .set("Annots", vec![widget.into()]);
        let catalog = catalog_id(&doc).unwrap();
        doc.get_dictionary_mut(catalog)
            .unwrap()
            .set("AcroForm", dictionary! {"Fields" => vec![field.into()]});
        let source = crate::engine::save(&mut doc).unwrap();
        let region = region(1, Rect::new(70.0, 398.0, 302.0, 426.0));
        let (output, report) = apply(
            &source,
            &request(vec![region], &["FIELD-CANARY"]),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert!(report.audit.passed);
        assert_eq!(report.removed_form_fields, 2);
        let result = Document::load_mem(&output).unwrap();
        assert!(!result.objects.contains_key(&field) && !result.objects.contains_key(&widget));
    }

    #[test]
    fn layer_hidden_annotations_are_removed_with_hidden_content() {
        let (mut doc, page) = page_document("", dictionary! {});
        let layer = doc.add_object(dictionary! {
            "Type" => "OCG",
            "Name" => "Watermark Layer",
        });
        let catalog = catalog_id(&doc).unwrap();
        {
            let catalog = doc.get_dictionary_mut(catalog).unwrap();
            catalog.set(
                "OCProperties",
                dictionary! {"OCGs" => vec![layer.into()], "D" => dictionary! {"OFF" => vec![layer.into()]}},
            );
        }
        let hidden_annot = doc.add_object(dictionary! {
            "Type" => "Annot",
            "Subtype" => "FreeText",
            "Rect" => vec![50.into(), 50.into(), 150.into(), 100.into()],
            "OC" => layer,
        });
        let visible_annot = doc.add_object(dictionary! {
            "Type" => "Annot",
            "Subtype" => "Text",
            "Rect" => vec![200.into(), 200.into(), 250.into(), 250.into()],
        });
        doc.get_dictionary_mut(page)
            .unwrap()
            .set("Annots", vec![hidden_annot.into(), visible_annot.into()]);

        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();

        let request = RedactionRequest {
            regions: Vec::new(),
            terms: Vec::new(),
            options: SanitizeOptions {
                remove_hidden_content: true,
                remove_metadata: false,
                remove_attachments: false,
                remove_scripts: false,
                remove_comments: false,
                remove_bookmarks: false,
            },
            acknowledge_signatures: false,
        };
        let cancel = AtomicBool::new(false);
        let (output, report) = apply(&bytes, &request, &cancel).unwrap();

        assert_eq!(report.hidden_annotations_removed, 1);
        let out_doc = Document::load_mem(&output).unwrap();
        let out_page = out_doc.get_pages()[&1];
        let annots = out_doc
            .get_dictionary(out_page)
            .unwrap()
            .get(b"Annots")
            .unwrap()
            .as_array()
            .unwrap();
        assert_eq!(annots.len(), 1);
        assert_eq!(annots[0].as_reference().unwrap(), visible_annot);
    }

    #[test]
    fn term_audit_holds_one_decoded_stream_at_a_time() {
        const STREAMS: usize = 24;
        const STREAM_BYTES: usize = 1 << 20;
        let (mut doc, _) = page_document(LINE, dictionary! {});
        for _ in 0..STREAMS {
            let mut stream = Stream::new(dictionary! {}, vec![b'x'; STREAM_BYTES]);
            stream.compress().unwrap();
            doc.add_object(stream);
        }
        let terms = vec!["secret-canary".to_owned(), "absent term".to_owned()];
        let mut scanned = 0;
        let (found, peak) = allocation::peak(|| residual_terms(&doc, "", &terms, &mut scanned));
        assert_eq!(found, 1);
        assert_eq!(scanned, STREAMS + 1);
        assert!(peak < 3 * STREAM_BYTES, "peak allocation was {peak} bytes");
    }

    #[test]
    fn text_with_unmeasurable_codes_near_a_region_blocks_redaction() {
        let font = dictionary! {
            "Type" => "Font", "Subtype" => "Type0", "BaseFont" => "Synthetic-CJK",
            "Encoding" => "UniJIS-UCS2-H",
            "DescendantFonts" => vec![Object::Dictionary(dictionary! {
                "Type" => "Font", "Subtype" => "CIDFontType0", "BaseFont" => "Synthetic-CJK",
            })],
        };
        let (mut doc, _) = page_document(
            "BT /F2 20 Tf 72 700 Td <00410042> Tj ET",
            dictionary! {"Font" => dictionary! {"F2" => font}},
        );
        let source = crate::engine::save(&mut doc).unwrap();
        let near = request(vec![region(1, Rect::new(70.0, 690.0, 90.0, 730.0))], &[]);
        let error = apply(&source, &near, &AtomicBool::new(false)).unwrap_err();
        assert!(error.contains("cannot be measured"), "{error}");

        let far = request(vec![region(1, Rect::new(400.0, 100.0, 450.0, 150.0))], &[]);
        let (_, report) = apply(&source, &far, &AtomicBool::new(false)).unwrap();
        assert!(report.audit.passed);
    }

    #[test]
    fn audit_specs_validate_requests_and_merge_later_passes() {
        let mut first = AuditSpec::from_request(&request(
            vec![region(1, Rect::new(0.0, 0.0, 10.0, 10.0))],
            &[" alpha "],
        ))
        .unwrap();
        let second = AuditSpec::from_request(&request(
            vec![region(2, Rect::new(0.0, 0.0, 5.0, 5.0))],
            &["alpha", "beta"],
        ))
        .unwrap();
        first.merge(second);
        assert_eq!(first.terms, ["alpha", "beta"]);
        assert_eq!(first.regions.keys().copied().collect::<Vec<_>>(), [1, 2]);
        let empty_region = request(vec![region(1, Rect::new(5.0, 5.0, 5.0, 9.0))], &[]);
        assert!(AuditSpec::from_request(&empty_region).is_err());
    }

    /// Counts heap allocations on the current thread so memory bounds can be asserted.
    mod allocation {
        use std::alloc::{GlobalAlloc, Layout, System};
        use std::cell::Cell;

        thread_local! {
            static TRACKING: Cell<bool> = const { Cell::new(false) };
            static CURRENT: Cell<usize> = const { Cell::new(0) };
            static PEAK: Cell<usize> = const { Cell::new(0) };
        }

        pub struct Counting;

        // SAFETY: every call is forwarded unchanged to the system allocator.
        unsafe impl GlobalAlloc for Counting {
            unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
                let pointer = unsafe { System.alloc(layout) };
                if !pointer.is_null() {
                    record(layout.size(), 0);
                }
                pointer
            }

            unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
                unsafe { System.dealloc(pointer, layout) };
                record(0, layout.size());
            }

            unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
                let moved = unsafe { System.realloc(pointer, layout, new_size) };
                if !moved.is_null() {
                    record(new_size, layout.size());
                }
                moved
            }
        }

        fn record(added: usize, removed: usize) {
            let _ = TRACKING.try_with(|tracking| {
                if tracking.get() {
                    let current = CURRENT.get().saturating_add(added).saturating_sub(removed);
                    CURRENT.set(current);
                    PEAK.set(PEAK.get().max(current));
                }
            });
        }

        #[global_allocator]
        static ALLOCATOR: Counting = Counting;

        /// Runs `work` and returns its result with the most bytes it held at once on this thread.
        pub fn peak<T>(work: impl FnOnce() -> T) -> (T, usize) {
            CURRENT.set(0);
            PEAK.set(0);
            TRACKING.set(true);
            let result = work();
            TRACKING.set(false);
            (result, PEAK.get())
        }
    }
}
