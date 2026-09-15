//! IPC for the local PDF engine. Document bytes are staged in memory under opaque ids, so
//! typed JSON commands never carry large payloads, and passwords never travel in headers.

use super::{document, payload, AppState};
use crate::engine::{compress, edit, protect, prune, redact, sign};
use crate::{filesystem, logging};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;
use tauri::ipc::{Request, Response};
use tauri::{AppHandle, Manager, State};

/// Staged buffers kept at once; the oldest is dropped when a new one arrives.
const MAX_STAGED_BUFFERS: usize = 8;
/// A document plus one bounded decoded image may be staged without allowing unbounded renderer
/// requests to retain multiple gigabytes of native memory.
const MAX_STAGED_BYTES: u64 = filesystem::MAX_FILE_BYTES + 256 * 1024 * 1024;
const STATE_UNAVAILABLE: &str = "The local engine state is unavailable.";

#[derive(Default)]
struct Buffers {
    entries: HashMap<String, Arc<Vec<u8>>>,
    order: VecDeque<String>,
    bytes: u64,
}

#[derive(Default)]
pub struct EngineState {
    buffers: Mutex<Buffers>,
    jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// The certificate chosen for signing; its decrypted key never leaves native memory.
    identity: Mutex<Option<Arc<sign::SigningIdentity>>>,
}

impl EngineState {
    fn stage(&self, bytes: Vec<u8>) -> Result<String, String> {
        self.stage_with_budget(bytes, MAX_STAGED_BYTES)
    }

    fn stage_with_budget(&self, bytes: Vec<u8>, budget: u64) -> Result<String, String> {
        let size = bytes.len() as u64;
        if size > budget {
            return Err("The local engine has reached its staged data limit. Try again after the current operation finishes.".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let mut buffers = self.buffers.lock().map_err(|_| STATE_UNAVAILABLE)?;
        while (buffers.order.len() >= MAX_STAGED_BUFFERS
            || buffers.bytes.saturating_add(size) > budget)
            && !buffers.order.is_empty()
        {
            if let Some(oldest) = buffers.order.pop_front() {
                if let Some(removed) = buffers.entries.remove(&oldest) {
                    buffers.bytes = buffers.bytes.saturating_sub(removed.len() as u64);
                }
            }
        }
        buffers.entries.insert(id.clone(), Arc::new(bytes));
        buffers.order.push_back(id.clone());
        buffers.bytes = buffers.bytes.saturating_add(size);
        Ok(id)
    }

    fn take(&self, id: &str) -> Result<Arc<Vec<u8>>, String> {
        let mut buffers = self.buffers.lock().map_err(|_| STATE_UNAVAILABLE)?;
        buffers.order.retain(|entry| entry != id);
        let bytes = buffers
            .entries
            .remove(id)
            .ok_or("The staged document data is no longer available. Try again.")?;
        buffers.bytes = buffers.bytes.saturating_sub(bytes.len() as u64);
        Ok(bytes)
    }

    fn job(&self, id: &str) -> Result<Arc<AtomicBool>, String> {
        let flag = Arc::new(AtomicBool::new(false));
        self.jobs
            .lock()
            .map_err(|_| STATE_UNAVAILABLE)?
            .insert(id.to_owned(), flag.clone());
        Ok(flag)
    }

    fn finish(&self, id: &str) {
        if let Ok(mut jobs) = self.jobs.lock() {
            jobs.remove(id);
        }
    }

    fn cancel(&self, id: &str) {
        if let Some(flag) = self.jobs.lock().ok().and_then(|jobs| jobs.get(id).cloned()) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineOutcome<R> {
    pub output_id: Option<String>,
    pub report: R,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectedSave {
    pub name: String,
    pub size: u64,
    pub replaced_source: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedSave {
    pub name: String,
    pub size: u64,
}

async fn run_job<T: Send + 'static>(
    app: &AppHandle,
    job_id: &str,
    work: impl FnOnce(&AtomicBool) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let state = app.state::<AppState>();
    let cancel = state.engine.job(job_id)?;
    let result = tauri::async_runtime::spawn_blocking(move || work(&cancel))
        .await
        .map_err(|_| {
            "The local engine stopped unexpectedly. The document is unchanged.".to_string()
        });
    state.engine.finish(job_id);
    result?
}

/// The file name the save picker suggests for a derived copy of the open document.
fn suggested_name(doc: &super::Opened, suffix: &str) -> String {
    let name = doc
        .name
        .lock()
        .map(|name| name.clone())
        .unwrap_or_else(|_| "Document.pdf".into());
    let stem = name
        .strip_suffix(".pdf")
        .or_else(|| name.strip_suffix(".PDF"))
        .unwrap_or(&name);
    format!("{stem}-{suffix}.pdf")
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Document.pdf".into())
}

#[tauri::command]
pub async fn engine_stage(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let bytes = payload(&request)?;
    app.state::<AppState>().engine.stage(bytes)
}

#[tauri::command]
pub fn engine_take(state: State<AppState>, id: String) -> Result<Response, String> {
    let bytes = state.engine.take(&id)?;
    Ok(Response::new(
        Arc::try_unwrap(bytes).unwrap_or_else(|shared| shared.as_ref().clone()),
    ))
}

#[tauri::command]
pub fn engine_discard(state: State<AppState>, id: String) {
    let _ = state.engine.take(&id);
}

#[tauri::command]
pub fn engine_cancel(state: State<AppState>, job_id: String) {
    state.engine.cancel(&job_id);
}

#[tauri::command]
pub async fn engine_redact(
    app: AppHandle,
    input_id: String,
    document_id: String,
    job_id: String,
    request: redact::RedactionRequest,
) -> Result<EngineOutcome<redact::RedactionReport>, String> {
    let state = app.state::<AppState>();
    let doc = document(&state, &document_id)?;
    let spec = redact::AuditSpec::from_request(&request)?;
    let bytes = state.engine.take(&input_id)?;
    let result = run_job(&app, &job_id, move |cancel| {
        redact::apply(&bytes, &request, cancel)
    })
    .await;
    logging::record(&state.root, "engine_redact", result.is_err());
    let (output, report) = result?;
    // Neither a plain Save nor an implicit recovery cleanup may happen until the renderer has
    // attached this candidate and the replacement save has committed successfully.
    *doc.force_save_as.lock().map_err(|_| STATE_UNAVAILABLE)? = true;
    // The renderer re-serializes this output before saving. The audit arms when these exact
    // bytes are committed as a revision and is re-run by every save until one succeeds.
    doc.redaction_audit
        .lock()
        .map_err(|_| STATE_UNAVAILABLE)?
        .candidate = Some((Sha256::digest(&output).to_vec(), spec));
    Ok(EngineOutcome {
        output_id: Some(state.engine.stage(output)?),
        report,
    })
}

#[tauri::command]
pub async fn engine_compress(
    app: AppHandle,
    input_id: String,
    job_id: String,
    preset: compress::CompressionPreset,
) -> Result<EngineOutcome<compress::CompressionReport>, String> {
    let state = app.state::<AppState>();
    let bytes = state.engine.take(&input_id)?;
    let result = run_job(&app, &job_id, move |cancel| {
        compress::compress(&bytes, preset, cancel)
    })
    .await;
    logging::record(&state.root, "engine_compress", result.is_err());
    let (output, report) = result?;
    let output_id = output.map(|bytes| state.engine.stage(bytes)).transpose()?;
    Ok(EngineOutcome { output_id, report })
}

#[tauri::command]
pub async fn engine_prune(app: AppHandle, input_id: String) -> Result<String, String> {
    let state = app.state::<AppState>();
    let bytes = state.engine.take(&input_id)?;
    let result = tauri::async_runtime::spawn_blocking(move || prune::prune(&bytes))
        .await
        .map_err(|_| "Pruning failed.".to_string())?;
    logging::record(&state.root, "engine_prune", result.is_err());
    let output = result?;
    state.engine.stage(output)
}

#[tauri::command]
pub async fn engine_inspect_page(
    app: AppHandle,
    input_id: String,
    page: u32,
) -> Result<edit::PageObjects, String> {
    let bytes = app.state::<AppState>().engine.take(&input_id)?;
    tauri::async_runtime::spawn_blocking(move || edit::inspect(&bytes, page))
        .await
        .map_err(|_| "The page could not be scanned.")?
}

#[tauri::command]
pub async fn engine_edit(
    app: AppHandle,
    input_id: String,
    page: u32,
    request: edit::EditRequest,
    image_id: Option<String>,
) -> Result<EngineOutcome<edit::EditReport>, String> {
    let state = app.state::<AppState>();
    let bytes = state.engine.take(&input_id)?;
    let image = image_id.map(|id| state.engine.take(&id)).transpose()?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        edit::apply(&bytes, page, &request, image.as_deref().map(Vec::as_slice))
    })
    .await
    .map_err(|_| "The edit could not be applied. The document is unchanged.")?;
    logging::record(&state.root, "engine_edit", result.is_err());
    let (output, report) = result?;
    let output_id = output.map(|bytes| state.engine.stage(bytes)).transpose()?;
    Ok(EngineOutcome { output_id, report })
}

/// Encrypts the staged document and writes it through the native Save As picker with a
/// password-aware validator. The open working document itself stays unencrypted.
#[tauri::command]
pub async fn engine_save_protected(
    app: AppHandle,
    input_id: String,
    document_id: String,
    expected_pages: u32,
    request: protect::ProtectionRequest,
) -> Result<Option<ProtectedSave>, String> {
    let state = app.state::<AppState>();
    let doc = document(&state, &document_id)?;
    let bytes = state.engine.take(&input_id)?;
    let owner = protect::owner_password(&request)?;
    let (source, source_hash) = doc.source.lock().map_err(|_| STATE_UNAVAILABLE)?.clone();
    let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter("PDF", &["pdf"])
        .set_file_name(suggested_name(&doc, "protected"))
        .save_file()
        .await
    else {
        return Ok(None);
    };
    let target = file.path().to_path_buf();
    let replaced_source = target == source && source != doc._snapshot.path();
    let check = if replaced_source {
        Some(source_hash)
    } else if target.exists() {
        Some(filesystem::fingerprint(&target)?)
    } else {
        None
    };
    let root = state.root.clone();
    let worker_doc = doc.clone();
    let worker_id = document_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let output = protect::protect(&bytes, &request, expected_pages)?;
        let hash = filesystem::atomic_save_with(&target, &output, check.as_deref(), |candidate| {
            protect::validate_protected(candidate, &request.user_password, &owner, expected_pages)
        })?;
        if replaced_source {
            adopt_protected_source(&worker_doc, &root, &worker_id, target.clone(), hash)?;
        }
        Ok::<_, String>(ProtectedSave {
            name: file_name(&target),
            size: output.len() as u64,
            replaced_source,
        })
    })
    .await
    .map_err(|_| "The protected copy could not be saved. Nothing was replaced.".to_string())?;
    logging::record(&state.root, "engine_save_protected", result.is_err());
    result.map(Some)
}

/// After an in-place protected save the open document is an unlocked copy of an encrypted
/// file: no working revision or recovery copy may remain, and a plain Save must ask for a name.
pub(super) fn adopt_protected_source(
    doc: &super::Opened,
    root: &Path,
    document_id: &str,
    target: std::path::PathBuf,
    hash: Vec<u8>,
) -> Result<(), String> {
    *doc.source.lock().map_err(|_| STATE_UNAVAILABLE)? = (target, hash);
    for flag in [&doc.force_save_as, &doc.sensitive, &doc.source_encrypted] {
        *flag.lock().map_err(|_| STATE_UNAVAILABLE)? = true;
    }
    *doc.working_file.lock().map_err(|_| STATE_UNAVAILABLE)? = None;
    super::recovery::discard(root, document_id)
}

/// Decrypts the open document's original bytes into an editable working copy. The session
/// is marked sensitive so recovery copies and working-revision files are never written.
#[tauri::command]
pub async fn engine_unlock(
    app: AppHandle,
    document_id: String,
    password: String,
) -> Result<String, String> {
    let state = app.state::<AppState>();
    let doc = document(&state, &document_id)?;
    let original = doc._snapshot.path().to_path_buf();
    let output = tauri::async_runtime::spawn_blocking(move || {
        let bytes = fs::read(&original).map_err(|_| "The protected PDF could not be read.")?;
        protect::unlock(&bytes, &password)
    })
    .await
    .map_err(|_| "The document could not be unlocked.")?;
    logging::record(&state.root, "engine_unlock", output.is_err());
    let output = output?;
    *doc.sensitive.lock().map_err(|_| STATE_UNAVAILABLE)? = true;
    *doc.force_save_as.lock().map_err(|_| STATE_UNAVAILABLE)? = true;
    *doc.source_encrypted.lock().map_err(|_| STATE_UNAVAILABLE)? = true;
    state.engine.stage(output)
}

/// Opens a PKCS #12 identity chosen in the native picker. The file never reaches the renderer,
/// the password is used only here, and the decrypted key stays in native memory until the
/// renderer releases it or another certificate is chosen.
#[tauri::command]
pub async fn engine_choose_certificate(
    app: AppHandle,
    password: String,
) -> Result<Option<sign::CertificateSummary>, String> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter("Certificate", &["p12", "pfx"])
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    let path = file.path().to_path_buf();
    let result = tauri::async_runtime::spawn_blocking(move || {
        const UNREADABLE: &str = "The certificate file could not be read.";
        let size = fs::metadata(&path).map_err(|_| UNREADABLE)?.len();
        if size > sign::MAX_IDENTITY_BYTES as u64 {
            return Err("The certificate file is too large.".to_string());
        }
        let data = fs::read(&path).map_err(|_| UNREADABLE)?;
        sign::load_identity(&data, &password, SystemTime::now())
    })
    .await
    .map_err(|_| "The certificate could not be read.".to_string())
    .and_then(|result| result);
    let state = app.state::<AppState>();
    logging::record(&state.root, "engine_choose_certificate", result.is_err());
    let identity = result?;
    let summary = identity.summary.clone();
    *state
        .engine
        .identity
        .lock()
        .map_err(|_| STATE_UNAVAILABLE)? = Some(Arc::new(identity));
    Ok(Some(summary))
}

#[tauri::command]
pub fn engine_forget_certificate(state: State<AppState>) {
    if let Ok(mut identity) = state.engine.identity.lock() {
        *identity = None;
    }
}

/// Signs the staged document with the chosen certificate and writes the result through the
/// native Save As picker once the candidate verifies. The open document stays unsigned.
#[tauri::command]
pub async fn engine_save_signed(
    app: AppHandle,
    input_id: String,
    document_id: String,
    expected_pages: u32,
    request: sign::SignRequest,
) -> Result<Option<SignedSave>, String> {
    let state = app.state::<AppState>();
    let doc = document(&state, &document_id)?;
    let bytes = state.engine.take(&input_id)?;
    let identity = state
        .engine
        .identity
        .lock()
        .map_err(|_| STATE_UNAVAILABLE)?
        .clone()
        .ok_or("Choose a certificate before signing.")?;
    let signed = tauri::async_runtime::spawn_blocking(move || {
        sign::sign(&bytes, &identity, &request, SystemTime::now())
    })
    .await
    .map_err(|_| "The document could not be signed. Nothing was saved.".to_string())
    .and_then(|result| result);
    logging::record(&state.root, "engine_sign", signed.is_err());
    let signed = signed?;
    let (source, _) = doc.source.lock().map_err(|_| STATE_UNAVAILABLE)?.clone();
    let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter("PDF", &["pdf"])
        .set_file_name(suggested_name(&doc, "signed"))
        .save_file()
        .await
    else {
        return Ok(None);
    };
    let target = file.path().to_path_buf();
    if target == source {
        return Err(
            "Save the signed copy under a new name. The open document stays unsigned.".into(),
        );
    }
    let check = if target.exists() {
        Some(filesystem::fingerprint(&target)?)
    } else {
        None
    };
    let result = tauri::async_runtime::spawn_blocking(move || {
        filesystem::atomic_save_with(&target, &signed, check.as_deref(), |candidate| {
            sign::validate_signed(candidate, expected_pages)
        })?;
        Ok::<_, String>(SignedSave {
            name: file_name(&target),
            size: signed.len() as u64,
        })
    })
    .await
    .map_err(|_| "The signed copy could not be saved. Nothing was replaced.".to_string())
    .and_then(|result| result);
    logging::record(&state.root, "engine_save_signed", result.is_err());
    result.map(Some)
}

/// Checks the signatures in the file as it was opened, not the renderer's working copy.
#[tauri::command]
pub async fn engine_verify_signatures(
    app: AppHandle,
    document_id: String,
) -> Result<Vec<sign::SignatureInfo>, String> {
    let state = app.state::<AppState>();
    let doc = document(&state, &document_id)?;
    let original = doc._snapshot.path().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = fs::read(&original).map_err(|_| "The opened PDF could not be read.")?;
        sign::verify(&bytes)
    })
    .await
    .map_err(|_| "The signatures could not be checked.")?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn staged_buffers_are_bounded_and_single_use() {
        let engine = EngineState::default();
        let first = engine.stage(vec![1]).unwrap();
        let ids: Vec<String> = (0..MAX_STAGED_BUFFERS)
            .map(|i| engine.stage(vec![i as u8]).unwrap())
            .collect();
        assert!(engine.take(&first).is_err(), "the oldest buffer is evicted");
        assert_eq!(*engine.take(&ids[0]).unwrap(), vec![0]);
        assert!(engine.take(&ids[0]).is_err(), "a buffer can be taken once");

        let flag = engine.job("job").unwrap();
        engine.cancel("job");
        assert!(flag.load(Ordering::Relaxed));
        engine.finish("job");
        engine.cancel("job");
    }

    #[test]
    fn staged_buffers_are_bounded_by_bytes_and_evict_oldest_first() {
        let engine = EngineState::default();
        let first = engine.stage_with_budget(vec![1, 2], 3).unwrap();
        let second = engine.stage_with_budget(vec![3, 4], 3).unwrap();

        assert!(engine.take(&first).is_err());
        assert_eq!(*engine.take(&second).unwrap(), vec![3, 4]);
        assert!(engine.stage_with_budget(vec![0; 4], 3).is_err());
    }
}
