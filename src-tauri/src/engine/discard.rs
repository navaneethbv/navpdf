//! Optional discards applied before compression: scripts, thumbnails, tags, bookmarks, print
//! settings, alternate images, comments, multimedia, metadata, attachments and private data.
//! Each discard is chosen explicitly and reported; nothing is removed by default.

use super::redact::{catalog_id, filter_annotations, names_dictionary};
use lopdf::{Dictionary, Document, Object, ObjectId};
use serde::Deserialize;
use std::collections::HashSet;

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct DiscardOptions {
    pub javascript: bool,
    pub thumbnails: bool,
    pub tags: bool,
    pub bookmarks: bool,
    pub print_settings: bool,
    pub alternate_images: bool,
    pub comments: bool,
    pub multimedia: bool,
    pub metadata: bool,
    pub attachments: bool,
    pub private_data: bool,
}

impl DiscardOptions {
    pub fn any(&self) -> bool {
        *self != Self::default()
    }
}

const COMMENT_SUBTYPES: &[&[u8]] = &[
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
    b"Redact",
];
const MULTIMEDIA_SUBTYPES: &[&[u8]] = &[b"Screen", b"Movie", b"Sound", b"RichMedia", b"3D"];
const PRINT_PREFERENCES: &[&[u8]] = &[
    b"PrintScaling",
    b"Duplex",
    b"PickTrayByPDFSize",
    b"PrintPageRange",
    b"NumCopies",
    b"PrintArea",
    b"PrintClip",
];

type Discard = fn(&mut Document, ObjectId, &[ObjectId]) -> usize;

/// Applies the chosen discards and returns a description of each one that changed something.
pub fn apply(doc: &mut Document, options: &DiscardOptions) -> Result<Vec<String>, String> {
    let catalog = catalog_id(doc)?;
    let pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
    let steps: [(bool, &str, Discard); 11] = [
        (
            options.javascript,
            "JavaScript actions removed",
            |doc, catalog, _| discard_javascript(doc, catalog),
        ),
        (
            options.thumbnails,
            "Page thumbnails removed",
            |doc, _, _| remove_from_objects(doc, |dict| is_type(dict, b"Page"), &[b"Thumb"]),
        ),
        (options.tags, "Tag structure entries removed", discard_tags),
        (
            options.bookmarks,
            "Bookmark trees removed",
            discard_bookmarks,
        ),
        (
            options.print_settings,
            "Print settings removed",
            |doc, catalog, _| discard_print_settings(doc, catalog),
        ),
        (
            options.alternate_images,
            "Alternate image lists removed",
            |doc, _, _| {
                remove_from_objects(doc, |dict| is_subtype(dict, b"Image"), &[b"Alternates"])
            },
        ),
        (options.comments, "Comments removed", |doc, _, pages| {
            remove_annotations(doc, pages, COMMENT_SUBTYPES)
        }),
        (
            options.multimedia,
            "Multimedia annotations removed",
            |doc, _, pages| remove_annotations(doc, pages, MULTIMEDIA_SUBTYPES),
        ),
        (
            options.metadata,
            "Document information and metadata entries removed",
            |doc, _, _| {
                let info = usize::from(doc.trailer.remove(b"Info").is_some());
                info + remove_from_objects(doc, |_| true, &[b"Metadata"])
            },
        ),
        (
            options.attachments,
            "Attachment entries removed",
            discard_attachments,
        ),
        (
            options.private_data,
            "Private application data entries removed",
            |doc, _, _| remove_from_objects(doc, |_| true, &[b"PieceInfo"]),
        ),
    ];
    Ok(steps
        .into_iter()
        .filter(|(enabled, _, _)| *enabled)
        .filter_map(|(_, what, discard)| {
            let count = discard(doc, catalog, &pages);
            (count > 0).then(|| format!("{what}: {count}"))
        })
        .collect())
}

fn discard_tags(doc: &mut Document, catalog: ObjectId, _: &[ObjectId]) -> usize {
    let root = remove_catalog_keys(doc, catalog, &[b"StructTreeRoot", b"MarkInfo"]);
    let links = remove_from_objects(doc, |_| true, &[b"StructParents", b"StructParent"]);
    root.min(1) + links
}

fn discard_bookmarks(doc: &mut Document, catalog: ObjectId, _: &[ObjectId]) -> usize {
    let removed = remove_catalog_keys(doc, catalog, &[b"Outlines"]);
    let Ok(catalog) = doc.get_dictionary_mut(catalog) else {
        return removed;
    };
    let outline_mode = catalog
        .get(b"PageMode")
        .and_then(Object::as_name)
        .is_ok_and(|mode| mode == b"UseOutlines");
    if outline_mode {
        catalog.set("PageMode", "UseNone");
    }
    removed
}

fn discard_attachments(doc: &mut Document, catalog: ObjectId, pages: &[ObjectId]) -> usize {
    let tree = names_dictionary(doc, catalog)
        .and_then(|names| names.remove(b"EmbeddedFiles"))
        .is_some();
    let collection = remove_catalog_keys(doc, catalog, &[b"Collection"]);
    let associated = remove_from_objects(doc, |_| true, &[b"AF"]);
    let annotations = remove_annotations(doc, pages, &[b"FileAttachment"]);
    usize::from(tree) + collection + associated + annotations
}

fn is_type(dict: &Dictionary, kind: &[u8]) -> bool {
    dict.get(b"Type")
        .and_then(Object::as_name)
        .is_ok_and(|name| name == kind)
}

fn is_subtype(dict: &Dictionary, kind: &[u8]) -> bool {
    dict.get(b"Subtype")
        .and_then(Object::as_name)
        .is_ok_and(|name| name == kind)
}

/// Removes keys from every top-level dictionary or stream dictionary that matches `select`.
fn remove_from_objects(
    doc: &mut Document,
    select: impl Fn(&Dictionary) -> bool,
    keys: &[&[u8]],
) -> usize {
    let mut removed = 0;
    for object in doc.objects.values_mut() {
        let dict = match object {
            Object::Dictionary(dict) => dict,
            Object::Stream(stream) => &mut stream.dict,
            _ => continue,
        };
        if select(dict) {
            removed += keys.iter().filter(|key| dict.remove(key).is_some()).count();
        }
    }
    removed
}

fn remove_catalog_keys(doc: &mut Document, catalog: ObjectId, keys: &[&[u8]]) -> usize {
    doc.get_dictionary_mut(catalog).map_or(0, |catalog| {
        keys.iter()
            .filter(|key| catalog.remove(key).is_some())
            .count()
    })
}

fn remove_annotations(doc: &mut Document, pages: &[ObjectId], subtypes: &[&[u8]]) -> usize {
    pages
        .iter()
        .map(|page| {
            filter_annotations(doc, *page, |_, annotation| {
                annotation
                    .get(b"Subtype")
                    .and_then(Object::as_name)
                    .is_ok_and(|subtype| subtypes.contains(&subtype))
            })
            .count
        })
        .sum()
}

fn discard_print_settings(doc: &mut Document, catalog: ObjectId) -> usize {
    let reference = doc
        .get_dictionary(catalog)
        .ok()
        .and_then(|catalog| catalog.get(b"ViewerPreferences").ok())
        .and_then(|preferences| preferences.as_reference().ok());
    let preferences = match reference {
        Some(id) => doc.get_dictionary_mut(id).ok(),
        None => doc
            .get_dictionary_mut(catalog)
            .ok()
            .and_then(|catalog| catalog.get_mut(b"ViewerPreferences").ok())
            .and_then(|preferences| preferences.as_dict_mut().ok()),
    };
    preferences.map_or(0, |preferences| {
        PRINT_PREFERENCES
            .iter()
            .filter(|key| preferences.remove(key).is_some())
            .count()
    })
}

fn is_javascript(object: &Object, scripts: &HashSet<ObjectId>) -> bool {
    match object {
        Object::Reference(id) => scripts.contains(id),
        Object::Dictionary(dict) => is_script_action(dict),
        _ => false,
    }
}

fn is_script_action(dict: &Dictionary) -> bool {
    dict.get(b"S")
        .and_then(Object::as_name)
        .is_ok_and(|kind| kind == b"JavaScript")
}

/// Removes JavaScript actions wherever an action can appear, including additional-action
/// triggers and action chains, plus the document-level script name tree.
fn discard_javascript(doc: &mut Document, catalog: ObjectId) -> usize {
    let mut removed = usize::from(
        names_dictionary(doc, catalog)
            .and_then(|names| names.remove(b"JavaScript"))
            .is_some(),
    );
    let scripts: HashSet<ObjectId> = doc
        .objects
        .iter()
        .filter(|(_, object)| object.as_dict().is_ok_and(is_script_action))
        .map(|(id, _)| *id)
        .collect();
    for object in doc.objects.values_mut() {
        removed += strip_scripts(object, &scripts);
    }
    removed
}

fn strip_scripts(object: &mut Object, scripts: &HashSet<ObjectId>) -> usize {
    let dict = match object {
        Object::Dictionary(dict) => dict,
        Object::Stream(stream) => &mut stream.dict,
        Object::Array(items) => {
            return items
                .iter_mut()
                .map(|item| strip_scripts(item, scripts))
                .sum();
        }
        _ => return 0,
    };
    let mut removed = 0;
    for key in [b"A".as_slice(), b"OpenAction"] {
        if dict
            .get(key)
            .is_ok_and(|action| is_javascript(action, scripts))
        {
            dict.remove(key);
            removed += 1;
        }
    }
    match dict.get_mut(b"Next") {
        Ok(next @ (Object::Reference(_) | Object::Dictionary(_)))
            if is_javascript(next, scripts) =>
        {
            dict.remove(b"Next");
            removed += 1;
        }
        Ok(Object::Array(chain)) => {
            let before = chain.len();
            chain.retain(|action| !is_javascript(action, scripts));
            removed += before - chain.len();
        }
        _ => {}
    }
    if let Ok(Object::Dictionary(triggers)) = dict.get_mut(b"AA") {
        let scripted: Vec<Vec<u8>> = triggers
            .iter()
            .filter(|(_, action)| is_javascript(action, scripts))
            .map(|(key, _)| key.clone())
            .collect();
        for key in &scripted {
            triggers.remove(key);
        }
        removed += scripted.len();
        if triggers.is_empty() {
            dict.remove(b"AA");
        }
    }
    for (_, value) in dict.iter_mut() {
        removed += strip_scripts(value, scripts);
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::content::tests::page_document;
    use lopdf::dictionary;

    fn sample() -> Document {
        let (mut doc, page) = page_document("BT /F1 12 Tf 72 700 Td (Kept) Tj ET", dictionary! {});
        let script = doc.add_object(
            dictionary! {"S" => "JavaScript", "JS" => Object::string_literal("app.alert(1)")},
        );
        let link = doc.add_object(dictionary! {
            "Type" => "Annot", "Subtype" => "Link",
            "Rect" => vec![0.into(), 0.into(), 10.into(), 10.into()],
            "A" => dictionary! {"S" => "URI", "URI" => Object::string_literal("https://example.com"), "Next" => script},
        });
        let note = doc.add_object(dictionary! {
            "Type" => "Annot", "Subtype" => "Text",
            "Rect" => vec![0.into(), 0.into(), 10.into(), 10.into()],
        });
        let screen = doc.add_object(dictionary! {
            "Type" => "Annot", "Subtype" => "Screen",
            "Rect" => vec![0.into(), 0.into(), 10.into(), 10.into()],
        });
        let thumb = doc.add_object(lopdf::Stream::new(dictionary! {}, vec![0]));
        let page_dict = doc.get_dictionary_mut(page).unwrap();
        page_dict.set("Annots", vec![link.into(), note.into(), screen.into()]);
        page_dict.set("Thumb", thumb);
        page_dict.set("PieceInfo", dictionary! {});
        page_dict.set("StructParents", 0);
        page_dict.set("AA", dictionary! {"O" => script});
        let tree = doc.add_object(dictionary! {"Type" => "StructTreeRoot"});
        let outlines = doc.add_object(dictionary! {"Type" => "Outlines"});
        let catalog = catalog_id(&doc).unwrap();
        let info = doc.add_object(dictionary! {"Title" => Object::string_literal("T")});
        doc.trailer.set("Info", info);
        let catalog = doc.get_dictionary_mut(catalog).unwrap();
        catalog.set("OpenAction", script);
        catalog.set("StructTreeRoot", tree);
        catalog.set("MarkInfo", dictionary! {"Marked" => true});
        catalog.set("Outlines", outlines);
        catalog.set("PageMode", "UseOutlines");
        catalog.set(
            "ViewerPreferences",
            dictionary! {"Duplex" => "Simplex", "NumCopies" => 2, "DisplayDocTitle" => true},
        );
        catalog.set(
            "Names",
            dictionary! {"JavaScript" => dictionary! {"Names" => vec![]}},
        );
        doc
    }

    fn annotation_subtypes(doc: &Document) -> Vec<Vec<u8>> {
        let page = doc.get_pages()[&1];
        doc.get_page_annotations(page)
            .unwrap_or_default()
            .iter()
            .map(|annotation| {
                annotation
                    .get(b"Subtype")
                    .unwrap()
                    .as_name()
                    .unwrap()
                    .to_vec()
            })
            .collect()
    }

    #[test]
    fn nothing_is_discarded_by_default() {
        let mut doc = sample();
        let before = crate::engine::save(&mut doc.clone()).unwrap();
        assert!(apply(&mut doc, &DiscardOptions::default())
            .unwrap()
            .is_empty());
        assert_eq!(crate::engine::save(&mut doc).unwrap(), before);
    }

    #[test]
    fn each_discard_removes_only_its_own_structures() {
        let mut doc = sample();
        let all = DiscardOptions {
            javascript: true,
            thumbnails: true,
            tags: true,
            bookmarks: true,
            print_settings: true,
            alternate_images: true,
            comments: true,
            multimedia: true,
            metadata: true,
            attachments: true,
            private_data: true,
        };
        let report = apply(&mut doc, &all).unwrap();
        assert!(report.len() >= 9, "{report:?}");
        let catalog = doc.get_dictionary(catalog_id(&doc).unwrap()).unwrap();
        for key in [
            b"OpenAction".as_slice(),
            b"StructTreeRoot",
            b"MarkInfo",
            b"Outlines",
        ] {
            assert!(!catalog.has(key));
        }
        assert_eq!(
            catalog.get(b"PageMode").unwrap().as_name().unwrap(),
            b"UseNone"
        );
        let preferences = catalog
            .get(b"ViewerPreferences")
            .unwrap()
            .as_dict()
            .unwrap();
        assert!(!preferences.has(b"Duplex") && !preferences.has(b"NumCopies"));
        assert!(preferences.has(b"DisplayDocTitle"));
        assert!(!doc.trailer.has(b"Info"));
        let page = doc.get_dictionary(doc.get_pages()[&1]).unwrap();
        for key in [b"Thumb".as_slice(), b"PieceInfo", b"StructParents", b"AA"] {
            assert!(!page.has(key));
        }
        // The link stays, minus the script chained after its URI action.
        assert_eq!(annotation_subtypes(&doc), vec![b"Link".to_vec()]);
        let link = &doc.get_page_annotations(doc.get_pages()[&1]).unwrap()[0];
        let action = link.get(b"A").unwrap().as_dict().unwrap();
        assert!(action.has(b"URI") && !action.has(b"Next"));
        let text = doc.extract_text(&[1]).unwrap();
        assert!(text.contains("Kept"));
    }

    #[test]
    fn comment_discard_keeps_links_and_multimedia() {
        let mut doc = sample();
        let options = DiscardOptions {
            comments: true,
            ..DiscardOptions::default()
        };
        apply(&mut doc, &options).unwrap();
        assert_eq!(
            annotation_subtypes(&doc),
            vec![b"Link".to_vec(), b"Screen".to_vec()]
        );
    }
}
