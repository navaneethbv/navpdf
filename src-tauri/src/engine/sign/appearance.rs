//! A visible appearance for a certificate signature: a framed text block naming the signer,
//! the signing time and the reason, drawn upright in a corner of the chosen page. It is a
//! picture of the signature, not part of what makes it valid.

use super::{deref, Document};
use lopdf::{dictionary, Dictionary, Object, ObjectId, Stream};
use serde::Deserialize;

/// Size of the appearance as the page is displayed, in points.
const WIDTH: f64 = 216.0;
const HEIGHT: f64 = 58.0;
const MARGIN: f64 = 36.0;
const FONT_SIZE: f64 = 9.0;
/// Characters that fit on one line of the box at the font size.
const LINE_CHARS: usize = 44;

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Corner {
    TopLeft,
    TopRight,
    BottomLeft,
    #[default]
    BottomRight,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureAppearance {
    /// 1-based page number.
    pub page: u32,
    #[serde(default)]
    pub corner: Corner,
}

/// A page attribute, following the page tree for inherited entries.
fn inherited<'a>(doc: &'a Document, page: ObjectId, key: &[u8]) -> Option<&'a Object> {
    let mut current = doc.get_dictionary(page).ok()?;
    for _ in 0..32 {
        if let Ok(value) = current.get(key) {
            return Some(deref(doc, value));
        }
        let parent = current.get(b"Parent").and_then(Object::as_reference).ok()?;
        current = doc.get_dictionary(parent).ok()?;
    }
    None
}

fn number(object: &Object) -> Option<f64> {
    match object {
        Object::Integer(value) => Some(*value as f64),
        Object::Real(value) => Some(f64::from(*value)),
        _ => None,
    }
}

/// The visible box of a page, normalised to [left, bottom, right, top].
fn visible_box(doc: &Document, page: ObjectId) -> Option<[f64; 4]> {
    let raw = inherited(doc, page, b"CropBox")
        .or_else(|| inherited(doc, page, b"MediaBox"))?
        .as_array()
        .ok()?;
    let values: Vec<f64> = raw
        .iter()
        .filter_map(|item| number(deref(doc, item)))
        .collect();
    let &[a, b, c, d] = values.as_slice() else {
        return None;
    };
    Some([a.min(c), b.min(d), a.max(c), b.max(d)])
}

/// The page's clockwise display rotation: 0, 90, 180 or 270.
fn rotation(doc: &Document, page: ObjectId) -> i64 {
    inherited(doc, page, b"Rotate")
        .and_then(|value| value.as_i64().ok())
        .map_or(0, |value| value.rem_euclid(360) / 90 * 90)
}

/// The annotation rectangle and appearance matrix for a box in the chosen displayed corner.
pub fn placement(page_box: [f64; 4], rotation: i64, corner: Corner) -> ([f64; 4], [f64; 6]) {
    let [left, bottom, right, top] = page_box;
    let (width, height) = (right - left, top - bottom);
    let quarter = rotation == 90 || rotation == 270;
    let (shown_width, shown_height) = if quarter {
        (height, width)
    } else {
        (width, height)
    };
    let box_width = WIDTH.min(shown_width - 2.0 * MARGIN).max(1.0);
    let box_height = HEIGHT.min(shown_height - 2.0 * MARGIN).max(1.0);
    let x = match corner {
        Corner::TopLeft | Corner::BottomLeft => MARGIN.min(shown_width / 2.0),
        _ => (shown_width - MARGIN - box_width).max(0.0),
    };
    let y = match corner {
        Corner::BottomLeft | Corner::BottomRight => MARGIN.min(shown_height / 2.0),
        _ => (shown_height - MARGIN - box_height).max(0.0),
    };
    // Displayed coordinates back to the page's own space, undoing its clockwise rotation.
    let to_page = |vx: f64, vy: f64| match rotation {
        90 => (left + width - vy, bottom + vx),
        180 => (left + width - vx, bottom + height - vy),
        270 => (left + vy, bottom + height - vx),
        _ => (left + vx, bottom + vy),
    };
    let (ax, ay) = to_page(x, y);
    let (bx, by) = to_page(x + box_width, y + box_height);
    let rect = [ax.min(bx), ay.min(by), ax.max(bx), ay.max(by)];
    // The appearance is turned counterclockwise by the page rotation, so it reads upright.
    let matrix = match rotation {
        90 => [0.0, 1.0, -1.0, 0.0, 0.0, 0.0],
        180 => [-1.0, 0.0, 0.0, -1.0, 0.0, 0.0],
        270 => [0.0, -1.0, 1.0, 0.0, 0.0, 0.0],
        _ => [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
    };
    (rect, matrix)
}

/// Latin-1 text for a standard font string, escaping delimiters and replacing other characters.
fn pdf_text(text: &str) -> Vec<u8> {
    let mut output = Vec::new();
    for character in text.chars().take(LINE_CHARS) {
        let byte = u32::from(character);
        match u8::try_from(byte) {
            Ok(b'(' | b')' | b'\\') => output.extend([b'\\', byte as u8]),
            Ok(byte) if byte >= 0x20 && byte != 0x7F && !(0x80..0xA0).contains(&byte) => {
                output.push(byte)
            }
            _ => output.push(b'?'),
        }
    }
    if text.chars().count() > LINE_CHARS {
        output.truncate(output.len().saturating_sub(3));
        output.extend(b"...");
    }
    output
}

/// The common name in a distinguished name such as `CN=Ada,O=Example`, or the whole name.
pub fn common_name(subject: &str) -> String {
    subject
        .split(',')
        .find_map(|part| part.trim().strip_prefix("CN="))
        .unwrap_or(subject)
        .to_string()
}

/// Lines drawn in the appearance, top first.
pub fn lines(signer: &str, signed_at: &str, reason: &str) -> Vec<String> {
    let mut lines = vec![format!("Digitally signed by {}", common_name(signer))];
    lines.push(format!("Date: {signed_at}"));
    if !reason.trim().is_empty() {
        lines.push(format!("Reason: {}", reason.trim()));
    }
    lines
}

/// Where the appearance goes on a page: the widget rectangle, the form matrix and its upright
/// width and height.
pub struct Placement {
    pub rect: [f64; 4],
    matrix: [f64; 6],
    width: f64,
    height: f64,
}

pub fn place(doc: &Document, page: ObjectId, corner: Corner) -> Result<Placement, String> {
    let page_box =
        visible_box(doc, page).ok_or("The page for the signature appearance could not be read.")?;
    let turn = rotation(doc, page);
    let (rect, matrix) = placement(page_box, turn, corner);
    // The form's own box is upright; its width and height are as displayed.
    let (width, height) = if turn == 90 || turn == 270 {
        (rect[3] - rect[1], rect[2] - rect[0])
    } else {
        (rect[2] - rect[0], rect[3] - rect[1])
    };
    Ok(Placement {
        rect,
        matrix,
        width,
        height,
    })
}

/// Adds the appearance stream and returns the widget's appearance dictionary.
pub fn build(target: &mut Document, placement: &Placement, text: &[String]) -> Dictionary {
    let Placement {
        matrix,
        width,
        height,
        ..
    } = *placement;
    let mut content = format!(
        "q 0.2 0.3 0.6 RG 0.75 w 0.5 0.5 {:.2} {:.2} re S Q\nBT /Helv {FONT_SIZE} Tf 0.1 0.1 0.2 rg\n",
        width - 1.0,
        height - 1.0
    )
    .into_bytes();
    for (index, line) in text.iter().enumerate() {
        let y = height - 6.0 - FONT_SIZE - index as f64 * (FONT_SIZE + 3.0);
        if y < 2.0 {
            break;
        }
        content.extend(format!("1 0 0 1 6 {y:.2} Tm (").into_bytes());
        content.extend(pdf_text(line));
        content.extend(b") Tj\n");
    }
    content.extend(b"ET\n");
    let font = target.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
        "Encoding" => "WinAnsiEncoding",
    });
    let stream = Stream::new(
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Form",
            "BBox" => vec![0.into(), 0.into(), Object::Real(width as f32), Object::Real(height as f32)],
            "Matrix" => matrix.iter().map(|value| Object::Real(*value as f32)).collect::<Vec<_>>(),
            "Resources" => dictionary! { "Font" => dictionary! { "Helv" => font } },
        },
        content,
    );
    let stream = target.add_object(stream);
    dictionary! { "N" => stream }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placement_keeps_the_box_in_the_displayed_corner() {
        let letter = [0.0, 0.0, 612.0, 792.0];
        let (rect, _) = placement(letter, 0, Corner::BottomRight);
        assert_eq!(rect, [612.0 - 36.0 - WIDTH, 36.0, 576.0, 36.0 + HEIGHT]);
        // Turned a quarter clockwise, the displayed bottom right is the page's top right.
        let (rect, matrix) = placement(letter, 90, Corner::BottomRight);
        assert_eq!(
            rect,
            [612.0 - 36.0 - HEIGHT, 792.0 - 36.0 - WIDTH, 576.0, 756.0]
        );
        assert_eq!(matrix, [0.0, 1.0, -1.0, 0.0, 0.0, 0.0]);
        let (rect, _) = placement(letter, 180, Corner::TopLeft);
        assert_eq!(rect, [612.0 - 36.0 - WIDTH, 36.0, 576.0, 36.0 + HEIGHT]);
        // Turned three quarters, the displayed top left is the page's top right.
        let (rect, _) = placement(letter, 270, Corner::TopLeft);
        assert_eq!(
            rect,
            [612.0 - 36.0 - HEIGHT, 792.0 - 36.0 - WIDTH, 576.0, 756.0]
        );
        // An offset crop box moves the box with it.
        let (rect, _) = placement([100.0, 50.0, 712.0, 842.0], 0, Corner::TopLeft);
        assert_eq!(rect, [136.0, 842.0 - 36.0 - HEIGHT, 136.0 + WIDTH, 806.0]);
    }

    #[test]
    fn text_is_latin_one_and_bounded() {
        assert_eq!(pdf_text("A (b) \\ é"), b"A \\(b\\) \\\\ \xe9".to_vec());
        assert_eq!(pdf_text("名前"), b"??".to_vec());
        let long = pdf_text(&"x".repeat(80));
        assert_eq!(long.len(), LINE_CHARS);
        assert!(long.ends_with(b"..."));
        assert_eq!(common_name("CN=Ada Lovelace,O=Example"), "Ada Lovelace");
        assert_eq!(common_name("O=Example"), "O=Example");
        assert_eq!(lines("CN=Ada", "2026-10-24", " ").len(), 2);
    }
}
