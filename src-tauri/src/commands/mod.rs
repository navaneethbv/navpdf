pub mod engine;
mod recovery;

use crate::{
    engine::redact,
    filesystem, logging, security,
    signatures::{LibraryListing, SignatureAsset, SignatureStore},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, Emitter, Manager, State, WebviewWindow,
};
use tempfile::NamedTempFile;
use url::Url;

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub theme: String,
    pub default_zoom: String,
    pub layout: String,
    pub remember_page: bool,
    pub autosave: bool,
    pub recent_files: bool,
    pub network_access: bool,
    pub save_behavior: String,
    pub confirm_on_delete: bool,
    pub annotation_color: String,
    pub annotation_stroke_width: f32,
    pub ocr_language: String,
    pub ocr_scope: String,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            default_zoom: "page-fit".into(),
            layout: "continuous".into(),
            remember_page: true,
            autosave: true,
            recent_files: true,
            network_access: false,
            save_behavior: "ask".into(),
            confirm_on_delete: true,
            annotation_color: "#f5cf58".into(),
            annotation_stroke_width: 2.0,
            ocr_language: "en-US".into(),
            ocr_scope: "current".into(),
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recent {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    pub opened_at: u64,
    pub page: u32,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalData {
    pub preferences: Preferences,
    pub recents: Vec<Recent>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub name: String,
    pub size: u64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionInfo {
    pub revision_id: String,
    pub page_count: u32,
    pub timestamp: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionStatus {
    pub current_revision_id: String,
    pub saved_revision_id: String,
    pub page_count: u32,
    pub is_dirty: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitRevisionResult {
    pub revision_id: String,
    pub page_count: u32,
    pub size: u64,
}

pub struct Opened {
    pub file: Mutex<File>,
    pub _snapshot: NamedTempFile,
    pub working_file: Mutex<Option<NamedTempFile>>,
    pub source: Mutex<(PathBuf, Vec<u8>)>,
    pub length: Mutex<u64>,
    pub name: Mutex<String>,
    pub current_revision: Mutex<RevisionInfo>,
    pub saved_revision: Mutex<String>,
    /// Set after unlocking an encrypted document: no recovery copy or working file is written.
    pub sensitive: Mutex<bool>,
    /// Set after redaction or unlocking so a plain Save cannot overwrite the source.
    pub force_save_as: Mutex<bool>,
    /// Set when the source file was encrypted when opened.
    pub source_encrypted: Mutex<bool>,
    pub redaction_audit: Mutex<RedactionAudit>,
}
/// Redaction audits that a save must pass, because the renderer re-serializes redacted output.
#[derive(Default)]
pub struct RedactionAudit {
    /// Regions and terms of redactions whose output was committed; cleared by a successful save.
    pub armed: Option<redact::AuditSpec>,
    /// SHA-256 of the latest redacted output and its audit, until those bytes are committed.
    pub candidate: Option<(Vec<u8>, redact::AuditSpec)>,
}
pub struct AppState {
    pub documents: Mutex<HashMap<String, Arc<Opened>>>,
    pub pending_open_tokens: Mutex<HashMap<String, PathBuf>>,
    pub local: Mutex<LocalData>,
    pub root: PathBuf,
    pub dirty: Mutex<bool>,
    pub saving: Mutex<bool>,
    pub engine: engine::EngineState,
}
const MAX_PENDING_OPEN_TOKENS: usize = 32;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenTokenEvent {
    pub token: Option<String>,
    pub error: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Descriptor {
    pub unsaved: bool,
    pub id: String,
    pub name: String,
    pub size: u64,
    pub revision_id: String,
}
fn time() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|t| t.as_secs())
        .unwrap_or(0)
}
fn document(state: &AppState, id: &str) -> Result<Arc<Opened>, String> {
    state
        .documents
        .lock()
        .map_err(|_| "Document state unavailable.")?
        .get(id)
        .cloned()
        .ok_or("This document is no longer open.".into())
}
pub fn refuse_plaintext_overwrite(doc: &Opened, target: &std::path::Path) -> Result<(), String> {
    let sensitive = *doc
        .sensitive
        .lock()
        .map_err(|_| "Document state unavailable.")?;
    let source_encrypted = *doc
        .source_encrypted
        .lock()
        .map_err(|_| "Document state unavailable.")?;
    if !sensitive && !source_encrypted {
        return Ok(());
    }
    let (source, _) = doc
        .source
        .lock()
        .map_err(|_| "Document state unavailable.")?
        .clone();
    let canon_source = fs::canonicalize(&source).unwrap_or(source);
    let canon_target = fs::canonicalize(target).unwrap_or_else(|_| target.to_path_buf());
    if canon_source == canon_target {
        return Err("This document was opened from an encrypted file. Choose a different name to save an unencrypted copy.".into());
    }
    Ok(())
}
fn opened(state: &AppState, path: PathBuf, remember: bool) -> Result<Descriptor, String> {
    let (snapshot, hash, length) = filesystem::snapshot(&path)?;
    let file = snapshot
        .reopen()
        .map_err(|_| "Unable to open working copy.")?;
    let source_encrypted = match lopdf::Document::load(snapshot.path()) {
        Ok(doc) => doc.is_encrypted(),
        Err(_) => fs::read(snapshot.path())
            .map(|b| b.windows(8).any(|w| w == b"/Encrypt"))
            .unwrap_or(false),
    };
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Document.pdf".into());
    let id = uuid::Uuid::new_v4().to_string();
    let revision_id = uuid::Uuid::new_v4().to_string();
    let entry = Arc::new(Opened {
        file: Mutex::new(file),
        _snapshot: snapshot,
        working_file: Mutex::new(None),
        source: Mutex::new((path.clone(), hash)),
        length: Mutex::new(length),
        name: Mutex::new(name.clone()),
        current_revision: Mutex::new(RevisionInfo {
            revision_id: revision_id.clone(),
            page_count: 0,
            timestamp: time(),
        }),
        saved_revision: Mutex::new(revision_id.clone()),
        sensitive: Mutex::new(false),
        force_save_as: Mutex::new(false),
        source_encrypted: Mutex::new(source_encrypted),
        redaction_audit: Mutex::new(RedactionAudit::default()),
    });
    state
        .documents
        .lock()
        .map_err(|_| "Document state unavailable.")?
        .insert(id.clone(), entry);
    if remember {
        let mut local = state.local.lock().map_err(|_| "Settings unavailable.")?;
        if local.preferences.recent_files {
            let page = local
                .recents
                .iter()
                .find(|r| r.path == path)
                .map(|r| r.page)
                .unwrap_or(1);
            local.recents.retain(|r| r.path != path);
            local.recents.insert(
                0,
                Recent {
                    id: uuid::Uuid::new_v4().to_string(),
                    name: name.clone(),
                    path,
                    opened_at: time(),
                    page,
                },
            );
            local.recents.truncate(15);
            filesystem::private_json(&state.root.join("settings.json"), &*local)?;
        }
    }
    logging::record(&state.root, "open_document", false);
    Ok(Descriptor {
        unsaved: false,
        id,
        name,
        size: length,
        revision_id,
    })
}
// Generated documents have no user-selected destination. Keep the source
// private and force the first save through the native Save As picker.
fn imported(state: &AppState, bytes: &[u8], name: String) -> Result<Descriptor, String> {
    if bytes.is_empty() || bytes.len() as u64 > filesystem::MAX_FILE_BYTES {
        return Err("Choose a PDF smaller than 1 GB.".into());
    }
    let mut input = NamedTempFile::new().map_err(|_| "Unable to create a private working copy.")?;
    input
        .write_all(bytes)
        .map_err(|_| "Unable to import PDF. Check free disk space.")?;
    let mut descriptor = opened(state, input.path().to_path_buf(), false)?;
    let doc = document(state, &descriptor.id)?;
    let mut source = doc
        .source
        .lock()
        .map_err(|_| "Document state unavailable.")?;
    source.0 = doc._snapshot.path().to_path_buf();
    *doc.name.lock().map_err(|_| "Document state unavailable.")? = name.clone();
    descriptor.name = name;
    descriptor.unsaved = true;
    Ok(descriptor)
}

#[tauri::command]
pub async fn import_document(app: AppHandle, request: Request<'_>) -> Result<Descriptor, String> {
    let bytes = payload(&request)?;
    let name: String = serde_json::from_str(&header(&request, "x-document-name")?)
        .map_err(|_| "Invalid document name.")?;
    let name = std::path::Path::new(&name)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled.pdf")
        .to_owned();
    tauri::async_runtime::spawn_blocking(move || imported(&app.state::<AppState>(), &bytes, name))
        .await
        .map_err(|_| "Importing the PDF failed.")?
}

#[tauri::command]
pub async fn open_document(app: AppHandle) -> Result<Option<Descriptor>, String> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter("PDF", &["pdf"])
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    let path = file.path().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || opened(&app.state::<AppState>(), path, true))
        .await
        .map_err(|_| "Opening the PDF failed.")?
        .map(Some)
}

fn is_pdf_path(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
}

/// Convert a path delivered by the operating system into a single-use opaque token.
/// The renderer never receives or submits the source path.
pub fn register_open_path(app: &AppHandle, path: PathBuf) {
    let event = if !is_pdf_path(&path) {
        OpenTokenEvent {
            token: None,
            error: Some("Only PDF files can be opened.".into()),
        }
    } else {
        let token = uuid::Uuid::new_v4().to_string();
        let registered = app
            .state::<AppState>()
            .pending_open_tokens
            .lock()
            .map(|mut tokens| {
                if tokens.len() >= MAX_PENDING_OPEN_TOKENS {
                    false
                } else {
                    tokens.insert(token.clone(), path).is_none()
                }
            })
            .unwrap_or(false);
        if registered {
            OpenTokenEvent {
                token: Some(token),
                error: None,
            }
        } else {
            OpenTokenEvent {
                token: None,
                error: Some("The file could not be queued for opening.".into()),
            }
        }
    };
    let _ = app.emit("open-token", event);
}

#[tauri::command]
pub async fn open_document_from_token(app: AppHandle, token: String) -> Result<Descriptor, String> {
    let path = app
        .state::<AppState>()
        .pending_open_tokens
        .lock()
        .map_err(|_| "Open queue unavailable.")?
        .remove(&token)
        .ok_or("This open request has expired or was already used.")?;
    if !is_pdf_path(&path) {
        return Err("Only PDF files can be opened.".into());
    }
    tauri::async_runtime::spawn_blocking(move || opened(&app.state::<AppState>(), path, true))
        .await
        .map_err(|_| "Opening the PDF failed.")?
}

pub fn validate_external_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    let parsed = Url::parse(trimmed).map_err(|_| "Malformed external link.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https" | "mailto") {
        return Err("Only http, https, and mailto links can be opened.".into());
    }
    Ok(parsed.to_string())
}

#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    let url = validate_external_url(&url)?;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        let result = std::process::Command::new("open").arg(&url).status();
        #[cfg(target_os = "windows")]
        let result = std::process::Command::new("explorer").arg(&url).status();
        #[cfg(all(unix, not(target_os = "macos")))]
        let result = std::process::Command::new("xdg-open").arg(&url).status();
        #[cfg(not(any(unix, target_os = "windows")))]
        let result: std::io::Result<std::process::ExitStatus> =
            Err(std::io::Error::other("unsupported platform"));
        result
            .map_err(|_| "The system could not open this link.".to_string())?
            .success()
            .then_some(())
            .ok_or_else(|| "The system could not open this link.".to_string())
    })
    .await
    .map_err(|_| "The system link task failed.".to_string())?
}
#[tauri::command]
pub async fn open_recent(app: AppHandle, id: String) -> Result<Descriptor, String> {
    let path = app
        .state::<AppState>()
        .local
        .lock()
        .map_err(|_| "Settings unavailable.")?
        .recents
        .iter()
        .find(|r| r.id == id)
        .map(|r| r.path.clone())
        .ok_or("This recent document is no longer available.")?;
    tauri::async_runtime::spawn_blocking(move || opened(&app.state::<AppState>(), path, true))
        .await
        .map_err(|_| "Opening the PDF failed.")?
}
#[tauri::command]
pub async fn read_range(
    app: AppHandle,
    id: String,
    begin: u64,
    end: u64,
) -> Result<Response, String> {
    let doc = document(&app.state::<AppState>(), &id)?;
    let length = *doc.length.lock().map_err(|_| "Document is busy.")?;
    if !security::valid_range(begin, end, length) {
        return Err("Invalid PDF byte range.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut file = doc.file.lock().map_err(|_| "Document is busy.")?;
        file.seek(SeekFrom::Start(begin))
            .map_err(|_| "Unable to read PDF range.")?;
        let mut bytes = vec![0; (end - begin) as usize];
        file.read_exact(&mut bytes)
            .map_err(|_| "Unable to read PDF range.")?;
        Ok(Response::new(bytes))
    })
    .await
    .map_err(|_| "Unable to read PDF.")?
}
#[tauri::command]
pub fn close_document(state: State<AppState>, id: String) -> Result<(), String> {
    state
        .documents
        .lock()
        .map_err(|_| "Document state unavailable.")?
        .remove(&id);
    let _ = fs::remove_file(state.root.join(format!("recovery-{id}.pdf")));
    let _ = fs::remove_file(state.root.join(format!("recovery-{id}.json")));
    Ok(())
}
fn header(request: &Request<'_>, name: &str) -> Result<String, String> {
    request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(String::from)
        .ok_or("Invalid save request.".into())
}
fn payload(request: &Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        InvokeBody::Raw(bytes) if bytes.len() as u64 <= filesystem::MAX_FILE_BYTES => {
            Ok(bytes.clone())
        }
        _ => Err("Invalid PDF save payload.".into()),
    }
}
#[tauri::command]
pub async fn save_document(
    app: AppHandle,
    request: Request<'_>,
) -> Result<Option<SaveResult>, String> {
    let id = header(&request, "x-document-id")?;
    let save_as = header(&request, "x-save-as")? == "true";
    let pages: u32 = header(&request, "x-page-count")?
        .parse()
        .map_err(|_| "Invalid page count.")?;
    let bytes = payload(&request)?;
    let doc = document(&app.state::<AppState>(), &id)?;
    {
        let state = app.state::<AppState>();
        let mut saving = state.saving.lock().map_err(|_| "Save state unavailable.")?;
        if *saving {
            return Err("A save is already in progress.".into());
        }
        *saving = true;
    }
    let result = async {
        let (source, hash) = doc
            .source
            .lock()
            .map_err(|_| "Document state unavailable.")?
            .clone();
        let current_name = doc
            .name
            .lock()
            .map(|n| n.clone())
            .unwrap_or_else(|_| "Document.pdf".into());
        let force_save_as = doc.force_save_as.lock().map(|flag| *flag).unwrap_or(true);
        let sensitive = *doc
            .sensitive
            .lock()
            .map_err(|_| "Document state unavailable.")?;
        let source_encrypted = *doc
            .source_encrypted
            .lock()
            .map_err(|_| "Document state unavailable.")?;
        let suggested_name = if sensitive || source_encrypted {
            let stem = std::path::Path::new(&current_name)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Document");
            format!("{stem}-unlocked.pdf")
        } else {
            current_name.clone()
        };
        let target = if save_as
            || force_save_as
            || sensitive
            || source_encrypted
            || source == doc._snapshot.path()
            || recovery::entry_for(&app.state::<AppState>().root, &source).is_some()
        {
            let Some(file) = rfd::AsyncFileDialog::new()
                .add_filter("PDF", &["pdf"])
                .set_file_name(&suggested_name)
                .save_file()
                .await
            else {
                return Ok(None);
            };
            file.path().to_path_buf()
        } else {
            source.clone()
        };
        refuse_plaintext_overwrite(&doc, &target)?;
        let check = if target == source {
            Some(hash)
        } else if target.exists() {
            Some(filesystem::fingerprint(&target)?)
        } else {
            None
        };
        let armed_audit = doc
            .redaction_audit
            .lock()
            .map_err(|_| "Document state unavailable.")?
            .armed
            .clone();
        let worker_app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let new_hash =
                filesystem::atomic_save_with(&target, &bytes, check.as_deref(), |candidate| {
                    filesystem::validate_pdf(candidate, pages)?;
                    verify_redactions(candidate, armed_audit.as_ref())
                })?;
            *doc.source
                .lock()
                .map_err(|_| "Document state unavailable.")? = (target.clone(), new_hash);
            let target_name = target
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "Document.pdf".into());
            if let Ok(mut name_guard) = doc.name.lock() {
                *name_guard = target_name.clone();
            }
            if let Ok(mut flag) = doc.force_save_as.lock() {
                *flag = false;
            }
            if target != source {
                if let Ok(mut enc_guard) = doc.source_encrypted.lock() {
                    *enc_guard = false;
                }
            }
            let size = bytes.len() as u64;
            let state = worker_app.state::<AppState>();
            if let Ok(mut local) = state.local.lock() {
                if local.preferences.recent_files {
                    let page = local
                        .recents
                        .iter()
                        .find(|r| r.path == source || r.path == target)
                        .map(|r| r.page)
                        .unwrap_or(1);
                    local.recents.retain(|r| r.path != target);
                    local.recents.insert(
                        0,
                        Recent {
                            id: uuid::Uuid::new_v4().to_string(),
                            name: target_name.clone(),
                            path: target.clone(),
                            opened_at: time(),
                            page,
                        },
                    );
                    local.recents.truncate(15);
                    let _ = filesystem::private_json(&state.root.join("settings.json"), &*local);
                }
            }
            retire_recovery(&state.root, &id, &source);
            if let Ok(mut audit) = doc.redaction_audit.lock() {
                audit.armed = None;
            }
            if let Ok(mut saved_guard) = doc.saved_revision.lock() {
                if let Ok(rev_guard) = doc.current_revision.lock() {
                    *saved_guard = rev_guard.revision_id.clone();
                }
            }
            logging::record(&state.root, "save_document", false);
            Ok(Some(SaveResult {
                name: target_name,
                size,
            }))
        })
        .await
        .map_err(|_| "Saving failed. The original file is unchanged.")?
    }
    .await;
    if let Ok(mut saving) = app.state::<AppState>().saving.lock() {
        *saving = false;
    }
    if result.is_err() {
        logging::record(&app.state::<AppState>().root, "save_document", true);
    }
    result
}

#[tauri::command]
pub async fn commit_working_revision(
    app: AppHandle,
    request: Request<'_>,
) -> Result<CommitRevisionResult, String> {
    let id = header(&request, "x-document-id")?;
    let base_revision_id = header(&request, "x-base-revision-id")?;
    let pages: u32 = header(&request, "x-page-count")?
        .parse()
        .map_err(|_| "Invalid page count.")?;
    let bytes = payload(&request)?;
    let doc = document(&app.state::<AppState>(), &id)?;

    tauri::async_runtime::spawn_blocking(move || {
        let result = commit_revision(&doc, &base_revision_id, &bytes, pages)?;
        *app.state::<AppState>()
            .dirty
            .lock()
            .map_err(|_| "Document state unavailable.")? = true;
        Ok(result)
    })
    .await
    .map_err(|_| "Failed to commit revision.")?
}

fn commit_revision(
    doc: &Opened,
    base_revision_id: &str,
    bytes: &[u8],
    pages: u32,
) -> Result<CommitRevisionResult, String> {
    filesystem::validate_pdf_structure(bytes, pages).map_err(|err| err.for_commit())?;

    // Keep the base check and publication under one lock so competing commits cannot both succeed.
    let mut current = doc
        .current_revision
        .lock()
        .map_err(|_| "Revision state unavailable.")?;
    if current.revision_id != base_revision_id {
        return Err("Stale base revision. The document has been modified elsewhere.".into());
    }
    let sensitive = *doc
        .sensitive
        .lock()
        .map_err(|_| "Document state unavailable.")?;
    let mut working = doc.working_file.lock().map_err(|_| "Document is busy.")?;
    let candidate = if sensitive {
        None
    } else {
        let mut temp = NamedTempFile::new()
            .map_err(|_| "Unable to create working revision temporary file.")?;
        temp.write_all(bytes)
            .map_err(|_| "Unable to write revision bytes.")?;
        temp.as_file()
            .sync_all()
            .map_err(|_| "Unable to flush revision bytes.")?;
        Some(temp)
    };
    let revision_id = uuid::Uuid::new_v4().to_string();
    *working = candidate;
    *current = RevisionInfo {
        revision_id: revision_id.clone(),
        page_count: pages,
        timestamp: time(),
    };
    promote_redaction_audit(doc, bytes)?;
    // doc.file and doc.length belong to the immutable source range transport.
    Ok(CommitRevisionResult {
        revision_id,
        page_count: pages,
        size: bytes.len() as u64,
    })
}

/// Arms the save-time redaction audit once the committed bytes are the audited redaction
/// output, so a failed attach never blocks saving the unredacted document.
fn promote_redaction_audit(doc: &Opened, bytes: &[u8]) -> Result<(), String> {
    let mut audit = doc
        .redaction_audit
        .lock()
        .map_err(|_| "Document state unavailable.")?;
    let committed = audit
        .candidate
        .as_ref()
        .is_some_and(|(hash, _)| hash.as_slice() == Sha256::digest(bytes).as_slice());
    if let Some((_, spec)) = committed.then(|| audit.candidate.take()).flatten() {
        match audit.armed.as_mut() {
            Some(armed) => armed.merge(spec),
            None => audit.armed = Some(spec),
        }
    }
    Ok(())
}

/// Re-runs armed redaction audits on bytes about to replace a file on disk.
fn verify_redactions(bytes: &[u8], audit: Option<&redact::AuditSpec>) -> Result<(), String> {
    let Some(spec) = audit else {
        return Ok(());
    };
    if redact::audit(bytes, &spec.regions, &spec.terms)?.passed {
        Ok(())
    } else {
        Err("Saving was blocked because this copy no longer passes the redaction audit: content was found inside a redacted area or a redaction term is present again. The file on disk is unchanged.".into())
    }
}

#[tauri::command]
pub async fn get_revision(app: AppHandle, id: String) -> Result<RevisionStatus, String> {
    let state = app.state::<AppState>();
    let doc = document(&state, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let current = doc
            .current_revision
            .lock()
            .map_err(|_| "Revision state unavailable.")?;
        let saved = doc
            .saved_revision
            .lock()
            .map_err(|_| "Saved revision state unavailable.")?;
        Ok(RevisionStatus {
            current_revision_id: current.revision_id.clone(),
            saved_revision_id: saved.clone(),
            page_count: current.page_count,
            is_dirty: current.revision_id != *saved,
        })
    })
    .await
    .map_err(|_| "The revision state could not be read.")?
}
#[tauri::command]
pub fn local_state(state: State<AppState>) -> Result<serde_json::Value, String> {
    let recoveries = recovery::list(&state.root);
    let local = state.local.lock().map_err(|_| "Settings unavailable.")?;
    Ok(serde_json::json!({
        "preferences": local.preferences,
        "recents": local.recents.iter().map(|r| serde_json::json!({
            "id": r.id,
            "name": r.name,
            "openedAt": r.opened_at,
            "page": r.page,
        })).collect::<Vec<_>>(),
        "recoveries": recoveries,
    }))
}
#[tauri::command]
pub fn save_preferences(
    state: State<AppState>,
    mut preferences: Preferences,
) -> Result<(), String> {
    if !["system", "light", "dark"].contains(&preferences.theme.as_str())
        || !["continuous", "single", "spread"].contains(&preferences.layout.as_str())
    {
        return Err("Invalid preference value.".into());
    }
    if !["page-fit", "page-width", "1", "1.5", "2"].contains(&preferences.default_zoom.as_str()) {
        return Err("Invalid default zoom.".into());
    }
    if !["ask", "save-as"].contains(&preferences.save_behavior.as_str())
        || !["current", "all"].contains(&preferences.ocr_scope.as_str())
        || !preferences.annotation_color.starts_with('#')
        || !(1.0..=20.0).contains(&preferences.annotation_stroke_width)
    {
        return Err("Invalid preference value.".into());
    }
    preferences.network_access = false;
    let mut local = state.local.lock().map_err(|_| "Settings unavailable.")?;
    local.preferences = preferences;
    if !local.preferences.recent_files {
        local.recents.clear();
    }
    filesystem::private_json(&state.root.join("settings.json"), &*local)?;
    Ok(())
}
#[tauri::command]
pub fn clear_recents(state: State<AppState>) -> Result<(), String> {
    let mut local = state.local.lock().map_err(|_| "Settings unavailable.")?;
    local.recents.clear();
    filesystem::private_json(&state.root.join("settings.json"), &*local)?;
    Ok(())
}
#[tauri::command]
pub fn remember_page(state: State<AppState>, id: String, page: u32) -> Result<(), String> {
    let doc = document(&state, &id)?;
    let source = doc
        .source
        .lock()
        .map_err(|_| "Document unavailable.")?
        .0
        .clone();
    let mut local = state.local.lock().map_err(|_| "Settings unavailable.")?;
    if local.preferences.remember_page {
        if let Some(recent) = local.recents.iter_mut().find(|r| r.path == source) {
            recent.page = page;
        }
        filesystem::private_json(&state.root.join("settings.json"), &*local)?;
    }
    Ok(())
}
#[tauri::command]
pub async fn write_recovery(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let id = header(&request, "x-document-id")?;
    let pages: u32 = header(&request, "x-page-count")?
        .parse()
        .map_err(|_| "Invalid recovery page count.")?;
    let bytes = payload(&request)?;
    let doc = document(&app.state::<AppState>(), &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let autosave = state
            .local
            .lock()
            .map_err(|_| "Settings unavailable.")?
            .preferences
            .autosave;
        store_recovery(&state.root, &id, &doc, pages, &bytes, autosave)
    })
    .await
    .map_err(|_| "Recovery could not be saved.")?
}
#[tauri::command]
pub async fn open_recovery(app: AppHandle, id: String) -> Result<Descriptor, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let path = recovery::path_for(&state.root, &id)?;
        opened(&state, path, false)
    })
    .await
    .map_err(|_| "Recovery could not be opened.")?
}
#[tauri::command]
pub fn discard_recovery(state: State<AppState>, id: String) -> Result<(), String> {
    recovery::discard(&state.root, &id)
}

/// Writes one document's recovery copy unless its session is sensitive or autosave is off.
fn store_recovery(
    root: &std::path::Path,
    id: &str,
    doc: &Opened,
    pages: u32,
    bytes: &[u8],
    autosave: bool,
) -> Result<(), String> {
    if doc.sensitive.lock().map(|flag| *flag).unwrap_or(true) {
        // Never leave decrypted recovery copies of encrypted documents.
        return recovery::discard(root, id);
    }
    if !autosave {
        return Ok(());
    }
    let name = doc
        .name
        .lock()
        .map(|name| name.clone())
        .unwrap_or_else(|_| "Document.pdf".into());
    let entry = recovery::RecoveryEntry {
        id: id.to_owned(),
        name,
        pages,
        saved_at: time(),
    };
    recovery::write(root, &entry, bytes)
}

/// Removes a saved document's own recovery entry and, when the document was opened from a
/// recovery copy, the entry it came from.
fn retire_recovery(root: &std::path::Path, id: &str, source: &std::path::Path) {
    let _ = recovery::discard(root, id);
    if let Some(entry) = recovery::entry_for(root, source) {
        let _ = recovery::discard(root, &entry);
    }
}
#[tauri::command]
pub fn mark_dirty(state: State<AppState>, dirty: bool) -> Result<(), String> {
    *state
        .dirty
        .lock()
        .map_err(|_| "Document state unavailable.")? = dirty;
    Ok(())
}
#[tauri::command]
pub fn close_window(window: WebviewWindow, state: State<AppState>) -> Result<(), String> {
    *state
        .dirty
        .lock()
        .map_err(|_| "Document state unavailable.")? = false;
    // Called only after the frontend's save/discard guard has completed.
    // Destroy bypasses CloseRequested, avoiding a second guard cycle.
    window
        .destroy()
        .map_err(|_| "Unable to close window.".into())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSignatureRequest {
    pub name: String,
    #[serde(rename = "type")]
    pub asset_type: String,
    pub data_url: String,
}

#[tauri::command]
pub fn load_signatures(state: State<AppState>) -> Result<LibraryListing, String> {
    let store = SignatureStore::new(&state.root)?;
    store.list()
}

#[tauri::command]
pub fn save_signature(
    state: State<AppState>,
    request: SaveSignatureRequest,
) -> Result<SignatureAsset, String> {
    let store = SignatureStore::new(&state.root)?;
    store.save(request.name, request.asset_type, request.data_url)
}

#[tauri::command]
pub fn delete_signature(state: State<AppState>, id: String) -> Result<(), String> {
    let store = SignatureStore::new(&state.root)?;
    store.delete(&id)
}

#[tauri::command]
pub fn migrate_signatures(
    state: State<AppState>,
    items: Vec<SignatureAsset>,
) -> Result<Vec<SignatureAsset>, String> {
    let store = SignatureStore::new(&state.root)?;
    store.migrate(items)
}

pub fn emit_action(app: &AppHandle, action: &str) {
    let _ = app.emit("menu-action", action);
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::dictionary;

    #[test]
    fn operating_system_open_tokens_accept_only_pdf_paths() {
        assert!(is_pdf_path(std::path::Path::new("report.PDF")));
        assert!(is_pdf_path(std::path::Path::new("/tmp/report.pdf")));
        assert!(!is_pdf_path(std::path::Path::new("report.pdf.exe")));
        assert!(!is_pdf_path(std::path::Path::new("report.txt")));
    }

    #[test]
    fn external_url_policy_allows_web_and_mail_links_only() {
        assert_eq!(
            validate_external_url(" https://example.org/a ").unwrap(),
            "https://example.org/a"
        );
        assert!(validate_external_url("mailto:person@example.org").is_ok());
        assert!(validate_external_url("file:///tmp/private.pdf").is_err());
        assert!(validate_external_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn generated_document_owns_private_snapshot_and_requires_save_as() {
        let root = tempfile::tempdir().unwrap();
        let state = AppState {
            documents: Mutex::new(HashMap::new()),
            pending_open_tokens: Mutex::new(HashMap::new()),
            local: Mutex::new(LocalData::default()),
            root: root.path().to_path_buf(),
            dirty: Mutex::new(false),
            saving: Mutex::new(false),
            engine: engine::EngineState::default(),
        };
        let bytes = b"%PDF-1.7\nprivate generated data";
        let descriptor = imported(&state, bytes, "Résumé-日本.pdf".into()).unwrap();
        assert!(descriptor.unsaved);
        assert_eq!(descriptor.name, "Résumé-日本.pdf");
        let doc = document(&state, &descriptor.id).unwrap();
        assert_eq!(doc.source.lock().unwrap().0, doc._snapshot.path());
        assert_eq!(fs::read(doc._snapshot.path()).unwrap(), bytes);
        assert!(state.local.lock().unwrap().recents.is_empty());
        assert!(imported(&state, b"", "empty.pdf".into()).is_err());
        assert!(imported(&state, b"not a PDF", "bad.pdf".into()).is_err());
    }

    #[test]
    fn revision_tracking_and_stale_base_rejection() {
        let root = tempfile::tempdir().unwrap();
        let state = AppState {
            documents: Mutex::new(HashMap::new()),
            pending_open_tokens: Mutex::new(HashMap::new()),
            local: Mutex::new(LocalData::default()),
            root: root.path().to_path_buf(),
            dirty: Mutex::new(false),
            saving: Mutex::new(false),
            engine: engine::EngineState::default(),
        };
        let bytes = b"%PDF-1.7\nprivate generated data";
        let descriptor = imported(&state, bytes, "test.pdf".into()).unwrap();
        let initial_rev = descriptor.revision_id.clone();
        assert!(!initial_rev.is_empty());

        let doc = document(&state, &descriptor.id).unwrap();
        {
            let rev = doc.current_revision.lock().unwrap();
            assert_eq!(rev.revision_id, initial_rev);
            assert_eq!(*doc.saved_revision.lock().unwrap(), initial_rev);
        }

        let stale_base = "fake-base-revision-uuid";
        let current_rev_id = doc.current_revision.lock().unwrap().revision_id.clone();
        assert_ne!(current_rev_id, stale_base);

        let next_rev_id = uuid::Uuid::new_v4().to_string();
        *doc.current_revision.lock().unwrap() = RevisionInfo {
            revision_id: next_rev_id.clone(),
            page_count: 2,
            timestamp: time(),
        };
        assert_ne!(
            doc.current_revision.lock().unwrap().revision_id,
            *doc.saved_revision.lock().unwrap()
        );

        // Cargo tests must not depend on fixtures generated by npm's pretest hook.
        let mut pdf = lopdf::Document::with_version("1.7");
        let pages_id = pdf.new_object_id();
        let mut kids = Vec::new();
        for _ in 0..5 {
            let page_id = pdf.add_object(lopdf::dictionary! {
                "Type" => "Page",
                "Parent" => pages_id,
                "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
            });
            kids.push(lopdf::Object::Reference(page_id));
        }
        pdf.objects.insert(
            pages_id,
            lopdf::dictionary! {
                "Type" => "Pages", "Kids" => kids, "Count" => 5,
            }
            .into(),
        );
        let catalog_id = pdf.add_object(lopdf::dictionary! {
            "Type" => "Catalog", "Pages" => pages_id,
        });
        pdf.trailer.set("Root", catalog_id);
        let mut candidate = Vec::new();
        pdf.save_to(&mut candidate).unwrap();
        assert!(commit_revision(&doc, stale_base, &candidate, 5).is_err());
        let committed = commit_revision(&doc, &next_rev_id, &candidate, 5).unwrap();
        assert_eq!(committed.page_count, 5);
        assert_eq!(*doc.length.lock().unwrap(), bytes.len() as u64);
        let mut source_bytes = Vec::new();
        let mut file = doc.file.lock().unwrap();
        file.seek(SeekFrom::Start(0)).unwrap();
        file.read_to_end(&mut source_bytes).unwrap();
        assert_eq!(source_bytes, bytes);
        assert_eq!(
            fs::read(doc.working_file.lock().unwrap().as_ref().unwrap().path()).unwrap(),
            candidate
        );
        assert!(commit_revision(&doc, &next_rev_id, &candidate, 5).is_err());
    }

    #[test]
    fn save_refuses_plaintext_over_encrypted_source() {
        let root = tempfile::tempdir().unwrap();
        let state = AppState {
            documents: Mutex::new(HashMap::new()),
            pending_open_tokens: Mutex::new(HashMap::new()),
            local: Mutex::new(LocalData::default()),
            root: root.path().to_path_buf(),
            dirty: Mutex::new(false),
            saving: Mutex::new(false),
            engine: engine::EngineState::default(),
        };
        let dir = tempfile::tempdir().unwrap();
        let source_path = dir.path().join("secret.pdf");
        let plain = filesystem::tests::fixture();
        let encrypted = crate::engine::protect::protect(
            &plain,
            &crate::engine::protect::ProtectionRequest::user_only("pw"),
            1,
        )
        .unwrap();
        fs::write(&source_path, &encrypted).unwrap();

        let descriptor = opened(&state, source_path.clone(), false).unwrap();
        let doc = document(&state, &descriptor.id).unwrap();
        assert!(*doc.source_encrypted.lock().unwrap());

        let err = refuse_plaintext_overwrite(&doc, &source_path).unwrap_err();
        assert!(err.contains("unencrypted copy"), "{err}");
        let after = fs::read(&source_path).unwrap();
        assert!(lopdf::Document::load_mem(&after).unwrap().is_encrypted());
    }

    fn test_state(root: &std::path::Path) -> AppState {
        AppState {
            documents: Mutex::new(HashMap::new()),
            pending_open_tokens: Mutex::new(HashMap::new()),
            local: Mutex::new(LocalData::default()),
            root: root.to_path_buf(),
            dirty: Mutex::new(false),
            saving: Mutex::new(false),
            engine: engine::EngineState::default(),
        }
    }

    #[test]
    fn protecting_in_place_marks_sensitive_and_removes_recovery() {
        let root = tempfile::tempdir().unwrap();
        let state = test_state(root.path());
        let dir = tempfile::tempdir().unwrap();
        let source_path = dir.path().join("doc.pdf");
        let plain = filesystem::tests::fixture();
        fs::write(&source_path, &plain).unwrap();
        let descriptor = opened(&state, source_path.clone(), false).unwrap();
        let doc = document(&state, &descriptor.id).unwrap();
        *doc.working_file.lock().unwrap() = Some(NamedTempFile::new().unwrap());
        store_recovery(&state.root, &descriptor.id, &doc, 1, &plain, true).unwrap();
        assert_eq!(recovery::list(&state.root).len(), 1);

        engine::adopt_protected_source(&doc, &state.root, &descriptor.id, source_path, vec![7])
            .unwrap();

        assert!(*doc.sensitive.lock().unwrap());
        assert!(*doc.source_encrypted.lock().unwrap());
        assert!(*doc.force_save_as.lock().unwrap());
        assert!(doc.working_file.lock().unwrap().is_none());
        assert_eq!(doc.source.lock().unwrap().1, vec![7]);
        assert!(recovery::list(&state.root).is_empty());
        // Later autosave ticks must not recreate a plaintext copy.
        store_recovery(&state.root, &descriptor.id, &doc, 1, &plain, true).unwrap();
        assert!(recovery::list(&state.root).is_empty());
    }

    #[test]
    fn recovery_is_retired_per_document_and_skipped_when_not_allowed() {
        let root = tempfile::tempdir().unwrap();
        let state = test_state(root.path());
        let dir = tempfile::tempdir().unwrap();
        let plain = filesystem::tests::fixture();
        let open = |name: &str| {
            let path = dir.path().join(name);
            fs::write(&path, &plain).unwrap();
            let descriptor = opened(&state, path, false).unwrap();
            let doc = document(&state, &descriptor.id).unwrap();
            (descriptor.id, doc)
        };
        let (a_id, a) = open("a.pdf");
        let (b_id, b) = open("b.pdf");
        store_recovery(&state.root, &a_id, &a, 1, &plain, true).unwrap();
        store_recovery(&state.root, &b_id, &b, 1, &plain, true).unwrap();

        // Saving A retires only A's entry.
        retire_recovery(&state.root, &a_id, &dir.path().join("a.pdf"));
        let remaining: Vec<String> = recovery::list(&state.root)
            .into_iter()
            .map(|entry| entry.id)
            .collect();
        assert_eq!(remaining, vec![b_id.clone()]);

        // Saving a document opened from a recovery copy retires the entry it came from.
        let copy = recovery::path_for(&state.root, &b_id).unwrap();
        let recovered = opened(&state, copy.clone(), false).unwrap();
        retire_recovery(&state.root, &recovered.id, &copy);
        assert!(recovery::list(&state.root).is_empty());

        // Autosave off and sensitive sessions never write a copy.
        store_recovery(&state.root, &a_id, &a, 1, &plain, false).unwrap();
        *b.sensitive.lock().unwrap() = true;
        store_recovery(&state.root, &b_id, &b, 1, &plain, true).unwrap();
        assert!(recovery::list(&state.root).is_empty());
    }

    #[test]
    fn committed_redaction_output_arms_an_audit_that_saving_must_pass() {
        let root = tempfile::tempdir().unwrap();
        let state = test_state(root.path());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("doc.pdf");
        fs::write(&path, filesystem::tests::fixture()).unwrap();
        let descriptor = opened(&state, path, false).unwrap();
        let doc = document(&state, &descriptor.id).unwrap();
        let page = |content: &str| {
            let (mut pdf, _) =
                crate::engine::content::tests::page_document(content, dictionary! {});
            crate::engine::save(&mut pdf).unwrap()
        };
        let leaked = page("BT /F1 12 Tf 72 700 Td (SECRET-CANARY) Tj ET");
        let redacted = page("BT /F1 12 Tf 72 700 Td (Nothing to see) Tj ET");
        let spec = redact::AuditSpec {
            regions: Default::default(),
            terms: vec!["SECRET-CANARY".into()],
        };
        doc.redaction_audit.lock().unwrap().candidate =
            Some((Sha256::digest(&redacted).to_vec(), spec));

        // Committing other bytes, as when attaching the redacted output failed, arms nothing.
        let base = doc.current_revision.lock().unwrap().revision_id.clone();
        let unrelated = commit_revision(&doc, &base, &leaked, 1).unwrap();
        let armed = doc.redaction_audit.lock().unwrap().armed.clone();
        assert!(armed.is_none());
        assert!(verify_redactions(&leaked, armed.as_ref()).is_ok());

        commit_revision(&doc, &unrelated.revision_id, &redacted, 1).unwrap();
        let armed = doc.redaction_audit.lock().unwrap().armed.clone();
        assert!(armed.is_some());
        assert!(doc.redaction_audit.lock().unwrap().candidate.is_none());
        assert!(verify_redactions(&redacted, armed.as_ref()).is_ok());
        let error = verify_redactions(&leaked, armed.as_ref()).unwrap_err();
        assert!(
            error.contains("redaction audit") && !error.contains("SECRET"),
            "{error}"
        );
    }
}

#[tauri::command]
pub async fn print_document(app: AppHandle, request: Request<'_>) -> Result<bool, String> {
    let bytes = payload(&request)?;
    let pages: u32 = header(&request, "x-page-count")?
        .parse()
        .map_err(|_| "Invalid print page count.")?;
    tauri::async_runtime::spawn_blocking(move || {
        filesystem::validate_pdf_structure(&bytes, pages).map_err(|err| err.for_print())?;
        #[cfg(target_os = "macos")]
        {
            let (send, receive) = std::sync::mpsc::channel();
            app.run_on_main_thread(move || {
                let result = (|| {
                    use objc2::{AnyThread, MainThreadMarker};
                    use objc2_foundation::NSData;
                    use objc2_app_kit::NSPrintInfo;
                    use objc2_pdf_kit::{PDFDocument, PDFPrintScalingMode};
                    let mtm = MainThreadMarker::new().ok_or("Printing requires the main thread.")?;
                    let data = NSData::with_bytes(&bytes);
                    // PDFKit retains its data and the document stays alive for the
                    // entire modal operation. No source file is written or launched.
                    let document = unsafe { PDFDocument::initWithData(PDFDocument::alloc(), &data) }
                        .ok_or("The print copy could not be opened.")?;
                    let print_info = NSPrintInfo::sharedPrintInfo();
                    let operation = unsafe {
                        document.printOperationForPrintInfo_scalingMode_autoRotate(
                            Some(&print_info), PDFPrintScalingMode::PageScaleDownToFit, true, mtm,
                        )
                    }.ok_or("The system print operation could not be created.")?;
                    Ok(operation.runOperation())
                })();
                let _ = send.send(result);
            }).map_err(|_| "The system print dialog could not be opened.")?;
            receive.recv().map_err(|_| "The print operation was interrupted.")?
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = app;
            Err("Native printing is currently supported on macOS. Save a copy and print from your system PDF viewer.".into())
        }
    }).await.map_err(|_| "Preparing the print copy failed.")?
}

#[tauri::command]
pub async fn ocr_recognize_page(request: Request<'_>) -> Result<crate::ocr::OcrPageResult, String> {
    let image_bytes = payload(&request).map_err(|_| "Invalid OCR image payload.".to_string())?;
    let options: crate::ocr::OcrOptions = serde_json::from_str(&header(&request, "x-ocr-options")?)
        .map_err(|_| "Invalid OCR options.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || crate::ocr::recognize_page(&image_bytes, &options))
        .await
        .map_err(|_| "OCR recognition task failed.".to_string())?
}

#[tauri::command]
pub fn ocr_get_engine_info() -> Result<crate::ocr::OcrEngineInfo, String> {
    crate::ocr::get_engine_info()
}
