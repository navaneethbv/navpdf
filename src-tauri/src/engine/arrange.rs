//! Stacking order and copying of images placed on a page.
//!
//! An image can be arranged when it is drawn inside its own `q ... Q` group (or marked content
//! holding only that group) at the top level of the page's content stream. The group moves past
//! other drawing, but never past a top-level change to the transform, clipping path, graphics
//! state or fill colour, since that would change where or how the image is drawn.

use super::content::{self, ItemKind, Resources};
use super::geometry::Matrix;
use lopdf::content::Operation;
use lopdf::{dictionary, Document, Object, ObjectId, Stream};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Order {
    Front,
    Back,
    Forward,
    Backward,
}

/// Operators that paint something.
const PAINTING: &[&str] = &[
    "S", "s", "f", "F", "f*", "B", "B*", "b", "b*", "Do", "sh", "BI", "EI", "Tj", "TJ", "'", "\"",
];
/// Path construction, which only paints when its painting operator follows.
const PATH: &[&str] = &["m", "l", "c", "v", "y", "h", "re"];
/// Top-level operators that change how a later image is placed or drawn.
const BARRIERS: &[&str] = &[
    "cm", "gs", "W", "W*", "g", "rg", "k", "cs", "sc", "scn", "d0", "d1",
];
/// The most content operations arranged at once.
const MAX_OPERATIONS: usize = 2_000_000;

#[derive(Debug, Clone, PartialEq)]
struct Unit {
    start: usize,
    /// One past the last operation.
    end: usize,
    paints: usize,
    barrier: bool,
    /// Begins with `q` or marked content and so restores or closes everything it changes.
    grouped: bool,
}

/// Splits a content stream into top-level units: groups, text objects, marked content, paths
/// with their painting operator, and single operators.
fn units(ops: &[Operation]) -> Result<Vec<Unit>, String> {
    const UNBALANCED: &str = "The page's drawing is not balanced, so its order cannot be changed.";
    if ops.len() > MAX_OPERATIONS {
        return Err("The page has too many drawing operations to arrange.".into());
    }
    let mut result = Vec::new();
    let mut index = 0;
    while index < ops.len() {
        let start = index;
        let first = ops[index].operator.as_str();
        let mut unit = Unit {
            start,
            end: start + 1,
            paints: 0,
            barrier: false,
            grouped: matches!(first, "q" | "BMC" | "BDC"),
        };
        if matches!(first, "q" | "BMC" | "BDC" | "BT") {
            // Nested groups: q/Q, marked content and text objects.
            let mut stack: Vec<u8> = Vec::new();
            loop {
                let Some(op) = ops.get(index) else {
                    return Err(UNBALANCED.into());
                };
                let name = op.operator.as_str();
                let saved = stack.contains(&b'q');
                match name {
                    "q" => stack.push(b'q'),
                    "BMC" | "BDC" => stack.push(b'm'),
                    "BT" => stack.push(b't'),
                    "Q" | "EMC" | "ET" => {
                        let expected = match name {
                            "Q" => b'q',
                            "EMC" => b'm',
                            _ => b't',
                        };
                        if stack.pop() != Some(expected) {
                            return Err(UNBALANCED.into());
                        }
                    }
                    _ => {
                        if PAINTING.contains(&name) {
                            unit.paints += 1;
                        }
                        // A change outside every q of this unit outlives it.
                        if !saved && BARRIERS.contains(&name) {
                            unit.barrier = true;
                        }
                    }
                }
                index += 1;
                if stack.is_empty() {
                    break;
                }
            }
        } else if PATH.contains(&first) {
            while index < ops.len() && PATH.contains(&ops[index].operator.as_str()) {
                index += 1;
            }
            while index < ops.len() && matches!(ops[index].operator.as_str(), "W" | "W*") {
                unit.barrier = true;
                index += 1;
            }
            if let Some(op) = ops.get(index) {
                let name = op.operator.as_str();
                if PAINTING.contains(&name) || name == "n" {
                    if name != "n" {
                        unit.paints += 1;
                    }
                    index += 1;
                }
            }
        } else {
            if matches!(first, "Q" | "EMC" | "ET") {
                return Err(UNBALANCED.into());
            }
            if PAINTING.contains(&first) {
                unit.paints = 1;
            }
            unit.barrier = BARRIERS.contains(&first);
            index += 1;
        }
        unit.end = index;
        result.push(unit);
    }
    Ok(result)
}

/// Moves the unit holding operation `index` and returns the reordered operations.
pub fn arrange(ops: Vec<Operation>, index: usize, order: Order) -> Result<Vec<Operation>, String> {
    let units = units(&ops)?;
    let position = units
        .iter()
        .position(|unit| unit.start <= index && index < unit.end)
        .ok_or("The image could not be found in the page's drawing.")?;
    let target = units[position].clone();
    if !target.grouped || target.paints != 1 || target.barrier {
        return Err(
            "Only an image drawn in a group of its own can be arranged. Apply an image transform first to give it one."
                .into(),
        );
    }
    // Walk past drawing in the chosen direction, stopping before any state change.
    let forward = matches!(order, Order::Front | Order::Forward);
    let mut destination = position;
    loop {
        let next = if forward {
            destination
                .checked_add(1)
                .filter(|next| *next < units.len())
        } else {
            destination.checked_sub(1)
        };
        let Some(next) = next else { break };
        if units[next].barrier {
            break;
        }
        destination = next;
        if units[next].paints > 0 && matches!(order, Order::Forward | Order::Backward) {
            break;
        }
    }
    if destination == position || units_between_paint_nothing(&units, position, destination) {
        return Err(if forward {
            "The image is already in front of everything it can move past.".into()
        } else {
            "The image is already behind everything it can move past.".into()
        });
    }
    let moved: Vec<Operation> = ops[target.start..target.end].to_vec();
    let mut rest: Vec<Operation> = Vec::with_capacity(ops.len());
    rest.extend_from_slice(&ops[..target.start]);
    rest.extend_from_slice(&ops[target.end..]);
    let insert_at = if forward {
        units[destination].end - (target.end - target.start)
    } else {
        units[destination].start
    };
    rest.splice(insert_at..insert_at, moved);
    Ok(rest)
}

/// Whether moving between two units passes no drawing, so the order would not visibly change.
fn units_between_paint_nothing(units: &[Unit], from: usize, to: usize) -> bool {
    let (low, high) = if from < to {
        (from + 1, to)
    } else {
        (to, from - 1)
    };
    units[low..=high].iter().all(|unit| unit.paints == 0)
}

const MAX_COPIED_OBJECTS: usize = 10_000;

/// Copies an object and everything it refers to from one document to another.
fn copy_object(
    source: &Document,
    target: &mut Document,
    object: &Object,
    copied: &mut HashMap<ObjectId, ObjectId>,
    depth: usize,
) -> Result<Object, String> {
    if depth > 64 || copied.len() > MAX_COPIED_OBJECTS {
        return Err("The image refers to too many objects to copy.".into());
    }
    Ok(match object {
        Object::Reference(id) => {
            if let Some(done) = copied.get(id) {
                return Ok(Object::Reference(*done));
            }
            let new_id = target.new_object_id();
            copied.insert(*id, new_id);
            let value = source
                .get_object(*id)
                .map_err(|_| "An object the image needs is missing.")?
                .clone();
            let value = copy_object(source, target, &value, copied, depth + 1)?;
            target.objects.insert(new_id, value);
            Object::Reference(new_id)
        }
        Object::Array(items) => Object::Array(
            items
                .iter()
                .map(|item| copy_object(source, target, item, copied, depth + 1))
                .collect::<Result<_, _>>()?,
        ),
        Object::Dictionary(dict) => {
            let mut out = lopdf::Dictionary::new();
            for (key, value) in dict.iter() {
                out.set(
                    key.clone(),
                    copy_object(source, target, value, copied, depth + 1)?,
                );
            }
            Object::Dictionary(out)
        }
        Object::Stream(stream) => {
            let mut dict = lopdf::Dictionary::new();
            for (key, value) in stream.dict.iter() {
                dict.set(
                    key.clone(),
                    copy_object(source, target, value, copied, depth + 1)?,
                );
            }
            Object::Stream(Stream::new(dict, stream.content.clone()).with_compression(false))
        }
        other => other.clone(),
    })
}

fn image_at(
    doc: &Document,
    page_id: ObjectId,
    ops: &[Operation],
    index: usize,
) -> Result<(ObjectId, Matrix), String> {
    let item = content::scan(
        doc,
        ops,
        &Resources::for_page(doc, page_id),
        Matrix::IDENTITY,
        &HashSet::new(),
    )
    .into_iter()
    .find(|item| item.op == index)
    .ok_or("The page changed since it was scanned. Scan the page again.")?;
    match item.kind {
        ItemKind::Image {
            id: Some(id), ctm, ..
        } => Ok((id, ctm)),
        ItemKind::Image { id: None, .. } => Err("Inline images cannot be copied.".into()),
        _ => Err("Only images can be copied.".into()),
    }
}

/// A one-page PDF holding only the image, placed where it is on its page.
pub fn copy_image(
    doc: &Document,
    page_id: ObjectId,
    ops: &[Operation],
    index: usize,
) -> Result<Vec<u8>, String> {
    let (image_id, ctm) = image_at(doc, page_id, ops, index)?;
    let mut clip = Document::with_version("1.7");
    let mut copied = HashMap::new();
    let image = copy_object(doc, &mut clip, &Object::Reference(image_id), &mut copied, 0)?;
    let media_box = super::edit::page_media_box(doc, page_id);
    let content = super::encode_operations(vec![
        Operation::new("q", vec![]),
        Operation::new(
            "cm",
            [ctm.a, ctm.b, ctm.c, ctm.d, ctm.e, ctm.f]
                .iter()
                .map(|value| Object::Real(*value as f32))
                .collect(),
        ),
        Operation::new("Do", vec![Object::Name(b"Im0".to_vec())]),
        Operation::new("Q", vec![]),
    ])?;
    let content_id = clip.add_object(Stream::new(dictionary! {}, content));
    let pages_id = clip.new_object_id();
    let page = clip.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "MediaBox" => media_box.iter().map(|value| Object::Real(*value as f32)).collect::<Vec<_>>(),
        "Contents" => content_id,
        "Resources" => dictionary! { "XObject" => dictionary! { "Im0" => image } },
    });
    clip.objects.insert(
        pages_id,
        Object::Dictionary(
            dictionary! { "Type" => "Pages", "Kids" => vec![page.into()], "Count" => 1 },
        ),
    );
    let catalog = clip.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    clip.trailer.set("Root", catalog);
    super::save(&mut clip)
}

/// Adds the image from a clip made by `copy_image` to a page, moved by (`dx`, `dy`) points.
pub fn paste_image(
    doc: &mut Document,
    page_id: ObjectId,
    clip_bytes: &[u8],
    dx: f64,
    dy: f64,
) -> Result<(), String> {
    if !dx.is_finite() || !dy.is_finite() || dx.abs() > 1e5 || dy.abs() > 1e5 {
        return Err("The paste offset is not valid.".into());
    }
    let clip = super::load(clip_bytes)?;
    let clip_page = *clip
        .get_pages()
        .get(&1)
        .ok_or("The copied image is not valid.")?;
    let clip_ops = super::page_operations(&clip, clip_page)?;
    let index = clip_ops
        .iter()
        .position(|op| op.operator == "Do")
        .ok_or("The copied image is not valid.")?;
    let (image_id, ctm) = image_at(&clip, clip_page, &clip_ops, index)?;
    let mut copied = HashMap::new();
    let image = copy_object(&clip, doc, &Object::Reference(image_id), &mut copied, 0)?;
    let Object::Reference(new_image) = image else {
        return Err("The copied image is not valid.".into());
    };
    super::own_page_resources(doc, page_id)?;
    let name = super::unused_resource_name(doc, page_id, b"XObject", "NavImage");
    super::add_page_resource(doc, page_id, b"XObject", &name, new_image)?;
    let mut ops = super::page_operations(doc, page_id)?;
    // Existing drawing that leaves a transform or other state set at the top level would move
    // or restyle the pasted image, so then it is wrapped in a group of its own.
    let wrap = units(&ops).map_or(true, |units| units.iter().any(|unit| unit.barrier));
    let existing = ops.len();
    ops.extend([
        Operation::new("q", vec![]),
        Operation::new(
            "cm",
            [ctm.a, ctm.b, ctm.c, ctm.d, ctm.e + dx, ctm.f + dy]
                .iter()
                .map(|value| Object::Real(*value as f32))
                .collect(),
        ),
        Operation::new("Do", vec![Object::Name(name)]),
        Operation::new("Q", vec![]),
    ]);
    if wrap && existing > 0 {
        ops.insert(existing, Operation::new("Q", vec![]));
        ops.insert(0, Operation::new("q", vec![]));
    }
    super::set_page_content(doc, page_id, super::encode_operations(ops)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn op(name: &str) -> Operation {
        Operation::new(name, vec![])
    }

    fn image(name: &str) -> Vec<Operation> {
        vec![
            op("q"),
            Operation::new(
                "cm",
                vec![1.into(), 0.into(), 0.into(), 1.into(), 0.into(), 0.into()],
            ),
            Operation::new("Do", vec![Object::Name(name.as_bytes().to_vec())]),
            op("Q"),
        ]
    }

    fn names(ops: &[Operation]) -> Vec<String> {
        ops.iter()
            .filter(|op| op.operator == "Do")
            .map(|op| String::from_utf8(op.operands[0].as_name().unwrap().to_vec()).unwrap())
            .collect()
    }

    fn page(images: &[&str]) -> Vec<Operation> {
        images.iter().flat_map(|name| image(name)).collect()
    }

    #[test]
    fn moves_an_image_forward_backward_to_front_and_to_back() {
        let ops = page(&["A", "B", "C"]);
        let do_b = 6;
        assert_eq!(
            names(&arrange(ops.clone(), do_b, Order::Forward).unwrap()),
            ["A", "C", "B"]
        );
        assert_eq!(
            names(&arrange(ops.clone(), do_b, Order::Backward).unwrap()),
            ["B", "A", "C"]
        );
        assert_eq!(
            names(&arrange(ops.clone(), 2, Order::Front).unwrap()),
            ["B", "C", "A"]
        );
        assert_eq!(
            names(&arrange(ops.clone(), 10, Order::Back).unwrap()),
            ["C", "A", "B"]
        );
        assert!(arrange(ops.clone(), 10, Order::Front).is_err());
        assert!(arrange(ops, 2, Order::Backward).is_err());
    }

    #[test]
    fn stops_before_state_changes_and_refuses_ungrouped_or_unbalanced_drawing() {
        // A top-level transform before C would change where A is drawn if A moved past it.
        let mut ops = page(&["A", "B"]);
        ops.push(Operation::new(
            "cm",
            vec![2.into(), 0.into(), 0.into(), 2.into(), 0.into(), 0.into()],
        ));
        ops.extend(image("C"));
        assert_eq!(
            names(&arrange(ops.clone(), 2, Order::Front).unwrap()),
            ["B", "A", "C"]
        );
        assert!(arrange(ops.clone(), 6, Order::Front).is_err());
        // An image drawn without a group of its own.
        let bare = vec![Operation::new("Do", vec![Object::Name(b"A".to_vec())])];
        assert!(arrange(bare, 0, Order::Front).is_err());
        // A group that paints two things moves them together, so it is refused.
        let mut shared = page(&["A"]);
        shared.insert(3, Operation::new("Do", vec![Object::Name(b"X".to_vec())]));
        shared.extend(image("B"));
        assert!(arrange(shared, 2, Order::Front).is_err());
        let mut unbalanced = page(&["A", "B"]);
        unbalanced.push(op("Q"));
        assert!(arrange(unbalanced, 2, Order::Front).is_err());
    }

    #[test]
    fn moves_marked_content_holding_only_the_image_and_passes_paths() {
        let mut ops = vec![Operation::new(
            "BDC",
            vec![
                Object::Name(b"Figure".to_vec()),
                Object::Dictionary(dictionary! { "MCID" => 0 }),
            ],
        )];
        ops.extend(image("A"));
        ops.push(op("EMC"));
        ops.extend([
            Operation::new("re", vec![0.into(), 0.into(), 9.into(), 9.into()]),
            op("f"),
        ]);
        ops.extend(image("B"));
        let moved = arrange(ops, 3, Order::Front).unwrap();
        assert_eq!(names(&moved), ["B", "A"]);
        assert_eq!(moved.last().unwrap().operator, "EMC");
        assert_eq!(moved[0].operator, "re");
    }
}
