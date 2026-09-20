use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{self, Read, Write},
    path::Path,
};
use tempfile::{NamedTempFile, PersistError};

pub const MAX_FILE_BYTES: u64 = 1024 * 1024 * 1024;
pub const MAX_RANGE_BYTES: u64 = 4 * 1024 * 1024;

/// Steps of `atomic_save` where tests can inject an I/O failure.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum SaveStep {
    Write,
    Flush,
    Persist,
}

#[cfg(test)]
thread_local! {
    static INJECTED_FAILURE: std::cell::Cell<Option<(SaveStep, io::ErrorKind)>> =
        const { std::cell::Cell::new(None) };
}

#[cfg(test)]
fn injected_failure(step: SaveStep) -> io::Result<()> {
    match INJECTED_FAILURE.with(|failure| failure.get()) {
        Some((failing, kind)) if failing == step => Err(io::Error::from(kind)),
        _ => Ok(()),
    }
}

#[cfg(not(test))]
#[inline(always)]
fn injected_failure(_step: SaveStep) -> io::Result<()> {
    Ok(())
}

pub fn fingerprint(path: &Path) -> Result<Vec<u8>, String> {
    let mut file = File::open(path).map_err(|_| "The source file is no longer accessible.")?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 65536];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| "Unable to verify the source file.")?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(digest.finalize().to_vec())
}

pub fn snapshot(path: &Path) -> Result<(NamedTempFile, Vec<u8>, u64), String> {
    let mut source =
        File::open(path).map_err(|_| "This file could not be opened. Check its permissions.")?;
    let length = source
        .metadata()
        .map_err(|_| "Cannot read the file details.")?
        .len();
    if length == 0 || length > MAX_FILE_BYTES {
        return Err("Choose a PDF smaller than 1 GB.".into());
    }
    let mut temp = NamedTempFile::new().map_err(|_| "Unable to create a private working copy.")?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 65536];
    let mut total = 0_u64;
    loop {
        let count = source
            .read(&mut buffer)
            .map_err(|_| "Unable to read the PDF.")?;
        if count == 0 {
            break;
        }
        if total == 0 && !buffer[..count.min(1024)].windows(5).any(|w| w == b"%PDF-") {
            return Err("This file does not appear to be a PDF.".into());
        }
        total += count as u64;
        if total > MAX_FILE_BYTES {
            return Err("The PDF exceeds the 1 GB limit.".into());
        }
        digest.update(&buffer[..count]);
        temp.write_all(&buffer[..count])
            .map_err(|_| "Unable to create a working copy. Check free disk space.")?;
    }
    if total != length {
        return Err("The file changed while opening. Try again.".into());
    }
    temp.flush()
        .map_err(|_| "Unable to finish opening the PDF.")?;
    Ok((temp, digest.finalize().to_vec(), length))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ValidationError {
    EmptyOrTooLarge,
    Unparseable,
    Encrypted,
    PageCount { expected: u32, actual: usize },
}

impl ValidationError {
    pub fn for_save(&self) -> String {
        match self {
            ValidationError::EmptyOrTooLarge => "The output PDF is empty or too large.".into(),
            ValidationError::Unparseable => {
                "Changes could not be saved: the output PDF failed validation.".into()
            }
            ValidationError::Encrypted => {
                "Saving encrypted documents is not available in this milestone. The original is unchanged.".into()
            }
            ValidationError::PageCount { .. } => {
                "Changes could not be saved: the output page count is incorrect.".into()
            }
        }
    }

    pub fn for_commit(&self) -> String {
        match self {
            ValidationError::EmptyOrTooLarge => "The revision PDF is empty or too large.".into(),
            ValidationError::Unparseable => {
                "Working revision could not be committed: the PDF failed validation.".into()
            }
            ValidationError::Encrypted => "Encrypted revisions are not supported.".into(),
            ValidationError::PageCount { .. } => {
                "Working revision could not be committed: the page count is incorrect.".into()
            }
        }
    }

    pub fn for_print(&self) -> String {
        match self {
            ValidationError::EmptyOrTooLarge => "The print PDF is empty or too large.".into(),
            ValidationError::Unparseable => {
                "Printing failed: the document failed validation.".into()
            }
            ValidationError::Encrypted => {
                "Printing encrypted documents is not supported directly.".into()
            }
            ValidationError::PageCount { .. } => {
                "Printing failed: the page count is incorrect.".into()
            }
        }
    }
}

pub fn validate_pdf_structure(bytes: &[u8], expected_pages: u32) -> Result<(), ValidationError> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(ValidationError::EmptyOrTooLarge);
    }
    let document = lopdf::Document::load_mem(bytes).map_err(|_| ValidationError::Unparseable)?;
    if document.is_encrypted() {
        return Err(ValidationError::Encrypted);
    }
    let actual_pages = document.get_pages().len();
    if expected_pages == 0 || actual_pages != expected_pages as usize {
        return Err(ValidationError::PageCount {
            expected: expected_pages,
            actual: actual_pages,
        });
    }
    Ok(())
}

pub fn validate_pdf(bytes: &[u8], expected_pages: u32) -> Result<(), String> {
    validate_pdf_structure(bytes, expected_pages).map_err(|err| err.for_save())
}

pub fn atomic_save(
    path: &Path,
    bytes: &[u8],
    expected_pages: u32,
    expected_hash: Option<&[u8]>,
) -> Result<Vec<u8>, String> {
    atomic_save_with(path, bytes, expected_hash, |candidate| {
        validate_pdf(candidate, expected_pages)
    })
}

/// Atomic replacement with a caller-supplied validator, for outputs such as encrypted
/// copies that the unencrypted validator must keep rejecting.
pub fn atomic_save_with(
    path: &Path,
    bytes: &[u8],
    expected_hash: Option<&[u8]>,
    validate: impl FnOnce(&[u8]) -> Result<(), String>,
) -> Result<Vec<u8>, String> {
    validate(bytes)?;
    let parent = path.parent().ok_or("Invalid save destination.")?;
    if let Some(expected) = expected_hash {
        if fingerprint(path)? != expected {
            return Err(
                "The original PDF changed outside NavPDF. Use Save As to keep both versions."
                    .into(),
            );
        }
    }
    let mut temp = NamedTempFile::new_in(parent).map_err(|_| {
        "Changes could not be saved. Check the destination permissions and free disk space."
    })?;
    if expected_hash.is_some() {
        let permissions = fs::metadata(path)
            .map_err(|_| "Unable to read destination permissions.")?
            .permissions();
        temp.as_file()
            .set_permissions(permissions)
            .map_err(|_| "Unable to preserve destination permissions.")?;
    }
    injected_failure(SaveStep::Write)
        .and_then(|()| temp.write_all(bytes))
        .map_err(|_| "Changes could not be saved. The original file is unchanged.")?;
    injected_failure(SaveStep::Flush)
        .and_then(|()| temp.as_file().sync_all())
        .map_err(|_| "Changes could not be flushed to disk. The original file is unchanged.")?;
    // Recheck after the expensive validation and write, before replacing the source.
    if let Some(expected) = expected_hash {
        if fingerprint(path)? != expected {
            return Err("The original PDF changed while saving. Use Save As.".into());
        }
    }
    // Hash the staged file before the replacement so a fingerprint failure cannot
    // leave callers with an error after the destination has already been committed.
    let saved_hash = fingerprint(temp.path())?;
    // A failed persist returns the temporary file inside the error; dropping it
    // removes the job-owned file so no partial output remains beside the destination.
    let persisted = match injected_failure(SaveStep::Persist) {
        Err(error) => Err(PersistError { error, file: temp }),
        Ok(()) if expected_hash.is_some() => temp.persist(path),
        Ok(()) => temp.persist_noclobber(path),
    };
    if persisted.is_err() {
        return Err(if expected_hash.is_some() {
            "Atomic replacement failed. The original file is unchanged.".into()
        } else {
            "The destination already exists or cannot be created. Choose another Save As destination.".into()
        });
    }
    // Opening a destination directory for fsync blocks indefinitely in the
    // packaged macOS WebKit sandbox after a user-selected Save As path has
    // been persisted. The temporary file is already flushed before the
    // atomic rename, which is the durability boundary available here.
    #[cfg(not(target_os = "macos"))]
    if let Ok(directory) = File::open(parent) {
        let _ = directory.sync_all();
    }
    Ok(saved_hash)
}

pub fn private_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid local storage directory.")?;
    fs::create_dir_all(parent).map_err(|_| "Local settings storage is unavailable.")?;
    let mut temp =
        NamedTempFile::new_in(parent).map_err(|_| "Local settings storage is unavailable.")?;
    serde_json::to_writer(&mut temp, value).map_err(|_| "Unable to serialize local settings.")?;
    temp.as_file()
        .sync_all()
        .map_err(|_| "Unable to save local settings.")?;
    temp.persist(path)
        .map_err(|_| "Unable to replace local settings.")?;
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use lopdf::{dictionary, Object, Stream};
    pub fn fixture() -> Vec<u8> {
        fixture_with_content(Vec::new())
    }
    fn fixture_with_content(content: Vec<u8>) -> Vec<u8> {
        let mut doc = lopdf::Document::with_version("1.7");
        let pages = doc.new_object_id();
        let content = doc.add_object(Stream::new(dictionary! {}, content));
        let page = doc.add_object(dictionary! {"Type"=>"Page","Parent"=>pages,"MediaBox"=>vec![0.into(),0.into(),300.into(),400.into()],"Contents"=>content});
        doc.objects.insert(
            pages,
            Object::Dictionary(dictionary! {"Type"=>"Pages","Kids"=>vec![page.into()],"Count"=>1}),
        );
        let catalog = doc.add_object(dictionary! {"Type"=>"Catalog","Pages"=>pages});
        doc.trailer.set("Root", catalog);
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).expect("fixture serialization");
        bytes
    }
    /// Injects a failure at one save step for the lifetime of the guard.
    struct InjectedFailure;
    impl InjectedFailure {
        fn at(step: SaveStep, kind: io::ErrorKind) -> Self {
            INJECTED_FAILURE.with(|failure| failure.set(Some((step, kind))));
            Self
        }
    }
    impl Drop for InjectedFailure {
        fn drop(&mut self) {
            INJECTED_FAILURE.with(|failure| failure.set(None));
        }
    }
    fn entries(directory: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(directory)
            .expect("list directory")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        names
    }

    #[test]
    fn injected_write_flush_and_persist_failures_leave_no_partial_output() {
        let cases = [
            (
                SaveStep::Write,
                io::ErrorKind::StorageFull,
                "could not be saved",
            ),
            (
                SaveStep::Flush,
                io::ErrorKind::StorageFull,
                "could not be flushed",
            ),
            (
                SaveStep::Persist,
                io::ErrorKind::PermissionDenied,
                "Atomic replacement failed",
            ),
        ];
        for (step, kind, message) in cases {
            let directory = tempfile::tempdir().unwrap();
            let existing = directory.path().join("existing.pdf");
            let original = b"%PDF-1.7 original destination bytes".to_vec();
            fs::write(&existing, &original).unwrap();
            let hash = fingerprint(&existing).unwrap();
            {
                let _failure = InjectedFailure::at(step, kind);
                let error = atomic_save(&existing, &fixture(), 1, Some(&hash)).unwrap_err();
                assert!(error.contains(message), "{step:?}: {error}");
                let new_destination = directory.path().join("new.pdf");
                assert!(atomic_save(&new_destination, &fixture(), 1, None).is_err());
                assert!(
                    !new_destination.exists(),
                    "{step:?} created a partial destination"
                );
            }
            assert_eq!(
                fs::read(&existing).unwrap(),
                original,
                "{step:?} changed the original"
            );
            assert_eq!(
                entries(directory.path()),
                ["existing.pdf"],
                "{step:?} leaked a temporary file"
            );
        }
    }

    #[test]
    fn save_succeeds_again_after_an_injected_failure_clears() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("retry.pdf");
        {
            let _failure = InjectedFailure::at(SaveStep::Write, io::ErrorKind::StorageFull);
            assert!(atomic_save(&path, &fixture(), 1, None).is_err());
        }
        atomic_save(&path, &fixture(), 1, None).unwrap();
        assert_eq!(fs::read(&path).unwrap(), fixture());
        assert_eq!(entries(directory.path()), ["retry.pdf"]);
    }

    #[cfg(unix)]
    #[test]
    fn unwritable_destination_directory_keeps_the_original() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let locked = directory.path().join("locked");
        fs::create_dir(&locked).unwrap();
        let existing = locked.join("existing.pdf");
        fs::write(&existing, b"original").unwrap();
        let hash = fingerprint(&existing).unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o555)).unwrap();
        let result = atomic_save(&existing, &fixture(), 1, Some(&hash));
        let new_result = atomic_save(&locked.join("new.pdf"), &fixture(), 1, None);
        let names = entries(&locked);
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(result.unwrap_err().contains("destination permissions"));
        assert!(new_result.is_err());
        assert_eq!(fs::read(&existing).unwrap(), b"original");
        assert_eq!(names, ["existing.pdf"]);
    }

    /// Reproduces a real disk-full condition without filling the user's drive.
    /// Mount a small disposable volume and run:
    /// `NAVPDF_CONSTRAINED_DIR=/path/to/volume cargo test -- --ignored real_disk_full`
    #[test]
    #[ignore = "requires NAVPDF_CONSTRAINED_DIR on a small disposable volume"]
    fn real_disk_full_leaves_the_original_and_no_temporary_file() {
        let directory = std::path::PathBuf::from(
            std::env::var("NAVPDF_CONSTRAINED_DIR").expect("NAVPDF_CONSTRAINED_DIR"),
        );
        let existing = directory.join("existing.pdf");
        let original = fixture();
        fs::write(&existing, &original).unwrap();
        let hash = fingerprint(&existing).unwrap();
        let before = entries(&directory);
        let oversized = fixture_with_content(vec![b'0'; 64 * 1024 * 1024]);
        let error = atomic_save(&existing, &oversized, 1, Some(&hash)).unwrap_err();
        let after = entries(&directory);
        let preserved = fs::read(&existing).unwrap();
        fs::remove_file(&existing).unwrap();
        assert!(error.contains("original file is unchanged"), "{error}");
        assert_eq!(preserved, original);
        assert_eq!(after, before);
    }

    #[test]
    fn new_destination_collision_keeps_the_other_writers_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("chosen-destination.pdf");
        fs::write(&path, b"created by another writer after the picker closed").unwrap();
        assert!(atomic_save(&path, &fixture(), 1, None).is_err());
        assert_eq!(
            fs::read(&path).unwrap(),
            b"created by another writer after the picker closed"
        );
    }

    #[cfg(unix)]
    #[test]
    fn replacement_preserves_existing_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("shared.pdf");
        fs::write(&path, fixture()).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
        let hash = fingerprint(&path).unwrap();
        atomic_save(&path, &fixture(), 1, Some(&hash)).unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o640
        );
    }

    #[test]
    fn valid_roundtrip() {
        let d = tempfile::tempdir().expect("temp");
        let p = d.path().join("a.pdf");
        let bytes = fixture();
        atomic_save(&p, &bytes, 1, None).expect("save");
        assert_eq!(fs::read(p).expect("read"), bytes);
    }
    #[test]
    fn custom_validators_gate_the_write() {
        let d = tempfile::tempdir().expect("temp");
        let p = d.path().join("protected.pdf");
        let rejected = atomic_save_with(&p, b"%PDF-1.7 encrypted", None, |_| Err("invalid".into()));
        assert_eq!(rejected.unwrap_err(), "invalid");
        assert!(!p.exists());
        atomic_save_with(&p, b"%PDF-1.7 encrypted", None, |_| Ok(())).expect("save");
        assert_eq!(fs::read(&p).expect("read"), b"%PDF-1.7 encrypted");
    }

    #[test]
    fn validate_pdf_rejects_real_encrypted_output() {
        let plain = fixture();
        let password = uuid::Uuid::new_v4().simple().to_string();
        let encrypted = crate::engine::protect::protect(
            &plain,
            &crate::engine::protect::ProtectionRequest::user_only(password),
            1,
        )
        .unwrap();
        let err = validate_pdf(&encrypted, 1).unwrap_err();
        assert!(err.contains("encrypted"), "{err}");
        assert_eq!(
            validate_pdf_structure(&encrypted, 1).unwrap_err(),
            ValidationError::Encrypted
        );
    }
    #[test]
    fn corrupt_output_never_overwrites() {
        let d = tempfile::tempdir().expect("temp");
        let p = d.path().join("a.pdf");
        let bytes = fixture();
        fs::write(&p, &bytes).expect("write");
        assert!(atomic_save(&p, b"%PDF-broken", 1, None).is_err());
        assert_eq!(fs::read(p).expect("read"), bytes);
    }
    #[test]
    fn wrong_page_count_never_overwrites() {
        let d = tempfile::tempdir().expect("temp");
        let p = d.path().join("a.pdf");
        let bytes = fixture();
        fs::write(&p, &bytes).expect("write");
        assert!(atomic_save(&p, &bytes, 2, None).is_err());
        assert_eq!(fs::read(p).expect("read"), bytes);
    }
    #[test]
    fn external_change_never_overwrites() {
        let d = tempfile::tempdir().expect("temp");
        let p = d.path().join("a.pdf");
        fs::write(&p, b"external change").expect("write");
        assert!(atomic_save(&p, &fixture(), 1, Some(b"old hash")).is_err());
        assert_eq!(fs::read(p).expect("read"), b"external change");
    }
    #[test]
    fn snapshot_is_immutable() {
        let d = tempfile::tempdir().expect("temp");
        let p = d.path().join("a.pdf");
        let bytes = fixture();
        fs::write(&p, &bytes).expect("write");
        let (copy, _, _) = snapshot(&p).expect("snapshot");
        fs::write(p, b"changed").expect("write");
        assert_eq!(fs::read(copy.path()).expect("read"), bytes);
    }
    #[test]
    fn invalid_input_is_rejected() {
        let d = tempfile::tempdir().expect("temp");
        let p = d.path().join("not.pdf");
        fs::write(&p, b"not a pdf").expect("write");
        assert!(snapshot(&p).is_err());
    }
}
