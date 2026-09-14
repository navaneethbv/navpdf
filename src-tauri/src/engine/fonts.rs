//! Font metrics, character-code segmentation and text decoding for the content interpreter.

use super::content::deref;
use super::geometry::{number, Matrix, Rect};
use super::standard_fonts::{StandardFont, STANDARD_FONTS};
use lopdf::{Dictionary, Document, Encoding, Object};

/// Vertical glyph extents never shrink below these values (thousandths of an em), so a
/// font that under-reports its ascent or descent cannot hide glyphs from region tests.
const MIN_ASCENT: f64 = 750.0;
const MIN_DESCENT: f64 = -250.0;
pub const ESTIMATED_WIDTH: f64 = 600.0;
const MAX_CID_WIDTH_ENTRIES: usize = 65_536;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FontKind {
    Simple,
    Type0,
    Type3,
}

enum Widths {
    Table {
        first: i64,
        values: Vec<f64>,
        missing: f64,
    },
    Cid {
        entries: Vec<(u32, u32, f64)>,
        default: f64,
    },
    Standard {
        font: &'static StandardFont,
        exact: bool,
    },
    Estimated(f64),
}

pub struct FontInfo<'a> {
    pub kind: FontKind,
    pub base_name: String,
    pub embedded: bool,
    pub vertical: bool,
    /// Bytes per character code, or `None` when the code space cannot be segmented.
    pub code_length: Option<usize>,
    pub ascent: f64,
    pub descent: f64,
    encoding: Option<Encoding<'a>>,
    widths: Widths,
    width_scale: f64,
}

impl<'a> FontInfo<'a> {
    pub fn load(doc: &'a Document, dict: &'a Dictionary) -> Self {
        let subtype = dict
            .get(b"Subtype")
            .and_then(Object::as_name)
            .unwrap_or(b"Type1".as_slice());
        let base_name = dict
            .get(b"BaseFont")
            .and_then(Object::as_name)
            .map(|name| String::from_utf8_lossy(name).into_owned())
            .unwrap_or_default();
        let encoding = dict.get_font_encoding(doc).ok();
        match subtype {
            b"Type0" => Self::composite(doc, dict, base_name, encoding),
            b"Type3" => Self::type3(doc, dict, base_name, encoding),
            _ => Self::simple(doc, dict, base_name, encoding),
        }
    }

    fn simple(
        doc: &'a Document,
        dict: &'a Dictionary,
        base_name: String,
        encoding: Option<Encoding<'a>>,
    ) -> Self {
        let descriptor = font_descriptor(doc, dict);
        let embedded = is_embedded(descriptor);
        let standard = standard_font(&base_name);
        let widths = match table_widths(doc, dict, descriptor) {
            Some(table) => table,
            None => match standard.filter(|_| !embedded) {
                Some((font, exact)) => Widths::Standard { font, exact },
                None => Widths::Estimated(estimated_width(descriptor)),
            },
        };
        let (ascent, descent) = vertical_extent(descriptor, standard.map(|(font, _)| font));
        Self {
            kind: FontKind::Simple,
            base_name,
            embedded,
            vertical: false,
            code_length: Some(1),
            ascent,
            descent,
            encoding,
            widths,
            width_scale: 1.0,
        }
    }

    fn composite(
        doc: &'a Document,
        dict: &'a Dictionary,
        base_name: String,
        encoding: Option<Encoding<'a>>,
    ) -> Self {
        let cmap = dict.get(b"Encoding").and_then(Object::as_name).ok();
        let identity = matches!(cmap, Some(b"Identity-H") | Some(b"Identity-V"));
        let descendant = dict
            .get(b"DescendantFonts")
            .ok()
            .map(|object| deref(doc, object))
            .and_then(|object| object.as_array().ok())
            .and_then(|fonts| fonts.first())
            .map(|object| deref(doc, object))
            .and_then(|object| object.as_dict().ok());
        let descriptor = descendant.and_then(|font| font_descriptor(doc, font));
        let default = descendant
            .and_then(|font| font.get(b"DW").ok())
            .map(|object| deref(doc, object))
            .and_then(number)
            .unwrap_or(1000.0);
        let entries = descendant
            .map(|font| cid_widths(doc, font))
            .unwrap_or_default();
        let (ascent, descent) = vertical_extent(descriptor, None);
        Self {
            kind: FontKind::Type0,
            base_name,
            embedded: is_embedded(descriptor),
            vertical: cmap.is_some_and(|name| name.ends_with(b"-V")),
            code_length: identity.then_some(2),
            ascent,
            descent,
            encoding,
            widths: Widths::Cid { entries, default },
            width_scale: 1.0,
        }
    }

    fn type3(
        doc: &'a Document,
        dict: &'a Dictionary,
        base_name: String,
        encoding: Option<Encoding<'a>>,
    ) -> Self {
        let array = |key: &[u8]| {
            dict.get(key)
                .ok()
                .map(|object| deref(doc, object))
                .and_then(|object| object.as_array().ok())
        };
        let matrix = array(b"FontMatrix")
            .and_then(|values| Matrix::from_objects(values))
            .unwrap_or(Matrix::new(0.001, 0.0, 0.0, 0.001, 0.0, 0.0));
        let (ascent, descent) = array(b"FontBBox")
            .and_then(|values| Rect::from_objects(values))
            .map(|bbox| (bbox.y1 * matrix.d * 1000.0, bbox.y0 * matrix.d * 1000.0))
            .unwrap_or((MIN_ASCENT, MIN_DESCENT));
        Self {
            kind: FontKind::Type3,
            base_name,
            embedded: true,
            vertical: false,
            code_length: Some(1),
            ascent: ascent.max(MIN_ASCENT),
            descent: descent.min(MIN_DESCENT),
            encoding,
            widths: table_widths(doc, dict, None).unwrap_or(Widths::Estimated(ESTIMATED_WIDTH)),
            width_scale: matrix.a * 1000.0,
        }
    }

    /// Splits a shown string into character codes, or `None` for unsupported code spaces.
    pub fn segments(&self, bytes: &[u8]) -> Option<Vec<(usize, usize)>> {
        let length = self.code_length?;
        bytes.len().is_multiple_of(length).then(|| {
            (0..bytes.len())
                .step_by(length)
                .map(|start| (start, length))
                .collect()
        })
    }

    /// Advance width in thousandths of text space and whether the metric is exact.
    pub fn width(&self, code_bytes: &[u8]) -> (f64, bool) {
        let code = code_value(code_bytes);
        let (width, exact) = match &self.widths {
            Widths::Table {
                first,
                values,
                missing,
            } => (
                usize::try_from(i64::from(code) - first)
                    .ok()
                    .and_then(|index| values.get(index))
                    .copied()
                    .unwrap_or(*missing)
                    * self.width_scale,
                true,
            ),
            Widths::Cid { entries, default } => {
                let index = entries.partition_point(|entry| entry.0 <= code);
                let width = index
                    .checked_sub(1)
                    .map(|i| entries[i])
                    .filter(|entry| code <= entry.1)
                    .map(|entry| entry.2)
                    .unwrap_or(*default);
                (width, self.code_length.is_some())
            }
            Widths::Standard { font, exact } => self.standard_width(font, code, code_bytes, *exact),
            Widths::Estimated(width) => (*width, false),
        };
        (width, exact && self.kind != FontKind::Type3)
    }

    fn standard_width(
        &self,
        font: &StandardFont,
        code: u32,
        code_bytes: &[u8],
        exact: bool,
    ) -> (f64, bool) {
        let missing = (f64::from(font.missing_width), false);
        if !font.builtin_code_widths.is_empty() {
            return u8::try_from(code)
                .ok()
                .and_then(|code| {
                    font.builtin_code_widths
                        .binary_search_by_key(&code, |entry| entry.0)
                        .ok()
                })
                .map(|index| (f64::from(font.builtin_code_widths[index].1), exact))
                .unwrap_or(missing);
        }
        self.text(code_bytes)
            .chars()
            .next()
            .and_then(|ch| {
                font.unicode_widths
                    .binary_search_by_key(&u32::from(ch), |entry| entry.0)
                    .ok()
            })
            .map(|index| (f64::from(font.unicode_widths[index].1), exact))
            .unwrap_or(missing)
    }

    /// Decodes character codes to Unicode. Composite fonts decode only through a
    /// ToUnicode map; without one their text is reported as unknown (empty).
    pub fn text(&self, bytes: &[u8]) -> String {
        match (&self.encoding, self.kind) {
            (Some(encoding @ Encoding::UnicodeMapEncoding(_)), _) => {
                Document::decode_text(encoding, bytes).unwrap_or_default()
            }
            (_, FontKind::Type0) => String::new(),
            (Some(encoding), _) => Document::decode_text(encoding, bytes).unwrap_or_default(),
            (None, _) => bytes.iter().map(|byte| char::from(*byte)).collect(),
        }
    }

    /// Encodes text for a simple font when every character survives a decode round trip.
    pub fn encode(&self, text: &str) -> Option<Vec<u8>> {
        if self.kind != FontKind::Simple {
            return None;
        }
        let bytes = match &self.encoding {
            Some(encoding) => Document::encode_text(encoding, text),
            None => text
                .chars()
                .map(|ch| u8::try_from(u32::from(ch)).ok())
                .collect::<Option<Vec<u8>>>()?,
        };
        (self.text(&bytes) == text).then_some(bytes)
    }
}

pub fn code_value(bytes: &[u8]) -> u32 {
    bytes
        .iter()
        .take(4)
        .fold(0, |acc, byte| (acc << 8) | u32::from(*byte))
}

fn font_descriptor<'a>(doc: &'a Document, dict: &'a Dictionary) -> Option<&'a Dictionary> {
    dict.get(b"FontDescriptor")
        .ok()
        .map(|object| deref(doc, object))
        .and_then(|object| object.as_dict().ok())
}

fn is_embedded(descriptor: Option<&Dictionary>) -> bool {
    descriptor.is_some_and(|d| d.has(b"FontFile") || d.has(b"FontFile2") || d.has(b"FontFile3"))
}

fn table_widths(
    doc: &Document,
    dict: &Dictionary,
    descriptor: Option<&Dictionary>,
) -> Option<Widths> {
    let values = dict
        .get(b"Widths")
        .ok()
        .map(|object| deref(doc, object))
        .and_then(|object| object.as_array().ok())?;
    let first = dict
        .get(b"FirstChar")
        .ok()
        .map(|object| deref(doc, object))
        .and_then(|object| object.as_i64().ok())
        .unwrap_or(0);
    let missing = descriptor
        .and_then(|d| d.get(b"MissingWidth").ok())
        .and_then(number)
        .unwrap_or(0.0);
    Some(Widths::Table {
        first,
        values: values
            .iter()
            .map(|value| number(deref(doc, value)).unwrap_or(missing))
            .collect(),
        missing,
    })
}

fn cid_widths(doc: &Document, font: &Dictionary) -> Vec<(u32, u32, f64)> {
    let mut entries = Vec::new();
    let Some(list) = font
        .get(b"W")
        .ok()
        .map(|object| deref(doc, object))
        .and_then(|object| object.as_array().ok())
    else {
        return entries;
    };
    let mut index = 0;
    while index < list.len() && entries.len() < MAX_CID_WIDTH_ENTRIES {
        let Some(first) = number(deref(doc, &list[index])).filter(|value| *value >= 0.0) else {
            break;
        };
        let first = first as u32;
        match list.get(index + 1).map(|object| deref(doc, object)) {
            Some(Object::Array(widths)) => {
                for (offset, value) in widths.iter().enumerate().take(MAX_CID_WIDTH_ENTRIES) {
                    if let Some(width) = number(deref(doc, value)) {
                        let code = first.saturating_add(offset as u32);
                        entries.push((code, code, width));
                    }
                }
                index += 2;
            }
            Some(last) => {
                let width = list
                    .get(index + 2)
                    .map(|object| deref(doc, object))
                    .and_then(number);
                let (Some(last), Some(width)) = (number(last), width) else {
                    break;
                };
                if last >= f64::from(first) {
                    entries.push((first, last as u32, width));
                }
                index += 3;
            }
            None => break,
        }
    }
    entries.sort_by_key(|entry| entry.0);
    entries
}

fn estimated_width(descriptor: Option<&Dictionary>) -> f64 {
    descriptor
        .and_then(|d| {
            d.get(b"AvgWidth")
                .ok()
                .or_else(|| d.get(b"MissingWidth").ok())
        })
        .and_then(number)
        .filter(|width| *width > 0.0)
        .unwrap_or(ESTIMATED_WIDTH)
}

fn vertical_extent(descriptor: Option<&Dictionary>, standard: Option<&StandardFont>) -> (f64, f64) {
    let metric = |key: &[u8], fallback: Option<i32>, default: f64| {
        descriptor
            .and_then(|d| d.get(key).ok())
            .and_then(number)
            .or(fallback.map(f64::from))
            .unwrap_or(default)
    };
    let ascent = metric(b"Ascent", standard.map(|font| font.ascent), MIN_ASCENT);
    let descent = metric(b"Descent", standard.map(|font| font.descent), MIN_DESCENT);
    (ascent.max(MIN_ASCENT), descent.min(MIN_DESCENT))
}

/// Resolves a standard font; metric-compatible aliases are treated as approximate.
fn standard_font(base_name: &str) -> Option<(&'static StandardFont, bool)> {
    let name = strip_subset_tag(base_name);
    if let Some(font) = STANDARD_FONTS.iter().find(|font| font.name == name) {
        return Some((font, true));
    }
    let (family, style) = name.split_once([',', '-']).unwrap_or((name, ""));
    let bold = style.contains("Bold");
    let italic = style.contains("Italic") || style.contains("Oblique");
    let variants = match family {
        "Arial" | "ArialMT" | "Helvetica" => [
            "Helvetica",
            "Helvetica-Bold",
            "Helvetica-Oblique",
            "Helvetica-BoldOblique",
        ],
        "TimesNewRoman" | "TimesNewRomanPS" | "TimesNewRomanPSMT" | "Times" => [
            "Times-Roman",
            "Times-Bold",
            "Times-Italic",
            "Times-BoldItalic",
        ],
        "CourierNew" | "CourierNewPS" | "CourierNewPSMT" | "Courier" => [
            "Courier",
            "Courier-Bold",
            "Courier-Oblique",
            "Courier-BoldOblique",
        ],
        _ => return None,
    };
    let target = variants[usize::from(bold) + 2 * usize::from(italic)];
    STANDARD_FONTS
        .iter()
        .find(|font| font.name == target)
        .map(|font| (font, false))
}

fn strip_subset_tag(name: &str) -> &str {
    match name.split_once('+') {
        Some((tag, rest)) if tag.len() == 6 && tag.bytes().all(|b| b.is_ascii_uppercase()) => rest,
        _ => name,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::dictionary;

    #[test]
    fn standard_helvetica_uses_exact_afm_widths() {
        let doc = Document::with_version("1.7");
        let font = dictionary! {
            "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
            "Encoding" => "WinAnsiEncoding",
        };
        let info = FontInfo::load(&doc, &font);
        assert_eq!(info.width(b"A"), (667.0, true));
        assert_eq!(info.width(b" "), (278.0, true));
        assert_eq!(info.text(b"Caf\xe9"), "Café");
        assert_eq!(info.encode("Café"), Some(b"Caf\xe9".to_vec()));
        assert_eq!(info.encode("日本"), None);
    }

    #[test]
    fn aliases_and_subsets_are_approximate_or_stripped() {
        let doc = Document::with_version("1.7");
        let arial =
            dictionary! {"Type" => "Font", "Subtype" => "TrueType", "BaseFont" => "Arial,Bold"};
        assert_eq!(FontInfo::load(&doc, &arial).width(b"A"), (722.0, false));
        assert_eq!(strip_subset_tag("ABCDEF+Times-Roman"), "Times-Roman");
        assert_eq!(strip_subset_tag("Abc+Times-Roman"), "Abc+Times-Roman");
        let unknown =
            dictionary! {"Type" => "Font", "Subtype" => "TrueType", "BaseFont" => "Custom"};
        assert_eq!(
            FontInfo::load(&doc, &unknown).width(b"A"),
            (ESTIMATED_WIDTH, false)
        );
    }

    #[test]
    fn composite_widths_parse_both_w_array_forms() {
        let doc = Document::with_version("1.7");
        let descendant = dictionary! {
            "Type" => "Font", "Subtype" => "CIDFontType2", "DW" => 900,
            "W" => vec![
                Object::Integer(3), Object::Array(vec![500.into(), 600.into()]),
                Object::Integer(10), Object::Integer(12), Object::Integer(250),
            ],
        };
        let font = dictionary! {
            "Type" => "Font", "Subtype" => "Type0", "BaseFont" => "CIDFont",
            "Encoding" => "Identity-H", "DescendantFonts" => vec![Object::Dictionary(descendant)],
        };
        let info = FontInfo::load(&doc, &font);
        assert_eq!(info.segments(&[0, 3, 0, 4]), Some(vec![(0, 2), (2, 2)]));
        assert_eq!(info.segments(&[0, 3, 0]), None);
        assert_eq!(info.width(&[0, 4]), (600.0, true));
        assert_eq!(info.width(&[0, 11]), (250.0, true));
        assert_eq!(info.width(&[0, 99]), (900.0, true));
        assert!(info.ascent >= MIN_ASCENT && info.descent <= MIN_DESCENT);
    }
}
