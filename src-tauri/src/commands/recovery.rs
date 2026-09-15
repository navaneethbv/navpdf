//! Per-document recovery copies stored as `recovery/<document id>.pdf` with a JSON sidecar, so
//! autosave, save and discard for one document never touch another document's entry.

use crate::filesystem;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

const DIRECTORY: &str = "recovery";
const LEGACY_PDF: &str = "recovery.pdf";
const LEGACY_JSON: &str = "recovery.json";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryEntry {
    pub id: String,
    pub name: String,
    pub pages: u32,
    pub saved_at: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyRecovery {
    name: String,
    saved_at: u64,
}

fn directory(root: &Path) -> PathBuf {
    root.join(DIRECTORY)
}

fn files(root: &Path, id: &str) -> Result<(PathBuf, PathBuf), String> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("Invalid recovery identifier.".into());
    }
    let dir = directory(root);
    Ok((
        dir.join(format!("{id}.pdf")),
        dir.join(format!("{id}.json")),
    ))
}

fn ensure_directory(root: &Path) -> Result<(), String> {
    let dir = directory(root);
    fs::create_dir_all(&dir).map_err(|_| "Recovery storage is unavailable.")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Unable to protect recovery storage.")?;
    }
    Ok(())
}

/// Validates and writes or replaces the recovery copy for one document.
pub fn write(root: &Path, entry: &RecoveryEntry, bytes: &[u8]) -> Result<(), String> {
    let (pdf, json) = files(root, &entry.id)?;
    ensure_directory(root)?;
    let previous = if pdf.exists() {
        Some(filesystem::fingerprint(&pdf)?)
    } else {
        None
    };
    filesystem::atomic_save(&pdf, bytes, entry.pages, previous.as_deref())?;
    filesystem::private_json(&json, entry)
}

/// Removes one document's recovery copy; a missing entry is not an error.
pub fn discard(root: &Path, id: &str) -> Result<(), String> {
    let (pdf, json) = files(root, id)?;
    for path in [pdf, json] {
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(_) => return Err("The recovery copy could not be removed.".into()),
        }
    }
    Ok(())
}

/// Recovery entries newest first, migrating the single legacy copy on first use.
pub fn list(root: &Path) -> Vec<RecoveryEntry> {
    migrate_legacy(root);
    let Ok(items) = fs::read_dir(directory(root)) else {
        return Vec::new();
    };
    let mut entries: Vec<RecoveryEntry> = items
        .flatten()
        .filter_map(|item| {
            let path = item.path();
            if path.extension()? != "json" {
                return None;
            }
            let stem = path.file_stem()?.to_str()?;
            let entry: RecoveryEntry = serde_json::from_slice(&fs::read(&path).ok()?).ok()?;
            let (pdf, _) = files(root, stem).ok()?;
            (entry.id == stem && pdf.is_file()).then_some(entry)
        })
        .collect();
    entries.sort_by(|a, b| b.saved_at.cmp(&a.saved_at).then_with(|| a.id.cmp(&b.id)));
    entries
}

/// The recovery copy to open for an entry id.
pub fn path_for(root: &Path, id: &str) -> Result<PathBuf, String> {
    let (pdf, _) = files(root, id)?;
    if pdf.is_file() {
        Ok(pdf)
    } else {
        Err("This recovery copy is no longer available.".into())
    }
}

/// The entry id when `path` is a recovery copy, so saving it elsewhere can retire the entry.
pub fn entry_for(root: &Path, path: &Path) -> Option<String> {
    if path.parent()? != directory(root) || path.extension()? != "pdf" {
        return None;
    }
    let stem = path.file_stem()?.to_str()?;
    files(root, stem).ok().map(|_| stem.to_owned())
}

/// Moves the single `recovery.pdf` written by earlier versions into a keyed entry. An
/// unreadable legacy copy is left in place rather than discarded.
fn migrate_legacy(root: &Path) {
    let legacy_pdf = root.join(LEGACY_PDF);
    if !legacy_pdf.is_file() {
        return;
    }
    let legacy_json = root.join(LEGACY_JSON);
    let metadata = fs::read(&legacy_json)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<LegacyRecovery>(&bytes).ok());
    let pages = lopdf::Document::load(&legacy_pdf)
        .map(|doc| doc.get_pages().len())
        .ok()
        .and_then(|count| u32::try_from(count).ok())
        .filter(|count| *count > 0);
    let Some(pages) = pages else {
        return;
    };
    if ensure_directory(root).is_err() {
        return;
    }
    let (name, saved_at) = metadata.map_or_else(
        || ("Recovered document.pdf".to_owned(), 0),
        |legacy| (legacy.name, legacy.saved_at),
    );
    let entry = RecoveryEntry {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        pages,
        saved_at,
    };
    let Ok((pdf, json)) = files(root, &entry.id) else {
        return;
    };
    if filesystem::private_json(&json, &entry).is_err() {
        return;
    }
    if fs::rename(&legacy_pdf, &pdf).is_err() {
        let _ = fs::remove_file(&json);
        return;
    }
    let _ = fs::remove_file(legacy_json);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::filesystem::tests::fixture;

    fn entry(id: &str, saved_at: u64) -> RecoveryEntry {
        RecoveryEntry {
            id: id.into(),
            name: format!("{id}.pdf"),
            pages: 1,
            saved_at,
        }
    }

    fn ids(root: &Path) -> Vec<String> {
        list(root).into_iter().map(|entry| entry.id).collect()
    }

    #[test]
    fn entries_are_isolated_per_document_and_listed_newest_first() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), &entry("doc-a", 100), &fixture()).unwrap();
        write(root.path(), &entry("doc-b", 200), &fixture()).unwrap();
        write(root.path(), &entry("doc-a", 300), &fixture()).unwrap();
        assert_eq!(ids(root.path()), ["doc-a", "doc-b"]);

        discard(root.path(), "doc-a").unwrap();
        discard(root.path(), "doc-a").unwrap();
        assert_eq!(list(root.path()), vec![entry("doc-b", 200)]);
        assert!(path_for(root.path(), "doc-a").is_err());
        assert_eq!(
            fs::read(path_for(root.path(), "doc-b").unwrap()).unwrap(),
            fixture()
        );
    }

    #[test]
    fn invalid_ids_and_invalid_output_create_no_entries() {
        let root = tempfile::tempdir().unwrap();
        assert!(write(root.path(), &entry("../escape", 1), &fixture()).is_err());
        assert!(discard(root.path(), "../escape").is_err());
        assert!(path_for(root.path(), "../escape").is_err());
        assert!(write(root.path(), &entry("doc", 1), b"not a pdf").is_err());
        let mut wrong_pages = entry("doc", 1);
        wrong_pages.pages = 3;
        assert!(write(root.path(), &wrong_pages, &fixture()).is_err());
        assert!(list(root.path()).is_empty());
    }

    #[test]
    fn the_legacy_single_recovery_copy_becomes_a_keyed_entry() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join(LEGACY_PDF), fixture()).unwrap();
        fs::write(
            root.path().join(LEGACY_JSON),
            br#"{"name":"Old.pdf","savedAt":42}"#,
        )
        .unwrap();
        let entries = list(root.path());
        assert_eq!(entries.len(), 1);
        assert_eq!(
            (
                entries[0].name.as_str(),
                entries[0].pages,
                entries[0].saved_at
            ),
            ("Old.pdf", 1, 42)
        );
        assert!(!root.path().join(LEGACY_PDF).exists());
        assert!(!root.path().join(LEGACY_JSON).exists());
        let copy = path_for(root.path(), &entries[0].id).unwrap();
        assert_eq!(fs::read(&copy).unwrap(), fixture());
        assert_eq!(entry_for(root.path(), &copy), Some(entries[0].id.clone()));
        assert_eq!(entry_for(root.path(), &root.path().join("Old.pdf")), None);
    }
}
