//! Measured compression: structural cleanup first, then optional image downsampling and
//! re-encoding. The result is offered only when fidelity checks pass and bytes are saved.

use super::content::{self, ItemKind, Resources};
use super::geometry::Matrix;
use super::images;
use lopdf::{Dictionary, Document, Object, ObjectId, SaveOptions, Stream};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::atomic::AtomicBool;

/// Images are only resampled when stored at more than this multiple of the target density.
const OVERSAMPLING_THRESHOLD: f64 = 1.25;
const MIN_IMAGE_DIMENSION: usize = 16;
/// A re-encoded image must be at least this much smaller than the original stream.
const MIN_IMAGE_SAVING: f64 = 0.9;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CompressionPreset {
    Lossless,
    Balanced,
    Small,
}

impl CompressionPreset {
    /// Target image density (dots per inch) and JPEG quality for lossy presets.
    fn image_target(self) -> Option<(f64, u8)> {
        match self {
            Self::Lossless => None,
            Self::Balanced => Some((150.0, 80)),
            Self::Small => Some((96.0, 60)),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FidelityCheck {
    pub name: String,
    pub passed: bool,
    pub detail: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressionReport {
    pub preset: CompressionPreset,
    pub before_bytes: u64,
    pub after_bytes: u64,
    pub useful: bool,
    pub unused_objects_removed: usize,
    pub duplicate_streams_merged: usize,
    pub images_examined: usize,
    pub images_recompressed: usize,
    pub images_skipped: usize,
    pub checks: Vec<FidelityCheck>,
    pub message: String,
}

/// Compresses a copy; returns output bytes only when the saving is useful and faithful.
pub fn compress(
    bytes: &[u8],
    preset: CompressionPreset,
    cancel: &AtomicBool,
) -> Result<(Option<Vec<u8>>, CompressionReport), String> {
    let mut doc = super::load(bytes)?;
    let baseline = Fingerprint::of(&doc)?;
    let mut report = CompressionReport {
        preset,
        before_bytes: bytes.len() as u64,
        after_bytes: bytes.len() as u64,
        useful: false,
        unused_objects_removed: doc.prune_objects().len(),
        duplicate_streams_merged: merge_duplicate_streams(&mut doc),
        images_examined: 0,
        images_recompressed: 0,
        images_skipped: 0,
        checks: Vec::new(),
        message: String::new(),
    };
    super::check_cancelled(cancel)?;
    if let Some((dpi, quality)) = preset.image_target() {
        recompress_images(&mut doc, dpi, quality, cancel, &mut report)?;
    }
    doc.compress();
    let mut output = Vec::new();
    let options = SaveOptions::builder()
        .use_object_streams(true)
        .use_xref_streams(true)
        .build();
    doc.save_with_options(&mut output, options)
        .map_err(|_| "The compressed PDF could not be written.")?;
    super::check_cancelled(cancel)?;
    report.checks = baseline.compare(&Fingerprint::of(&super::load(&output)?)?);
    report.after_bytes = output.len() as u64;
    let faithful = report.checks.iter().all(|check| check.passed);
    let saved = report.before_bytes.saturating_sub(report.after_bytes);
    report.useful = faithful && saved >= (report.before_bytes / 100).max(1024);
    report.message = if !faithful {
        "A fidelity check failed, so the original was kept.".into()
    } else if !report.useful {
        "Compression would not save a useful amount of space, so the original was kept.".into()
    } else {
        format!(
            "Saves {saved} bytes ({:.1}%).",
            saved as f64 * 100.0 / report.before_bytes as f64
        )
    };
    Ok((report.useful.then_some(output), report))
}

/// Replaces references to byte-identical streams with one shared object.
fn merge_duplicate_streams(doc: &mut Document) -> usize {
    let mut first: HashMap<[u8; 32], ObjectId> = HashMap::new();
    let mut replace: HashMap<ObjectId, ObjectId> = HashMap::new();
    for (id, object) in &doc.objects {
        let Object::Stream(stream) = object else {
            continue;
        };
        let mut hasher = Sha256::new();
        hash_dictionary(&mut hasher, &stream.dict);
        hasher.update(&stream.content);
        let digest: [u8; 32] = hasher.finalize().into();
        match first.get(&digest) {
            Some(original) => {
                replace.insert(*id, *original);
            }
            None => {
                first.insert(digest, *id);
            }
        }
    }
    for object in doc.objects.values_mut() {
        replace_references(object, &replace);
    }
    for (_, value) in doc.trailer.iter_mut() {
        replace_references(value, &replace);
    }
    for id in replace.keys() {
        doc.objects.remove(id);
    }
    replace.len()
}

fn hash_dictionary(hasher: &mut Sha256, dict: &Dictionary) {
    let mut entries: Vec<(&Vec<u8>, &Object)> = dict
        .iter()
        .filter(|(key, _)| key.as_slice() != b"Length")
        .collect();
    entries.sort_by(|a, b| a.0.cmp(b.0));
    hasher.update(b"<<");
    for (key, value) in entries {
        hasher.update(key);
        hasher.update(b"=");
        hash_object(hasher, value);
    }
    hasher.update(b">>");
}

fn hash_object(hasher: &mut Sha256, object: &Object) {
    match object {
        Object::Null => hasher.update(b"n"),
        Object::Boolean(value) => hasher.update(if *value { b"t" } else { b"f" }),
        Object::Integer(value) => hasher.update(format!("i{value}")),
        Object::Real(value) => hasher.update(format!("r{}", value.to_bits())),
        Object::Name(name) => {
            hasher.update(b"/");
            hasher.update(name);
        }
        Object::String(bytes, _) => {
            hasher.update(format!("s{}:", bytes.len()));
            hasher.update(bytes);
        }
        Object::Array(items) => {
            hasher.update(b"[");
            items.iter().for_each(|item| hash_object(hasher, item));
            hasher.update(b"]");
        }
        Object::Dictionary(dict) => hash_dictionary(hasher, dict),
        Object::Stream(stream) => {
            hash_dictionary(hasher, &stream.dict);
            hasher.update(&stream.content);
        }
        Object::Reference((number, generation)) => hasher.update(format!("R{number}.{generation}")),
    }
}

fn replace_references(object: &mut Object, replace: &HashMap<ObjectId, ObjectId>) {
    match object {
        Object::Reference(id) => {
            if let Some(target) = replace.get(id) {
                *id = *target;
            }
        }
        Object::Array(items) => items
            .iter_mut()
            .for_each(|item| replace_references(item, replace)),
        Object::Dictionary(dict) => dict
            .iter_mut()
            .for_each(|(_, value)| replace_references(value, replace)),
        Object::Stream(stream) => stream
            .dict
            .iter_mut()
            .for_each(|(_, value)| replace_references(value, replace)),
        _ => {}
    }
}

/// Largest displayed size in points of each image placed directly in page content.
fn image_placements(doc: &Document) -> Result<HashMap<ObjectId, (f64, f64)>, String> {
    let mut sizes: HashMap<ObjectId, (f64, f64)> = HashMap::new();
    let nothing_hidden = HashSet::new();
    for page_id in doc.get_pages().into_values() {
        let ops = super::page_operations(doc, page_id)?;
        let resources = Resources::for_page(doc, page_id);
        content::walk(
            doc,
            &ops,
            &resources,
            Matrix::IDENTITY,
            &nothing_hidden,
            0,
            &mut |item| {
                if let ItemKind::Image {
                    id: Some(id), ctm, ..
                } = &item.kind
                {
                    let entry = sizes.entry(*id).or_insert((0.0, 0.0));
                    entry.0 = entry.0.max(ctm.scale_x());
                    entry.1 = entry.1.max(ctm.scale_y());
                }
            },
        )?;
    }
    Ok(sizes)
}

/// Soft masks and images drawn through annotation appearances or tiling patterns have
/// placements the interpreter does not measure, so they are never resampled.
fn unmeasured_images(doc: &Document) -> HashSet<ObjectId> {
    let mut excluded: HashSet<ObjectId> = doc
        .objects
        .values()
        .filter_map(|object| object.as_stream().ok())
        .filter_map(|stream| {
            stream
                .dict
                .get(b"SMask")
                .and_then(Object::as_reference)
                .ok()
        })
        .collect();
    let mut roots: Vec<&Object> = Vec::new();
    for page_id in doc.get_pages().into_values() {
        for annotation in doc.get_page_annotations(page_id).unwrap_or_default() {
            roots.extend(annotation.get(b"AP").ok());
        }
        for resources in content::page_resource_dictionaries(doc, page_id) {
            roots.extend(resources.get(b"Pattern").ok());
        }
    }
    let mut visited = HashSet::new();
    for root in roots {
        collect_images(doc, root, &mut excluded, &mut visited, 0);
    }
    excluded
}

/// Image streams reachable from an object through references and resource dictionaries.
fn collect_images(
    doc: &Document,
    object: &Object,
    images: &mut HashSet<ObjectId>,
    visited: &mut HashSet<ObjectId>,
    depth: usize,
) {
    if depth > MAX_TREE_DEPTH {
        return;
    }
    let children: Vec<&Object> = match object {
        Object::Reference(id) => {
            if !visited.insert(*id) {
                return;
            }
            let Ok(target) = doc.get_object(*id) else {
                return;
            };
            let is_image = target
                .as_stream()
                .ok()
                .and_then(|stream| stream.dict.get(b"Subtype").and_then(Object::as_name).ok())
                == Some(b"Image".as_slice());
            if is_image {
                images.insert(*id);
                return;
            }
            vec![target]
        }
        Object::Array(items) => items.iter().collect(),
        Object::Dictionary(dict) => dict
            .iter()
            .filter(|(key, _)| key.as_slice() != b"Parent")
            .map(|(_, value)| value)
            .collect(),
        Object::Stream(stream) => stream
            .dict
            .iter()
            .filter(|(key, _)| key.as_slice() != b"Parent")
            .map(|(_, value)| value)
            .collect(),
        _ => Vec::new(),
    };
    for child in children {
        collect_images(doc, child, images, visited, depth + 1);
    }
}

fn recompress_images(
    doc: &mut Document,
    target_dpi: f64,
    quality: u8,
    cancel: &AtomicBool,
    report: &mut CompressionReport,
) -> Result<(), String> {
    let placements = image_placements(doc)?;
    let excluded = unmeasured_images(doc);
    let mut ids: Vec<ObjectId> = placements.keys().copied().collect();
    ids.sort();
    for id in ids {
        super::check_cancelled(cancel)?;
        report.images_examined += 1;
        if excluded.contains(&id) {
            report.images_skipped += 1;
            continue;
        }
        let (width_points, height_points) = placements[&id];
        match recompressed_image(doc, id, width_points, height_points, target_dpi, quality) {
            Some((image, mask)) => {
                doc.objects.insert(id, Object::Stream(image));
                if let Some((mask_id, mask)) = mask {
                    doc.objects.insert(mask_id, Object::Stream(mask));
                }
                report.images_recompressed += 1;
            }
            None => report.images_skipped += 1,
        }
    }
    Ok(())
}

type Recompressed = (Stream, Option<(ObjectId, Stream)>);

fn recompressed_image(
    doc: &Document,
    id: ObjectId,
    width_points: f64,
    height_points: f64,
    target_dpi: f64,
    quality: u8,
) -> Option<Recompressed> {
    let stream = doc.get_object(id).and_then(Object::as_stream).ok()?;
    let raster = images::decode(doc, stream).ok()?;
    let needed = (
        width_points / 72.0 * target_dpi,
        height_points / 72.0 * target_dpi,
    );
    let scale = (needed.0 / raster.width as f64).max(needed.1 / raster.height as f64);
    let resize = scale > 0.0 && scale * OVERSAMPLING_THRESHOLD < 1.0;
    let (width, height) = if resize {
        (
            ((raster.width as f64 * scale).ceil() as usize)
                .clamp(MIN_IMAGE_DIMENSION.min(raster.width), raster.width),
            ((raster.height as f64 * scale).ceil() as usize)
                .clamp(MIN_IMAGE_DIMENSION.min(raster.height), raster.height),
        )
    } else {
        (raster.width, raster.height)
    };
    let resized = (width, height) != (raster.width, raster.height);
    let mask = match stream.dict.get(b"SMask") {
        Ok(reference) => {
            let mask_id = reference.as_reference().ok()?;
            if !resized {
                None
            } else {
                let mask_stream = doc.get_object(mask_id).and_then(Object::as_stream).ok()?;
                let alpha = images::decode(doc, mask_stream)
                    .ok()
                    .filter(|alpha| alpha.components == 1)?;
                Some((
                    mask_id,
                    images::encode_flate(&alpha.resample(width, height), &mask_stream.dict),
                ))
            }
        }
        Err(_) => None,
    };
    let source = if resized {
        raster.resample(width, height)
    } else {
        raster
    };
    let flate = images::encode_flate(&source, &stream.dict);
    let best = match images::encode_jpeg(&source, &stream.dict, quality) {
        Ok(jpeg) if jpeg.content.len() < flate.content.len() => jpeg,
        _ => flate,
    };
    let smaller = (best.content.len() as f64) < stream.content.len() as f64 * MIN_IMAGE_SAVING;
    (resized || smaller).then_some((best, mask))
}

/// Document properties that compression must not change.
#[derive(PartialEq)]
struct Fingerprint {
    pages: usize,
    text: Vec<String>,
    annotations: Vec<BTreeMap<Vec<u8>, usize>>,
    fonts: Vec<usize>,
    image_placements: Vec<usize>,
    fields: usize,
    outlines: bool,
    attachments: usize,
}

impl Fingerprint {
    fn of(doc: &Document) -> Result<Self, String> {
        let mut fingerprint = Fingerprint {
            pages: 0,
            text: Vec::new(),
            annotations: Vec::new(),
            fonts: Vec::new(),
            image_placements: Vec::new(),
            fields: 0,
            outlines: false,
            attachments: 0,
        };
        let nothing_hidden = HashSet::new();
        for page_id in doc.get_pages().into_values() {
            fingerprint.pages += 1;
            let ops = super::page_operations(doc, page_id)?;
            let resources = Resources::for_page(doc, page_id);
            let mut text = String::new();
            let mut images = 0;
            content::walk(
                doc,
                &ops,
                &resources,
                Matrix::IDENTITY,
                &nothing_hidden,
                0,
                &mut |item| match &item.kind {
                    ItemKind::Text { glyphs, .. } => {
                        text.extend(glyphs.iter().map(|glyph| glyph.text.as_str()))
                    }
                    ItemKind::Image { .. } => images += 1,
                    _ => {}
                },
            )?;
            fingerprint.text.push(text);
            fingerprint.image_placements.push(images);
            fingerprint
                .fonts
                .push(resources.entries(doc, b"Font").len());
            let mut annotations = BTreeMap::new();
            for annotation in doc.get_page_annotations(page_id).unwrap_or_default() {
                let subtype = annotation
                    .get(b"Subtype")
                    .and_then(Object::as_name)
                    .unwrap_or(b"Unknown");
                *annotations.entry(subtype.to_vec()).or_insert(0) += 1;
            }
            fingerprint.annotations.push(annotations);
        }
        if let Some(catalog) = doc
            .trailer
            .get(b"Root")
            .and_then(Object::as_reference)
            .ok()
            .and_then(|id| doc.get_dictionary(id).ok())
        {
            let entry = |key: &[u8]| {
                catalog
                    .get(key)
                    .ok()
                    .map(|object| content::deref(doc, object))
            };
            fingerprint.outlines = entry(b"Outlines")
                .and_then(|outlines| outlines.as_dict().ok())
                .is_some_and(|outlines| outlines.has(b"First"));
            fingerprint.fields = entry(b"AcroForm")
                .and_then(|form| form.as_dict().ok())
                .and_then(|form| form.get(b"Fields").ok())
                .map_or(0, |fields| count_fields(doc, fields, 0));
            fingerprint.attachments = entry(b"Names")
                .and_then(|names| names.as_dict().ok())
                .and_then(|names| names.get(b"EmbeddedFiles").ok())
                .map_or(0, |tree| count_name_tree(doc, tree, 0));
        }
        Ok(fingerprint)
    }

    fn compare(&self, other: &Fingerprint) -> Vec<FidelityCheck> {
        let check = |name: &str, passed: bool, detail: String| FidelityCheck {
            name: name.into(),
            passed,
            detail,
        };
        let changed_pages = |a: &[String], b: &[String]| {
            a.iter()
                .zip(b)
                .filter(|(left, right)| left != right)
                .count()
        };
        vec![
            check(
                "Page count",
                self.pages == other.pages,
                format!("{} pages", other.pages),
            ),
            check(
                "Extracted text",
                self.text == other.text,
                format!("{} page(s) differ", changed_pages(&self.text, &other.text)),
            ),
            check(
                "Annotations and links",
                self.annotations == other.annotations,
                format!(
                    "{} annotation(s)",
                    other
                        .annotations
                        .iter()
                        .flat_map(BTreeMap::values)
                        .sum::<usize>()
                ),
            ),
            check(
                "Fonts",
                self.fonts == other.fonts,
                format!("{} font resources", other.fonts.iter().sum::<usize>()),
            ),
            check(
                "Image placements",
                self.image_placements == other.image_placements,
                format!(
                    "{} placements",
                    other.image_placements.iter().sum::<usize>()
                ),
            ),
            check(
                "Form fields",
                self.fields == other.fields,
                format!("{} fields", other.fields),
            ),
            check(
                "Bookmarks",
                self.outlines == other.outlines,
                if other.outlines { "present" } else { "none" }.into(),
            ),
            check(
                "Attachments",
                self.attachments == other.attachments,
                format!("{} attachments", other.attachments),
            ),
        ]
    }
}

const MAX_TREE_DEPTH: usize = 32;

fn count_fields(doc: &Document, fields: &Object, depth: usize) -> usize {
    if depth > MAX_TREE_DEPTH {
        return 0;
    }
    content::deref(doc, fields)
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(|item| {
                    let kids = content::deref(doc, item)
                        .as_dict()
                        .ok()
                        .and_then(|field| field.get(b"Kids").ok());
                    1 + kids.map_or(0, |kids| count_fields(doc, kids, depth + 1))
                })
                .sum()
        })
        .unwrap_or(0)
}

fn count_name_tree(doc: &Document, node: &Object, depth: usize) -> usize {
    let Some(node) = content::deref(doc, node)
        .as_dict()
        .ok()
        .filter(|_| depth <= MAX_TREE_DEPTH)
    else {
        return 0;
    };
    let names = node
        .get(b"Names")
        .ok()
        .and_then(|names| content::deref(doc, names).as_array().ok())
        .map_or(0, |names| names.len() / 2);
    let kids = node
        .get(b"Kids")
        .ok()
        .and_then(|kids| content::deref(doc, kids).as_array().ok())
        .map_or(0, |kids| {
            kids.iter()
                .map(|kid| count_name_tree(doc, kid, depth + 1))
                .sum()
        });
    names + kids
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::content::tests::page_document;
    use lopdf::dictionary;

    fn image_document(side: usize, duplicate: bool) -> Vec<u8> {
        let (mut doc, page) = page_document("", dictionary! {});
        let pixels: Vec<u8> = (0..side * side * 3)
            .map(|i| ((i * 7919) % 251) as u8)
            .collect();
        let make = || {
            Stream::new(
                dictionary! {"Type" => "XObject", "Subtype" => "Image", "Width" => side as i64,
                "Height" => side as i64, "ColorSpace" => "DeviceRGB", "BitsPerComponent" => 8},
                pixels.clone(),
            )
        };
        let first = doc.add_object(make());
        let second = if duplicate {
            doc.add_object(make())
        } else {
            first
        };
        let content = doc.add_object(Stream::new(
            dictionary! {},
            b"BT /F1 12 Tf 72 720 Td (Measured text) Tj ET q 100 0 0 100 72 500 cm /Im1 Do Q q 100 0 0 100 300 500 cm /Im2 Do Q"
                .to_vec(),
        ));
        let page_dict = doc.get_dictionary_mut(page).unwrap();
        page_dict.set("Contents", content);
        page_dict
            .get_mut(b"Resources")
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("XObject", dictionary! {"Im1" => first, "Im2" => second});
        crate::engine::save(&mut doc).unwrap()
    }

    #[test]
    fn oversampled_images_are_resampled_with_passing_fidelity_checks() {
        let source = image_document(600, false);
        let (output, report) = compress(
            &source,
            CompressionPreset::Balanced,
            &AtomicBool::new(false),
        )
        .unwrap();
        let output = output.expect("a useful reduction");
        assert!(
            report.useful && report.images_recompressed == 1,
            "{report:?}"
        );
        assert_eq!(report.after_bytes, output.len() as u64);
        assert!(report.after_bytes < report.before_bytes / 2);
        assert!(report.checks.iter().all(|check| check.passed));
        let result = crate::engine::load(&output).unwrap();
        let (_, image) = Resources::for_page(&result, result.get_pages()[&1])
            .lookup(&result, b"XObject", b"Im1")
            .unwrap();
        let width = image
            .as_stream()
            .unwrap()
            .dict
            .get(b"Width")
            .unwrap()
            .as_i64()
            .unwrap();
        assert!((200..=240).contains(&width), "{width}");
    }

    #[test]
    fn color_key_masked_images_are_left_as_they_are() {
        let mut doc = Document::load_mem(&image_document(600, false)).unwrap();
        let image = doc
            .objects
            .iter()
            .find(|(_, object)| {
                object.as_stream().is_ok_and(|stream| {
                    stream.dict.get(b"Subtype").and_then(Object::as_name).ok()
                        == Some(b"Image".as_slice())
                })
            })
            .map(|(id, _)| *id)
            .unwrap();
        doc.get_object_mut(image)
            .unwrap()
            .as_stream_mut()
            .unwrap()
            .dict
            .set("Mask", vec![Object::Integer(0); 6]);
        let source = crate::engine::save(&mut doc).unwrap();
        let (_, report) = compress(
            &source,
            CompressionPreset::Balanced,
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(report.images_recompressed, 0, "{report:?}");
        assert_eq!(report.images_skipped, 1, "{report:?}");
    }

    #[test]
    fn lossless_merges_duplicates_and_keeps_unhelpful_results_out() {
        let (output, report) = compress(
            &image_document(64, true),
            CompressionPreset::Lossless,
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(report.duplicate_streams_merged, 1);
        assert!(report.checks.iter().all(|check| check.passed));
        assert_eq!(output.is_some(), report.useful);

        let (mut tiny, _) = page_document("BT /F1 12 Tf 72 720 Td (Tiny) Tj ET", dictionary! {});
        let tiny = crate::engine::save(&mut tiny).unwrap();
        let (output, report) =
            compress(&tiny, CompressionPreset::Small, &AtomicBool::new(false)).unwrap();
        assert!(output.is_none() && !report.useful && report.message.contains("original was kept"));
        assert!(compress(&tiny, CompressionPreset::Small, &AtomicBool::new(true)).is_err());
    }
}
