//! Certificates the user chose to trust for checking signatures, kept on this device only.
//! The list holds public certificates, never keys, and is read when signatures are checked.

use super::{document, AppState};
use crate::engine::sign;
use crate::{filesystem, logging};
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Manager, State};
use x509_cert::der::{Decode, Encode};
use x509_cert::Certificate;

const FILE: &str = "trusted-certificates.json";
/// Enough for a personal or organisational list; more suggests a mistaken import.
const MAX_TRUSTED: usize = 64;
const UNAVAILABLE: &str = "The trusted certificate list is unavailable.";

fn encode_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn decode_hex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(text.get(index..index + 2)?, 16).ok())
        .collect()
}

/// The trusted certificates; unreadable entries are skipped rather than failing every check.
pub fn load(root: &Path) -> Vec<Certificate> {
    let Ok(text) = fs::read_to_string(root.join(FILE)) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<String>>(&text)
        .unwrap_or_default()
        .iter()
        .filter_map(|entry| decode_hex(entry))
        .filter_map(|der| Certificate::from_der(&der).ok())
        .take(MAX_TRUSTED)
        .collect()
}

fn store(root: &Path, certificates: &[Certificate]) -> Result<(), String> {
    let entries: Vec<String> = certificates
        .iter()
        .map(|certificate| certificate.to_der().map(|der| encode_hex(&der)))
        .collect::<Result<_, _>>()
        .map_err(|_| UNAVAILABLE)?;
    filesystem::private_json(&root.join(FILE), &entries)
}

fn listing(certificates: &[Certificate]) -> Vec<sign::CertificateDetails> {
    certificates
        .iter()
        .map(|certificate| sign::certificate_details(certificate, true))
        .collect()
}

/// Adds a certificate unless it is already trusted.
pub fn add(root: &Path, certificate: Certificate) -> Result<Vec<sign::CertificateDetails>, String> {
    let mut certificates = load(root);
    let der = certificate.to_der().map_err(|_| UNAVAILABLE)?;
    let wanted = sign::fingerprint(&der);
    let known = certificates.iter().any(|existing| {
        existing
            .to_der()
            .is_ok_and(|existing| sign::fingerprint(&existing) == wanted)
    });
    if !known {
        if certificates.len() >= MAX_TRUSTED {
            return Err(format!("Up to {MAX_TRUSTED} certificates can be trusted."));
        }
        certificates.push(certificate);
        store(root, &certificates)?;
    }
    Ok(listing(&certificates))
}

pub fn remove(root: &Path, wanted: &str) -> Result<Vec<sign::CertificateDetails>, String> {
    let mut certificates = load(root);
    certificates.retain(|certificate| {
        certificate
            .to_der()
            .is_ok_and(|der| sign::fingerprint(&der) != wanted)
    });
    store(root, &certificates)?;
    Ok(listing(&certificates))
}

#[tauri::command]
pub fn trust_list(state: State<AppState>) -> Vec<sign::CertificateDetails> {
    listing(&load(&state.root))
}

/// Trusts a certificate file chosen in the native picker; null when the picker is cancelled.
#[tauri::command]
pub async fn trust_import(app: AppHandle) -> Result<Option<Vec<sign::CertificateDetails>>, String> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter("Certificate", &["cer", "crt", "pem", "der"])
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    let path = file.path().to_path_buf();
    let state = app.state::<AppState>();
    let root = state.root.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        const UNREADABLE: &str = "The certificate file could not be read.";
        let size = fs::metadata(&path).map_err(|_| UNREADABLE)?.len();
        if size > sign::MAX_CERTIFICATE_BYTES as u64 {
            return Err("The certificate file is too large.".to_string());
        }
        let data = fs::read(&path).map_err(|_| UNREADABLE)?;
        add(&root, sign::parse_certificate(&data)?)
    })
    .await
    .map_err(|_| UNAVAILABLE.to_string())
    .and_then(|result| result);
    logging::record(&state.root, "trust_import", result.is_err());
    result.map(Some)
}

/// Trusts a certificate carried in a signature of the open document, chosen by fingerprint.
#[tauri::command]
pub async fn trust_signature_certificate(
    app: AppHandle,
    document_id: String,
    fingerprint: String,
) -> Result<Vec<sign::CertificateDetails>, String> {
    let state = app.state::<AppState>();
    let doc = document(&state, &document_id)?;
    let original = doc._snapshot.path().to_path_buf();
    let root = state.root.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let bytes = fs::read(&original).map_err(|_| "The opened PDF could not be read.")?;
        let der = sign::embedded_certificate(&bytes, &fingerprint)?;
        add(&root, Certificate::from_der(&der).map_err(|_| UNAVAILABLE)?)
    })
    .await
    .map_err(|_| UNAVAILABLE.to_string())
    .and_then(|result| result);
    logging::record(&state.root, "trust_signature_certificate", result.is_err());
    result
}

#[tauri::command]
pub fn trust_remove(
    state: State<AppState>,
    fingerprint: String,
) -> Result<Vec<sign::CertificateDetails>, String> {
    remove(&state.root, &fingerprint)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_round_trips_and_rejects_odd_or_foreign_text() {
        assert_eq!(
            decode_hex(&encode_hex(&[0, 15, 255])),
            Some(vec![0, 15, 255])
        );
        assert_eq!(decode_hex("abc"), None);
        assert_eq!(decode_hex("zz"), None);
    }

    #[test]
    fn a_corrupt_list_reads_as_empty() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join(FILE), "not json").unwrap();
        assert!(load(root.path()).is_empty());
        fs::write(root.path().join(FILE), r#"["zz", "00"]"#).unwrap();
        assert!(load(root.path()).is_empty());
    }
}
