//! Finds text with a regular expression the user typed, for marking redactions.
//!
//! The expression uses the `regex` crate's syntax and always matches in time linear in the
//! text: look-around and back-references do not exist, and the compiled size and nesting are
//! capped. An expression that can match nothing at all (the empty string) is refused, because
//! it would mark every position. Neither the expression nor the text is logged.

use regex::RegexBuilder;
use serde::Deserialize;

/// The longest expression accepted, in bytes.
pub const MAX_PATTERN_BYTES: usize = 1024;
/// The compiled program's size limit and the deepest nesting of groups.
const MAX_COMPILED_BYTES: usize = 1024 * 1024;
const MAX_NESTING: u32 = 50;
/// The most text searched in one request and the most matches returned.
const MAX_TEXT_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_MATCHES: usize = 10_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternRequest {
    pub pattern: String,
    #[serde(default)]
    pub case_insensitive: bool,
    /// One string per page.
    pub texts: Vec<String>,
}

/// Matches in each text as `[start, end)` offsets counted in UTF-16 code units, the unit the
/// renderer's strings use.
pub fn find(request: &PatternRequest) -> Result<Vec<Vec<[u32; 2]>>, String> {
    let pattern = request.pattern.as_str();
    if pattern.trim().is_empty() {
        return Err("Type a regular expression to search for.".into());
    }
    if pattern.len() > MAX_PATTERN_BYTES {
        return Err(format!(
            "Regular expressions can be up to {MAX_PATTERN_BYTES} bytes long."
        ));
    }
    if request.texts.iter().map(String::len).sum::<usize>() > MAX_TEXT_BYTES {
        return Err("This document has too much text to search at once.".into());
    }
    let expression = RegexBuilder::new(pattern)
        .case_insensitive(request.case_insensitive)
        .size_limit(MAX_COMPILED_BYTES)
        .dfa_size_limit(MAX_COMPILED_BYTES)
        .nest_limit(MAX_NESTING)
        .build()
        .map_err(|error| match error {
            regex::Error::CompiledTooBig(_) => {
                "This regular expression is too large. Use smaller repetition counts.".to_string()
            }
            _ => "This regular expression is not valid. Look-around and back-references are not supported.".to_string(),
        })?;
    if expression.is_match("") {
        return Err(
            "This regular expression also matches nothing at all. Require at least one character."
                .into(),
        );
    }
    let mut total = 0_usize;
    let mut pages = Vec::with_capacity(request.texts.len());
    for text in &request.texts {
        let mut matches = Vec::new();
        // Matches come in order, so one pass converts byte offsets to UTF-16 offsets.
        let mut byte = 0_usize;
        let mut units = 0_u32;
        for found in expression.find_iter(text) {
            total += 1;
            if total > MAX_MATCHES {
                return Err(format!(
                    "This regular expression matches more than {MAX_MATCHES} times. Make it more specific."
                ));
            }
            units += text[byte..found.start()].encode_utf16().count() as u32;
            let length = found.as_str().encode_utf16().count() as u32;
            matches.push([units, units + length]);
            units += length;
            byte = found.end();
        }
        pages.push(matches);
    }
    Ok(pages)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(pattern: &str, texts: &[&str]) -> PatternRequest {
        PatternRequest {
            pattern: pattern.into(),
            case_insensitive: false,
            texts: texts.iter().map(|text| text.to_string()).collect(),
        }
    }

    #[test]
    fn matches_are_reported_per_text_in_utf16_units() {
        let found = find(&request(
            r"[A-Z]{2}-\d{4}",
            &["Ref AB-1234 and CD-5678.", "none", "日本😀 EF-9012"],
        ))
        .unwrap();
        assert_eq!(found[0], vec![[4, 11], [16, 23]]);
        assert!(found[1].is_empty());
        // Two BMP characters, one surrogate pair and a space come before the match.
        assert_eq!(found[2], vec![[5, 12]]);
        let units: Vec<u16> = "日本😀 EF-9012".encode_utf16().collect();
        assert_eq!(String::from_utf16(&units[5..12]).unwrap(), "EF-9012");
    }

    #[test]
    fn case_can_be_ignored() {
        let mut wanted = request("invoice", &["Invoice INVOICE invoice"]);
        assert_eq!(find(&wanted).unwrap()[0].len(), 1);
        wanted.case_insensitive = true;
        assert_eq!(find(&wanted).unwrap()[0].len(), 3);
    }

    #[test]
    fn unsafe_or_unusable_expressions_are_refused() {
        let text = &["aaaa"];
        for pattern in ["", "   ", "(", r"(?=a)a", r"(a)\1", "a*", "x?", "(?:)"] {
            assert!(find(&request(pattern, text)).is_err(), "{pattern:?}");
        }
        assert!(find(&request(&"a".repeat(MAX_PATTERN_BYTES + 1), text))
            .unwrap_err()
            .contains("bytes long"));
        assert!(find(&request(r"(?:\pL{1000}){1000}", text))
            .unwrap_err()
            .contains("too large"));
        assert!(find(&request(
            &format!("{}a{}", "(".repeat(60), ")".repeat(60)),
            text
        ))
        .is_err());
    }

    #[test]
    fn nested_repetition_runs_in_linear_time() {
        // A backtracking engine needs exponential time for this; here it returns at once.
        let text = format!("{}!", "a".repeat(50_000));
        let started = std::time::Instant::now();
        let found = find(&request(r"(a+)+$", &[&text])).unwrap();
        assert!(found[0].is_empty());
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
    }

    #[test]
    fn too_many_matches_stop_the_search() {
        let text = "a ".repeat(MAX_MATCHES + 1);
        assert!(find(&request("a", &[&text]))
            .unwrap_err()
            .contains("more specific"));
    }
}
