//! Finds redactions that only look applied: text that is still extractable under an opaque
//! shape painted after it, redaction marks that were never applied, and filled annotations
//! lying over text. Findings are reported for review; nothing is changed.

use super::content::{self, ItemKind, Resources};
use super::geometry::{Matrix, Rect};
use lopdf::{Dictionary, Object};
use serde::Serialize;
use std::collections::HashSet;

const MAX_FINDINGS: usize = 1_000;
const MAX_SAMPLE_CHARS: usize = 60;
const FILL_OPERATORS: [&str; 7] = ["f", "F", "f*", "B", "B*", "b", "b*"];

#[derive(Debug, Serialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum CoverUpKind {
    /// A filled shape drawn over text that remains in the content stream.
    CoveredText,
    /// A redaction annotation that marks an area but was never applied.
    UnappliedRedaction,
    /// A filled rectangle or oval annotation lying over text.
    CoveringAnnotation,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverUp {
    pub page: u32,
    pub kind: CoverUpKind,
    pub rect: [f64; 4],
    /// Characters of extractable text under the cover.
    pub characters: usize,
    /// The start of that text, for the reviewer only; never logged.
    pub sample: String,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CoverUpReport {
    pub findings: Vec<CoverUp>,
    pub pages_checked: usize,
    pub truncated: bool,
}

struct Glyph {
    order: usize,
    bbox: Rect,
    text: String,
}

fn rect_of(annotation: &Dictionary) -> Option<Rect> {
    let values = annotation.get(b"Rect").and_then(Object::as_array).ok()?;
    Rect::from_objects(values)
}

fn name_of<'a>(dict: &'a Dictionary, key: &[u8]) -> &'a [u8] {
    dict.get(key).and_then(Object::as_name).unwrap_or_default()
}

fn covered(glyphs: &[Glyph], cover: &Rect, before: Option<usize>) -> (usize, String) {
    let area = cover.inflate(0.5);
    let mut characters = 0;
    let mut sample = String::new();
    for glyph in glyphs
        .iter()
        .filter(|glyph| before.is_none_or(|order| glyph.order < order))
        .filter(|glyph| area.contains(&glyph.bbox) && !glyph.text.trim().is_empty())
    {
        characters += glyph.text.chars().count();
        if sample.chars().count() < MAX_SAMPLE_CHARS {
            sample.push_str(&glyph.text);
        }
    }
    (characters, sample.chars().take(MAX_SAMPLE_CHARS).collect())
}

pub fn find_cover_ups(bytes: &[u8]) -> Result<CoverUpReport, String> {
    let doc = super::load(bytes)?;
    let mut report = CoverUpReport::default();
    let nothing_hidden = HashSet::new();
    for (number, page_id) in doc.get_pages() {
        report.pages_checked += 1;
        let ops = super::page_operations(&doc, page_id)?;
        let resources = Resources::for_page(&doc, page_id);
        let mut glyphs = Vec::new();
        let mut fills = Vec::new();
        let mut order = 0;
        content::walk_with_ops(
            &doc,
            &ops,
            &resources,
            Matrix::IDENTITY,
            &nothing_hidden,
            0,
            &mut |item, stream| {
                order += 1;
                if item.hidden {
                    return;
                }
                match &item.kind {
                    ItemKind::Text {
                        glyphs: run,
                        invisible: false,
                        ..
                    } => glyphs.extend(run.iter().map(|glyph| Glyph {
                        order,
                        bbox: glyph.bbox,
                        text: glyph.text.clone(),
                    })),
                    ItemKind::Path { clip: false, .. }
                        if stream
                            .get(item.op)
                            .is_some_and(|op| FILL_OPERATORS.contains(&op.operator.as_str())) =>
                    {
                        fills.push((order, item.bbox));
                    }
                    _ => {}
                }
            },
        )?;
        for (painted, bbox) in fills {
            let (characters, sample) = covered(&glyphs, &bbox, Some(painted));
            if characters > 0 {
                report.findings.push(CoverUp {
                    page: number,
                    kind: CoverUpKind::CoveredText,
                    rect: bbox.to_array(),
                    characters,
                    sample,
                });
            }
        }
        if let Ok(annotations) = doc.get_page_annotations(page_id) {
            for annotation in annotations {
                let Some(rect) = rect_of(annotation) else {
                    continue;
                };
                let subtype = name_of(annotation, b"Subtype");
                let kind = match subtype {
                    b"Redact" => CoverUpKind::UnappliedRedaction,
                    b"Square" | b"Circle" if annotation.has(b"IC") => {
                        CoverUpKind::CoveringAnnotation
                    }
                    _ => continue,
                };
                let (characters, sample) = covered(&glyphs, &rect, None);
                if kind == CoverUpKind::UnappliedRedaction || characters > 0 {
                    report.findings.push(CoverUp {
                        page: number,
                        kind,
                        rect: rect.to_array(),
                        characters,
                        sample,
                    });
                }
            }
        }
        if report.findings.len() > MAX_FINDINGS {
            report.findings.truncate(MAX_FINDINGS);
            report.truncated = true;
            break;
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::content::tests::page_document;
    use lopdf::dictionary;

    const TEXT: &str = "BT /F1 12 Tf 72 700 Td (Account 1234) Tj ET";

    fn saved(content: &str, annotations: Vec<Dictionary>) -> Vec<u8> {
        let (mut doc, page) = page_document(content, dictionary! {});
        if !annotations.is_empty() {
            let ids: Vec<Object> = annotations
                .into_iter()
                .map(|annotation| doc.add_object(annotation).into())
                .collect();
            doc.get_dictionary_mut(page).unwrap().set("Annots", ids);
        }
        crate::engine::save(&mut doc).unwrap()
    }

    #[test]
    fn a_box_painted_over_text_is_reported_with_the_hidden_text() {
        let bytes = saved(
            &format!("{TEXT} q 0 0 0 rg 60 690 200 30 re f Q"),
            Vec::new(),
        );
        let report = find_cover_ups(&bytes).unwrap();
        assert_eq!(report.findings.len(), 1);
        let finding = &report.findings[0];
        assert_eq!(finding.kind, CoverUpKind::CoveredText);
        assert!(finding.sample.contains("Account"), "{}", finding.sample);
        assert!(finding.characters >= 11);
    }

    #[test]
    fn backgrounds_drawn_first_and_stroked_boxes_are_not_reported() {
        let background = format!("q 1 1 0 rg 60 690 200 30 re f Q {TEXT}");
        assert!(find_cover_ups(&saved(&background, Vec::new()))
            .unwrap()
            .findings
            .is_empty());
        let outline = format!("{TEXT} q 60 690 200 30 re S Q");
        assert!(find_cover_ups(&saved(&outline, Vec::new()))
            .unwrap()
            .findings
            .is_empty());
    }

    #[test]
    fn unapplied_redactions_and_filled_annotations_are_reported() {
        let bytes = saved(
            TEXT,
            vec![
                dictionary! { "Type" => "Annot", "Subtype" => "Redact", "Rect" => vec![300.into(), 300.into(), 350.into(), 320.into()] },
                dictionary! { "Type" => "Annot", "Subtype" => "Square", "IC" => vec![0.into(), 0.into(), 0.into()], "Rect" => vec![60.into(), 690.into(), 260.into(), 720.into()] },
                dictionary! { "Type" => "Annot", "Subtype" => "Square", "Rect" => vec![60.into(), 690.into(), 260.into(), 720.into()] },
            ],
        );
        let kinds: Vec<_> = find_cover_ups(&bytes)
            .unwrap()
            .findings
            .iter()
            .map(|finding| finding.kind)
            .collect();
        assert_eq!(
            kinds,
            [
                CoverUpKind::UnappliedRedaction,
                CoverUpKind::CoveringAnnotation
            ]
        );
    }
}
