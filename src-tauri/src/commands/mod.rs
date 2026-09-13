use crate::{filesystem, logging, security};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, Emitter, Manager, State, WebviewWindow,
};
use tempfile::NamedTempFile;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub theme: String,
    pub default_zoom: String,
    pub layout: String,
    pub remember_page: bool,
    pub autosave: bool,
    pub recent_files: bool,
    pub network_access: bool,
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
pub struct Recovery {
    pub name: String,
    pub saved_at: u64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub name: String,
    pub size: u64,
}
pub struct Opened {
    pub file: Mutex<File>,
    pub _snapshot: NamedTempFile,
    pub source: Mutex<(PathBuf, Vec<u8>)>,
    pub length: u64,
    pub name: Mutex<String>,
}
pub struct AppState {
    pub documents: Mutex<HashMap<String, Arc<Opened>>>,
    pub local: Mutex<LocalData>,
    pub root: PathBuf,
    pub dirty: Mutex<bool>,
    pub saving: Mutex<bool>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Descriptor {
    pub id: String,
    pub name: String,
    pub size: u64,
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
fn opened(state: &AppState, path: PathBuf, remember: bool) -> Result<Descriptor, String> {
    let (snapshot, hash, length) = filesystem::snapshot(&path)?;
    let file = snapshot
        .reopen()
        .map_err(|_| "Unable to open working copy.")?;
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Document.pdf".into());
    let id = uuid::Uuid::new_v4().to_string();
    let entry = Arc::new(Opened {
        file: Mutex::new(file),
        _snapshot: snapshot,
        source: Mutex::new((path.clone(), hash)),
        length,
        name: Mutex::new(name.clone()),
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
        id,
        name,
        size: length,
    })
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
    if !security::valid_range(begin, end, doc.length) {
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
pub async fn save_document(app: AppHandle, request: Request<'_>) -> Result<Option<SaveResult>, String> {
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
        let target = if save_as || source == app.state::<AppState>().root.join("recovery.pdf") {
            let Some(file) = rfd::AsyncFileDialog::new()
                .add_filter("PDF", &["pdf"])
                .set_file_name(&current_name)
                .save_file()
                .await
            else {
                return Ok(None);
            };
            file.path().to_path_buf()
        } else {
            source.clone()
        };
        let check = if target == source {
            Some(hash)
        } else if target.exists() {
            Some(filesystem::fingerprint(&target)?)
        } else {
            None
        };
        let worker_app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let new_hash = filesystem::atomic_save(&target, &bytes, pages, check.as_deref())?;
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
            let _ = fs::remove_file(state.root.join("recovery.pdf"));
            let _ = fs::remove_file(state.root.join("recovery.json"));
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
pub fn local_state(state: State<AppState>) -> Result<serde_json::Value, String> {
    let local = state.local.lock().map_err(|_| "Settings unavailable.")?;
    let recovery = fs::read(state.root.join("recovery.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Recovery>(&bytes).ok());
    Ok(serde_json::json!({
        "preferences": local.preferences,
        "recents": local.recents.iter().map(|r| serde_json::json!({
            "id": r.id,
            "name": r.name,
            "openedAt": r.opened_at,
            "page": r.page,
        })).collect::<Vec<_>>(),
        "recovery": recovery.map(|r| serde_json::json!({
            "name": r.name,
            "savedAt": r.saved_at,
        })),
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
    let doc_name = doc
        .name
        .lock()
        .map(|n| n.clone())
        .unwrap_or_else(|_| "Document.pdf".into());
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        if !state
            .local
            .lock()
            .map_err(|_| "Settings unavailable.")?
            .preferences
            .autosave
        {
            return Ok(());
        }
        filesystem::atomic_save(&state.root.join("recovery.pdf"), &bytes, pages, None)?;
        filesystem::private_json(
            &state.root.join("recovery.json"),
            &Recovery {
                name: doc_name,
                saved_at: time(),
            },
        )
    })
    .await
    .map_err(|_| "Recovery could not be saved.")?
}
#[tauri::command]
pub async fn open_recovery(app: AppHandle) -> Result<Descriptor, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        opened(&state, state.root.join("recovery.pdf"), false)
    })
    .await
    .map_err(|_| "Recovery could not be opened.")?
}
#[tauri::command]
pub fn discard_recovery(state: State<AppState>) -> Result<(), String> {
    for name in ["recovery.pdf", "recovery.json"] {
        let path = state.root.join(name);
        if path.exists() {
            fs::remove_file(path).map_err(|_| "Recovery could not be removed.")?;
        }
    }
    Ok(())
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

pub fn emit_action(app: &AppHandle, action: &str) {
    let _ = app.emit("menu-action", action);
}
