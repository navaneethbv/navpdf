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

pub struct SignatureStore {
    dir: PathBuf,
    key: [u8; 32],
}

impl SignatureStore {
    pub fn new(root: &Path) -> Result<Self, String> {
        let dir = root.join("signatures");
        if !dir.exists() {
            fs::create_dir_all(&dir).map_err(|_| "Unable to create secure signature directory.")?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
            }
        }
        let key = derive_key(root);
        Ok(Self { dir, key })
    }

    pub fn list(&self) -> Result<Vec<SignatureAsset>, String> {
        let mut results = Vec::new();
        let entries = match fs::read_dir(&self.dir) {
            Ok(iter) => iter,
            Err(_) => return Ok(results),
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("sig") {
                if let Ok(asset) = self.read_asset(&path) {
                    results.push(asset);
                }
            }
        }
        results.sort_by_key(|b| std::cmp::Reverse(b.created_at));
        Ok(results)
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
        if !data_url.starts_with("data:image/png;base64,") {
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
        if id.contains('/') || id.contains('\\') || id.contains("..") {
            return Err("Invalid signature identifier.".into());
        }
        let target = self.dir.join(format!("{id}.sig"));
        if target.exists() {
            fs::remove_file(&target).map_err(|_| "Failed to delete signature asset.")?;
        }
        Ok(())
    }

    pub fn migrate(&self, items: Vec<SignatureAsset>) -> Result<Vec<SignatureAsset>, String> {
        let mut migrated = Vec::new();
        for item in items {
            let target = self.dir.join(format!("{}.sig", item.id));
            self.write_asset(&target, &item)?;
            // Verify readability of the saved asset before confirming
            let verified = self.read_asset(&target)?;
            migrated.push(verified);
        }
        Ok(migrated)
    }

    fn write_asset(&self, path: &Path, asset: &SignatureAsset) -> Result<(), String> {
        let serialized = serde_json::to_vec(asset).map_err(|_| "Serialization error.")?;
        let encrypted = encrypt_payload(&self.key, &serialized);

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
            let _ = fs::set_permissions(temp.path(), fs::Permissions::from_mode(0o600));
        }

        temp.persist(path)
            .map_err(|_| "Failed to persist signature asset.")?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
        }
        Ok(())
    }

    fn read_asset(&self, path: &Path) -> Result<SignatureAsset, String> {
        let mut file = File::open(path).map_err(|_| "Unable to open asset.")?;
        let mut encrypted = Vec::new();
        file.read_to_end(&mut encrypted)
            .map_err(|_| "Unable to read asset.")?;
        let decrypted = decrypt_payload(&self.key, &encrypted)?;
        serde_json::from_slice(&decrypted).map_err(|_| "Invalid asset format.".into())
    }
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

/// Encrypts plaintext using SHA-256 in counter mode with a 16-byte nonce and HMAC authentication tag.
/// Format: [16 bytes nonce] [N bytes ciphertext] [32 bytes auth tag]
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
        let store = SignatureStore::new(temp.path()).unwrap();

        assert_eq!(store.list().unwrap().len(), 0);

        let saved = store
            .save(
                "My Signature".into(),
                "signature".into(),
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==".into(),
            )
            .unwrap();

        assert_eq!(saved.name, "My Signature");
        assert_eq!(saved.asset_type, "signature");

        let list = store.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, saved.id);
        assert_eq!(list[0].name, "My Signature");

        // Verify file on disk is encrypted
        let file_path = temp.path().join("signatures").join(format!("{}.sig", saved.id));
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
        assert_eq!(store.list().unwrap().len(), 0);
        assert!(!file_path.exists());
    }

    #[test]
    fn signature_migration_verifies_saved_copy() {
        let temp = tempfile::tempdir().unwrap();
        let store = SignatureStore::new(temp.path()).unwrap();

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

        let list = store.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Initials");
    }
}
