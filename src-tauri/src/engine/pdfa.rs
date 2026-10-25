//! PDF/A-2 and PDF/A-3 checks and conversion, output intents and standards identification.
//! The checks cover structural rules that can be read from the file; they are not a full
//! validator such as veraPDF. Conversion fixes what it can without changing page content and
//! refuses when anything it cannot fix remains. Scope and limits are recorded in ADR 0020.

use super::content::{deref, Resources};
use super::protect::ensure_file_id;
use super::{icc, load, save, MAX_STREAM_BYTES};
use lopdf::content::Content;
use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, Stream};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashSet, VecDeque};

/// Objects followed from the trailer; larger files are refused rather than partly checked.
const MAX_OBJECTS: usize = 2_000_000;
const MAX_NESTING: usize = 64;
/// Examples listed with each finding.
const MAX_EXAMPLES: usize = 5;

/// Actions PDF/A-2 and PDF/A-3 do not permit.
const FORBIDDEN_ACTIONS: [&str; 11] = [
    "Launch",
    "Sound",
    "Movie",
    "ResetForm",
    "ImportData",
    "Hide",
    "SetOCGState",
    "Rendition",
    "Trans",
    "GoTo3DView",
    "JavaScript",
];
const ALLOWED_NAMED: [&str; 4] = ["NextPage", "PrevPage", "FirstPage", "LastPage"];
const FORBIDDEN_ANNOTATIONS: [&str; 5] = ["3D", "Sound", "Screen", "Movie", "RichMedia"];
/// Annotation flags: Invisible, Hidden, NoView and ToggleNoView must be clear, Print set.
const HIDING_FLAGS: i64 = 1 | 2 | 32 | 256;
const PRINT_FLAG: i64 = 4;
const ACTIONS: &str = "Launch, sound, movie, reset, import, hide, layer, rendition, transition, 3D and JavaScript actions, and named actions other than page navigation, are not permitted.";
const ADDITIONAL_ACTIONS: &str =
    "Additional actions (AA) on the catalog, pages, annotations and fields are not permitted.";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Level {
    /// 2 or 3.
    pub part: u8,
    /// 'B', 'U' or 'A'.
    pub conformance: char,
}

impl Level {
    pub fn parse(text: &str) -> Result<Self, String> {
        let mut characters = text.trim().chars();
        let part = characters.next().and_then(|digit| digit.to_digit(10));
        let conformance = characters.next().map(|letter| letter.to_ascii_uppercase());
        match (part, conformance, characters.next()) {
            (Some(part @ (2 | 3)), Some(conformance @ ('B' | 'U' | 'A')), None) => Ok(Self {
                part: part as u8,
                conformance,
            }),
            _ => Err("Choose PDF/A-2b, 2u, 2a, 3b, 3u or 3a.".into()),
        }
    }

    pub fn label(self) -> String {
        format!(
            "PDF/A-{}{}",
            self.part,
            self.conformance.to_ascii_lowercase()
        )
    }

    fn unicode(self) -> bool {
        self.conformance != 'B'
    }

    fn accessible(self) -> bool {
        self.conformance == 'A'
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub rule: String,
    pub message: String,
    /// How many objects break the rule.
    pub count: usize,
    pub examples: Vec<String>,
    /// Conversion fixes this rule.
    pub fixable: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub level: String,
    pub declared: Option<String>,
    pub passed: bool,
    pub findings: Vec<Finding>,
    /// Requirements these checks do not read.
    pub not_checked: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputIntentInfo {
    pub subtype: String,
    pub condition: String,
    pub info: String,
    pub has_profile: bool,
    pub components: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Standards {
    pub pdfa: Option<String>,
    pub pdfua: Option<String>,
    pub pdfx: Option<String>,
    pub output_intents: Vec<OutputIntentInfo>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", tag = "action")]
pub enum StandardsEdit {
    Convert { level: String },
    AddOutputIntent,
    RemoveIdentification,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StandardsReport {
    pub message: String,
}

/// Collects findings by rule.
#[derive(Default)]
struct Findings {
    rules: BTreeMap<&'static str, (String, usize, Vec<String>, bool)>,
}

impl Findings {
    fn add(&mut self, rule: &'static str, message: &str, fixable: bool, example: Option<String>) {
        let entry = self
            .rules
            .entry(rule)
            .or_insert_with(|| (message.to_string(), 0, Vec::new(), fixable));
        entry.1 += 1;
        if let Some(example) = example {
            if entry.2.len() < MAX_EXAMPLES && !entry.2.contains(&example) {
                entry.2.push(example);
            }
        }
    }

    fn into_list(self) -> Vec<Finding> {
        self.rules
            .into_iter()
            .map(|(rule, (message, count, examples, fixable))| Finding {
                rule: rule.to_string(),
                message,
                count,
                examples,
                fixable,
            })
            .collect()
    }
}

fn name_of(dictionary: &Dictionary, key: &[u8]) -> Option<String> {
    dictionary
        .get(key)
        .and_then(Object::as_name)
        .ok()
        .map(|name| String::from_utf8_lossy(name).into_owned())
}

fn dictionary_of(object: &Object) -> Option<&Dictionary> {
    match object {
        Object::Dictionary(dictionary) => Some(dictionary),
        Object::Stream(stream) => Some(&stream.dict),
        _ => None,
    }
}

/// Objects reachable from the trailer, in a stable order.
fn reachable(doc: &Document) -> Result<Vec<ObjectId>, String> {
    fn references(object: &Object, out: &mut Vec<ObjectId>, depth: usize) {
        if depth > MAX_NESTING {
            return;
        }
        match object {
            Object::Reference(id) => out.push(*id),
            Object::Array(items) => items
                .iter()
                .for_each(|item| references(item, out, depth + 1)),
            Object::Dictionary(dictionary) => dictionary
                .iter()
                .for_each(|(_, value)| references(value, out, depth + 1)),
            Object::Stream(stream) => stream
                .dict
                .iter()
                .for_each(|(_, value)| references(value, out, depth + 1)),
            _ => {}
        }
    }
    let mut seen = HashSet::new();
    let mut order = Vec::new();
    let mut queue = VecDeque::new();
    let mut start = Vec::new();
    references(&Object::Dictionary(doc.trailer.clone()), &mut start, 0);
    queue.extend(start);
    while let Some(id) = queue.pop_front() {
        if !seen.insert(id) {
            continue;
        }
        let Ok(object) = doc.get_object(id) else {
            continue;
        };
        order.push(id);
        if order.len() > MAX_OBJECTS {
            return Err("The document has too many objects to check.".into());
        }
        let mut next = Vec::new();
        references(object, &mut next, 0);
        queue.extend(next.into_iter().filter(|next| !seen.contains(next)));
    }
    Ok(order)
}

/// The catalog's XMP metadata as text, when present and readable.
fn xmp(doc: &Document) -> Option<String> {
    let catalog = doc.catalog().ok()?;
    let stream = deref(doc, catalog.get(b"Metadata").ok()?)
        .as_stream()
        .ok()?;
    let bytes = stream
        .decompressed_content_with_limit(MAX_STREAM_BYTES)
        .ok()
        .or_else(|| (!stream.dict.has(b"Filter")).then(|| stream.content.clone()))?;
    String::from_utf8(bytes).ok()
}

/// An XMP property written as an attribute (`name="value"`) or an element.
fn xmp_property(xmp: &str, name: &str) -> Option<String> {
    let attribute = format!("{name}=\"");
    if let Some(start) = xmp.find(&attribute).map(|index| index + attribute.len()) {
        let end = xmp[start..].find('"')? + start;
        return Some(xmp[start..end].trim().to_string());
    }
    let attribute = format!("{name}='");
    if let Some(start) = xmp.find(&attribute).map(|index| index + attribute.len()) {
        let end = xmp[start..].find('\'')? + start;
        return Some(xmp[start..end].trim().to_string());
    }
    let open = format!("<{name}>");
    let start = xmp.find(&open)? + open.len();
    let end = xmp[start..].find(&format!("</{name}>"))? + start;
    Some(xmp[start..end].trim().to_string())
}

fn declared_pdfa(xmp: Option<&str>) -> Option<String> {
    let xmp = xmp?;
    let part = xmp_property(xmp, "pdfaid:part")?;
    let conformance = xmp_property(xmp, "pdfaid:conformance").unwrap_or_default();
    Some(format!("PDF/A-{part}{}", conformance.to_ascii_lowercase()))
}

fn info(doc: &Document) -> Option<&Dictionary> {
    deref(doc, doc.trailer.get(b"Info").ok()?).as_dict().ok()
}

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
    bytes.iter().map(|&byte| char::from(byte)).collect()
}

fn info_text(doc: &Document, key: &[u8]) -> Option<String> {
    info(doc)?
        .get(key)
        .and_then(Object::as_str)
        .ok()
        .map(decode_text)
        .filter(|text| !text.trim().is_empty())
}

fn escape_xml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// What device colour spaces the document paints with.
#[derive(Default)]
struct DeviceColour {
    rgb: bool,
    cmyk: bool,
    gray: bool,
}

impl DeviceColour {
    fn note(&mut self, name: &[u8]) {
        match name {
            b"DeviceRGB" | b"RGB" => self.rgb = true,
            b"DeviceCMYK" | b"CMYK" => self.cmyk = true,
            b"DeviceGray" | b"G" => self.gray = true,
            _ => {}
        }
    }

    fn colour_space(&mut self, doc: &Document, value: &Object) {
        match deref(doc, value) {
            Object::Name(name) => self.note(name),
            Object::Array(items) => {
                // Indexed and similar spaces name their base space second.
                let family = items.first().and_then(|item| item.as_name().ok());
                if family == Some(b"Indexed".as_slice()) {
                    if let Some(base) = items.get(1) {
                        self.colour_space(doc, base);
                    }
                }
            }
            _ => {}
        }
    }
}

/// Fonts selected by content, keyed by a description so each is checked once.
type UsedFonts = BTreeMap<String, Dictionary>;

fn scan_content(
    doc: &Document,
    bytes: &[u8],
    resources: &Resources,
    colour: &mut DeviceColour,
    fonts: &mut UsedFonts,
) {
    let Ok(content) = Content::decode(bytes) else {
        return;
    };
    // The current font and text rendering mode, saved and restored with the graphics state.
    let mut state: (Option<(String, Dictionary)>, i64) = (None, 0);
    let mut saved = Vec::new();
    for operation in content.operations {
        match operation.operator.as_str() {
            "q" => saved.push(state.clone()),
            "Q" => state = saved.pop().unwrap_or_default(),
            "Tf" => {
                let font = operation
                    .operands
                    .first()
                    .and_then(|name| name.as_name().ok())
                    .and_then(|name| resources.lookup(doc, b"Font", name));
                state.0 = match font {
                    Some((id, Object::Dictionary(font))) => {
                        Some((format!("{id:?} {}", font_name(font)), font.clone()))
                    }
                    _ => None,
                };
            }
            "Tr" => {
                state.1 = operation
                    .operands
                    .first()
                    .and_then(|mode| mode.as_i64().ok())
                    .unwrap_or(0)
            }
            // Fonts must be embedded when they draw glyphs; invisible text (mode 3) is exempt.
            "Tj" | "TJ" | "'" | "\"" if state.1 != 3 => {
                if let Some((key, font)) = &state.0 {
                    fonts.entry(key.clone()).or_insert_with(|| font.clone());
                }
            }
            "rg" | "RG" => colour.rgb = true,
            "k" | "K" => colour.cmyk = true,
            "g" | "G" => colour.gray = true,
            "cs" | "CS" => {
                if let Some(Object::Name(name)) = operation.operands.first() {
                    colour.note(name);
                }
            }
            "BI" => {
                if let Some(Object::Dictionary(image)) = operation.operands.first() {
                    let space = image.get(b"CS").or_else(|_| image.get(b"ColorSpace"));
                    if let Ok(space) = space {
                        colour.colour_space(doc, space);
                    }
                }
            }
            _ => {}
        }
    }
}

fn font_name(font: &Dictionary) -> String {
    name_of(font, b"BaseFont").unwrap_or_else(|| "unnamed font".into())
}

/// Checks one font dictionary for embedding and Unicode mapping.
fn check_font(doc: &Document, font: &Dictionary, level: Level, findings: &mut Findings) {
    let subtype = name_of(font, b"Subtype").unwrap_or_default();
    let descriptor = font
        .get(b"FontDescriptor")
        .ok()
        .and_then(|value| deref(doc, value).as_dict().ok());
    if subtype == "Type0" {
        let descendant = font
            .get(b"DescendantFonts")
            .ok()
            .and_then(|fonts| deref(doc, fonts).as_array().ok())
            .and_then(|fonts| fonts.first())
            .and_then(|font| deref(doc, font).as_dict().ok());
        if let Some(descendant) = descendant {
            check_font(
                doc,
                descendant,
                Level {
                    conformance: 'B',
                    ..level
                },
                findings,
            );
        }
    }
    match subtype.as_str() {
        "Type3" | "Type0" => {}
        _ => {
            let embedded = descriptor.is_some_and(|descriptor| {
                descriptor.has(b"FontFile")
                    || descriptor.has(b"FontFile2")
                    || descriptor.has(b"FontFile3")
            });
            if !embedded {
                findings.add(
                    "fonts-embedded",
                    "Every font must be embedded. NavPDF cannot embed fonts that are not in the file, including the standard 14 fonts such as Helvetica.",
                    false,
                    Some(font_name(font)),
                );
            }
        }
    }
    if !level.unicode() || subtype.starts_with("CIDFont") || font.has(b"ToUnicode") {
        return;
    }
    let symbolic = descriptor
        .and_then(|descriptor| descriptor.get(b"Flags").and_then(Object::as_i64).ok())
        .is_some_and(|flags| flags & 4 != 0);
    let standard_encoding = matches!(
        font.get(b"Encoding").map(|value| deref(doc, value)),
        Ok(Object::Name(_))
    );
    if subtype == "Type0" || subtype == "Type3" || symbolic || !standard_encoding {
        findings.add(
            "fonts-unicode",
            "Every font must map its characters to Unicode with a ToUnicode table.",
            false,
            Some(font_name(font)),
        );
    }
}

fn action_kind(doc: &Document, action: &Object) -> Option<String> {
    let action = deref(doc, action).as_dict().ok()?;
    let kind = name_of(action, b"S")?;
    if FORBIDDEN_ACTIONS.contains(&kind.as_str()) {
        return Some(kind);
    }
    if kind == "Named" {
        let named = name_of(action, b"N").unwrap_or_default();
        if !ALLOWED_NAMED.contains(&named.as_str()) {
            return Some(format!("Named {named}"));
        }
    }
    None
}

fn check_actions(doc: &Document, dictionary: &Dictionary, findings: &mut Findings) {
    for key in [b"A".as_slice(), b"OpenAction", b"Next"] {
        let Ok(value) = dictionary.get(key) else {
            continue;
        };
        let actions: Vec<&Object> = match deref(doc, value) {
            Object::Array(items) => items.iter().collect(),
            _ => vec![value],
        };
        for action in actions {
            if let Some(kind) = action_kind(doc, action) {
                findings.add("actions", ACTIONS, true, Some(kind));
            }
        }
    }
    if dictionary.has(b"AA") {
        findings.add("additional-actions", ADDITIONAL_ACTIONS, true, None);
    }
}

fn check_annotation(doc: &Document, annotation: &Dictionary, page: u32, findings: &mut Findings) {
    let subtype = name_of(annotation, b"Subtype").unwrap_or_default();
    let example = Some(format!("page {page}: {subtype}"));
    if FORBIDDEN_ANNOTATIONS.contains(&subtype.as_str()) {
        findings.add(
            "annotation-types",
            "3D, sound, screen, movie and rich media annotations are not permitted.",
            false,
            example.clone(),
        );
    }
    if subtype == "Popup" {
        return;
    }
    let flags = annotation.get(b"F").and_then(Object::as_i64).unwrap_or(0);
    if flags & PRINT_FLAG == 0 || flags & HIDING_FLAGS != 0 {
        findings.add(
            "annotation-flags",
            "Annotations must be set to print and must not be hidden.",
            true,
            example.clone(),
        );
    }
    let appearance = annotation
        .get(b"AP")
        .ok()
        .and_then(|value| deref(doc, value).as_dict().ok());
    if let Some(appearance) = appearance {
        if appearance.has(b"D") || appearance.has(b"R") {
            findings.add(
                "appearance-states",
                "Appearance dictionaries may hold only the normal appearance (N).",
                true,
                example.clone(),
            );
        }
    }
    let rect: Vec<f64> = annotation
        .get(b"Rect")
        .and_then(Object::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| deref(doc, item).as_float().ok().map(f64::from))
                .collect()
        })
        .unwrap_or_default();
    let has_area =
        rect.len() == 4 && (rect[2] - rect[0]).abs() > 0.0 && (rect[3] - rect[1]).abs() > 0.0;
    let has_normal = appearance.is_some_and(|appearance| appearance.has(b"N"));
    if has_area && subtype != "Link" && !has_normal {
        findings.add(
            "annotation-appearance",
            "Annotations other than links and pop-ups need an appearance stream. Flatten or remove those annotations first.",
            false,
            example,
        );
    }
}

fn check_embedded_file(
    doc: &Document,
    filespec: &Dictionary,
    level: Level,
    catalog_af: &HashSet<ObjectId>,
    id: Option<ObjectId>,
    findings: &mut Findings,
) {
    let name = filespec
        .get(b"UF")
        .or_else(|_| filespec.get(b"F"))
        .and_then(Object::as_str)
        .map(decode_text)
        .unwrap_or_else(|_| "attachment".into());
    let stream = filespec
        .get(b"EF")
        .ok()
        .and_then(|ef| deref(doc, ef).as_dict().ok())
        .and_then(|ef| ef.get(b"F").ok())
        .and_then(|file| deref(doc, file).as_stream().ok());
    let Some(stream) = stream else { return };
    if level.part == 2 {
        let bytes = stream
            .decompressed_content_with_limit(MAX_STREAM_BYTES)
            .unwrap_or_default();
        let is_pdfa =
            bytes.starts_with(b"%PDF") && bytes.windows(11).any(|window| window == b"pdfaid:part");
        if !is_pdfa {
            findings.add(
                "embedded-files",
                "PDF/A-2 allows only attachments that are themselves PDF/A files; remove other attachments or choose PDF/A-3.",
                false,
                Some(name),
            );
        }
        return;
    }
    let listed = id.is_some_and(|id| catalog_af.contains(&id));
    if !filespec.has(b"AFRelationship")
        || !mime_type(&stream.dict)
        || !filespec.has(b"UF")
        || !listed
    {
        findings.add(
            "associated-files",
            "PDF/A-3 attachments need a relationship, a MIME type, a Unicode file name and a place in the document's associated files.",
            true,
            Some(name),
        );
    }
}

/// Whether an embedded file names a MIME type such as `text/plain`.
fn mime_type(stream: &Dictionary) -> bool {
    name_of(stream, b"Subtype").is_some_and(|mime| {
        let mut parts = mime.split('/');
        matches!((parts.next(), parts.next(), parts.next()), (Some(kind), Some(sub), None) if !kind.is_empty() && !sub.is_empty())
    })
}

fn catalog_associated_files(doc: &Document) -> HashSet<ObjectId> {
    doc.catalog()
        .ok()
        .and_then(|catalog| catalog.get(b"AF").ok())
        .and_then(|af| deref(doc, af).as_array().ok())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_reference().ok())
                .collect()
        })
        .unwrap_or_default()
}

fn has_pdfa_intent(doc: &Document) -> Option<i64> {
    let catalog = doc.catalog().ok()?;
    let intents = deref(doc, catalog.get(b"OutputIntents").ok()?)
        .as_array()
        .ok()?;
    intents.iter().find_map(|intent| {
        let intent = deref(doc, intent).as_dict().ok()?;
        (name_of(intent, b"S").as_deref() == Some("GTS_PDFA1")).then(|| {
            intent
                .get(b"DestOutputProfile")
                .ok()
                .and_then(|profile| deref(doc, profile).as_stream().ok())
                .and_then(|profile| profile.dict.get(b"N").and_then(Object::as_i64).ok())
                .unwrap_or(0)
        })
    })
}

/// Checks the document against a PDF/A level.
fn check(doc: &Document, level: Level) -> Result<Vec<Finding>, String> {
    let mut findings = Findings::default();
    let objects = reachable(doc)?;
    let metadata = xmp(doc);
    let catalog = doc
        .catalog()
        .map_err(|_| "The document catalog could not be read.")?;

    if !doc.version.starts_with("1.") {
        findings.add(
            "version",
            "The file must declare a PDF version from 1.0 to 1.7.",
            true,
            Some(doc.version.clone()),
        );
    }
    if !doc.trailer.has(b"ID") {
        findings.add(
            "file-id",
            "The file needs a file identifier in its trailer.",
            true,
            None,
        );
    }
    match metadata.as_deref() {
        None => findings.add(
            "metadata",
            "The document needs XMP metadata identifying its PDF/A level.",
            true,
            None,
        ),
        Some(xmp) => {
            let part = xmp_property(xmp, "pdfaid:part");
            let conformance = xmp_property(xmp, "pdfaid:conformance");
            if part.as_deref() != Some(&level.part.to_string())
                || !conformance
                    .is_some_and(|value| value.eq_ignore_ascii_case(&level.conformance.to_string()))
            {
                findings.add(
                    "identification",
                    "The XMP metadata must identify the PDF/A part and conformance level.",
                    true,
                    declared_pdfa(Some(xmp)),
                );
            }
            for (key, property) in [
                (b"Title".as_slice(), "dc:title"),
                (b"Author", "dc:creator"),
                (b"Subject", "dc:description"),
                (b"Producer", "pdf:Producer"),
                (b"Keywords", "pdf:Keywords"),
                (b"Creator", "xmp:CreatorTool"),
            ] {
                if let Some(value) = info_text(doc, key) {
                    if !xmp.contains(&escape_xml(value.trim())) || !xmp.contains(property) {
                        findings.add(
                            "metadata-match",
                            "Document information must match its XMP metadata.",
                            true,
                            Some(String::from_utf8_lossy(key).into_owned()),
                        );
                    }
                }
            }
        }
    }
    check_actions(doc, catalog, &mut findings);
    if catalog
        .get(b"Names")
        .ok()
        .and_then(|names| deref(doc, names).as_dict().ok())
        .is_some_and(|names| names.has(b"JavaScript"))
    {
        findings.add(
            "javascript",
            "Document-level JavaScript is not permitted.",
            true,
            None,
        );
    }
    if let Some(form) = catalog
        .get(b"AcroForm")
        .ok()
        .and_then(|form| deref(doc, form).as_dict().ok())
    {
        if form.has(b"XFA") {
            findings.add("xfa", "XFA forms are not permitted; the XFA data is removed and the AcroForm fields are kept.", true, None);
        }
        if form
            .get(b"NeedAppearances")
            .and_then(Object::as_bool)
            .unwrap_or(false)
        {
            findings.add(
                "need-appearances",
                "Forms must not ask readers to generate appearances.",
                true,
                None,
            );
        }
    }
    if let Some(properties) = catalog
        .get(b"OCProperties")
        .ok()
        .and_then(|value| deref(doc, value).as_dict().ok())
    {
        let mut configurations: Vec<&Dictionary> = properties
            .get(b"D")
            .ok()
            .and_then(|value| deref(doc, value).as_dict().ok())
            .into_iter()
            .collect();
        if let Ok(Object::Array(configs)) =
            properties.get(b"Configs").map(|value| deref(doc, value))
        {
            configurations.extend(
                configs
                    .iter()
                    .filter_map(|config| deref(doc, config).as_dict().ok()),
            );
        }
        if configurations
            .iter()
            .any(|config| !config.has(b"Name") || config.has(b"AS"))
        {
            findings.add(
                "layers",
                "Layer configurations need a name and must not set states automatically (AS).",
                true,
                None,
            );
        }
    }
    if level.accessible() {
        let marked = catalog
            .get(b"MarkInfo")
            .ok()
            .and_then(|value| deref(doc, value).as_dict().ok())
            .and_then(|mark| mark.get(b"Marked").and_then(Object::as_bool).ok())
            .unwrap_or(false);
        if !marked || !catalog.has(b"StructTreeRoot") {
            findings.add(
                "tagged",
                "Level A documents must be tagged. Use Tags and Reading Order first.",
                false,
                None,
            );
        }
        if !catalog.has(b"Lang") {
            findings.add(
                "language",
                "Level A documents must declare their language. Set it in the Accessibility Check.",
                false,
                None,
            );
        }
    }

    let mut colour = DeviceColour::default();
    let mut fonts = UsedFonts::new();
    let catalog_af = catalog_associated_files(doc);
    for (number, page) in doc.get_pages() {
        if let Ok(bytes) = doc.get_page_content_with_limit(page, MAX_STREAM_BYTES) {
            scan_content(
                doc,
                &bytes,
                &Resources::for_page(doc, page),
                &mut colour,
                &mut fonts,
            );
        }
        let Ok(dictionary) = doc.get_dictionary(page) else {
            continue;
        };
        if dictionary.has(b"AA") {
            findings.add(
                "additional-actions",
                ADDITIONAL_ACTIONS,
                true,
                Some(format!("page {number}")),
            );
        }
        if let Ok(annots) = dictionary.get(b"Annots").map(|value| deref(doc, value)) {
            for annotation in annots
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|entry| deref(doc, entry).as_dict().ok())
            {
                check_annotation(doc, annotation, number, &mut findings);
                check_actions(doc, annotation, &mut findings);
            }
        }
    }
    for id in &objects {
        let Ok(object) = doc.get_object(*id) else {
            continue;
        };
        let Some(dictionary) = dictionary_of(object) else {
            continue;
        };
        let subtype = name_of(dictionary, b"Subtype");
        if let Object::Stream(stream) = object {
            let filters = stream.filters().unwrap_or_default();
            if filters.iter().any(|filter| filter == b"LZWDecode") {
                findings.add("lzw", "LZW compression is not permitted.", true, None);
            }
            match subtype.as_deref() {
                Some("Image") => {
                    if dictionary
                        .get(b"Interpolate")
                        .and_then(Object::as_bool)
                        .unwrap_or(false)
                    {
                        findings.add(
                            "image-interpolation",
                            "Images must not ask for interpolation.",
                            true,
                            None,
                        );
                    }
                    if dictionary.has(b"Alternates") || dictionary.has(b"OPI") {
                        findings.add(
                            "image-alternates",
                            "Alternate images and OPI references are not permitted.",
                            true,
                            None,
                        );
                    }
                    if let Ok(space) = dictionary.get(b"ColorSpace") {
                        colour.colour_space(doc, space);
                    }
                }
                Some("Form") => {
                    if dictionary.has(b"Subtype2")
                        || dictionary.has(b"OPI")
                        || dictionary.has(b"PS")
                    {
                        findings.add(
                            "postscript",
                            "PostScript fragments and OPI references in forms are not permitted.",
                            false,
                            None,
                        );
                    }
                    if let Ok(bytes) = stream.decompressed_content_with_limit(MAX_STREAM_BYTES) {
                        let resources = Resources::for_form(doc, dictionary, &Resources::default());
                        scan_content(doc, &bytes, &resources, &mut colour, &mut fonts);
                    }
                }
                Some("PS") => findings.add(
                    "postscript",
                    "PostScript fragments and OPI references in forms are not permitted.",
                    false,
                    None,
                ),
                _ => {}
            }
            if dictionary.get(b"PatternType").and_then(Object::as_i64).ok() == Some(1) {
                if let Ok(bytes) = stream.decompressed_content_with_limit(MAX_STREAM_BYTES) {
                    let resources = Resources::for_form(doc, dictionary, &Resources::default());
                    scan_content(doc, &bytes, &resources, &mut colour, &mut fonts);
                }
            }
        }
        if dictionary.has(b"ShadingType") {
            if let Ok(space) = dictionary.get(b"ColorSpace") {
                colour.colour_space(doc, space);
            }
        }
        if dictionary.has(b"EF") {
            check_embedded_file(
                doc,
                dictionary,
                level,
                &catalog_af,
                Some(*id),
                &mut findings,
            );
        }
        if dictionary.has(b"FT") && dictionary.has(b"AA") {
            findings.add("additional-actions", ADDITIONAL_ACTIONS, true, None);
        }
        if (dictionary.has(b"S") && !dictionary.has(b"Type"))
            || name_of(dictionary, b"Type").as_deref() == Some("Action")
        {
            if let Some(kind) = action_kind(doc, object) {
                findings.add("actions", ACTIONS, true, Some(kind));
            }
        }
    }
    for font in fonts.values() {
        check_font(doc, font, level, &mut findings);
    }
    match has_pdfa_intent(doc) {
        None if colour.rgb || colour.cmyk || colour.gray => findings.add(
            "output-intent",
            "Documents that paint with device colours need a PDF/A output intent.",
            !colour.cmyk,
            None,
        ),
        Some(components) if (colour.rgb && components != 3) || (colour.cmyk && components != 4) => {
            findings.add(
                "output-intent-colour",
                "Device RGB colour needs an RGB output intent and device CMYK colour a CMYK one.",
                false,
                None,
            );
        }
        _ => {}
    }
    if colour.cmyk && has_pdfa_intent(doc).is_none() {
        findings.add("cmyk", "This document paints with device CMYK. NavPDF can add only an sRGB output intent, which does not cover CMYK.", false, None);
    }
    Ok(findings.into_list())
}

fn not_checked() -> Vec<String> {
    [
        "Glyph widths and character sets inside embedded fonts",
        "Transparency blending colour spaces",
        "Content inside Type 3 glyphs and annotation appearances other than colour",
        "Custom XMP schemas and extension schema descriptions",
        "Whether attachments are valid PDF/A beyond their identification",
    ]
    .into_iter()
    .map(String::from)
    .collect()
}

pub fn validate(bytes: &[u8], level: &str) -> Result<ValidationReport, String> {
    let level = Level::parse(level)?;
    let doc =
        Document::load_mem(bytes).map_err(|_| "The PDF could not be read by the local engine.")?;
    let declared = declared_pdfa(xmp(&doc).as_deref());
    if doc.trailer.has(b"Encrypt") {
        return Ok(ValidationReport {
            level: level.label(),
            declared,
            passed: false,
            findings: vec![Finding {
                rule: "encryption".into(),
                message: "PDF/A files must not be encrypted.".into(),
                count: 1,
                examples: Vec::new(),
                fixable: false,
            }],
            not_checked: not_checked(),
        });
    }
    let findings = check(&doc, level)?;
    Ok(ValidationReport {
        level: level.label(),
        declared,
        passed: findings.is_empty(),
        findings,
        not_checked: not_checked(),
    })
}

pub fn standards(bytes: &[u8]) -> Result<Standards, String> {
    let doc = load(bytes)?;
    let metadata = xmp(&doc);
    let pdfua = metadata
        .as_deref()
        .and_then(|xmp| xmp_property(xmp, "pdfuaid:part"))
        .map(|part| format!("PDF/UA-{part}"));
    let pdfx = info_text(&doc, b"GTS_PDFXVersion").or_else(|| {
        metadata
            .as_deref()
            .and_then(|xmp| xmp_property(xmp, "pdfxid:GTS_PDFXVersion"))
    });
    let output_intents = doc
        .catalog()
        .ok()
        .and_then(|catalog| catalog.get(b"OutputIntents").ok())
        .and_then(|intents| deref(&doc, intents).as_array().ok())
        .into_iter()
        .flatten()
        .filter_map(|intent| deref(&doc, intent).as_dict().ok())
        .map(|intent| {
            let profile = intent
                .get(b"DestOutputProfile")
                .ok()
                .and_then(|profile| deref(&doc, profile).as_stream().ok());
            let text = |key: &[u8]| {
                intent
                    .get(key)
                    .and_then(Object::as_str)
                    .map(decode_text)
                    .unwrap_or_default()
            };
            OutputIntentInfo {
                subtype: name_of(intent, b"S").unwrap_or_default(),
                condition: text(b"OutputConditionIdentifier"),
                info: text(b"Info"),
                has_profile: profile.is_some(),
                components: profile
                    .and_then(|profile| profile.dict.get(b"N").and_then(Object::as_i64).ok()),
            }
        })
        .collect();
    Ok(Standards {
        pdfa: declared_pdfa(metadata.as_deref()),
        pdfua,
        pdfx,
        output_intents,
    })
}

fn add_srgb_intent(doc: &mut Document) -> Result<(), String> {
    let mut profile = Stream::new(dictionary! { "N" => 3 }, icc::srgb_profile());
    let _ = profile.compress();
    let profile = doc.add_object(profile);
    let intent = doc.add_object(dictionary! {
        "Type" => "OutputIntent",
        "S" => "GTS_PDFA1",
        "OutputConditionIdentifier" => Object::string_literal("sRGB IEC61966-2.1"),
        "RegistryName" => Object::string_literal("http://www.color.org"),
        "Info" => Object::string_literal("sRGB IEC61966-2.1"),
        "DestOutputProfile" => profile,
    });
    let catalog = doc
        .catalog_mut()
        .map_err(|_| "The document catalog could not be updated.")?;
    let mut intents = match catalog.get(b"OutputIntents") {
        Ok(Object::Array(items)) => items.clone(),
        _ => Vec::new(),
    };
    intents.push(Object::Reference(intent));
    catalog.set("OutputIntents", intents);
    Ok(())
}

/// A PDF date such as `D:20261025103000+02'00'` as an XMP date.
fn xmp_date(text: &str) -> Option<String> {
    let digits = text.strip_prefix("D:").unwrap_or(text);
    let part = |range: std::ops::Range<usize>, fallback: &str| -> String {
        digits
            .get(range)
            .filter(|part| part.bytes().all(|byte| byte.is_ascii_digit()))
            .unwrap_or(fallback)
            .to_string()
    };
    if digits.len() < 4 || !digits[..4].bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let zone = match digits.get(14..15) {
        Some("+") | Some("-") => {
            let sign = &digits[14..15];
            let hours = part(15..17, "00");
            let minutes = part(18..20, "00");
            format!("{sign}{hours}:{minutes}")
        }
        _ => "Z".into(),
    };
    Some(format!(
        "{}-{}-{}T{}:{}:{}{zone}",
        part(0..4, "0000"),
        part(4..6, "01"),
        part(6..8, "01"),
        part(8..10, "00"),
        part(10..12, "00"),
        part(12..14, "00")
    ))
}

fn build_xmp(doc: &Document, level: Level, pdfua: Option<String>) -> String {
    let text = |key: &[u8]| info_text(doc, key).map(|value| escape_xml(value.trim()));
    let mut body = String::new();
    if let Some(title) = text(b"Title") {
        body.push_str(&format!("<dc:title><rdf:Alt><rdf:li xml:lang=\"x-default\">{title}</rdf:li></rdf:Alt></dc:title>"));
    }
    if let Some(author) = text(b"Author") {
        body.push_str(&format!(
            "<dc:creator><rdf:Seq><rdf:li>{author}</rdf:li></rdf:Seq></dc:creator>"
        ));
    }
    if let Some(subject) = text(b"Subject") {
        body.push_str(&format!("<dc:description><rdf:Alt><rdf:li xml:lang=\"x-default\">{subject}</rdf:li></rdf:Alt></dc:description>"));
    }
    for (key, property) in [
        (b"Keywords".as_slice(), "pdf:Keywords"),
        (b"Producer", "pdf:Producer"),
        (b"Creator", "xmp:CreatorTool"),
    ] {
        if let Some(value) = text(key) {
            body.push_str(&format!("<{property}>{value}</{property}>"));
        }
    }
    for (key, property) in [
        (b"CreationDate".as_slice(), "xmp:CreateDate"),
        (b"ModDate", "xmp:ModifyDate"),
    ] {
        if let Some(date) = info_text(doc, key).and_then(|date| xmp_date(&date)) {
            body.push_str(&format!("<{property}>{date}</{property}>"));
        }
    }
    let pdfua = pdfua
        .map(|part| format!("<pdfuaid:part>{}</pdfuaid:part>", escape_xml(&part)))
        .unwrap_or_default();
    format!(
        "<?xpacket begin=\"\u{FEFF}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\n\
<x:xmpmeta xmlns:x=\"adobe:ns:meta/\"><rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\
<rdf:Description rdf:about=\"\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:pdf=\"http://ns.adobe.com/pdf/1.3/\" \
xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\" xmlns:pdfaid=\"http://www.aiim.org/pdfa/ns/id/\" xmlns:pdfuaid=\"http://www.aiim.org/pdfua/ns/id/\">\
<pdfaid:part>{}</pdfaid:part><pdfaid:conformance>{}</pdfaid:conformance>{pdfua}{body}\
</rdf:Description></rdf:RDF></x:xmpmeta>\n<?xpacket end=\"w\"?>",
        level.part, level.conformance
    )
}

fn set_metadata(doc: &mut Document, xmp: String) -> Result<(), String> {
    let stream = doc.add_object(Stream::new(
        dictionary! { "Type" => "Metadata", "Subtype" => "XML" },
        xmp.into_bytes(),
    ));
    doc.catalog_mut()
        .map_err(|_| "The document catalog could not be updated.")?
        .set("Metadata", stream);
    Ok(())
}

/// Removes forbidden actions and additional actions from one dictionary.
fn strip_actions(doc: &Document, dictionary: &mut Dictionary) {
    dictionary.remove(b"AA");
    for key in [b"A".as_slice(), b"OpenAction", b"Next"] {
        let forbidden = dictionary
            .get(key)
            .ok()
            .is_some_and(|value| match deref(doc, value) {
                Object::Array(items) => items.iter().any(|item| action_kind(doc, item).is_some()),
                _ => action_kind(doc, value).is_some(),
            });
        if forbidden {
            dictionary.remove(key);
        }
    }
}

fn fix_annotation(dictionary: &mut Dictionary) {
    let flags = dictionary.get(b"F").and_then(Object::as_i64).unwrap_or(0);
    dictionary.set("F", (flags | PRINT_FLAG) & !HIDING_FLAGS);
    if let Ok(Object::Dictionary(appearance)) = dictionary.get_mut(b"AP") {
        appearance.remove(b"D");
        appearance.remove(b"R");
    }
}

/// Applies every fix NavPDF knows, leaving page content unchanged.
fn apply_fixes(doc: &mut Document, level: Level) -> Result<(), String> {
    doc.version = "1.7".into();
    ensure_file_id(doc)?;
    let objects = reachable(doc)?;
    let snapshot = doc.clone();
    let catalog_id = doc
        .trailer
        .get(b"Root")
        .and_then(Object::as_reference)
        .map_err(|_| "The document catalog could not be read.")?;
    let page_ids: HashSet<ObjectId> = doc.get_pages().into_values().collect();
    let mut filespecs = Vec::new();
    for id in objects {
        let Some(object) = doc.objects.get_mut(&id) else {
            continue;
        };
        if let Object::Stream(stream) = object {
            if stream
                .filters()
                .unwrap_or_default()
                .iter()
                .any(|filter| filter == b"LZWDecode")
                && stream.decompress_with_limit(MAX_STREAM_BYTES).is_ok()
            {
                let _ = stream.compress();
            }
        }
        let dictionary = match object {
            Object::Dictionary(dictionary) => dictionary,
            Object::Stream(stream) => &mut stream.dict,
            _ => continue,
        };
        if name_of(dictionary, b"Subtype").as_deref() == Some("Image") {
            dictionary.remove(b"Interpolate");
            dictionary.remove(b"Alternates");
            dictionary.remove(b"OPI");
        }
        let annotation = name_of(dictionary, b"Type").as_deref() == Some("Annot")
            || (dictionary.has(b"Subtype") && dictionary.has(b"Rect"));
        if annotation && name_of(dictionary, b"Subtype").as_deref() != Some("Popup") {
            fix_annotation(dictionary);
        }
        let outline = dictionary.has(b"Title") && dictionary.has(b"Parent");
        if annotation
            || outline
            || dictionary.has(b"FT")
            || page_ids.contains(&id)
            || id == catalog_id
        {
            strip_actions(&snapshot, dictionary);
        }
        if dictionary.has(b"EF") {
            filespecs.push(id);
            if level.part == 3 {
                if !dictionary.has(b"AFRelationship") {
                    dictionary.set("AFRelationship", Object::Name(b"Unspecified".to_vec()));
                }
                if !dictionary.has(b"UF") {
                    if let Ok(name) = dictionary.get(b"F").cloned() {
                        dictionary.set("UF", name);
                    }
                }
            }
        }
    }
    if level.part == 3 {
        for id in &filespecs {
            let stream_id = doc
                .get_dictionary(*id)
                .ok()
                .and_then(|filespec| filespec.get(b"EF").ok())
                .and_then(|ef| deref(doc, ef).as_dict().ok())
                .and_then(|ef| ef.get(b"F").and_then(Object::as_reference).ok());
            if let Some(Ok(Object::Stream(stream))) =
                stream_id.map(|stream| doc.get_object_mut(stream))
            {
                if !mime_type(&stream.dict) {
                    stream.dict.set(
                        "Subtype",
                        Object::Name(b"application/octet-stream".to_vec()),
                    );
                }
            }
        }
    }
    let associated = catalog_associated_files(doc);
    let catalog = doc
        .catalog_mut()
        .map_err(|_| "The document catalog could not be updated.")?;
    strip_actions(&snapshot, catalog);
    if let Ok(Object::Dictionary(names)) = catalog.get_mut(b"Names") {
        names.remove(b"JavaScript");
    }
    if let Ok(Object::Dictionary(form)) = catalog.get_mut(b"AcroForm") {
        form.remove(b"XFA");
        form.remove(b"NeedAppearances");
    }
    if let Ok(Object::Dictionary(properties)) = catalog.get_mut(b"OCProperties") {
        if let Ok(Object::Dictionary(default)) = properties.get_mut(b"D") {
            default.remove(b"AS");
            if !default.has(b"Name") {
                default.set("Name", Object::string_literal("Default"));
            }
        }
    }
    if level.part == 3 && !filespecs.is_empty() {
        let mut list: Vec<Object> = match catalog.get(b"AF") {
            Ok(Object::Array(items)) => items.clone(),
            _ => Vec::new(),
        };
        list.extend(
            filespecs
                .iter()
                .filter(|id| !associated.contains(id))
                .map(|id| Object::Reference(*id)),
        );
        catalog.set("AF", list);
    }
    // Referenced form, names and layer dictionaries are fixed through their own objects.
    for key in [b"AcroForm".as_slice(), b"Names", b"OCProperties"] {
        let Some(id) = doc
            .catalog()
            .ok()
            .and_then(|catalog| catalog.get(key).and_then(Object::as_reference).ok())
        else {
            continue;
        };
        if let Ok(dictionary) = doc.get_dictionary_mut(id) {
            dictionary.remove(b"XFA");
            dictionary.remove(b"NeedAppearances");
            dictionary.remove(b"JavaScript");
            if let Ok(Object::Dictionary(default)) = dictionary.get_mut(b"D") {
                default.remove(b"AS");
                if !default.has(b"Name") {
                    default.set("Name", Object::string_literal("Default"));
                }
            }
        }
    }
    let colour_findings = check(doc, level)?;
    if has_pdfa_intent(doc).is_none()
        && colour_findings
            .iter()
            .any(|finding| finding.rule == "output-intent")
    {
        add_srgb_intent(doc)?;
    }
    let pdfua = xmp(doc)
        .as_deref()
        .and_then(|xmp| xmp_property(xmp, "pdfuaid:part"));
    set_metadata(doc, build_xmp(doc, level, pdfua))
}

/// Removes PDF/A and PDF/UA identification from XMP and PDF/X keys from the information.
fn remove_identification(doc: &mut Document) -> Result<String, String> {
    let mut removed = Vec::new();
    if let Some(mut text) = xmp(doc) {
        let before = text.clone();
        for name in [
            "pdfaid:part",
            "pdfaid:conformance",
            "pdfaid:amd",
            "pdfaid:rev",
            "pdfuaid:part",
            "pdfuaid:rev",
        ] {
            while let Some(start) = text.find(&format!("<{name}>")) {
                let close = format!("</{name}>");
                let Some(end) = text[start..]
                    .find(&close)
                    .map(|offset| start + offset + close.len())
                else {
                    break;
                };
                text.replace_range(start..end, "");
            }
            for quote in ['"', '\''] {
                let attribute = format!(" {name}={quote}");
                while let Some(start) = text.find(&attribute) {
                    let value = start + attribute.len();
                    let Some(end) = text[value..].find(quote).map(|offset| value + offset + 1)
                    else {
                        break;
                    };
                    text.replace_range(start..end, "");
                }
            }
        }
        if text != before {
            removed.push("PDF/A and PDF/UA identification");
            set_metadata(doc, text)?;
        }
    }
    let info_id = doc.trailer.get(b"Info").and_then(Object::as_reference).ok();
    if let Some(Ok(info)) = info_id.map(|id| doc.get_dictionary_mut(id)) {
        let version = info.remove(b"GTS_PDFXVersion").is_some();
        let conformance = info.remove(b"GTS_PDFXConformance").is_some();
        if version || conformance {
            removed.push("PDF/X identification");
        }
    }
    if removed.is_empty() {
        return Err("The document declares no standards to remove.".into());
    }
    Ok(format!("Removed {}", removed.join(" and ")))
}

fn describe(findings: &[Finding]) -> String {
    findings
        .iter()
        .map(|finding| finding.message.as_str())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn apply(bytes: &[u8], edit: &StandardsEdit) -> Result<(Vec<u8>, StandardsReport), String> {
    let mut doc = load(bytes)?;
    let pages = doc.get_pages().len();
    let message = match edit {
        StandardsEdit::Convert { level } => {
            let level = Level::parse(level)?;
            let blockers: Vec<Finding> = check(&doc, level)?
                .into_iter()
                .filter(|finding| !finding.fixable)
                .collect();
            if !blockers.is_empty() {
                return Err(format!(
                    "The document cannot be converted to {}: {}",
                    level.label(),
                    describe(&blockers)
                ));
            }
            apply_fixes(&mut doc, level)?;
            let remaining = check(&doc, level)?;
            if !remaining.is_empty() {
                return Err(format!(
                    "The document cannot be converted to {}: {}",
                    level.label(),
                    describe(&remaining)
                ));
            }
            format!(
                "Converted to {}. Later edits can break conformance; check again before sharing.",
                level.label()
            )
        }
        StandardsEdit::AddOutputIntent => {
            if has_pdfa_intent(&doc).is_some() {
                return Err("The document already has a PDF/A output intent.".into());
            }
            add_srgb_intent(&mut doc)?;
            "Added an sRGB output intent".into()
        }
        StandardsEdit::RemoveIdentification => remove_identification(&mut doc)?,
    };
    let output = save(&mut doc)?;
    if load(&output)?.get_pages().len() != pages {
        return Err(
            "The converted copy has an unexpected page count. The document is unchanged.".into(),
        );
    }
    Ok((output, StandardsReport { message }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::content::tests::page_document;

    fn plain_pdf() -> Document {
        let (doc, _) = page_document("0 0 1 rg 10 10 100 100 re f", dictionary! {});
        doc
    }

    #[test]
    fn levels_parse_and_label() {
        assert_eq!(
            Level::parse("2b").unwrap(),
            Level {
                part: 2,
                conformance: 'B'
            }
        );
        assert_eq!(Level::parse("3A").unwrap().label(), "PDF/A-3a");
        for bad in ["1b", "2x", "", "2bb"] {
            assert!(Level::parse(bad).is_err());
        }
        assert_eq!(
            xmp_date("D:20261025103000+02'00'").as_deref(),
            Some("2026-10-25T10:30:00+02:00")
        );
        assert_eq!(xmp_date("D:2026").as_deref(), Some("2026-01-01T00:00:00Z"));
        assert_eq!(xmp_date("garbage"), None);
    }

    #[test]
    fn a_plain_document_converts_to_each_b_level_and_validates() {
        let mut doc = plain_pdf();
        let info = doc.add_object(dictionary! {
            "Title" => Object::string_literal("Quarterly <report> & notes"),
            "Author" => Object::string_literal("Synthetic Author"),
            "CreationDate" => Object::string_literal("D:20261025103000Z"),
        });
        doc.trailer.set("Info", info);
        let bytes = save(&mut doc).unwrap();
        let before = validate(&bytes, "2b").unwrap();
        assert!(!before.passed);
        let rules: Vec<&str> = before
            .findings
            .iter()
            .map(|finding| finding.rule.as_str())
            .collect();
        assert!(
            rules.contains(&"metadata") && rules.contains(&"output-intent"),
            "{rules:?}"
        );
        assert!(before.findings.iter().all(|finding| finding.fixable));

        for level in ["2b", "3b"] {
            let (converted, report) = apply(
                &bytes,
                &StandardsEdit::Convert {
                    level: level.into(),
                },
            )
            .unwrap();
            assert!(
                report.message.contains("Converted to PDF/A-"),
                "{}",
                report.message
            );
            let after = validate(&converted, level).unwrap();
            assert!(after.passed, "{level}: {:?}", after.findings);
            assert_eq!(
                after.declared.as_deref(),
                Some(format!("PDF/A-{level}").as_str())
            );
            let standards = standards(&converted).unwrap();
            assert_eq!(standards.output_intents.len(), 1);
            assert_eq!(standards.output_intents[0].components, Some(3));
            let text = xmp(&Document::load_mem(&converted).unwrap()).unwrap();
            assert!(
                text.contains("Quarterly &lt;report&gt; &amp; notes"),
                "{text}"
            );
            assert!(text.contains("<xmp:CreateDate>2026-10-25T10:30:00Z</xmp:CreateDate>"));
        }
    }

    #[test]
    fn unembedded_fonts_and_missing_tags_block_conversion() {
        let (mut doc, _) = page_document("BT /F1 12 Tf 72 700 Td (Hello) Tj ET", dictionary! {});
        let bytes = save(&mut doc).unwrap();
        let report = validate(&bytes, "2a").unwrap();
        let rules: Vec<&str> = report
            .findings
            .iter()
            .map(|finding| finding.rule.as_str())
            .collect();
        assert!(rules.contains(&"fonts-embedded"), "{rules:?}");
        assert!(
            rules.contains(&"tagged") && rules.contains(&"language"),
            "{rules:?}"
        );
        assert!(report
            .findings
            .iter()
            .any(|finding| finding.examples.contains(&"Helvetica".to_string())));
        let error = apply(&bytes, &StandardsEdit::Convert { level: "2b".into() }).unwrap_err();
        assert!(error.contains("must be embedded"), "{error}");
    }

    #[test]
    fn actions_flags_images_forms_and_attachments_are_fixed() {
        let (mut doc, page) = page_document("q 10 0 0 10 0 0 cm /Im1 Do Q", dictionary! {});
        let image = doc.add_object(Stream::new(
            dictionary! { "Type" => "XObject", "Subtype" => "Image", "Width" => 1, "Height" => 1,
            "ColorSpace" => "DeviceGray", "BitsPerComponent" => 8, "Interpolate" => true },
            vec![0],
        ));
        let appearance = doc.add_object(Stream::new(dictionary! { "Type" => "XObject", "Subtype" => "Form", "BBox" => vec![0.into(), 0.into(), 10.into(), 10.into()] }, vec![]));
        let note = doc.add_object(dictionary! {
            "Type" => "Annot", "Subtype" => "Square", "F" => 2,
            "Rect" => vec![0.into(), 0.into(), 10.into(), 10.into()],
            "AP" => dictionary! { "N" => appearance, "D" => appearance },
            "AA" => dictionary! {},
        });
        let link = doc.add_object(dictionary! {
            "Type" => "Annot", "Subtype" => "Link", "F" => 4,
            "Rect" => vec![0.into(), 0.into(), 10.into(), 10.into()],
            "A" => dictionary! { "S" => "JavaScript", "JS" => Object::string_literal("app.alert(1)") },
        });
        let attachment = doc.add_object(Stream::new(
            dictionary! { "Type" => "EmbeddedFile" },
            b"plain text".to_vec(),
        ));
        let filespec = doc.add_object(dictionary! {
            "Type" => "Filespec", "F" => Object::string_literal("notes.txt"),
            "EF" => dictionary! { "F" => attachment },
        });
        let page_dictionary = doc.get_dictionary_mut(page).unwrap();
        page_dictionary.set("Annots", vec![note.into(), link.into()]);
        page_dictionary
            .get_mut(b"Resources")
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("XObject", dictionary! { "Im1" => image });
        let catalog = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
        let catalog = doc.get_dictionary_mut(catalog).unwrap();
        catalog.set(
            "OpenAction",
            dictionary! { "S" => "Launch", "F" => Object::string_literal("app.exe") },
        );
        catalog.set("Names", dictionary! {
            "EmbeddedFiles" => dictionary! { "Names" => vec![Object::string_literal("notes.txt"), filespec.into()] },
            "JavaScript" => dictionary! { "Names" => vec![] },
        });
        let bytes = save(&mut doc).unwrap();

        let report = validate(&bytes, "3b").unwrap();
        let rules: BTreeSet<&str> = report
            .findings
            .iter()
            .map(|finding| finding.rule.as_str())
            .collect();
        for rule in [
            "actions",
            "additional-actions",
            "annotation-flags",
            "appearance-states",
            "image-interpolation",
            "javascript",
            "associated-files",
            "output-intent",
        ] {
            assert!(rules.contains(rule), "{rule} in {rules:?}");
        }
        let two = validate(&bytes, "2b").unwrap();
        assert!(two
            .findings
            .iter()
            .any(|finding| finding.rule == "embedded-files" && !finding.fixable));
        assert!(
            apply(&bytes, &StandardsEdit::Convert { level: "2b".into() })
                .unwrap_err()
                .contains("PDF/A-3")
        );

        let (converted, _) = apply(&bytes, &StandardsEdit::Convert { level: "3b".into() }).unwrap();
        let after = validate(&converted, "3b").unwrap();
        assert!(after.passed, "{:?}", after.findings);
        let doc = Document::load_mem(&converted).unwrap();
        let catalog = doc.catalog().unwrap();
        assert!(!catalog.has(b"OpenAction"));
        assert_eq!(catalog.get(b"AF").unwrap().as_array().unwrap().len(), 1);
        let note = doc.get_dictionary(note).unwrap();
        assert_eq!(note.get(b"F").unwrap().as_i64().unwrap(), 4);
        assert!(!note.get(b"AP").unwrap().as_dict().unwrap().has(b"D"));
        assert!(!doc.get_dictionary(link).unwrap().has(b"A"));
        assert!(!doc
            .get_object(image)
            .unwrap()
            .as_stream()
            .unwrap()
            .dict
            .has(b"Interpolate"));
        assert_eq!(
            doc.get_dictionary(filespec)
                .unwrap()
                .get(b"AFRelationship")
                .unwrap()
                .as_name()
                .unwrap(),
            b"Unspecified"
        );
        let embedded = doc.get_object(attachment).unwrap().as_stream().unwrap();
        assert_eq!(
            embedded.dict.get(b"Subtype").unwrap().as_name().unwrap(),
            b"application/octet-stream"
        );
        assert!(!mime_type(&dictionary! { "Subtype" => "octet" }));
    }

    #[test]
    fn cmyk_documents_need_their_own_output_intent() {
        let (mut doc, _) = page_document("0 0 0 1 k 10 10 50 50 re f", dictionary! {});
        let bytes = save(&mut doc).unwrap();
        let report = validate(&bytes, "2b").unwrap();
        assert!(report
            .findings
            .iter()
            .any(|finding| finding.rule == "cmyk" && !finding.fixable));
        assert!(
            apply(&bytes, &StandardsEdit::Convert { level: "2b".into() })
                .unwrap_err()
                .contains("CMYK")
        );
        let (with_intent, _) = apply(&bytes, &StandardsEdit::AddOutputIntent).unwrap();
        assert!(validate(&with_intent, "2b")
            .unwrap()
            .findings
            .iter()
            .any(|finding| finding.rule == "output-intent-colour"));
        assert!(apply(&with_intent, &StandardsEdit::AddOutputIntent)
            .unwrap_err()
            .contains("already"));
    }

    #[test]
    fn identification_is_listed_and_removed() {
        let mut doc = plain_pdf();
        let bytes = save(&mut doc).unwrap();
        let (converted, _) = apply(&bytes, &StandardsEdit::Convert { level: "2b".into() }).unwrap();
        let mut doc = Document::load_mem(&converted).unwrap();
        let text = xmp(&doc).unwrap().replace(
            "</pdfaid:conformance>",
            "</pdfaid:conformance><pdfuaid:part>1</pdfuaid:part>",
        );
        set_metadata(&mut doc, text).unwrap();
        let info =
            doc.add_object(dictionary! { "GTS_PDFXVersion" => Object::string_literal("PDF/X-4") });
        doc.trailer.set("Info", info);
        let marked = save(&mut doc).unwrap();
        let listed = standards(&marked).unwrap();
        assert_eq!(listed.pdfa.as_deref(), Some("PDF/A-2b"));
        assert_eq!(listed.pdfua.as_deref(), Some("PDF/UA-1"));
        assert_eq!(listed.pdfx.as_deref(), Some("PDF/X-4"));

        let (cleared, report) = apply(&marked, &StandardsEdit::RemoveIdentification).unwrap();
        assert!(report.message.contains("PDF/A and PDF/UA") && report.message.contains("PDF/X"));
        let listed = standards(&cleared).unwrap();
        assert!(listed.pdfa.is_none() && listed.pdfua.is_none() && listed.pdfx.is_none());
        assert_eq!(listed.output_intents.len(), 1, "the output intent stays");
        assert!(apply(&cleared, &StandardsEdit::RemoveIdentification).is_err());
        // Attribute-style identification is removed too.
        assert!(xmp_property("<d pdfaid:part=\"3\"/>", "pdfaid:part").as_deref() == Some("3"));
    }
}
