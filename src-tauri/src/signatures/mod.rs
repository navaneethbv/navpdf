use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tempfile::NamedTempFile;

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SignatureAsset {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub asset_type: String,
    pub data_url: String,
    pub created_at: u64,
}

/// Readable assets plus user-facing notes about entries that could not be read.
#[derive(Clone, Serialize, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryListing {
    pub assets: Vec<SignatureAsset>,
    pub warnings: Vec<String>,
}

const ASSET_TYPES: [&str; 2] = ["signature", "initials"];

pub struct SignatureStore {
    dir: PathBuf,
    key: [u8; 32],
    legacy_key: [u8; 32],
}

impl SignatureStore {
    pub fn new(root: &Path) -> Result<Self, String> {
        Self::with_key(root, protected_key(root)?)
    }

    fn with_key(root: &Path, key: [u8; 32]) -> Result<Self, String> {
        let dir = root.join("signatures");
        if !dir.exists() {
            fs::create_dir_all(&dir).map_err(|_| "Unable to create secure signature directory.")?;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))
                .map_err(|_| "Unable to protect the signature directory.")?;
        }
        Ok(Self {
            dir,
            key,
            legacy_key: derive_key(root),
        })
    }

    /// Lists every readable asset. Unreadable entries and failed legacy upgrades become
    /// warnings without paths, so one bad file never hides the rest of the library.
    pub fn list(&self) -> Result<LibraryListing, String> {
        let entries =
            fs::read_dir(&self.dir).map_err(|_| "Unable to read the signature library.")?;
        let mut listing = LibraryListing::default();
        let (mut unreadable, mut not_upgraded) = (0_usize, 0_usize);
        for entry in entries {
            let Ok(entry) = entry else {
                unreadable += 1;
                continue;
            };
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("sig") {
                continue;
            }
            match self.read_asset(&path) {
                Ok((asset, current)) => {
                    not_upgraded += usize::from(!current);
                    listing.assets.push(asset);
                }
                Err(_) => unreadable += 1,
            }
        }
        match unreadable {
            0 => {}
            1 => listing
                .warnings
                .push("One saved signature could not be read.".into()),
            count => listing
                .warnings
                .push(format!("{count} saved signatures could not be read.")),
        }
        if not_upgraded > 0 {
            listing.warnings.push(
                "Some saved signatures could not be upgraded to protected storage. NavPDF will retry next time."
                    .into(),
            );
        }
        listing
            .assets
            .sort_by_key(|asset| std::cmp::Reverse(asset.created_at));
        Ok(listing)
    }

    pub fn save(
        &self,
        name: String,
        asset_type: String,
        data_url: String,
    ) -> Result<SignatureAsset, String> {
        if name.trim().is_empty() {
            return Err("Signature name cannot be empty.".into());
        }
        if !ASSET_TYPES.contains(&asset_type.as_str()) {
            return Err("Invalid signature type.".into());
        }
        if data_url.len() > 8 * 1024 * 1024 || !data_url.starts_with("data:image/png;base64,") {
            return Err("Invalid signature image format.".into());
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|t| t.as_secs())
            .unwrap_or(0);
        let id = uuid::Uuid::new_v4().to_string();
        let asset = SignatureAsset {
            id: id.clone(),
            name,
            asset_type,
            data_url,
            created_at: now,
        };
        let target = self.dir.join(format!("{id}.sig"));
        self.write_asset(&target, &asset)?;
        Ok(asset)
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        validate_id(id)?;
        let target = self.dir.join(format!("{id}.sig"));
        if target.exists() {
            fs::remove_file(&target).map_err(|_| "Failed to delete signature asset.")?;
        }
        Ok(())
    }

    pub fn migrate(&self, items: Vec<SignatureAsset>) -> Result<Vec<SignatureAsset>, String> {
        // Validate the whole batch before writing any destination.
        for item in &items {
            validate_id(&item.id)?;
            if !ASSET_TYPES.contains(&item.asset_type.as_str()) {
                return Err("Invalid signature type.".into());
            }
            if item.data_url.len() > 8 * 1024 * 1024
                || !item.data_url.starts_with("data:image/png;base64,")
            {
                return Err("Invalid signature image.".into());
            }
        }
        let mut migrated = Vec::new();
        for item in items {
            let target = self.dir.join(format!("{}.sig", item.id));
            self.write_asset(&target, &item)?;
            // Verify readability of the saved asset before confirming
            let (verified, _) = self.read_asset(&target)?;
            migrated.push(verified);
        }
        Ok(migrated)
    }

    fn write_asset(&self, path: &Path, asset: &SignatureAsset) -> Result<(), String> {
        let serialized = serde_json::to_vec(asset).map_err(|_| "Serialization error.")?;
        let encrypted = seal_payload(&self.key, &serialized)?;

        let parent = path.parent().ok_or("Invalid directory.")?;
        let mut temp =
            NamedTempFile::new_in(parent).map_err(|_| "Unable to create temporary asset file.")?;
        temp.write_all(&encrypted)
            .map_err(|_| "Failed to write signature.")?;
        temp.as_file()
            .sync_all()
            .map_err(|_| "Failed to flush signature.")?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(temp.path(), fs::Permissions::from_mode(0o600))
                .map_err(|_| "Unable to protect the signature file.")?;
        }

        temp.persist(path)
            .map_err(|_| "Failed to persist signature asset.")?;

        Ok(())
    }

    /// Reads one asset; the flag is false when a legacy asset could not be rewritten in the
    /// current format.
    fn read_asset(&self, path: &Path) -> Result<(SignatureAsset, bool), String> {
        let mut file = File::open(path).map_err(|_| "Unable to open asset.")?;
        if file
            .metadata()
            .map_err(|_| "Unable to inspect asset.")?
            .len()
            > 9 * 1024 * 1024
        {
            return Err("Signature asset exceeds the size limit.".into());
        }
        let mut encrypted = Vec::new();
        file.read_to_end(&mut encrypted)
            .map_err(|_| "Unable to read asset.")?;
        let legacy = !encrypted.starts_with(b"NAVSIG2\0");
        let decrypted = if !legacy {
            open_payload(&self.key, &encrypted)?
        } else {
            decrypt_payload(&self.legacy_key, &encrypted)?
        };
        let asset: SignatureAsset =
            serde_json::from_slice(&decrypted).map_err(|_| "Invalid asset format.")?;
        if legacy {
            // Upgrade with the same atomic writer; a failed upgrade keeps the old file and
            // still returns the decrypted asset.
            let upgraded = self
                .write_asset(path, &asset)
                .and_then(|()| self.read_asset(path))
                .is_ok_and(|(_, current)| current);
            return Ok((asset, upgraded));
        }
        Ok((asset, true))
    }
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("Invalid signature identifier.".into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn protected_key(root: &Path) -> Result<[u8; 32], String> {
    use security_framework::{os::macos::keychain::SecKeychain, passwords::get_generic_password};
    // Serialize first-use creation within the native process.
    static KEY_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = KEY_LOCK
        .lock()
        .map_err(|_| "Secure signature storage is busy.")?;
    let account = format!("{:x}", Sha256::digest(root.to_string_lossy().as_bytes()));
    let service = "local.navpdf.reader.signature-key-v2";
    match get_generic_password(service, &account) {
        Ok(bytes) => bytes
            .try_into()
            .map_err(|_| "Invalid signature key in Keychain.".into()),
        Err(error) if error.code() == -25300 => {
            let mut key = [0; 32];
            getrandom::fill(&mut key).map_err(|_| "Unable to generate signature key.")?;
            let keychain = SecKeychain::default()
                .map_err(|_| "Keychain is unavailable. Use session-only signatures.")?;
            match keychain.add_generic_password(service, &account, &key) {
                Ok(()) => Ok(key),
                Err(error) if error.code() == -25299 => get_generic_password(service, &account)
                    .map_err(|_| "Unable to read signature key.")?
                    .try_into()
                    .map_err(|_| "Invalid signature key in Keychain.".into()),
                Err(_) => Err("Keychain is unavailable. Use session-only signatures.".into()),
            }
        }
        Err(_) => Err("Keychain is unavailable. Use session-only signatures.".into()),
    }
}

#[cfg(not(target_os = "macos"))]
fn protected_key(_root: &Path) -> Result<[u8; 32], String> {
    Err("Protected storage is unavailable. Use session-only signatures.".into())
}

fn seal_payload(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let mut nonce = [0; 12];
    getrandom::fill(&mut nonce).map_err(|_| "Unable to generate signature nonce.")?;
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "Invalid signature key.")?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext)
        .map_err(|_| "Signature encryption failed.")?;
    let mut output = b"NAVSIG2\0".to_vec();
    output.extend_from_slice(&nonce);
    output.extend_from_slice(&ciphertext);
    Ok(output)
}

fn open_payload(key: &[u8; 32], payload: &[u8]) -> Result<Vec<u8>, String> {
    if payload.len() < 36 {
        return Err("Asset payload too short.".into());
    }
    Aes256Gcm::new_from_slice(key)
        .map_err(|_| "Invalid signature key.")?
        .decrypt(Nonce::from_slice(&payload[8..20]), &payload[20..])
        .map_err(|_| "Signature asset failed integrity check.".into())
}

fn derive_key(root: &Path) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"NavPDF-Protected-Signature-Store-Key-v1:");
    hasher.update(root.to_string_lossy().as_bytes());
    if let Ok(user) = std::env::var("USER") {
        hasher.update(b":user=");
        hasher.update(user.as_bytes());
    }
    hasher.finalize().into()
}

/// Legacy v1 test fixture encoder. The custom keyed digest was not HMAC.
/// Production writes use AES-GCM; this exists only to test migration of old files.
#[cfg(test)]
fn encrypt_payload(key: &[u8; 32], plaintext: &[u8]) -> Vec<u8> {
    let mut nonce = [0_u8; 16];
    let uuid_bytes = uuid::Uuid::new_v4();
    nonce.copy_from_slice(uuid_bytes.as_bytes());

    let mut ciphertext = Vec::with_capacity(plaintext.len());

    for (block_index, chunk) in (0_u32..).zip(plaintext.chunks(32)) {
        let mut hasher = Sha256::new();
        hasher.update(key);
        hasher.update(nonce);
        hasher.update(block_index.to_be_bytes());
        let mask = hasher.finalize();

        for (p, m) in chunk.iter().zip(mask.iter()) {
            ciphertext.push(p ^ m);
        }
    }

    let mut tag_hasher = Sha256::new();
    tag_hasher.update(b"NavPDF-Auth-Tag:");
    tag_hasher.update(key);
    tag_hasher.update(nonce);
    tag_hasher.update(&ciphertext);
    let tag = tag_hasher.finalize();

    let mut result = Vec::with_capacity(16 + ciphertext.len() + 32);
    result.extend_from_slice(&nonce);
    result.extend_from_slice(&ciphertext);
    result.extend_from_slice(&tag);
    result
}

fn decrypt_payload(key: &[u8; 32], payload: &[u8]) -> Result<Vec<u8>, String> {
    if payload.len() < 16 + 32 {
        return Err("Asset payload too short.".into());
    }
    let nonce = &payload[..16];
    let ciphertext = &payload[16..payload.len() - 32];
    let expected_tag = &payload[payload.len() - 32..];

    let mut tag_hasher = Sha256::new();
    tag_hasher.update(b"NavPDF-Auth-Tag:");
    tag_hasher.update(key);
    tag_hasher.update(nonce);
    tag_hasher.update(ciphertext);
    let computed_tag = tag_hasher.finalize();

    if computed_tag.as_slice() != expected_tag {
        return Err("Signature asset failed integrity check.".into());
    }

    let mut plaintext = Vec::with_capacity(ciphertext.len());

    for (block_index, chunk) in (0_u32..).zip(ciphertext.chunks(32)) {
        let mut hasher = Sha256::new();
        hasher.update(key);
        hasher.update(nonce);
        hasher.update(block_index.to_be_bytes());
        let mask = hasher.finalize();

        for (c, m) in chunk.iter().zip(mask.iter()) {
            plaintext.push(c ^ m);
        }
    }

    Ok(plaintext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protected_assets_require_secret_key_and_authenticate_ciphertext() {
        let payload = seal_payload(&[42; 32], b"synthetic asset").unwrap();
        assert_eq!(
            open_payload(&[42; 32], &payload).unwrap(),
            b"synthetic asset"
        );
        assert!(open_payload(&[41; 32], &payload).is_err());
        let mut tampered = payload.clone();
        tampered[21] ^= 1;
        assert!(open_payload(&[42; 32], &tampered).is_err());
        assert_ne!(
            seal_payload(&[42; 32], b"synthetic asset").unwrap(),
            payload
        );
    }

    #[test]
    fn legacy_assets_upgrade_to_authenticated_encryption_without_losing_content() {
        let root = tempfile::tempdir().unwrap();
        let store = SignatureStore::with_key(root.path(), [17; 32]).unwrap();
        let asset = SignatureAsset {
            id: "old".into(),
            name: "Synthetic".into(),
            asset_type: "signature".into(),
            data_url: "data:image/png;base64,AA==".into(),
            created_at: 1,
        };
        let path = store.dir.join("old.sig");
        let old = encrypt_payload(
            &derive_key(root.path()),
            &serde_json::to_vec(&asset).unwrap(),
        );
        fs::write(&path, old).unwrap();
        assert_eq!(store.list().unwrap().assets, vec![asset.clone()]);
        let upgraded = fs::read(&path).unwrap();
        assert!(upgraded.starts_with(b"NAVSIG2\0"));
        assert!(open_payload(&derive_key(root.path()), &upgraded).is_err());
        assert_eq!(store.list().unwrap().assets, vec![asset]);
    }

    #[test]
    fn migration_rejects_path_escape_before_writing() {
        let temp = tempfile::tempdir().unwrap();
        let store = SignatureStore::with_key(temp.path(), [42; 32]).unwrap();
        let result = store.migrate(vec![SignatureAsset {
            id: "../escaped".into(),
            name: "Synthetic".into(),
            asset_type: "signature".into(),
            data_url: "data:image/png;base64,AA==".into(),
            created_at: 0,
        }]);
        assert!(result.is_err());
        assert!(!temp.path().join("escaped.sig").exists());
    }

    #[test]
    fn encryption_roundtrip_and_tamper_detection() {
        let key = [42_u8; 32];
        let original = b"Sample signature PNG data and metadata payload";
        let encrypted = encrypt_payload(&key, original);
        assert_ne!(encrypted.as_slice(), original);

        let decrypted = decrypt_payload(&key, &encrypted).expect("decryption succeeds");
        assert_eq!(decrypted, original);

        // Tamper test
        let mut tampered = encrypted.clone();
        let mid = tampered.len() / 2;
        tampered[mid] ^= 0x01;
        assert!(decrypt_payload(&key, &tampered).is_err());
    }

    #[test]
    fn signature_store_crud_and_permissions() {
        let temp = tempfile::tempdir().unwrap();
        let store = SignatureStore::with_key(temp.path(), [42; 32]).unwrap();

        assert_eq!(store.list().unwrap().assets.len(), 0);

        let saved = store
            .save(
                "My Signature".into(),
                "signature".into(),
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==".into(),
            )
            .unwrap();

        assert_eq!(saved.name, "My Signature");
        assert_eq!(saved.asset_type, "signature");

        let list = store.list().unwrap().assets;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, saved.id);
        assert_eq!(list[0].name, "My Signature");

        // Verify file on disk is encrypted
        let file_path = temp
            .path()
            .join("signatures")
            .join(format!("{}.sig", saved.id));
        let raw_bytes = fs::read(&file_path).unwrap();
        assert_ne!(raw_bytes, saved.data_url.as_bytes());

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let meta = fs::metadata(&file_path).unwrap();
            assert_eq!(meta.permissions().mode() & 0o777, 0o600);
        }

        // Delete test
        store.delete(&saved.id).unwrap();
        assert_eq!(store.list().unwrap().assets.len(), 0);
        assert!(!file_path.exists());
    }

    #[test]
    fn signature_migration_verifies_saved_copy() {
        let temp = tempfile::tempdir().unwrap();
        let store = SignatureStore::with_key(temp.path(), [42; 32]).unwrap();

        let legacy = vec![
            SignatureAsset {
                id: "legacy-1".into(),
                name: "Initials".into(),
                asset_type: "initials".into(),
                data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==".into(),
                created_at: 1000,
            },
        ];

        let migrated = store.migrate(legacy).unwrap();
        assert_eq!(migrated.len(), 1);
        assert_eq!(migrated[0].id, "legacy-1");

        let list = store.list().unwrap().assets;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Initials");
    }

    #[test]
    fn corrupt_signature_file_does_not_block_valid_signatures() {
        let temp = tempfile::tempdir().unwrap();
        let store = SignatureStore::with_key(temp.path(), [42; 32]).unwrap();

        let valid = store
            .save(
                "Valid Signature".into(),
                "signature".into(),
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==".into(),
            )
            .unwrap();

        // Write a corrupt .sig file directly into the store directory
        let corrupt_path = store.dir.join("corrupt.sig");
        fs::write(&corrupt_path, b"not a valid encrypted signature file").unwrap();

        // Listing should succeed, skipping the corrupt file and returning the valid one
        let listing = store.list().unwrap();
        assert_eq!(listing.assets.len(), 1);
        assert_eq!(listing.assets[0].id, valid.id);
        assert_eq!(listing.assets[0].name, "Valid Signature");
        assert_eq!(listing.warnings, ["One saved signature could not be read."]);
    }

    #[cfg(unix)]
    #[test]
    fn legacy_assets_stay_listed_when_the_upgrade_cannot_be_written() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let store = SignatureStore::with_key(root.path(), [17; 32]).unwrap();
        let asset = SignatureAsset {
            id: "old".into(),
            name: "Synthetic".into(),
            asset_type: "initials".into(),
            data_url: "data:image/png;base64,AA==".into(),
            created_at: 1,
        };
        let legacy = encrypt_payload(
            &derive_key(root.path()),
            &serde_json::to_vec(&asset).unwrap(),
        );
        fs::write(store.dir.join("old.sig"), &legacy).unwrap();
        fs::set_permissions(&store.dir, fs::Permissions::from_mode(0o500)).unwrap();
        let listing = store.list();
        fs::set_permissions(&store.dir, fs::Permissions::from_mode(0o700)).unwrap();
        let listing = listing.unwrap();
        assert_eq!(listing.assets, vec![asset]);
        assert_eq!(listing.warnings.len(), 1);
        assert_eq!(fs::read(store.dir.join("old.sig")).unwrap(), legacy);
    }

    #[test]
    fn unknown_asset_types_are_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let store = SignatureStore::with_key(temp.path(), [42; 32]).unwrap();
        let image = "data:image/png;base64,AA==";
        assert!(store
            .save("Name".into(), "bogus".into(), image.into())
            .is_err());
        let stamp = SignatureAsset {
            id: "stamp".into(),
            name: "Stamp".into(),
            asset_type: "stamp".into(),
            data_url: image.into(),
            created_at: 0,
        };
        assert!(store.migrate(vec![stamp]).is_err());
        assert!(store.list().unwrap().assets.is_empty());
    }
}
