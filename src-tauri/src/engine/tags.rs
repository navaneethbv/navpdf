//! Document tags: listing the structure tree, editing tag properties and sibling order,
//! retiring a leaf tag to an artifact, tagging an untagged document and finding untagged
//! content. Only indirect structure elements reachable from the structure tree root are
//! listed or edited. Scope and limits are recorded in ADR 0019.

use super::content::{deref, Resources};
use super::{encode_operations, load, page_operations, save, set_page_content};
use lopdf::content::Operation;
use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, StringFormat};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

/// The most tags listed or created; larger trees are reported as truncated or refused.
const MAX_TAGS: usize = 20_000;
const MAX_DEPTH: usize = 128;
/// Number tree levels followed in a parent tree.
const MAX_TREE_LEVELS: usize = 32;
const MAX_TEXT_CHARS: usize = 2_000;
/// Pages listed in an untagged-content report.
const MAX_UNTAGGED_PAGES: usize = 500;

const NO_TAGS: &str = "This document has no tags.";
const UNKNOWN_TAG: &str = "That tag is no longer in the document. List the tags again.";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TagNode {
    /// Object number and generation, such as "12 0".
    pub id: String,
    pub parent: Option<String>,
    pub depth: usize,
    /// The structure type, such as P, H1 or Figure.
    pub role: String,
    /// The standard type a custom role maps to through the role map.
    pub standard_role: Option<String>,
    pub title: String,
    pub alt: String,
    pub actual_text: String,
    pub lang: String,
    /// 1-based page of the tag or of its first content.
    pub page: Option<u32>,
    /// Marked-content identifiers the tag owns directly.
    pub mcids: Vec<i64>,
    /// Annotations the tag owns directly.
    pub objects: usize,
    /// Child tags, including inline ones that are not listed.
    pub children: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagTree {
    pub tagged: bool,
    pub nodes: Vec<TagNode>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagProperties {
    pub role: Option<String>,
    pub title: Option<String>,
    pub alt: Option<String>,
    pub actual_text: Option<String>,
    pub lang: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", tag = "action")]
pub enum TagEdit {
    SetProperties {
        id: String,
        properties: TagProperties,
    },
    /// Moves a tag one place earlier (negative) or later among its parent's children.
    Move {
        id: String,
        offset: i32,
    },
    MarkArtifact {
        id: String,
    },
    Autotag,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagReport {
    pub message: String,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UntaggedPage {
    pub page: u32,
    /// Painting operations outside tagged content and artifacts.
    pub content: usize,
    pub annotations: usize,
    pub widgets: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UntaggedReport {
    pub tagged: bool,
    pub pages: Vec<UntaggedPage>,
    pub truncated: bool,
}

fn parse_id(text: &str) -> Result<ObjectId, String> {
    let mut parts = text.split_whitespace();
    let number = parts.next().and_then(|part| part.parse().ok());
    let generation = parts.next().and_then(|part| part.parse().ok());
    match (number, generation, parts.next()) {
        (Some(number), Some(generation), None) => Ok((number, generation)),
        _ => Err(UNKNOWN_TAG.into()),
    }
}

fn format_id(id: ObjectId) -> String {
    format!("{} {}", id.0, id.1)
}

fn text_of(dictionary: &Dictionary, key: &[u8]) -> String {
    dictionary
        .get(key)
        .and_then(Object::as_str)
        .map(decode_text)
        .unwrap_or_default()
}

/// PDF text strings: UTF-16BE or UTF-8 with a byte order mark, or single-byte text.
fn decode_text(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        let units: Vec<u16> = rest
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| u16::from_be_bytes(*pair))
            .collect();
        return String::from_utf16_lossy(&units);
    }
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(rest).into_owned();
    }
    bytes.iter().map(|&byte| char::from(byte)).collect()
}

fn name_of(dictionary: &Dictionary, key: &[u8]) -> Option<String> {
    dictionary
        .get(key)
        .and_then(Object::as_name)
        .ok()
        .map(|name| String::from_utf8_lossy(name).into_owned())
}

fn struct_root(doc: &Document) -> Option<(Option<ObjectId>, &Dictionary)> {
    let catalog = doc.catalog().ok()?;
    let value = catalog.get(b"StructTreeRoot").ok()?;
    let id = value.as_reference().ok();
    let root = deref(doc, value).as_dict().ok()?;
    Some((id, root))
}

fn page_numbers(doc: &Document) -> HashMap<ObjectId, u32> {
    doc.get_pages()
        .into_iter()
        .map(|(number, id)| (id, number))
        .collect()
}

fn kids(doc: &Document, dictionary: &Dictionary) -> Vec<Object> {
    match dictionary.get(b"K").map(|value| deref(doc, value)) {
        Ok(Object::Array(items)) => items.clone(),
        Ok(_) => dictionary.get(b"K").ok().cloned().into_iter().collect(),
        Err(_) => Vec::new(),
    }
}

/// The role map entry for a custom structure type.
fn standard_role(doc: &Document, root: &Dictionary, role: &str) -> Option<String> {
    let map = deref(doc, root.get(b"RoleMap").ok()?).as_dict().ok()?;
    map.get(role.as_bytes())
        .and_then(Object::as_name)
        .ok()
        .map(|name| String::from_utf8_lossy(name).into_owned())
}

struct Walk {
    nodes: Vec<TagNode>,
    /// Each listed tag's parent: the structure tree root is `None`.
    parents: HashMap<ObjectId, Option<ObjectId>>,
    truncated: bool,
}

/// Lists indirect structure elements reachable from the root, parents before children.
fn walk(doc: &Document) -> Option<Walk> {
    let (_, root) = struct_root(doc)?;
    let pages = page_numbers(doc);
    let mut walk = Walk {
        nodes: Vec::new(),
        parents: HashMap::new(),
        truncated: false,
    };
    let mut seen = HashSet::new();
    // Children are pushed in reverse so the stack visits them in document order.
    let mut stack: Vec<(Object, Option<ObjectId>, usize, Option<ObjectId>)> = kids(doc, root)
        .into_iter()
        .rev()
        .map(|kid| (kid, None, 0, None))
        .collect();
    while let Some((kid, parent, depth, inherited_page)) = stack.pop() {
        let Ok(id) = kid.as_reference() else {
            continue;
        };
        let Ok(element) = doc.get_dictionary(id) else {
            continue;
        };
        if depth > MAX_DEPTH || !seen.insert(id) || element.get(b"S").is_err() {
            continue;
        }
        if walk.nodes.len() >= MAX_TAGS {
            walk.truncated = true;
            break;
        }
        let own_page = element.get(b"Pg").and_then(Object::as_reference).ok();
        let element_page = own_page.or(inherited_page);
        let children = kids(doc, element);
        let mut mcids = Vec::new();
        let mut objects = 0;
        let mut first_page = None;
        let mut child_count = 0;
        for child in &children {
            match deref(doc, child) {
                Object::Integer(mcid) => mcids.push(*mcid),
                Object::Dictionary(entry) => match name_of(entry, b"Type").as_deref() {
                    Some("MCR") => {
                        if let Ok(mcid) = entry.get(b"MCID").and_then(Object::as_i64) {
                            mcids.push(mcid);
                        }
                        first_page = first_page
                            .or_else(|| entry.get(b"Pg").and_then(Object::as_reference).ok());
                    }
                    Some("OBJR") => objects += 1,
                    _ => child_count += 1,
                },
                _ => {}
            }
        }
        let role = name_of(element, b"S").unwrap_or_default();
        walk.parents.insert(id, parent);
        walk.nodes.push(TagNode {
            id: format_id(id),
            parent: parent.map(format_id),
            depth,
            standard_role: standard_role(doc, root, &role),
            role,
            title: text_of(element, b"T"),
            alt: text_of(element, b"Alt"),
            actual_text: text_of(element, b"ActualText"),
            lang: text_of(element, b"Lang"),
            page: element_page
                .or(first_page)
                .and_then(|page| pages.get(&page).copied()),
            mcids,
            objects,
            children: child_count,
        });
        stack.extend(
            children
                .into_iter()
                .rev()
                .filter(|child| child.as_reference().is_ok())
                .map(|child| (child, Some(id), depth + 1, element_page)),
        );
    }
    Some(walk)
}

/// The structure tree of a document, or an empty untagged tree.
pub fn list(bytes: &[u8]) -> Result<TagTree, String> {
    let doc = load(bytes)?;
    Ok(match walk(&doc) {
        Some(walk) => TagTree {
            tagged: true,
            nodes: walk.nodes,
            truncated: walk.truncated,
        },
        None => TagTree {
            tagged: false,
            nodes: Vec::new(),
            truncated: false,
        },
    })
}

/// A PDF text string: literal for printable ASCII, UTF-16BE otherwise.
fn text_object(text: &str) -> Object {
    if text
        .chars()
        .all(|character| character.is_ascii() && !character.is_ascii_control())
    {
        Object::string_literal(text)
    } else {
        let mut encoded = vec![0xFE, 0xFF];
        encoded.extend(text.encode_utf16().flat_map(u16::to_be_bytes));
        Object::String(encoded, StringFormat::Hexadecimal)
    }
}

fn valid_role(role: &str) -> bool {
    (1..=64).contains(&role.len())
        && role
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn set_properties(
    doc: &mut Document,
    id: ObjectId,
    properties: &TagProperties,
) -> Result<String, String> {
    if let Some(role) = &properties.role {
        if !valid_role(role.trim()) {
            return Err(
                "A tag type uses letters, digits, '-' and '_', up to 64 characters.".into(),
            );
        }
    }
    if let Some(lang) = properties.lang.as_deref().map(str::trim) {
        let valid = lang.is_empty()
            || lang.split('-').enumerate().all(|(index, part)| {
                let letters = part.bytes().all(|byte| byte.is_ascii_alphanumeric());
                letters
                    && if index == 0 {
                        (2..=3).contains(&part.len())
                    } else {
                        (1..=8).contains(&part.len())
                    }
            });
        if !valid {
            return Err("Use a language tag such as en, en-US or fr-CA.".into());
        }
    }
    let element = doc
        .get_dictionary_mut(id)
        .map_err(|_| UNKNOWN_TAG.to_string())?;
    if let Some(role) = &properties.role {
        element.set("S", Object::Name(role.trim().as_bytes().to_vec()));
    }
    for (key, value) in [
        (b"T".as_slice(), &properties.title),
        (b"Alt".as_slice(), &properties.alt),
        (b"ActualText".as_slice(), &properties.actual_text),
        (b"Lang".as_slice(), &properties.lang),
    ] {
        let Some(value) = value else { continue };
        let value = value.trim();
        if value.chars().count() > MAX_TEXT_CHARS {
            return Err(format!("Keep tag text under {MAX_TEXT_CHARS} characters."));
        }
        if value.chars().any(char::is_control) {
            return Err("Tag text cannot contain control characters.".into());
        }
        if value.is_empty() {
            element.remove(key);
        } else {
            element.set(key.to_vec(), text_object(value));
        }
    }
    Ok("Tag properties updated".into())
}

/// The dictionary that lists a tag among its children: its parent element or the root.
fn parent_dictionary_id(
    doc: &Document,
    parent: Option<ObjectId>,
) -> Result<Option<ObjectId>, String> {
    match parent {
        Some(parent) => Ok(Some(parent)),
        None => struct_root(doc)
            .map(|(id, _)| id)
            .ok_or_else(|| NO_TAGS.to_string()),
    }
}

/// Runs `change` on the K entry of a tag's parent, whether the parent is an element, an
/// indirect root or a root written directly in the catalog.
fn with_parent_kids<T>(
    doc: &mut Document,
    parent: Option<ObjectId>,
    change: impl FnOnce(&mut Vec<Object>) -> Result<T, String>,
) -> Result<T, String> {
    let holder = parent_dictionary_id(doc, parent)?;
    let resolved: Option<Vec<Object>> = {
        let dictionary = match holder {
            Some(id) => doc.get_dictionary(id).map_err(|_| UNKNOWN_TAG)?,
            None => struct_root(doc).ok_or(NO_TAGS)?.1,
        };
        match dictionary.get(b"K") {
            Ok(Object::Reference(id)) => match doc.get_object(*id) {
                Ok(Object::Array(items)) => Some(items.clone()),
                _ => None,
            },
            _ => None,
        }
    };
    let dictionary = match holder {
        Some(id) => doc.get_dictionary_mut(id).map_err(|_| UNKNOWN_TAG)?,
        None => doc
            .catalog_mut()
            .map_err(|_| NO_TAGS)?
            .get_mut(b"StructTreeRoot")
            .and_then(Object::as_dict_mut)
            .map_err(|_| NO_TAGS)?,
    };
    let mut items = match (resolved, dictionary.get(b"K").ok()) {
        (Some(items), _) => items,
        (None, Some(Object::Array(items))) => items.clone(),
        (None, Some(single)) => vec![single.clone()],
        (None, None) => Vec::new(),
    };
    let result = change(&mut items)?;
    dictionary.set("K", items);
    Ok(result)
}

fn move_tag(
    doc: &mut Document,
    id: ObjectId,
    parent: Option<ObjectId>,
    offset: i32,
) -> Result<String, String> {
    let step = offset.signum() as isize;
    if step == 0 {
        return Ok("The tag was not moved".into());
    }
    with_parent_kids(doc, parent, |items| {
        let index = items
            .iter()
            .position(|item| item.as_reference().ok() == Some(id))
            .ok_or(UNKNOWN_TAG)?;
        let target = index as isize + step;
        if target < 0 || target as usize >= items.len() {
            return Err("The tag is already at that end of its parent's children.".into());
        }
        items.swap(index, target as usize);
        Ok(if step < 0 {
            "Tag moved earlier in the reading order".into()
        } else {
            "Tag moved later in the reading order".into()
        })
    })
}

/// The marked-content identifier set on a BDC operation, directly or through a named
/// property list.
fn operation_mcid(doc: &Document, resources: &Resources, operation: &Operation) -> Option<i64> {
    let properties = match operation.operands.get(1)? {
        Object::Dictionary(properties) => properties,
        Object::Name(name) => resources
            .lookup(doc, b"Properties", name)
            .and_then(|(_, value)| value.as_dict().ok())?,
        _ => return None,
    };
    properties.get(b"MCID").and_then(Object::as_i64).ok()
}

/// The parent-tree array for a page's StructParents key, followed through number tree kids.
fn parent_tree_entry(doc: &Document, tree: &Object, key: i64) -> Option<ObjectId> {
    let mut node = deref(doc, tree).as_dict().ok()?;
    for _ in 0..MAX_TREE_LEVELS {
        if let Ok(nums) = node.get(b"Nums").map(|value| deref(doc, value)) {
            let nums = nums.as_array().ok()?;
            return nums
                .chunks(2)
                .find(|pair| pair[0].as_i64().ok() == Some(key))
                .and_then(|pair| pair.get(1))
                .and_then(|value| value.as_reference().ok());
        }
        let kids = deref(doc, node.get(b"Kids").ok()?).as_array().ok()?;
        node = kids.iter().find_map(|kid| {
            let kid = deref(doc, kid).as_dict().ok()?;
            let limits = deref(doc, kid.get(b"Limits").ok()?).as_array().ok()?;
            let (low, high) = (
                limits.first()?.as_i64().ok()?,
                limits.get(1)?.as_i64().ok()?,
            );
            (low <= key && key <= high).then_some(kid)
        })?;
    }
    None
}

fn mark_artifact(
    doc: &mut Document,
    id: ObjectId,
    parent: Option<ObjectId>,
) -> Result<String, String> {
    const REFUSED: &str = "Only a tag that directly owns page content, with no child tags or annotations, can become an artifact.";
    let element = doc.get_dictionary(id).map_err(|_| UNKNOWN_TAG)?;
    let element_page = element.get(b"Pg").and_then(Object::as_reference).ok();
    // Content on each page, by marked-content identifier.
    let mut content: BTreeMap<ObjectId, HashSet<i64>> = BTreeMap::new();
    let children = kids(doc, element);
    if children.is_empty() {
        return Err(REFUSED.into());
    }
    for child in &children {
        let (page, mcid) = match deref(doc, child) {
            Object::Integer(mcid) => (element_page, *mcid),
            Object::Dictionary(entry) if name_of(entry, b"Type").as_deref() == Some("MCR") => (
                entry
                    .get(b"Pg")
                    .and_then(Object::as_reference)
                    .ok()
                    .or(element_page),
                entry
                    .get(b"MCID")
                    .and_then(Object::as_i64)
                    .map_err(|_| REFUSED)?,
            ),
            _ => return Err(REFUSED.into()),
        };
        // An MCR with its own stream (Stm) is in a form XObject, which is not rewritten.
        if let Object::Dictionary(entry) = deref(doc, child) {
            if entry.has(b"Stm") {
                return Err(REFUSED.into());
            }
        }
        let page = page.ok_or("The tag's page could not be found.")?;
        content.entry(page).or_default().insert(mcid);
    }
    let tree = struct_root(doc)
        .and_then(|(_, root)| root.get(b"ParentTree").ok().cloned())
        .ok_or(NO_TAGS)?;
    let mut rewritten = Vec::new();
    for (page, mcids) in &content {
        let resources = Resources::for_page(doc, *page);
        let mut operations = page_operations(doc, *page)?;
        let mut found = HashSet::new();
        for operation in &mut operations {
            if operation.operator != "BDC" {
                continue;
            }
            if let Some(mcid) = operation_mcid(doc, &resources, operation) {
                if mcids.contains(&mcid) {
                    found.insert(mcid);
                    *operation = Operation::new("BMC", vec![Object::Name(b"Artifact".to_vec())]);
                }
            }
        }
        if found.len() != mcids.len() {
            return Err(
                "Some of the tag's content is not in its page's own content stream.".into(),
            );
        }
        let key = doc
            .get_dictionary(*page)
            .ok()
            .and_then(|page| page.get(b"StructParents").and_then(Object::as_i64).ok());
        let entry = key.and_then(|key| parent_tree_entry(doc, &tree, key));
        rewritten.push((*page, encode_operations(operations)?, entry, mcids.clone()));
    }
    for (page, bytes, entry, mcids) in rewritten {
        set_page_content(doc, page, bytes)?;
        if let Some(Ok(Object::Array(items))) = entry.map(|entry| doc.get_object_mut(entry)) {
            for mcid in mcids {
                if let Some(slot) = usize::try_from(mcid)
                    .ok()
                    .and_then(|index| items.get_mut(index))
                {
                    *slot = Object::Null;
                }
            }
        }
    }
    with_parent_kids(doc, parent, |items| {
        items.retain(|item| item.as_reference().ok() != Some(id));
        Ok(())
    })?;
    Ok("The tag's content is now an artifact and the tag was removed".into())
}

/// Painting operators that show content on the page.
fn paints(operator: &str) -> bool {
    matches!(
        operator,
        "Tj" | "TJ"
            | "'"
            | "\""
            | "Do"
            | "sh"
            | "BI"
            | "S"
            | "s"
            | "f"
            | "F"
            | "f*"
            | "B"
            | "B*"
            | "b"
            | "b*"
    )
}

fn starts_path(operator: &str) -> bool {
    matches!(operator, "m" | "re")
}

fn ends_path(operator: &str) -> bool {
    matches!(
        operator,
        "S" | "s" | "f" | "F" | "f*" | "B" | "B*" | "b" | "b*" | "n"
    )
}

/// What kind of content an XObject draws, from its subtype.
fn xobject_role(doc: &Document, resources: &Resources, operation: &Operation) -> &'static str {
    let subtype = operation
        .operands
        .first()
        .and_then(|name| name.as_name().ok())
        .and_then(|name| resources.lookup(doc, b"XObject", name))
        .and_then(|(_, object)| object.as_stream().ok())
        .and_then(|stream| name_of(&stream.dict, b"Subtype"));
    match subtype.as_deref() {
        Some("Image") | Some("Form") => "Figure",
        _ => "Artifact",
    }
}

fn mcid_dictionary(mcid: i64) -> Object {
    Object::Dictionary(dictionary! { "MCID" => mcid })
}

/// Wraps text objects as paragraphs, images and forms as figures and other painting as
/// artifacts, returning the new operations and the role of each new marked-content id.
fn tag_operations(
    doc: &Document,
    resources: &Resources,
    operations: Vec<Operation>,
) -> Result<(Vec<Operation>, Vec<&'static str>), String> {
    let mut output = Vec::with_capacity(operations.len() * 2);
    let mut roles = Vec::new();
    // Existing marked content: true when it is an artifact, whose content stays untagged.
    let mut marked: Vec<bool> = Vec::new();
    let mut index = 0;
    let open = |output: &mut Vec<Operation>, roles: &mut Vec<&'static str>, role: &'static str| {
        if role == "Artifact" {
            output.push(Operation::new(
                "BMC",
                vec![Object::Name(b"Artifact".to_vec())],
            ));
        } else {
            output.push(Operation::new(
                "BDC",
                vec![
                    Object::Name(role.as_bytes().to_vec()),
                    mcid_dictionary(roles.len() as i64),
                ],
            ));
            roles.push(role);
        }
    };
    while index < operations.len() {
        let operation = &operations[index];
        let operator = operation.operator.as_str();
        let in_artifact = marked.iter().any(|artifact| *artifact);
        match operator {
            "BMC" | "BDC" => {
                let tag = operation
                    .operands
                    .first()
                    .and_then(|tag| tag.as_name().ok());
                marked.push(tag == Some(b"Artifact".as_slice()));
                output.push(operation.clone());
            }
            "EMC" => {
                marked.pop();
                output.push(operation.clone());
            }
            _ if in_artifact => output.push(operation.clone()),
            "BT" => {
                let end = operations[index..]
                    .iter()
                    .position(|item| item.operator == "ET")
                    .map(|offset| index + offset)
                    .ok_or("A page has a text object without an end.")?;
                let block = &operations[index..=end];
                if block
                    .iter()
                    .any(|item| matches!(item.operator.as_str(), "BMC" | "BDC" | "EMC"))
                {
                    // Marked content inside the text object stays as it is.
                    output.extend(block.iter().cloned());
                } else if block.iter().any(|item| paints(&item.operator)) {
                    open(&mut output, &mut roles, "P");
                    output.extend(block.iter().cloned());
                    output.push(Operation::new("EMC", vec![]));
                } else {
                    output.extend(block.iter().cloned());
                }
                index = end;
            }
            _ if starts_path(operator) => {
                let end = operations[index..]
                    .iter()
                    .position(|item| ends_path(&item.operator))
                    .map(|offset| index + offset);
                match end {
                    Some(end)
                        if !operations[index..=end].iter().any(|item| {
                            matches!(
                                item.operator.as_str(),
                                "BMC" | "BDC" | "EMC" | "q" | "Q" | "BT"
                            )
                        }) =>
                    {
                        open(&mut output, &mut roles, "Artifact");
                        output.extend(operations[index..=end].iter().cloned());
                        output.push(Operation::new("EMC", vec![]));
                        index = end;
                    }
                    _ => output.push(operation.clone()),
                }
            }
            "Do" => {
                open(
                    &mut output,
                    &mut roles,
                    xobject_role(doc, resources, operation),
                );
                output.push(operation.clone());
                output.push(Operation::new("EMC", vec![]));
            }
            "BI" => {
                open(&mut output, &mut roles, "Figure");
                output.push(operation.clone());
                output.push(Operation::new("EMC", vec![]));
            }
            "sh" => {
                open(&mut output, &mut roles, "Artifact");
                output.push(operation.clone());
                output.push(Operation::new("EMC", vec![]));
            }
            _ => output.push(operation.clone()),
        }
        index += 1;
    }
    Ok((output, roles))
}

fn has_mcid(doc: &Document, resources: &Resources, operations: &[Operation]) -> bool {
    operations.iter().any(|operation| {
        operation.operator == "BDC" && operation_mcid(doc, resources, operation).is_some()
    })
}

/// Tags an untagged document: paragraphs for text objects, figures for images and forms,
/// artifacts for other painting, and Form, Link or Annot tags for annotations, in content
/// order on each page.
fn autotag(doc: &mut Document) -> Result<String, String> {
    if struct_root(doc).is_some() {
        return Err("This document already has tags. Edit them in the Tags list instead.".into());
    }
    let pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
    let mut tagged = Vec::new();
    for page in &pages {
        let resources = Resources::for_page(doc, *page);
        let operations = page_operations(doc, *page)?;
        if has_mcid(doc, &resources, &operations) {
            return Err("This document has marked content from earlier tagging but no tag tree, so it cannot be tagged automatically.".into());
        }
        let (operations, roles) = tag_operations(doc, &resources, operations)?;
        let annotations: Vec<(ObjectId, &'static str)> = doc
            .get_dictionary(*page)
            .ok()
            .and_then(|page| page.get(b"Annots").ok())
            .map(|annots| deref(doc, annots))
            .and_then(|annots| annots.as_array().ok())
            .into_iter()
            .flatten()
            .filter_map(|entry| {
                let id = entry.as_reference().ok()?;
                let annotation = doc.get_dictionary(id).ok()?;
                let role = match name_of(annotation, b"Subtype").as_deref() {
                    Some("Popup") => return None,
                    Some("Widget") => "Form",
                    Some("Link") => "Link",
                    _ => "Annot",
                };
                Some((id, role))
            })
            .collect();
        tagged.push((*page, operations, roles, annotations));
    }
    let total: usize = tagged
        .iter()
        .map(|(_, _, roles, annotations)| roles.len() + annotations.len())
        .sum();
    if total == 0 {
        return Err("No content was found to tag.".into());
    }
    if total > MAX_TAGS {
        return Err(format!("Automatic tagging is limited to {MAX_TAGS} tags."));
    }

    let root_id = doc.new_object_id();
    let document_id = doc.new_object_id();
    let mut document_kids = Vec::new();
    let mut nums = Vec::new();
    let mut next_key = 0_i64;
    for (page, operations, roles, annotations) in tagged {
        let mut page_elements = Vec::new();
        for (mcid, role) in roles.iter().enumerate() {
            let element = doc.add_object(dictionary! {
                "Type" => "StructElem",
                "S" => Object::Name(role.as_bytes().to_vec()),
                "P" => document_id,
                "Pg" => page,
                "K" => mcid as i64,
            });
            page_elements.push(Object::Reference(element));
        }
        document_kids.extend(page_elements.iter().cloned());
        if !roles.is_empty() {
            nums.push(Object::Integer(next_key));
            nums.push(Object::Reference(doc.add_object(page_elements)));
            let page_dictionary = doc
                .get_dictionary_mut(page)
                .map_err(|_| "A page could not be updated.")?;
            page_dictionary.set("StructParents", next_key);
            next_key += 1;
        }
        encode_operations(operations).and_then(|bytes| set_page_content(doc, page, bytes))?;
        for (annotation, role) in &annotations {
            let element = doc.add_object(dictionary! {
                "Type" => "StructElem",
                "S" => Object::Name(role.as_bytes().to_vec()),
                "P" => document_id,
                "Pg" => page,
                "K" => dictionary! { "Type" => "OBJR", "Obj" => *annotation, "Pg" => page },
            });
            document_kids.push(Object::Reference(element));
            nums.push(Object::Integer(next_key));
            nums.push(Object::Reference(element));
            if let Ok(annotation) = doc.get_dictionary_mut(*annotation) {
                annotation.set("StructParent", next_key);
            }
            next_key += 1;
        }
        if !annotations.is_empty() {
            if let Ok(page) = doc.get_dictionary_mut(page) {
                page.set("Tabs", Object::Name(b"S".to_vec()));
            }
        }
    }
    let count = document_kids.len();
    doc.objects.insert(
        document_id,
        Object::Dictionary(dictionary! {
            "Type" => "StructElem",
            "S" => "Document",
            "P" => root_id,
            "K" => document_kids,
        }),
    );
    doc.objects.insert(
        root_id,
        Object::Dictionary(dictionary! {
            "Type" => "StructTreeRoot",
            "K" => document_id,
            "ParentTree" => dictionary! { "Nums" => nums },
            "ParentTreeNextKey" => next_key,
        }),
    );
    let catalog = doc
        .catalog_mut()
        .map_err(|_| "The document catalog could not be updated.")?;
    catalog.set("StructTreeRoot", root_id);
    catalog.set("MarkInfo", dictionary! { "Marked" => true });
    Ok(format!(
        "Added {count} tags. Review headings, figures and reading order in the Tags list."
    ))
}

/// Applies one tag edit and returns the edited document, which is reloaded before it is
/// accepted.
pub fn apply(bytes: &[u8], edit: &TagEdit) -> Result<(Vec<u8>, TagReport), String> {
    let mut doc = load(bytes)?;
    let pages = doc.get_pages().len();
    let message = match edit {
        TagEdit::Autotag => autotag(&mut doc)?,
        TagEdit::SetProperties { id, properties } => {
            let id = reachable(&doc, id)?.0;
            set_properties(&mut doc, id, properties)?
        }
        TagEdit::Move { id, offset } => {
            let (id, parent) = reachable(&doc, id)?;
            move_tag(&mut doc, id, parent, *offset)?
        }
        TagEdit::MarkArtifact { id } => {
            let (id, parent) = reachable(&doc, id)?;
            mark_artifact(&mut doc, id, parent)?
        }
    };
    let output = save(&mut doc)?;
    if load(&output)?.get_pages().len() != pages {
        return Err(
            "The tagged copy has an unexpected page count. The document is unchanged.".into(),
        );
    }
    Ok((output, TagReport { message }))
}

/// A listed tag and its parent, refusing objects outside the structure tree.
fn reachable(doc: &Document, id: &str) -> Result<(ObjectId, Option<ObjectId>), String> {
    let id = parse_id(id)?;
    let walk = walk(doc).ok_or(NO_TAGS)?;
    walk.parents
        .get(&id)
        .map(|parent| (id, *parent))
        .ok_or_else(|| UNKNOWN_TAG.into())
}

/// Counts painting outside tagged content and artifacts, and annotations without tags.
pub fn untagged(bytes: &[u8]) -> Result<UntaggedReport, String> {
    let doc = load(bytes)?;
    let tagged = struct_root(&doc).is_some();
    let mut pages = Vec::new();
    let mut truncated = false;
    for (number, page) in doc.get_pages() {
        let resources = Resources::for_page(&doc, page);
        let mut finding = UntaggedPage {
            page: number,
            ..UntaggedPage::default()
        };
        // Each open marked-content section: tagged, artifact or neither.
        let mut stack: Vec<(bool, bool)> = Vec::new();
        for operation in page_operations(&doc, page)? {
            match operation.operator.as_str() {
                "BMC" | "BDC" => {
                    let artifact = operation
                        .operands
                        .first()
                        .and_then(|tag| tag.as_name().ok())
                        == Some(b"Artifact".as_slice());
                    let mcid = operation.operator == "BDC"
                        && operation_mcid(&doc, &resources, &operation).is_some();
                    stack.push((mcid, artifact));
                }
                "EMC" => {
                    stack.pop();
                }
                operator
                    if paints(operator)
                        && !stack.iter().any(|(mcid, artifact)| *mcid || *artifact) =>
                {
                    finding.content += 1;
                }
                _ => {}
            }
        }
        if let Some(annots) = doc
            .get_dictionary(page)
            .ok()
            .and_then(|page| page.get(b"Annots").ok())
            .map(|annots| deref(&doc, annots))
            .and_then(|annots| annots.as_array().ok())
        {
            for annotation in annots
                .iter()
                .filter_map(|entry| deref(&doc, entry).as_dict().ok())
            {
                let subtype = name_of(annotation, b"Subtype");
                if subtype.as_deref() == Some("Popup") || annotation.has(b"StructParent") {
                    continue;
                }
                if subtype.as_deref() == Some("Widget") {
                    finding.widgets += 1;
                } else {
                    finding.annotations += 1;
                }
            }
        }
        if finding.content + finding.annotations + finding.widgets > 0 {
            if pages.len() >= MAX_UNTAGGED_PAGES {
                truncated = true;
                break;
            }
            pages.push(finding);
        }
    }
    Ok(UntaggedReport {
        tagged,
        pages,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::content::tests::page_document;
    use lopdf::Stream;

    /// A page with two text objects, a rule and an image, plus a link and a field.
    fn untagged_pdf() -> Vec<u8> {
        let (mut doc, page) = page_document(
            "BT /F1 18 Tf 72 720 Td (Title) Tj ET 0 0 1 RG 72 700 m 540 700 l S \
             BT /F1 12 Tf 72 680 Td (Body text) Tj ET q 100 0 0 50 72 600 cm /Im1 Do Q \
             BT ET",
            dictionary! {},
        );
        let image = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject", "Subtype" => "Image", "Width" => 1, "Height" => 1,
                "ColorSpace" => "DeviceGray", "BitsPerComponent" => 8,
            },
            vec![0],
        ));
        let link = doc.add_object(dictionary! {
            "Type" => "Annot", "Subtype" => "Link",
            "Rect" => vec![72.into(), 720.into(), 120.into(), 740.into()],
        });
        let field = doc.add_object(dictionary! {
            "Type" => "Annot", "Subtype" => "Widget", "FT" => "Tx",
            "T" => Object::string_literal("Name"),
            "Rect" => vec![72.into(), 500.into(), 200.into(), 520.into()],
        });
        let popup = doc.add_object(dictionary! { "Type" => "Annot", "Subtype" => "Popup" });
        let page_dictionary = doc.get_dictionary_mut(page).unwrap();
        page_dictionary.set("Annots", vec![link.into(), field.into(), popup.into()]);
        page_dictionary
            .get_mut(b"Resources")
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("XObject", dictionary! { "Im1" => image });
        save(&mut doc).unwrap()
    }

    fn roles(tree: &TagTree) -> Vec<&str> {
        tree.nodes.iter().map(|node| node.role.as_str()).collect()
    }

    fn by_role<'a>(tree: &'a TagTree, role: &str) -> &'a TagNode {
        tree.nodes.iter().find(|node| node.role == role).unwrap()
    }

    #[test]
    fn autotagging_tags_text_figures_and_annotations_in_content_order() {
        let source = untagged_pdf();
        let before = untagged(&source).unwrap();
        assert!(!before.tagged);
        assert_eq!(
            before.pages,
            vec![UntaggedPage {
                page: 1,
                content: 4,
                annotations: 1,
                widgets: 1
            }]
        );
        assert!(!list(&source).unwrap().tagged);

        let (tagged, report) = apply(&source, &TagEdit::Autotag).unwrap();
        assert!(
            report.message.contains("Added 5 tags"),
            "{}",
            report.message
        );
        let tree = list(&tagged).unwrap();
        assert!(tree.tagged);
        assert_eq!(
            roles(&tree),
            ["Document", "P", "P", "Figure", "Link", "Form"]
        );
        assert_eq!(tree.nodes[1].mcids, [0]);
        assert_eq!(tree.nodes[3].mcids, [2]);
        assert_eq!(tree.nodes[4].objects, 1);
        assert!(tree.nodes[1..]
            .iter()
            .all(|node| node.page == Some(1) && node.depth == 1));
        let after = untagged(&tagged).unwrap();
        assert!(after.tagged && after.pages.is_empty(), "{:?}", after.pages);

        let doc = Document::load_mem(&tagged).unwrap();
        let page = *doc.get_pages().values().next().unwrap();
        let content = String::from_utf8(doc.get_page_content(page)).unwrap();
        assert!(content.contains("/P <</MCID 0>> BDC"), "{content}");
        assert!(content.contains("/Artifact BMC"), "{content}");
        assert!(content.contains("/Figure <</MCID 2>> BDC"), "{content}");
        let catalog = doc.catalog().unwrap();
        assert_eq!(
            catalog
                .get(b"MarkInfo")
                .unwrap()
                .as_dict()
                .unwrap()
                .get(b"Marked")
                .unwrap(),
            &Object::Boolean(true)
        );
        let page_dictionary = doc.get_dictionary(page).unwrap();
        assert_eq!(
            page_dictionary
                .get(b"StructParents")
                .unwrap()
                .as_i64()
                .unwrap(),
            0
        );
        assert_eq!(
            page_dictionary.get(b"Tabs").unwrap().as_name().unwrap(),
            b"S"
        );

        assert!(apply(&tagged, &TagEdit::Autotag)
            .unwrap_err()
            .contains("already has tags"));
    }

    #[test]
    fn tag_properties_order_and_artifacts_are_edited_in_place() {
        let (tagged, _) = apply(&untagged_pdf(), &TagEdit::Autotag).unwrap();
        let tree = list(&tagged).unwrap();
        let title = tree.nodes[1].id.clone();
        let (renamed, _) = apply(
            &tagged,
            &TagEdit::SetProperties {
                id: title.clone(),
                properties: TagProperties {
                    role: Some("H1".into()),
                    title: Some("Heading".into()),
                    alt: None,
                    actual_text: Some("Titre é".into()),
                    lang: Some("fr-CA".into()),
                },
            },
        )
        .unwrap();
        let tree = list(&renamed).unwrap();
        let heading = by_role(&tree, "H1");
        assert_eq!(heading.title, "Heading");
        assert_eq!(heading.actual_text, "Titre é");
        assert_eq!(heading.lang, "fr-CA");
        for bad in [
            TagProperties {
                role: Some("H 1".into()),
                ..TagProperties::default()
            },
            TagProperties {
                lang: Some("not a tag".into()),
                ..TagProperties::default()
            },
            TagProperties {
                alt: Some("x\u{7}".into()),
                ..TagProperties::default()
            },
        ] {
            assert!(apply(
                &renamed,
                &TagEdit::SetProperties {
                    id: title.clone(),
                    properties: bad
                }
            )
            .is_err());
        }
        let cleared = apply(
            &renamed,
            &TagEdit::SetProperties {
                id: title.clone(),
                properties: TagProperties {
                    title: Some(" ".into()),
                    ..TagProperties::default()
                },
            },
        )
        .unwrap()
        .0;
        assert_eq!(by_role(&list(&cleared).unwrap(), "H1").title, "");

        let moved = apply(
            &renamed,
            &TagEdit::Move {
                id: title.clone(),
                offset: 1,
            },
        )
        .unwrap()
        .0;
        assert_eq!(
            roles(&list(&moved).unwrap()),
            ["Document", "P", "H1", "Figure", "Link", "Form"]
        );
        assert!(apply(
            &renamed,
            &TagEdit::Move {
                id: title.clone(),
                offset: -1
            }
        )
        .unwrap_err()
        .contains("already at that end"));

        let figure = by_role(&tree, "Figure").id.clone();
        let retired = apply(&renamed, &TagEdit::MarkArtifact { id: figure.clone() })
            .unwrap()
            .0;
        assert_eq!(
            roles(&list(&retired).unwrap()),
            ["Document", "H1", "P", "Link", "Form"]
        );
        let doc = Document::load_mem(&retired).unwrap();
        let page = *doc.get_pages().values().next().unwrap();
        let content = String::from_utf8(doc.get_page_content(page)).unwrap();
        assert!(!content.contains("MCID 2"), "{content}");
        assert!(
            content.contains("/Im1 Do"),
            "the image is still drawn: {content}"
        );
        assert!(untagged(&retired).unwrap().pages.is_empty());
        assert!(apply(&retired, &TagEdit::MarkArtifact { id: figure })
            .unwrap_err()
            .contains("no longer"));

        let document = tree.nodes[0].id.clone();
        assert!(apply(&renamed, &TagEdit::MarkArtifact { id: document }).is_err());
        let link = by_role(&tree, "Link").id.clone();
        assert!(apply(&renamed, &TagEdit::MarkArtifact { id: link }).is_err());
        assert!(apply(
            &renamed,
            &TagEdit::Move {
                id: "1 0".into(),
                offset: 1
            }
        )
        .is_err());
        assert!(apply(
            &renamed,
            &TagEdit::Move {
                id: "nonsense".into(),
                offset: 1
            }
        )
        .is_err());
    }

    #[test]
    fn named_property_lists_role_maps_and_untagged_content_are_read() {
        let (mut doc, page) = page_document(
            "/Span /MC0 BDC BT /F1 12 Tf 72 700 Td (Tagged) Tj ET EMC \
             BT /F1 12 Tf 72 680 Td (Loose) Tj ET /Artifact BMC 0 0 m 1 1 l S EMC",
            dictionary! { "Properties" => dictionary! { "MC0" => dictionary! { "MCID" => 0 } } },
        );
        let parent_array = doc.new_object_id();
        let element = doc.add_object(dictionary! {
            "Type" => "StructElem", "S" => "Callout", "Pg" => page,
            "K" => vec![Object::Dictionary(dictionary! { "Type" => "MCR", "MCID" => 0 })],
        });
        doc.objects
            .insert(parent_array, Object::Array(vec![element.into()]));
        doc.get_dictionary_mut(page)
            .unwrap()
            .set("StructParents", 0);
        let root = doc.add_object(dictionary! {
            "Type" => "StructTreeRoot", "K" => element,
            "RoleMap" => dictionary! { "Callout" => "P" },
            "ParentTree" => dictionary! { "Kids" => vec![Object::Dictionary(dictionary! {
                "Limits" => vec![0.into(), 0.into()], "Nums" => vec![0.into(), parent_array.into()],
            })] },
        });
        let catalog = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
        doc.get_dictionary_mut(catalog)
            .unwrap()
            .set("StructTreeRoot", root);
        let bytes = save(&mut doc).unwrap();

        let tree = list(&bytes).unwrap();
        assert_eq!(tree.nodes.len(), 1);
        assert_eq!(tree.nodes[0].standard_role.as_deref(), Some("P"));
        assert_eq!(tree.nodes[0].mcids, [0]);
        assert_eq!(
            untagged(&bytes).unwrap().pages[0].content,
            1,
            "only the loose text"
        );

        let retired = apply(
            &bytes,
            &TagEdit::MarkArtifact {
                id: tree.nodes[0].id.clone(),
            },
        )
        .unwrap()
        .0;
        let doc = Document::load_mem(&retired).unwrap();
        assert_eq!(
            doc.get_object(parent_array).unwrap().as_array().unwrap()[0],
            Object::Null
        );
        assert!(list(&retired).unwrap().nodes.is_empty());
        assert!(
            apply(&bytes, &TagEdit::Autotag).is_err(),
            "existing tags are kept"
        );
    }

    #[test]
    fn earlier_marked_content_without_a_tree_is_not_retagged() {
        let (mut doc, _) = page_document(
            "/P <</MCID 0>> BDC BT /F1 12 Tf (x) Tj ET EMC",
            dictionary! {},
        );
        let bytes = save(&mut doc).unwrap();
        assert!(apply(&bytes, &TagEdit::Autotag)
            .unwrap_err()
            .contains("earlier tagging"));
        let (mut doc, _) = page_document("", dictionary! {});
        let empty = save(&mut doc).unwrap();
        assert!(apply(&empty, &TagEdit::Autotag)
            .unwrap_err()
            .contains("No content"));
    }
}
