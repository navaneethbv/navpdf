use std::{
    fs::OpenOptions,
    io::Write,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
/// Only static operation and classification strings are accepted, never document payloads.
pub fn record(root: &Path, operation: &'static str, error: bool) {
    let path = root.join("events.jsonl");
    if path
        .metadata()
        .map(|m| m.len() > 1024 * 1024)
        .unwrap_or(false)
    {
        let _ = std::fs::rename(&path, root.join("events.previous.jsonl"));
    }
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    if let Ok(mut file) = options.open(path) {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|t| t.as_secs())
            .unwrap_or(0);
        let value = serde_json::json!({"timestamp":timestamp,"severity":if error {"error"} else {"info"},"component":"filesystem","operation":operation,"stack":if error {Some(std::backtrace::Backtrace::force_capture().to_string())} else {None}});
        let _ = writeln!(file, "{value}");
    }
}
