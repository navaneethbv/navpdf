use crate::{commands::AppState, filesystem};
use tauri::{
    ipc::{InvokeBody, Request},
    AppHandle, Manager,
};

fn export_name(name: &str) -> Result<&str, String> {
    if name.is_empty()
        || name.len() > 240
        || name.starts_with('.')
        || name
            .chars()
            .any(|c| c.is_control() || c == '/' || c == '\\' || c == ':')
    {
        return Err("Choose a valid export filename.".into());
    }
    Ok(name)
}

/// The webview supplies bytes and a suggested name, never a destination path.
#[tauri::command]
pub async fn export_file(app: AppHandle, request: Request<'_>) -> Result<bool, String> {
    let name: String = serde_json::from_str(
        request
            .headers()
            .get("x-export-name")
            .and_then(|v| v.to_str().ok())
            .ok_or("Invalid export request.")?,
    )
    .map_err(|_| "Invalid export filename.")?;
    export_name(&name)?;
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) if bytes.len() as u64 <= filesystem::MAX_FILE_BYTES => bytes.clone(),
        _ => return Err("The export exceeds the 1 GB limit.".into()),
    };
    {
        let state = app.state::<AppState>();
        let mut saving = state.saving.lock().map_err(|_| "Save state unavailable.")?;
        if *saving {
            return Err("A save is already in progress.".into());
        }
        *saving = true;
    }
    let result = async {
        let Some(file) = rfd::AsyncFileDialog::new()
            .set_file_name(&name)
            .save_file()
            .await
        else {
            return Ok(false);
        };
        let target = file.path().to_path_buf();
        tauri::async_runtime::spawn_blocking(move || {
            let expected = if target.exists() {
                Some(filesystem::fingerprint(&target)?)
            } else {
                None
            };
            filesystem::atomic_save_with(&target, &bytes, expected.as_deref(), |_| Ok(()))?;
            Ok(true)
        })
        .await
        .map_err(|_| "The export could not be saved.")?
    }
    .await;
    if let Ok(mut saving) = app.state::<AppState>().saving.lock() {
        *saving = false;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn export_names_cannot_supply_paths_or_hidden_files() {
        for name in [
            "",
            ".profile",
            "../report.txt",
            "a/b.txt",
            "a\\b.txt",
            "a:b.txt",
            "a\n.txt",
        ] {
            assert!(export_name(name).is_err());
        }
        assert_eq!(
            export_name("Résumé report.pptx").unwrap(),
            "Résumé report.pptx"
        );
        assert!(export_name(&"a".repeat(241)).is_err());
    }
    #[test]
    fn exported_bytes_round_trip_and_collisions_preserve_the_destination() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("report.txt");
        let bytes = "Résumé\nExported text".as_bytes();
        filesystem::atomic_save_with(&path, bytes, None, |_| Ok(())).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert!(filesystem::atomic_save_with(&path, b"collision", None, |_| Ok(())).is_err());
        assert_eq!(std::fs::read(path).unwrap(), bytes);
    }
}
