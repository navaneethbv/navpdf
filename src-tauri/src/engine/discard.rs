//! Optional discards applied before compression: scripts, thumbnails, tags, bookmarks, print
//! settings, alternate images, comments, multimedia, metadata, attachments, private data,
//! embedded search indexes, form submit, import and reset actions, and references to other
//! files. Each discard is chosen explicitly and reported; nothing is removed by default.

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
    pub search_index: bool,
    pub form_actions: bool,
    pub external_references: bool,
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
    let mut report: Vec<String> = steps
        .into_iter()
        .filter(|(enabled, _, _)| *enabled)
        .filter_map(|(_, what, discard)| {
            let count = discard(doc, catalog, &pages);
            (count > 0).then(|| format!("{what}: {count}"))
        })
        .collect();
    let mut note = |what: &str, count: usize| {
        if count > 0 {
            report.push(format!("{what}: {count}"));
        }
    };
    if options.search_index {
        note(
            "Embedded search index entries removed",
            discard_search_index(doc, catalog),
        );
    }
    if options.form_actions {
        note(
            "Form submit, import and reset actions removed",
            remove_actions(doc, is_form_action)?.actions,
        );
    }
    if options.external_references {
        let removed = remove_actions(doc, is_external_reference)?;
        note("References to other files removed", removed.actions);
        note(
            "Links left without a target removed",
            remove_dead_links(doc, &pages, removed.emptied_links),
        );
    }
    Ok(report)
}

/// Removes catalog `/PieceInfo` entries whose application name contains "index" in any letter
/// case, such as `IBM-ODIndexes`. An indirect `/PieceInfo` is copied into the catalog without
/// those entries, so the original object stays intact for anything else that uses it.
fn discard_search_index(doc: &mut Document, catalog: ObjectId) -> usize {
    let Some(mut piece_info) = doc
        .get_dictionary(catalog)
        .ok()
        .and_then(|catalog| catalog.get(b"PieceInfo").ok())
        .and_then(|value| doc.dereference(value).ok())
        .and_then(|(_, value)| value.as_dict().ok())
        .cloned()
    else {
        return 0;
    };
    let indexes: Vec<Vec<u8>> = piece_info
        .iter()
        .map(|(key, _)| key.clone())
        .filter(|key| key.to_ascii_lowercase().windows(5).any(|w| w == b"index"))
        .collect();
    if indexes.is_empty() {
        return 0;
    }
    for key in &indexes {
        piece_info.remove(key);
    }
    if let Ok(catalog) = doc.get_dictionary_mut(catalog) {
        if piece_info.is_empty() {
            catalog.remove(b"PieceInfo");
        } else {
            catalog.set("PieceInfo", piece_info);
        }
    }
    indexes.len()
}

/// The most values one action walk may visit before the optimization stops with an error.
const MAX_WALK_VALUES: usize = 1_000_000;
/// The most actions one chain may hold, and the deepest `/Next` nesting followed.
const MAX_CHAIN_ACTIONS: usize = 4096;
const MAX_CHAIN_DEPTH: usize = 64;
/// Marks a link whose only action was removed until it is taken out of its page.
const DEAD_LINK: &[u8] = b"NavPDFDeadLink";

fn action_kind(action: &Dictionary) -> &[u8] {
    action.get(b"S").and_then(Object::as_name).unwrap_or(b"")
}

fn is_form_action(action: &Dictionary) -> bool {
    matches!(
        action_kind(action),
        b"SubmitForm" | b"ImportData" | b"ResetForm"
    )
}

/// Actions that open or read another file: remote and embedded go-to, launch, import data and
/// article threads in another file.
fn is_external_reference(action: &Dictionary) -> bool {
    match action_kind(action) {
        b"GoToR" | b"GoToE" | b"Launch" | b"ImportData" => true,
        b"Thread" => action.has(b"F"),
        _ => false,
    }
}

enum Step {
    Key(Vec<u8>),
    Index(usize),
}

/// Where an action is held: an object and the keys and array positions leading to the
/// dictionary entry.
type Slot = (ObjectId, Vec<Step>);

#[derive(Default)]
struct RemovedActions {
    actions: usize,
    emptied_links: usize,
}

/// An action and the actions chained after it through `/Next`, in the order they run, each
/// without its own `/Next`. Cycles are followed once.
fn flatten_chain(
    doc: &Document,
    action: &Object,
    depth: usize,
    seen: &mut HashSet<ObjectId>,
    chain: &mut Vec<Dictionary>,
) -> Result<(), String> {
    const TOO_LONG: &str =
        "An action chain in this document is too long or too deeply nested to change safely.";
    if depth > MAX_CHAIN_DEPTH {
        return Err(TOO_LONG.into());
    }
    if let Object::Reference(id) = action {
        if !seen.insert(*id) {
            return Ok(());
        }
    }
    let Some(dict) = doc
        .dereference(action)
        .ok()
        .and_then(|(_, object)| object.as_dict().ok())
    else {
        return Ok(());
    };
    let mut own = dict.clone();
    own.remove(b"Next");
    chain.push(own);
    if chain.len() > MAX_CHAIN_ACTIONS {
        return Err(TOO_LONG.into());
    }
    let Some(next) = dict.get(b"Next").ok().and_then(|next| {
        doc.dereference(next)
            .ok()
            .map(|(id, object)| (id, next, object))
    }) else {
        return Ok(());
    };
    match next {
        (id, _, Object::Array(actions)) => {
            if id.is_some_and(|id| !seen.insert(id)) {
                return Ok(());
            }
            for action in actions {
                flatten_chain(doc, action, depth + 1, seen, chain)?;
            }
            Ok(())
        }
        (_, original, _) => flatten_chain(doc, original, depth + 1, seen, chain),
    }
}

/// The replacement for an action entry once unwanted actions are taken out of its chain:
/// `None` when nothing in the chain is unwanted, `Some(None)` when nothing is left.
fn rewritten_chain(
    doc: &Document,
    action: &Object,
    unwanted: fn(&Dictionary) -> bool,
) -> Result<Option<(usize, Option<Object>)>, String> {
    let mut chain = Vec::new();
    flatten_chain(doc, action, 0, &mut HashSet::new(), &mut chain)?;
    let before = chain.len();
    chain.retain(|action| !unwanted(action));
    let removed = before - chain.len();
    if removed == 0 {
        return Ok(None);
    }
    let mut rest = chain.into_iter();
    let Some(mut first) = rest.next() else {
        return Ok(Some((removed, None)));
    };
    let mut rest: Vec<Object> = rest.map(Object::Dictionary).collect();
    match rest.len() {
        0 => {}
        1 => first.set("Next", rest.remove(0)),
        _ => first.set("Next", rest),
    }
    Ok(Some((removed, Some(Object::Dictionary(first)))))
}

/// Every place an action can be held: `/A`, `/OpenAction` and each `/AA` trigger of any
/// dictionary, however deeply it is stored inside an object. The walk keeps its own stack, so
/// deep nesting cannot exhaust the thread's.
fn action_slots(doc: &Document) -> Result<Vec<Slot>, String> {
    let mut slots: Vec<Slot> = Vec::new();
    let mut shared_triggers: HashSet<ObjectId> = HashSet::new();
    let mut visited = 0_usize;
    for (id, object) in &doc.objects {
        let mut pending: Vec<(Vec<Step>, &Object)> = vec![(Vec::new(), object)];
        while let Some((path, value)) = pending.pop() {
            visited += 1;
            if visited > MAX_WALK_VALUES {
                return Err(
                    "This document holds too many nested values to look for actions safely.".into(),
                );
            }
            let with = |step: Step| {
                let mut next: Vec<Step> = path.iter().map(Step::copy).collect();
                next.push(step);
                next
            };
            let dict = match value {
                Object::Dictionary(dict) => dict,
                Object::Stream(stream) => &stream.dict,
                Object::Array(items) => {
                    for (index, item) in items.iter().enumerate() {
                        if matches!(item, Object::Array(_) | Object::Dictionary(_)) {
                            pending.push((with(Step::Index(index)), item));
                        }
                    }
                    continue;
                }
                _ => continue,
            };
            for (key, item) in dict.iter() {
                match (key.as_slice(), item) {
                    (b"A" | b"OpenAction", _) => slots.push((*id, with(Step::Key(key.clone())))),
                    (b"AA", Object::Dictionary(triggers)) => {
                        for (trigger, _) in triggers.iter() {
                            let mut slot = with(Step::Key(key.clone()));
                            slot.push(Step::Key(trigger.clone()));
                            slots.push((*id, slot));
                        }
                    }
                    (b"AA", Object::Reference(shared)) => {
                        let triggers = doc.get_dictionary(*shared).ok();
                        if let Some(triggers) = triggers.filter(|_| shared_triggers.insert(*shared))
                        {
                            for (trigger, _) in triggers.iter() {
                                slots.push((*shared, vec![Step::Key(trigger.clone())]));
                            }
                        }
                    }
                    (_, Object::Array(_) | Object::Dictionary(_)) => {
                        pending.push((with(Step::Key(key.clone())), item));
                    }
                    _ => {}
                }
            }
        }
    }
    Ok(slots)
}

impl Step {
    fn copy(&self) -> Self {
        match self {
            Step::Key(key) => Step::Key(key.clone()),
            Step::Index(index) => Step::Index(*index),
        }
    }
}

fn dictionary_of(object: &Object) -> Option<&Dictionary> {
    match object {
        Object::Dictionary(dict) => Some(dict),
        Object::Stream(stream) => Some(&stream.dict),
        _ => None,
    }
}

fn dictionary_of_mut(object: &mut Object) -> Option<&mut Dictionary> {
    match object {
        Object::Dictionary(dict) => Some(dict),
        Object::Stream(stream) => Some(&mut stream.dict),
        _ => None,
    }
}

fn step<'a>(object: &'a Object, step: &Step) -> Option<&'a Object> {
    match step {
        Step::Key(key) => dictionary_of(object)?.get(key).ok(),
        Step::Index(index) => object.as_array().ok()?.get(*index),
    }
}

fn step_mut<'a>(object: &'a mut Object, step: &Step) -> Option<&'a mut Object> {
    match step {
        Step::Key(key) => dictionary_of_mut(object)?.get_mut(key).ok(),
        Step::Index(index) => object.as_array_mut().ok()?.get_mut(*index),
    }
}

/// Takes the actions `unwanted` matches out of every action entry. The actions chained after a
/// removed one still run, in order.
fn remove_actions(
    doc: &mut Document,
    unwanted: fn(&Dictionary) -> bool,
) -> Result<RemovedActions, String> {
    let mut edits: Vec<(Slot, Option<Object>)> = Vec::new();
    let mut removed = RemovedActions::default();
    for (id, path) in action_slots(doc)? {
        let held = doc.objects.get(&id).and_then(|root| {
            path.iter()
                .try_fold(root, |object, part| step(object, part))
        });
        let Some(held) = held else { continue };
        if let Some((count, replacement)) = rewritten_chain(doc, held, unwanted)? {
            removed.actions += count;
            edits.push(((id, path), replacement));
        }
    }
    for ((id, path), replacement) in edits {
        let Some((Step::Key(key), parents)) = path.split_last() else {
            continue;
        };
        let Some(root) = doc.objects.get_mut(&id) else {
            continue;
        };
        let holder = parents
            .iter()
            .try_fold(root, |object, part| step_mut(object, part))
            .and_then(dictionary_of_mut);
        let Some(holder) = holder else { continue };
        match replacement {
            Some(action) => holder.set(key.clone(), action),
            None => {
                holder.remove(key);
                if key == b"A" && is_subtype(holder, b"Link") && !holder.has(b"Dest") {
                    holder.set(DEAD_LINK, true);
                    removed.emptied_links += 1;
                }
            }
        }
    }
    Ok(removed)
}

/// Takes links marked as left without a target out of their pages, then clears the mark from
/// any that something else still refers to.
fn remove_dead_links(doc: &mut Document, pages: &[ObjectId], marked: usize) -> usize {
    if marked == 0 {
        return 0;
    }
    let removed = pages
        .iter()
        .map(|page| filter_annotations(doc, *page, |_, annotation| annotation.has(DEAD_LINK)).count)
        .sum();
    remove_from_objects(doc, |_| true, &[DEAD_LINK]);
    removed
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
            ..DiscardOptions::default()
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

    fn action(kind: &str) -> Dictionary {
        dictionary! {"S" => kind}
    }

    fn kinds(doc: &Document, action: &Object) -> Vec<String> {
        let mut chain = Vec::new();
        flatten_chain(doc, action, 0, &mut HashSet::new(), &mut chain).unwrap();
        chain
            .iter()
            .map(|action| String::from_utf8_lossy(action_kind(action)).into_owned())
            .collect()
    }

    fn only(options: DiscardOptions, doc: &mut Document) -> Vec<String> {
        apply(doc, &options).unwrap()
    }

    #[test]
    fn search_index_discard_keeps_other_private_data() {
        let mut doc = sample();
        let shared = doc.add_object(dictionary! {
            "IBM-ODIndexes" => dictionary! {"Private" => 1},
            "fullTextINDEX" => dictionary! {},
            "Illustrator" => dictionary! {"Private" => 2},
        });
        let catalog = catalog_id(&doc).unwrap();
        doc.get_dictionary_mut(catalog)
            .unwrap()
            .set("PieceInfo", shared);
        let options = DiscardOptions {
            search_index: true,
            ..DiscardOptions::default()
        };
        assert_eq!(
            only(options, &mut doc),
            vec!["Embedded search index entries removed: 2"]
        );
        let kept = doc
            .get_dictionary(catalog)
            .unwrap()
            .get(b"PieceInfo")
            .unwrap()
            .as_dict()
            .unwrap();
        assert!(kept.has(b"Illustrator") && kept.len() == 1);
        // The shared object is left as it was for anything else that refers to it.
        assert!(doc.get_dictionary(shared).unwrap().has(b"IBM-ODIndexes"));
        // The page's own private data is not a document search index.
        assert!(doc
            .get_dictionary(doc.get_pages()[&1])
            .unwrap()
            .has(b"PieceInfo"));
        assert!(only(options, &mut doc).is_empty());

        doc.get_dictionary_mut(catalog)
            .unwrap()
            .set("PieceInfo", dictionary! {"SearchIndex" => dictionary! {}});
        only(options, &mut doc);
        assert!(!doc.get_dictionary(catalog).unwrap().has(b"PieceInfo"));
    }

    #[test]
    fn form_actions_are_removed_and_the_actions_after_them_still_run() {
        let mut doc = sample();
        let page = doc.get_pages()[&1];
        let named = doc.add_object(action("Named"));
        let reset = doc.add_object(dictionary! {"S" => "ResetForm", "Next" => named});
        let mut submit = action("SubmitForm");
        submit.set(
            "Next",
            vec![Object::Reference(reset), action("Hide").into()],
        );
        let mut first = action("GoTo");
        first.set("Next", submit);
        let button = doc.add_object(dictionary! {
            "Type" => "Annot", "Subtype" => "Widget",
            "Rect" => vec![0.into(), 0.into(), 10.into(), 10.into()],
            "A" => first,
            "AA" => dictionary! {"U" => action("ImportData"), "D" => action("Hide")},
        });
        let shared_triggers = doc.add_object(dictionary! {"WS" => action("SubmitForm")});
        doc.get_dictionary_mut(page).unwrap().set(
            "Annots",
            vec![
                Object::Reference(button),
                // An annotation stored directly in the page's list.
                dictionary! {"Subtype" => "Widget", "A" => action("ResetForm")}.into(),
            ],
        );
        let catalog = catalog_id(&doc).unwrap();
        let catalog_dict = doc.get_dictionary_mut(catalog).unwrap();
        catalog_dict.set("OpenAction", action("ResetForm"));
        catalog_dict.set("AA", shared_triggers);

        let options = DiscardOptions {
            form_actions: true,
            ..DiscardOptions::default()
        };
        assert_eq!(
            only(options, &mut doc),
            vec!["Form submit, import and reset actions removed: 6"]
        );
        let button = doc.get_dictionary(button).unwrap();
        assert_eq!(
            kinds(&doc, button.get(b"A").unwrap()),
            vec!["GoTo", "Named", "Hide"]
        );
        let triggers = button.get(b"AA").unwrap().as_dict().unwrap();
        assert!(!triggers.has(b"U") && triggers.has(b"D"));
        assert!(doc.get_dictionary(shared_triggers).unwrap().is_empty());
        assert!(!doc.get_dictionary(catalog).unwrap().has(b"OpenAction"));
        let direct = doc.get_page_annotations(page).unwrap()[1];
        assert!(!direct.has(b"A"));
        // The script the sample opens with is not a form action; nothing more to remove.
        assert!(only(options, &mut doc).is_empty());
        assert!(crate::engine::save(&mut doc).is_ok());
    }

    #[test]
    fn external_references_leave_and_links_without_a_target_go() {
        let mut doc = sample();
        let page = doc.get_pages()[&1];
        let link = |doc: &mut Document, entries: Dictionary| {
            let mut link = dictionary! {
                "Type" => "Annot", "Subtype" => "Link",
                "Rect" => vec![0.into(), 0.into(), 10.into(), 10.into()],
            };
            link.extend(&entries);
            doc.add_object(link)
        };
        let remote = link(&mut doc, dictionary! {"A" => action("GoToR")});
        let with_dest = link(
            &mut doc,
            dictionary! {"A" => action("Launch"), "Dest" => Object::string_literal("named")},
        );
        let mut launch = action("Launch");
        launch.set("Next", action("URI"));
        let chained = link(&mut doc, dictionary! {"A" => launch});
        let local_thread = link(&mut doc, dictionary! {"A" => action("Thread")});
        let mut remote_thread = action("Thread");
        remote_thread.set("F", Object::string_literal("other.pdf"));
        let other_thread = link(&mut doc, dictionary! {"A" => remote_thread});
        let already_inert = link(&mut doc, dictionary! {});
        let bookmark = doc.add_object(dictionary! {
            "Title" => Object::string_literal("Other file"), "A" => action("GoToE"),
        });
        doc.get_dictionary_mut(page).unwrap().set(
            "Annots",
            vec![
                remote.into(),
                with_dest.into(),
                chained.into(),
                local_thread.into(),
                other_thread.into(),
                already_inert.into(),
            ],
        );
        let options = DiscardOptions {
            external_references: true,
            ..DiscardOptions::default()
        };
        assert_eq!(
            only(options, &mut doc),
            vec![
                "References to other files removed: 5",
                "Links left without a target removed: 2",
            ]
        );
        let kept: Vec<ObjectId> = doc
            .get_dictionary(page)
            .unwrap()
            .get(b"Annots")
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry.as_reference().unwrap())
            .collect();
        assert_eq!(kept, vec![with_dest, chained, local_thread, already_inert]);
        assert!(!doc.get_dictionary(with_dest).unwrap().has(b"A"));
        let chained = doc.get_dictionary(chained).unwrap();
        assert_eq!(kinds(&doc, chained.get(b"A").unwrap()), vec!["URI"]);
        let bookmark = doc.get_dictionary(bookmark).unwrap();
        assert!(bookmark.has(b"Title") && !bookmark.has(b"A"));
        // No object keeps the mark used while links are taken out of their pages.
        assert!(doc
            .objects
            .values()
            .filter_map(dictionary_of)
            .all(|dict| !dict.has(DEAD_LINK)));
    }

    #[test]
    fn action_chains_that_loop_or_run_too_long_are_handled() {
        let mut doc = sample();
        let first = doc.new_object_id();
        let second = doc.add_object(dictionary! {"S" => "ResetForm", "Next" => first});
        doc.objects
            .insert(first, dictionary! {"S" => "Named", "Next" => second}.into());
        let page = doc.get_pages()[&1];
        doc.get_dictionary_mut(page)
            .unwrap()
            .set("AA", dictionary! {"O" => first});
        let options = DiscardOptions {
            form_actions: true,
            ..DiscardOptions::default()
        };
        assert_eq!(only(options, &mut doc).len(), 1);
        let opened = doc.get_dictionary(page).unwrap().get(b"AA").unwrap();
        let opened = opened.as_dict().unwrap().get(b"O").unwrap();
        assert_eq!(kinds(&doc, opened), vec!["Named"]);

        let mut deep = action("ResetForm");
        for _ in 0..=MAX_CHAIN_DEPTH {
            let mut outer = action("Named");
            outer.set("Next", deep);
            deep = outer;
        }
        doc.get_dictionary_mut(page).unwrap().set("A", deep);
        assert!(apply(&mut doc, &options)
            .unwrap_err()
            .contains("too deeply nested"));
    }
}
