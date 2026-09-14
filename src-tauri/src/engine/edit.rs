//! Scoped edits to existing page objects: replace text drawn with simple fonts, delete text
//! or image placements, and replace an image on one page without changing other pages.

use super::content::{self, Glyph, ItemKind, Resources};
use super::fonts::{FontInfo, FontKind};
use super::geometry::{number, Matrix};
use super::images::{self, Raster, Source};
use lopdf::content::{Content, Operation};
use lopdf::{dictionary, Document, Object, ObjectId, StringFormat};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

const MAX_REPLACEMENT_CHARS: usize = 2_000;
const MAX_REPLACEMENT_PIXELS: usize = 50_000_000;
const STALE: &str = "The page changed since it was scanned. Scan the page again.";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageObject {
    pub id: String,
    pub kind: &'static str,
    pub bbox: [f64; 4],
    pub text: Option<String>,
    pub font: Option<String>,
    pub font_size: Option<f64>,
    pub pixel_width: Option<usize>,
    pub pixel_height: Option<usize>,
    pub shared: bool,
    pub replaceable: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageObjects {
    pub page: u32,
    pub media_box: [f64; 4],
    pub objects: Vec<PageObject>,
}

#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum EditRequest {
    ReplaceText {
        object_id: String,
        text: String,
        #[serde(default)]
        preview: bool,
    },
    DeleteObject {
        object_id: String,
    },
    /// Replacement pixels arrive separately as unpremultiplied RGBA.
    ReplaceImage {
        object_id: String,
        width: usize,
        height: usize,
    },
}

impl EditRequest {
    fn object_id(&self) -> &str {
        match self {
            Self::ReplaceText { object_id, .. }
            | Self::DeleteObject { object_id }
            | Self::ReplaceImage { object_id, .. } => object_id,
        }
    }
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditReport {
    pub applied: bool,
    pub message: String,
    pub width_before: Option<f64>,
    pub width_after: Option<f64>,
    pub missing_characters: Vec<String>,
}

struct PageContent {
    page_id: ObjectId,
    ops: Vec<Operation>,
    fingerprint: String,
}

fn page_content(doc: &Document, page: u32) -> Result<PageContent, String> {
    let page_id = *doc
        .get_pages()
        .get(&page)
        .ok_or_else(|| format!("Page {page} does not exist in this document."))?;
    let bytes = doc
        .get_page_content_with_limit(page_id, super::MAX_STREAM_BYTES)
        .map_err(|_| "The page content could not be decoded.")?;
    let digest = Sha256::digest(&bytes);
    let fingerprint = digest
        .iter()
        .take(6)
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let ops = Content::decode(&bytes)
        .map_err(|_| "The page content could not be parsed.")?
        .operations;
    Ok(PageContent {
        page_id,
        ops,
        fingerprint,
    })
}

fn media_box(doc: &Document, page_id: ObjectId) -> [f64; 4] {
    let mut current = Some(page_id);
    for _ in 0..64 {
        let Some(node) = current.and_then(|id| doc.get_dictionary(id).ok()) else {
            break;
        };
        let values = node
            .get(b"MediaBox")
            .ok()
            .map(|object| content::deref(doc, object))
            .and_then(|object| object.as_array().ok())
            .and_then(|values| values.iter().map(number).collect::<Option<Vec<f64>>>());
        if let Some([x0, y0, x1, y1]) = values.as_deref() {
            return [*x0, *y0, *x1, *y1];
        }
        current = node.get(b"Parent").and_then(Object::as_reference).ok();
    }
    [0.0, 0.0, 612.0, 792.0]
}

/// Pages on which each image object is drawn, including through form objects.
fn image_pages(doc: &Document) -> HashMap<ObjectId, HashSet<u32>> {
    let mut usage: HashMap<ObjectId, HashSet<u32>> = HashMap::new();
    let nothing_hidden = HashSet::new();
    for (number, page_id) in doc.get_pages() {
        let Ok(ops) = super::page_operations(doc, page_id) else {
            continue;
        };
        let resources = Resources::for_page(doc, page_id);
        let _ = content::walk(
            doc,
            &ops,
            &resources,
            Matrix::IDENTITY,
            &nothing_hidden,
            0,
            &mut |item| {
                if let ItemKind::Image { id: Some(id), .. } = item.kind {
                    usage.entry(id).or_default().insert(number);
                }
            },
        );
    }
    usage
}

fn text_blocker(font: Option<&FontInfo<'_>>) -> Option<&'static str> {
    match font {
        None => Some("The font for this text could not be found."),
        Some(font) if font.kind == FontKind::Type0 => {
            Some("Text in composite (CID) fonts cannot be re-encoded safely.")
        }
        Some(font) if font.kind == FontKind::Type3 => {
            Some("Text drawn with Type 3 glyph procedures cannot be re-encoded safely.")
        }
        Some(_) => None,
    }
}

pub fn inspect(bytes: &[u8], page: u32) -> Result<PageObjects, String> {
    let doc = super::load(bytes)?;
    let content = page_content(&doc, page)?;
    let resources = Resources::for_page(&doc, content.page_id);
    let usage = image_pages(&doc);
    let items = content::scan(
        &doc,
        &content.ops,
        &resources,
        Matrix::IDENTITY,
        &HashSet::new(),
    );
    let mut placements: HashMap<ObjectId, usize> = HashMap::new();
    for item in &items {
        if let ItemKind::Image { id: Some(id), .. } = item.kind {
            *placements.entry(id).or_default() += 1;
        }
    }
    let objects = items
        .iter()
        .filter_map(|item| {
            let id = format!("{}:{}", content.fingerprint, item.op);
            match &item.kind {
                ItemKind::Text {
                    font, size, glyphs, ..
                } if !glyphs.is_empty() => {
                    let info = resources
                        .lookup(&doc, b"Font", font)
                        .and_then(|(_, object)| object.as_dict().ok())
                        .map(|dict| FontInfo::load(&doc, dict));
                    let blocker = text_blocker(info.as_ref());
                    Some(PageObject {
                        id,
                        kind: "text",
                        bbox: item.bbox.to_array(),
                        text: Some(glyphs.iter().map(|glyph| glyph.text.as_str()).collect()),
                        font: info.as_ref().map(|font| font.base_name.clone()),
                        font_size: Some(*size),
                        pixel_width: None,
                        pixel_height: None,
                        shared: false,
                        replaceable: blocker.is_none(),
                        reason: blocker.map(String::from),
                    })
                }
                ItemKind::Image {
                    name, id: image_id, ..
                } => {
                    let stream = image_id
                        .and_then(|image| doc.get_object(image).and_then(Object::as_stream).ok());
                    let dimension = |key: &[u8]| {
                        stream
                            .and_then(|s| s.dict.get(key).ok())
                            .and_then(|value| value.as_i64().ok())
                            .and_then(|value| usize::try_from(value).ok())
                    };
                    let shared = image_id.is_some_and(|image| {
                        usage.get(&image).is_some_and(|pages| pages.len() > 1)
                            || placements.get(&image).copied().unwrap_or(0) > 1
                    });
                    let named = name.is_some() && image_id.is_some();
                    Some(PageObject {
                        id,
                        kind: "image",
                        bbox: item.bbox.to_array(),
                        text: None,
                        font: None,
                        font_size: None,
                        pixel_width: dimension(b"Width"),
                        pixel_height: dimension(b"Height"),
                        shared,
                        replaceable: named,
                        reason: (!named)
                            .then(|| "Inline images can be deleted but not replaced.".into()),
                    })
                }
                _ => None,
            }
        })
        .collect();
    Ok(PageObjects {
        page,
        media_box: media_box(&doc, content.page_id),
        objects,
    })
}

fn operation_index(object_id: &str, fingerprint: &str) -> Result<usize, String> {
    let (page_fingerprint, index) = object_id.split_once(':').ok_or(STALE)?;
    if page_fingerprint != fingerprint {
        return Err(STALE.into());
    }
    index.parse().map_err(|_| STALE.into())
}

/// Bytes of one glyph's character code inside its text operation.
fn glyph_code<'o>(op: &'o Operation, glyph: &Glyph) -> Option<&'o [u8]> {
    let string = match op.operator.as_str() {
        "TJ" => op.operands.first()?.as_array().ok()?.get(glyph.element)?,
        "\"" => op.operands.get(2)?,
        _ => op.operands.first()?,
    };
    match string {
        Object::String(bytes, _) => bytes.get(glyph.start..glyph.start + glyph.len),
        _ => None,
    }
}

/// Applies an edit and returns the new document, or only a report for previews and refusals.
pub fn apply(
    bytes: &[u8],
    page: u32,
    request: &EditRequest,
    rgba: Option<&[u8]>,
) -> Result<(Option<Vec<u8>>, EditReport), String> {
    let mut doc = super::load(bytes)?;
    let PageContent {
        page_id,
        mut ops,
        fingerprint,
    } = page_content(&doc, page)?;
    let index = operation_index(request.object_id(), &fingerprint)?;
    let item = content::scan(
        &doc,
        &ops,
        &Resources::for_page(&doc, page_id),
        Matrix::IDENTITY,
        &HashSet::new(),
    )
    .into_iter()
    .find(|item| item.op == index)
    .ok_or(STALE)?;
    let mut report = EditReport::default();
    match (request, &item.kind) {
        (
            EditRequest::ReplaceText { text, preview, .. },
            ItemKind::Text {
                font, size, glyphs, ..
            },
        ) => {
            if text.is_empty()
                || text.chars().count() > MAX_REPLACEMENT_CHARS
                || text.contains(['\n', '\r'])
            {
                return Err(
                    "Replacement text must be a single line of 1 to 2,000 characters.".into(),
                );
            }
            let encoded = {
                let resources = Resources::for_page(&doc, page_id);
                let info = resources
                    .lookup(&doc, b"Font", font)
                    .and_then(|(_, object)| object.as_dict().ok())
                    .map(|dict| FontInfo::load(&doc, dict));
                let info = match (text_blocker(info.as_ref()), info) {
                    (None, Some(info)) => info,
                    (reason, _) => {
                        return Err(reason.unwrap_or("The font could not be read.").into())
                    }
                };
                let used = used_codes(&doc, &ops, &resources, font);
                let mut missing: Vec<String> = Vec::new();
                for ch in text.chars() {
                    let available = info
                        .encode(&ch.to_string())
                        .is_some_and(|code| !info.embedded || used.contains(&code));
                    if !available && !missing.contains(&ch.to_string()) {
                        missing.push(ch.to_string());
                    }
                }
                report.missing_characters = missing;
                let width = |codes: Vec<Vec<u8>>| {
                    codes.iter().map(|code| info.width(code).0).sum::<f64>() * size / 1000.0
                };
                report.width_before = Some(width(
                    glyphs
                        .iter()
                        .filter_map(|glyph| glyph_code(&ops[index], glyph).map(<[u8]>::to_vec))
                        .collect(),
                ));
                let encoded = info.encode(text);
                report.width_after = encoded
                    .as_ref()
                    .map(|bytes| width(bytes.iter().map(|byte| vec![*byte]).collect()));
                encoded
            };
            let (Some(encoded), true) = (encoded, report.missing_characters.is_empty()) else {
                report.message = format!(
                    "These characters are not available in the document's font: {}. The text was not changed.",
                    report.missing_characters.join(" ")
                );
                return Ok((None, report));
            };
            if *preview {
                report.message = format!(
                    "The replacement is {:.1} pt wide; the original is {:.1} pt. Text is not reflowed.",
                    report.width_after.unwrap_or_default(),
                    report.width_before.unwrap_or_default()
                );
                return Ok((None, report));
            }
            let string = Object::String(encoded, StringFormat::Literal);
            let op = &ops[index];
            ops[index] = match op.operator.as_str() {
                "'" => Operation::new("'", vec![string]),
                "\"" => Operation::new(
                    "\"",
                    vec![op.operands[0].clone(), op.operands[1].clone(), string],
                ),
                _ => Operation::new("Tj", vec![string]),
            };
            report.message = "Text replaced.".into();
        }
        (EditRequest::DeleteObject { .. }, ItemKind::Text { glyphs, .. }) => {
            let replacement =
                super::redact::rewrite_text(&ops[index], glyphs, &vec![true; glyphs.len()]);
            ops.splice(index..=index, replacement);
            report.message = "Text deleted.".into();
        }
        (EditRequest::DeleteObject { .. }, ItemKind::Image { .. }) => {
            ops.remove(index);
            report.message = "Image deleted.".into();
        }
        (
            EditRequest::ReplaceImage { width, height, .. },
            ItemKind::Image {
                name: Some(_),
                id: Some(_),
                ..
            },
        ) => {
            let (width, height) = (*width, *height);
            let rgba = rgba.ok_or("The replacement image data is missing.")?;
            if width == 0
                || height == 0
                || width
                    .checked_mul(height)
                    .is_none_or(|pixels| pixels > MAX_REPLACEMENT_PIXELS)
                || rgba.len() != width * height * 4
            {
                return Err("The replacement image is empty, too large or malformed.".into());
            }
            let rgb: Vec<u8> = rgba
                .chunks_exact(4)
                .flat_map(|pixel| [pixel[0], pixel[1], pixel[2]])
                .collect();
            let alpha: Vec<u8> = rgba.chunks_exact(4).map(|pixel| pixel[3]).collect();
            let raster = |components, pixels| Raster {
                width,
                height,
                components,
                pixels,
                source: Source::Raw,
            };
            let base = dictionary! {
                "Type" => "XObject", "Subtype" => "Image", "ColorSpace" => "DeviceRGB", "BitsPerComponent" => 8,
            };
            let mut image = images::encode_flate(&raster(3, rgb), &base);
            if alpha.iter().any(|value| *value < 255) {
                let mut mask_dict = base.clone();
                mask_dict.set("ColorSpace", "DeviceGray");
                let mask = doc.add_object(images::encode_flate(&raster(1, alpha), &mask_dict));
                image.dict.set("SMask", Object::Reference(mask));
            }
            let image_id = doc.add_object(image);
            super::own_page_resources(&mut doc, page_id)?;
            let name = super::unused_resource_name(&doc, page_id, b"XObject", "NavImage");
            super::add_page_resource(&mut doc, page_id, b"XObject", &name, image_id)?;
            ops[index] = Operation::new("Do", vec![Object::Name(name)]);
            report.message = "Image replaced on this page only.".into();
        }
        _ => return Err("This edit is not supported for the selected object.".into()),
    }
    let expected_pages = doc.get_pages().len();
    super::set_page_content(&mut doc, page_id, super::encode_operations(ops)?)?;
    let output = super::save(&mut doc)?;
    if super::load(&output)?.get_pages().len() != expected_pages {
        return Err("The edited PDF failed validation. The document is unchanged.".into());
    }
    report.applied = true;
    Ok((Some(output), report))
}

/// Character codes already drawn on the page with a font resource; an embedded subset is
/// only known to contain glyphs for these codes.
fn used_codes(
    doc: &Document,
    ops: &[Operation],
    resources: &Resources<'_>,
    font: &[u8],
) -> HashSet<Vec<u8>> {
    content::scan(doc, ops, resources, Matrix::IDENTITY, &HashSet::new())
        .into_iter()
        .filter_map(|item| match item.kind {
            ItemKind::Text {
                font: name, glyphs, ..
            } if name == font => Some((item.op, glyphs)),
            _ => None,
        })
        .flat_map(|(op, glyphs)| {
            glyphs
                .iter()
                .filter_map(|glyph| glyph_code(&ops[op], glyph).map(<[u8]>::to_vec))
                .collect::<Vec<_>>()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::content::tests::page_document;
    use lopdf::Stream;

    fn saved(doc: &mut Document) -> Vec<u8> {
        crate::engine::save(doc).unwrap()
    }

    fn text_of(bytes: &[u8], page: u32) -> String {
        crate::engine::load(bytes)
            .unwrap()
            .extract_text(&[page])
            .unwrap()
    }

    #[test]
    fn standard_font_text_is_replaced_with_a_width_preview_and_stale_ids_are_rejected() {
        let (mut doc, _) = page_document(
            "BT /F1 12 Tf 72 700 Td (Invoice 1001) Tj ET BT /F1 12 Tf 72 680 Td (Unchanged) Tj ET",
            dictionary! {},
        );
        let source = saved(&mut doc);
        let objects = inspect(&source, 1).unwrap();
        let first = &objects.objects[0];
        assert_eq!(
            (first.kind, first.text.as_deref(), first.replaceable),
            ("text", Some("Invoice 1001"), true)
        );
        assert_eq!(objects.media_box, [0.0, 0.0, 612.0, 792.0]);

        let preview = EditRequest::ReplaceText {
            object_id: first.id.clone(),
            text: "Invoice 1002".into(),
            preview: true,
        };
        let (output, report) = apply(&source, 1, &preview, None).unwrap();
        assert!(output.is_none() && !report.applied);
        assert_eq!(report.width_before, report.width_after);

        let replace = EditRequest::ReplaceText {
            object_id: first.id.clone(),
            text: "Invoice 1002".into(),
            preview: false,
        };
        let (output, report) = apply(&source, 1, &replace, None).unwrap();
        let output = output.unwrap();
        assert!(report.applied);
        let text = text_of(&output, 1);
        assert!(
            text.contains("Invoice 1002") && !text.contains("1001") && text.contains("Unchanged")
        );
        assert!(apply(&output, 1, &replace, None)
            .unwrap_err()
            .contains("Scan the page again"));
    }

    #[test]
    fn embedded_subsets_only_accept_characters_already_drawn() {
        let (mut doc, page) = page_document("BT /F2 12 Tf 72 700 Td (ABBA) Tj ET", dictionary! {});
        let font_file = doc.add_object(Stream::new(dictionary! {}, vec![0; 8]));
        let descriptor =
            doc.add_object(dictionary! {"Type" => "FontDescriptor", "FontFile2" => font_file});
        let subset = doc.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "TrueType", "BaseFont" => "ABCDEF+Custom",
            "Encoding" => "WinAnsiEncoding", "FirstChar" => 65,
            "Widths" => vec![500.into(), 600.into(), 700.into()], "FontDescriptor" => descriptor,
        });
        doc.get_dictionary_mut(page)
            .unwrap()
            .get_mut(b"Resources")
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("Font", dictionary! {"F2" => subset});
        let source = saved(&mut doc);
        let id = inspect(&source, 1).unwrap().objects[0].id.clone();
        let request = |text: &str| EditRequest::ReplaceText {
            object_id: id.clone(),
            text: text.into(),
            preview: false,
        };
        let (output, report) = apply(&source, 1, &request("ABC"), None).unwrap();
        assert!(output.is_none() && report.missing_characters == ["C"]);
        let (output, _) = apply(&source, 1, &request("BAAB"), None).unwrap();
        assert!(text_of(&output.unwrap(), 1).contains("BAAB"));
        assert!(apply(&source, 1, &request("line\nbreak"), None).is_err());

        let composite = dictionary! {"Type" => "Font", "Subtype" => "Type0", "BaseFont" => "CID"};
        let blocked = FontInfo::load(&doc, &composite);
        assert!(text_blocker(Some(&blocked)).is_some() && text_blocker(None).is_some());
    }

    #[test]
    fn deletions_keep_neighbors_and_image_replacement_stays_on_one_page() {
        let (mut doc, page) = page_document(
            "BT /F1 12 Tf 72 700 Td (Remove me) Tj (Keep me) Tj ET q 50 0 0 50 100 100 cm /Im1 Do Q",
            dictionary! {},
        );
        let image = doc.add_object(Stream::new(
            dictionary! {"Type" => "XObject", "Subtype" => "Image", "Width" => 2, "Height" => 2,
            "ColorSpace" => "DeviceGray", "BitsPerComponent" => 8},
            vec![10, 20, 30, 40],
        ));
        doc.get_dictionary_mut(page)
            .unwrap()
            .get_mut(b"Resources")
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("XObject", dictionary! {"Im1" => image});
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
        let source = saved(&mut doc);
        let objects = inspect(&source, 1).unwrap().objects;
        let image_object = objects
            .iter()
            .find(|object| object.kind == "image")
            .unwrap();
        assert!(image_object.shared && image_object.pixel_width == Some(2));

        let delete = EditRequest::DeleteObject {
            object_id: objects[0].id.clone(),
        };
        let deleted = apply(&source, 1, &delete, None).unwrap().0.unwrap();
        let text = text_of(&deleted, 1);
        assert!(
            !text.contains("Remove") && text.contains("Keep me"),
            "{text}"
        );
        let keep_x = |bytes: &[u8]| {
            inspect(bytes, 1)
                .unwrap()
                .objects
                .into_iter()
                .find(|object| object.text.as_deref() == Some("Keep me"))
                .unwrap()
                .bbox[0]
        };
        assert!((keep_x(&deleted) - keep_x(&source)).abs() < 1e-3);

        let replace = EditRequest::ReplaceImage {
            object_id: image_object.id.clone(),
            width: 1,
            height: 1,
        };
        let replaced = apply(&source, 1, &replace, Some(&[255, 0, 0, 128]))
            .unwrap()
            .0
            .unwrap();
        let result = crate::engine::load(&replaced).unwrap();
        let image_dict = |number: u32| {
            let page_id = result.get_pages()[&number];
            let ops = crate::engine::page_operations(&result, page_id).unwrap();
            let name = ops.iter().find(|op| op.operator == "Do").unwrap().operands[0]
                .as_name()
                .unwrap()
                .to_vec();
            let resources = Resources::for_page(&result, page_id);
            resources
                .lookup(&result, b"XObject", &name)
                .unwrap()
                .1
                .as_stream()
                .unwrap()
                .dict
                .clone()
        };
        let first = image_dict(1);
        assert!(first.has(b"SMask") && first.get(b"Width").unwrap().as_i64().unwrap() == 1);
        assert_eq!(image_dict(2).get(b"Width").unwrap().as_i64().unwrap(), 2);
        assert!(apply(&source, 1, &replace, Some(&[0; 3])).is_err());
    }
}
