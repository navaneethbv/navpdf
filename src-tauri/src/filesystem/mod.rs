use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::Path,
};
use tempfile::NamedTempFile;

pub const MAX_FILE_BYTES: u64 = 1024 * 1024 * 1024;
pub const MAX_RANGE_BYTES: u64 = 4 * 1024 * 1024;

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

pub fn validate_pdf(bytes: &[u8], expected_pages: u32) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("The output PDF is empty or too large.".into());
    }
    let document = lopdf::Document::load_mem(bytes)
        .map_err(|_| "Changes could not be saved: the output PDF failed validation.")?;
    if document.is_encrypted() {
        return Err("Saving encrypted documents is not available in this milestone. The original is unchanged.".into());
    }
    if expected_pages == 0 || document.get_pages().len() != expected_pages as usize {
        return Err("Changes could not be saved: the output page count is incorrect.".into());
    }
    Ok(())
}

pub fn atomic_save(
    path: &Path,
    bytes: &[u8],
    expected_pages: u32,
    expected_hash: Option<&[u8]>,
) -> Result<Vec<u8>, String> {
    validate_pdf(bytes, expected_pages)?;
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
    temp.write_all(bytes)
        .map_err(|_| "Changes could not be saved. The original file is unchanged.")?;
    temp.as_file()
        .sync_all()
        .map_err(|_| "Changes could not be flushed to disk. The original file is unchanged.")?;
    // Recheck after the expensive validation and write, before replacing the source.
    if let Some(expected) = expected_hash {
        if fingerprint(path)? != expected {
            return Err("The original PDF changed while saving. Use Save As.".into());
        }
    }
    if expected_hash.is_some() {
        temp.persist(path)
            .map_err(|_| "Atomic replacement failed. The original file is unchanged.")?;
    } else {
        temp.persist_noclobber(path)
            .map_err(|_| "The destination already exists or cannot be created. Choose another Save As destination.")?;
    }
    if let Ok(directory) = File::open(parent) {
        let _ = directory.sync_all();
    }
    Ok(Sha256::digest(bytes).to_vec())
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
mod tests {
    use super::*;
    use lopdf::{dictionary, Object, Stream};
    pub fn fixture() -> Vec<u8> {
        let mut doc = lopdf::Document::with_version("1.7");
        let pages = doc.new_object_id();
        let content = doc.add_object(Stream::new(dictionary! {}, Vec::new()));
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
