//! Saved guided actions: named sequences of document steps kept in preferences. The renderer
//! runs them; this module only checks that what it stores is well formed.

use serde::{Deserialize, Serialize};

const MAX_ACTIONS: usize = 50;
const MAX_STEPS: usize = 20;
const MAX_NAME_CHARS: usize = 80;
const MAX_TEXT_CHARS: usize = 256;

#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SavedAction {
    pub id: String,
    pub name: String,
    pub steps: Vec<ActionStep>,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ActionStep {
    Watermark {
        text: String,
        opacity: f32,
        font_size: f32,
    },
    HeaderFooter {
        header: String,
        footer: String,
    },
    /// Empty values leave the document's own value.
    Metadata {
        title: String,
        author: String,
        subject: String,
        keywords: String,
    },
    Flatten,
    RemoveHidden,
    Compress {
        preset: String,
    },
    Ocr {
        language: String,
        skip_text_pages: bool,
    },
    Autotag,
    Pdfa {
        level: String,
    },
}

fn text_ok(text: &str, limit: usize) -> bool {
    text.chars().count() <= limit && !text.chars().any(char::is_control)
}

fn step_ok(step: &ActionStep) -> bool {
    match step {
        ActionStep::Watermark {
            text,
            opacity,
            font_size,
        } => {
            !text.trim().is_empty()
                && text_ok(text, MAX_TEXT_CHARS)
                && (0.05..=1.0).contains(opacity)
                && (6.0..=200.0).contains(font_size)
        }
        ActionStep::HeaderFooter { header, footer } => {
            !(header.trim().is_empty() && footer.trim().is_empty())
                && text_ok(header, MAX_TEXT_CHARS)
                && text_ok(footer, MAX_TEXT_CHARS)
        }
        ActionStep::Metadata {
            title,
            author,
            subject,
            keywords,
        } => [title, author, subject, keywords]
            .iter()
            .all(|value| text_ok(value, MAX_TEXT_CHARS)),
        ActionStep::Compress { preset } => {
            ["lossless", "balanced", "small"].contains(&preset.as_str())
        }
        ActionStep::Ocr { language, .. } => {
            (2..=16).contains(&language.len())
                && language
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        }
        ActionStep::Pdfa { level } => crate::engine::pdfa::Level::parse(level).is_ok(),
        ActionStep::Flatten | ActionStep::RemoveHidden | ActionStep::Autotag => true,
    }
}

/// Checks saved actions before they are written to settings.
pub fn validate(actions: &[SavedAction]) -> Result<(), String> {
    if actions.len() > MAX_ACTIONS {
        return Err(format!("Up to {MAX_ACTIONS} actions can be saved."));
    }
    let mut ids = std::collections::HashSet::new();
    for action in actions {
        let id_ok = (1..=64).contains(&action.id.len())
            && action
                .id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-');
        if !id_ok || !ids.insert(action.id.as_str()) {
            return Err("Invalid action identifier.".into());
        }
        if action.name.trim().is_empty() || !text_ok(&action.name, MAX_NAME_CHARS) {
            return Err("Action names need 1 to 80 characters without control characters.".into());
        }
        if action.steps.is_empty() || action.steps.len() > MAX_STEPS {
            return Err(format!("An action needs 1 to {MAX_STEPS} steps."));
        }
        if !action.steps.iter().all(step_ok) {
            return Err(format!(
                "A step in \"{}\" has invalid options.",
                action.name
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn action(steps: Vec<ActionStep>) -> SavedAction {
        SavedAction {
            id: "a1".into(),
            name: "Archive".into(),
            steps,
        }
    }

    #[test]
    fn steps_round_trip_through_their_json_shape() {
        let json = r#"[{"id":"a1","name":"Archive","steps":[
            {"kind":"removeHidden"},
            {"kind":"watermark","text":"DRAFT","opacity":0.3,"fontSize":48},
            {"kind":"ocr","language":"en-US","skipTextPages":true},
            {"kind":"pdfa","level":"2b"}]}]"#;
        let actions: Vec<SavedAction> = serde_json::from_str(json).unwrap();
        assert_eq!(actions[0].steps.len(), 4);
        validate(&actions).unwrap();
        let written = serde_json::to_string(&actions).unwrap();
        assert!(written.contains(r#""kind":"removeHidden""#), "{written}");
        assert!(written.contains(r#""fontSize":48.0"#), "{written}");
        assert!(written.contains(r#""skipTextPages":true"#), "{written}");
        assert!(serde_json::from_str::<Vec<SavedAction>>(
            r#"[{"id":"a","name":"x","steps":[{"kind":"script"}]}]"#
        )
        .is_err());
    }

    #[test]
    fn invalid_actions_are_refused() {
        let watermark = |text: &str, opacity: f32| ActionStep::Watermark {
            text: text.into(),
            opacity,
            font_size: 40.0,
        };
        for bad in [
            action(vec![]),
            action(vec![watermark("", 0.5)]),
            action(vec![watermark("DRAFT", 2.0)]),
            action(vec![watermark("A\nB", 0.5)]),
            action(vec![ActionStep::Compress {
                preset: "tiny".into(),
            }]),
            action(vec![ActionStep::Pdfa { level: "1b".into() }]),
            action(vec![ActionStep::Ocr {
                language: "en US".into(),
                skip_text_pages: false,
            }]),
            action(vec![ActionStep::HeaderFooter {
                header: " ".into(),
                footer: String::new(),
            }]),
            action(vec![ActionStep::Autotag; MAX_STEPS + 1]),
            SavedAction {
                name: " ".into(),
                ..action(vec![ActionStep::Flatten])
            },
            SavedAction {
                id: "../x".into(),
                ..action(vec![ActionStep::Flatten])
            },
        ] {
            assert!(validate(std::slice::from_ref(&bad)).is_err(), "{bad:?}");
        }
        let one = action(vec![ActionStep::Flatten]);
        assert!(
            validate(&[one.clone(), one]).is_err(),
            "identifiers are unique"
        );
    }
}
