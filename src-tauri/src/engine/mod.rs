//! Pure-Rust PDF engine for protection, compression, existing-object edits and redaction.
//! Scope, supported structures and rejection rules are recorded in ADR 0006.

pub mod compress;
pub mod content;
pub mod edit;
pub mod fonts;
pub mod geometry;
pub mod images;
pub mod protect;
pub mod prune;
pub mod redact;
pub mod sign;
#[rustfmt::skip]
mod standard_fonts;

use lopdf::content::{Content, Operation};
use lopdf::{Dictionary, Document, Object, ObjectId, Stream};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};

/// Upper bound for any single decoded stream.
pub const MAX_STREAM_BYTES: usize = 512 * 1024 * 1024;
pub const CANCELLED: &str = "The operation was cancelled. The document is unchanged.";

/// Loads an unencrypted document for engine operations.
pub fn load(bytes: &[u8]) -> Result<Document, String> {
    let doc = Document::load_mem(bytes)
        .map_err(|_| "The PDF could not be read by the local engine.".to_string())?;
    if doc.trailer.has(b"Encrypt") {
        return Err("This PDF is password protected. Unlock it for editing first.".into());
    }
    if doc.get_pages().is_empty() {
        return Err("The PDF has no readable pages.".into());
    }
    Ok(doc)
}

pub fn save(doc: &mut Document) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    doc.save_to(&mut output)
        .map_err(|_| "The output PDF could not be written.")?;
    Ok(output)
}

pub fn stream_bytes(stream: &Stream) -> Result<Vec<u8>, String> {
    if stream.dict.has(b"Filter") {
        stream
            .decompressed_content_with_limit(MAX_STREAM_BYTES)
            .map_err(|_| "A stream could not be decoded.".into())
    } else {
        Ok(stream.content.clone())
    }
}

pub fn stream_operations(stream: &Stream) -> Result<Vec<Operation>, String> {
    let bytes = stream_bytes(stream)?;
    Content::decode(&bytes)
        .map(|content| content.operations)
        .map_err(|_| "A content stream could not be parsed.".into())
}

pub fn page_operations(doc: &Document, page_id: ObjectId) -> Result<Vec<Operation>, String> {
    let bytes = doc
        .get_page_content_with_limit(page_id, MAX_STREAM_BYTES)
        .map_err(|_| "A page's content could not be decoded.")?;
    Content::decode(&bytes)
        .map(|content| content.operations)
        .map_err(|_| "A page's content could not be parsed.".into())
}

pub fn encode_operations(operations: Vec<Operation>) -> Result<Vec<u8>, String> {
    Content { operations }
        .encode()
        .map_err(|_| "Page content could not be encoded.".into())
}

/// Replaces a page's content with one compressed stream.
pub fn set_page_content(
    doc: &mut Document,
    page_id: ObjectId,
    content: Vec<u8>,
) -> Result<(), String> {
    let mut stream = Stream::new(Dictionary::new(), content);
    let _ = stream.compress();
    let id = doc.add_object(stream);
    doc.get_dictionary_mut(page_id)
        .map_err(|_| "The page could not be updated.")?
        .set("Contents", Object::Reference(id));
    Ok(())
}

/// Copies inherited and shared resources onto the page as direct dictionaries, so names
/// added for one page cannot change other pages that share the original resources.
pub fn own_page_resources(doc: &mut Document, page_id: ObjectId) -> Result<(), String> {
    let merged = content::Resources::for_page(doc, page_id).materialize(doc);
    doc.get_dictionary_mut(page_id)
        .map_err(|_| "The page could not be updated.")?
        .set("Resources", merged);
    Ok(())
}

/// Adds a named reference to a page category; call `own_page_resources` first.
pub fn add_page_resource(
    doc: &mut Document,
    page_id: ObjectId,
    category: &[u8],
    name: &[u8],
    target: ObjectId,
) -> Result<(), String> {
    const UNAVAILABLE: &str = "The page resources could not be updated.";
    let resources = doc
        .get_dictionary_mut(page_id)
        .and_then(|page| page.get_mut(b"Resources"))
        .and_then(Object::as_dict_mut)
        .map_err(|_| UNAVAILABLE)?;
    if !resources.has(category) {
        resources.set(category.to_vec(), Dictionary::new());
    }
    resources
        .get_mut(category)
        .and_then(Object::as_dict_mut)
        .map_err(|_| UNAVAILABLE)?
        .set(name.to_vec(), Object::Reference(target));
    Ok(())
}

/// A resource name that the page does not use yet in the category.
pub fn unused_resource_name(
    doc: &Document,
    page_id: ObjectId,
    category: &[u8],
    prefix: &str,
) -> Vec<u8> {
    let used: HashSet<Vec<u8>> = content::Resources::for_page(doc, page_id)
        .entries(doc, category)
        .into_iter()
        .map(|(name, _)| name)
        .collect();
    let mut index = 1_u64;
    loop {
        let candidate = format!("{prefix}{index}").into_bytes();
        if !used.contains(&candidate) {
            return candidate;
        }
        index += 1;
    }
}

pub fn check_cancelled(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        Err(CANCELLED.into())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::dictionary;

    #[test]
    fn owned_resources_merge_inherited_categories_without_touching_the_parent() {
        let (mut doc, page) = content::tests::page_document("", dictionary! {});
        let image = doc.add_object(Stream::new(dictionary! {"Subtype" => "Image"}, vec![0]));
        let parent_id = doc
            .get_dictionary(page)
            .unwrap()
            .get(b"Parent")
            .unwrap()
            .as_reference()
            .unwrap();
        doc.get_dictionary_mut(parent_id).unwrap().set(
            "Resources",
            dictionary! {"XObject" => dictionary! {"Im1" => image}},
        );
        own_page_resources(&mut doc, page).unwrap();
        let name = unused_resource_name(&doc, page, b"XObject", "Im");
        assert_eq!(name, b"Im2");
        add_page_resource(&mut doc, page, b"XObject", &name, image).unwrap();
        let resources = doc
            .get_dictionary(page)
            .unwrap()
            .get(b"Resources")
            .unwrap()
            .as_dict()
            .unwrap();
        assert!(resources
            .get(b"Font")
            .unwrap()
            .as_dict()
            .unwrap()
            .has(b"F1"));
        let xobjects = resources.get(b"XObject").unwrap().as_dict().unwrap();
        assert!(xobjects.has(b"Im1") && xobjects.has(b"Im2"));
        let parent = doc.get_dictionary(parent_id).unwrap();
        let parent_xobjects = parent
            .get(b"Resources")
            .unwrap()
            .as_dict()
            .unwrap()
            .get(b"XObject")
            .unwrap();
        assert!(!parent_xobjects.as_dict().unwrap().has(b"Im2"));
        assert!(load(b"%PDF-1.7 broken").is_err());
    }
}
