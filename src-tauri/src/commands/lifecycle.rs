//! Document lifecycle: reverting to the saved file, noticing changes made to it by other
//! applications and reopening the documents of the last session.

use super::{document, filesystem, opened, recovery, AppState, Descriptor, Opened};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::SystemTime,
};
use tauri::{AppHandle, Manager};

/// Size and modification time of a file, compared before hashing it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct SourceStamp {
    length: u64,
    modified: Option<SystemTime>,
}

pub fn stamp(path: &Path) -> Option<SourceStamp> {
    let metadata = fs::metadata(path).ok()?;
    Some(SourceStamp {
        length: metadata.len(),
        modified: metadata.modified().ok(),
    })
}

static SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub fn next_sequence() -> u64 {
    SEQUENCE.fetch_add(1, Ordering::Relaxed)
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionEntry {
    pub path: PathBuf,
    pub page: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDocument {
    pub descriptor: Descriptor,
    pub page: u32,
}

#[derive(Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SourceStatus {
    /// The file on disk no longer matches the version this document was opened or saved from.
    pub changed: bool,
    /// The file was moved, deleted or cannot be read.
    pub missing: bool,
}

/// The saved file behind a document, or None for an unsaved import or a recovery copy.
fn saved_source(root: &Path, doc: &Opened) -> Result<Option<(PathBuf, Vec<u8>)>, String> {
    let source = doc
        .source
        .lock()
        .map_err(|_| "Document state unavailable.")?
        .clone();
    if source.0 == doc._snapshot.path() || recovery::entry_for(root, &source.0).is_some() {
        return Ok(None);
    }
    Ok(Some(source))
}

/// Compares the saved file with the version the document came from. Only a size or time
/// change leads to hashing, and a matching hash refreshes the stamp.
pub fn source_status_of(root: &Path, doc: &Opened) -> Result<SourceStatus, String> {
    let unchanged = SourceStatus {
        changed: false,
        missing: false,
    };
    let Some((path, hash)) = saved_source(root, doc)? else {
        return Ok(unchanged);
    };
    let Some(current) = stamp(&path) else {
        return Ok(SourceStatus {
            changed: false,
            missing: true,
        });
    };
    let mut known = doc
        .stamp
        .lock()
        .map_err(|_| "Document state unavailable.")?;
    if *known == Some(current) {
        return Ok(unchanged);
    }
    let Ok(fingerprint) = filesystem::fingerprint(&path) else {
        return Ok(SourceStatus {
            changed: false,
            missing: true,
        });
    };
    if fingerprint == hash {
        *known = Some(current);
        return Ok(unchanged);
    }
    Ok(SourceStatus {
        changed: true,
        missing: false,
    })
}

#[tauri::command]
pub async fn source_status(app: AppHandle, id: String) -> Result<SourceStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let doc = document(&state, &id)?;
        source_status_of(&state.root, &doc)
    })
    .await
    .map_err(|_| "The file could not be checked.")?
}

/// Opens the saved file behind a document again, for Revert and for reloading a changed file.
/// The caller replaces the open document with the result.
#[tauri::command]
pub async fn reopen_document(app: AppHandle, id: String) -> Result<Descriptor, String> {
    tauri::async_runtime::spawn_blocking(move || reopen(&app.state::<AppState>(), &id))
        .await
        .map_err(|_| "The saved file could not be opened.")?
}

fn reopen(state: &AppState, id: &str) -> Result<Descriptor, String> {
    let doc = document(state, id)?;
    let (path, _) = saved_source(&state.root, &doc)?
        .ok_or("This document has no saved file to go back to. Use Save As to keep it.")?;
    let page = *doc.page.lock().map_err(|_| "Document state unavailable.")?;
    let descriptor = opened(state, path, false)?;
    if let Ok(reopened) = document(state, &descriptor.id) {
        if let Ok(mut current) = reopened.page.lock() {
            *current = page;
        }
    }
    Ok(descriptor)
}

/// The saved documents now open, in opening order, with the page each last showed.
fn open_session(state: &AppState) -> Result<Vec<SessionEntry>, String> {
    let documents = state
        .documents
        .lock()
        .map_err(|_| "Document state unavailable.")?;
    let mut open: Vec<_> = documents.values().cloned().collect();
    drop(documents);
    open.sort_by_key(|doc| doc.sequence);
    let mut entries: Vec<SessionEntry> = Vec::new();
    for doc in open {
        let Some((path, _)) = saved_source(&state.root, &doc)? else {
            continue;
        };
        if entries.iter().any(|entry| entry.path == path) {
            continue;
        }
        let page = *doc.page.lock().map_err(|_| "Document state unavailable.")?;
        entries.push(SessionEntry { path, page });
    }
    Ok(entries)
}

/// Records the documents open as NavPDF closes, or clears the record when reopening is off.
pub fn record_session(state: &AppState) -> Result<(), String> {
    let entries = open_session(state)?;
    let mut local = state.local.lock().map_err(|_| "Settings unavailable.")?;
    let session = if local.preferences.reopen_session {
        entries
    } else {
        Vec::new()
    };
    if local.session == session {
        return Ok(());
    }
    local.session = session;
    filesystem::private_json(&state.root.join("settings.json"), &*local)
}

/// Opens the documents of the last session once, skipping files that are gone or unreadable.
pub fn restore_session(state: &AppState) -> Result<(Vec<SessionDocument>, usize), String> {
    let entries = {
        let mut local = state.local.lock().map_err(|_| "Settings unavailable.")?;
        if !local.preferences.reopen_session || local.session.is_empty() {
            return Ok((Vec::new(), 0));
        }
        let entries = std::mem::take(&mut local.session);
        filesystem::private_json(&state.root.join("settings.json"), &*local)?;
        entries
    };
    let mut documents = Vec::new();
    let mut skipped = 0;
    for entry in entries {
        match opened(state, entry.path, true) {
            Ok(descriptor) => {
                if let Ok(doc) = document(state, &descriptor.id) {
                    if let Ok(mut page) = doc.page.lock() {
                        *page = entry.page;
                    }
                }
                documents.push(SessionDocument {
                    descriptor,
                    page: entry.page,
                });
            }
            Err(_) => skipped += 1,
        }
    }
    Ok((documents, skipped))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredSession {
    pub documents: Vec<SessionDocument>,
    /// Documents of the last session that could not be opened again.
    pub skipped: usize,
}

#[tauri::command]
pub async fn reopen_session(app: AppHandle) -> Result<RestoredSession, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (documents, skipped) = restore_session(&app.state::<AppState>())?;
        Ok(RestoredSession { documents, skipped })
    })
    .await
    .map_err(|_| "The last session could not be reopened.")?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::{engine, imported, LocalData};
    use std::{collections::HashMap, sync::Mutex};

    fn state(root: &Path) -> AppState {
        AppState {
            documents: Mutex::new(HashMap::new()),
            local: Mutex::new(LocalData::default()),
            root: root.to_path_buf(),
            dirty: Mutex::new(false),
            saving: Mutex::new(false),
            engine: engine::EngineState::default(),
        }
    }

    fn status(state: &AppState, id: &str) -> SourceStatus {
        source_status_of(&state.root, &document(state, id).unwrap()).unwrap()
    }

    const UNCHANGED: SourceStatus = SourceStatus {
        changed: false,
        missing: false,
    };

    #[test]
    fn source_changes_are_found_by_content_not_timestamps() {
        let root = tempfile::tempdir().unwrap();
        let files = tempfile::tempdir().unwrap();
        let state = state(root.path());
        let path = files.path().join("report.pdf");
        let original = filesystem::tests::fixture();
        fs::write(&path, &original).unwrap();
        let id = opened(&state, path.clone(), false).unwrap().id;
        assert_eq!(status(&state, &id), UNCHANGED);

        // Rewriting identical bytes with a longer file first changes the stamp, not the content.
        fs::write(&path, [original.as_slice(), b"\n"].concat()).unwrap();
        fs::write(&path, &original).unwrap();
        assert_eq!(status(&state, &id), UNCHANGED);

        fs::write(
            &path,
            [original.as_slice(), b"% edited elsewhere\n"].concat(),
        )
        .unwrap();
        assert_eq!(
            status(&state, &id),
            SourceStatus {
                changed: true,
                missing: false
            }
        );
        fs::remove_file(&path).unwrap();
        assert_eq!(
            status(&state, &id),
            SourceStatus {
                changed: false,
                missing: true
            }
        );

        let import = imported(&state, &original, "new.pdf".into()).unwrap().id;
        assert_eq!(status(&state, &import), UNCHANGED);
    }

    #[test]
    fn revert_reopens_the_saved_file_at_the_same_page() {
        let root = tempfile::tempdir().unwrap();
        let files = tempfile::tempdir().unwrap();
        let state = state(root.path());
        let path = files.path().join("report.pdf");
        let original = filesystem::tests::fixture();
        fs::write(&path, &original).unwrap();
        let first = opened(&state, path.clone(), false).unwrap();
        *document(&state, &first.id).unwrap().page.lock().unwrap() = 3;
        let changed = [original.as_slice(), b"% newer\n"].concat();
        fs::write(&path, &changed).unwrap();

        let reverted = reopen(&state, &first.id).unwrap();
        assert_ne!(reverted.id, first.id);
        assert_eq!(reverted.size, changed.len() as u64);
        let doc = document(&state, &reverted.id).unwrap();
        assert_eq!(*doc.page.lock().unwrap(), 3);
        assert_eq!(status(&state, &reverted.id), UNCHANGED);

        let import = imported(&state, &original, "new.pdf".into()).unwrap().id;
        let Err(error) = reopen(&state, &import) else {
            panic!("an unsaved import has no saved file to reopen");
        };
        assert!(error.contains("no saved file"), "{error}");
    }

    #[test]
    fn sessions_are_recorded_only_when_enabled_and_restored_once() {
        let root = tempfile::tempdir().unwrap();
        let files = tempfile::tempdir().unwrap();
        let state = state(root.path());
        let original = filesystem::tests::fixture();
        let paths: Vec<_> = ["b.pdf", "a.pdf", "gone.pdf"]
            .iter()
            .map(|name| files.path().join(name))
            .collect();
        for path in &paths {
            fs::write(path, &original).unwrap();
        }
        let ids: Vec<_> = paths
            .iter()
            .map(|path| opened(&state, path.clone(), false).unwrap().id)
            .collect();
        *document(&state, &ids[1]).unwrap().page.lock().unwrap() = 7;
        imported(&state, &original, "unsaved.pdf".into()).unwrap();

        record_session(&state).unwrap();
        assert!(state.local.lock().unwrap().session.is_empty());

        state.local.lock().unwrap().preferences.reopen_session = true;
        record_session(&state).unwrap();
        let session = state.local.lock().unwrap().session.clone();
        assert_eq!(
            session,
            vec![
                SessionEntry {
                    path: paths[0].clone(),
                    page: 1
                },
                SessionEntry {
                    path: paths[1].clone(),
                    page: 7
                },
                SessionEntry {
                    path: paths[2].clone(),
                    page: 1
                },
            ]
        );
        let saved: LocalData =
            serde_json::from_slice(&fs::read(root.path().join("settings.json")).unwrap()).unwrap();
        assert_eq!(saved.session, session);

        fs::remove_file(&paths[2]).unwrap();
        state.documents.lock().unwrap().clear();
        let (restored, skipped) = restore_session(&state).unwrap();
        assert_eq!(skipped, 1);
        assert_eq!(
            restored
                .iter()
                .map(|document| (document.descriptor.name.as_str(), document.page))
                .collect::<Vec<_>>(),
            vec![("b.pdf", 1), ("a.pdf", 7)]
        );
        assert!(state.local.lock().unwrap().session.is_empty());
        assert!(restore_session(&state).unwrap().0.is_empty());
    }
}
