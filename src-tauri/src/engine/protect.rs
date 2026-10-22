//! AES-256 password protection, password-aware validation and unlocking for editing.

use lopdf::encryption::crypt_filters::{Aes128CryptFilter, Aes256CryptFilter, CryptFilter};
use lopdf::{Document, EncryptionState, EncryptionVersion, Object, Permissions, StringFormat};
use serde::Deserialize;
use std::{collections::BTreeMap, sync::Arc};
use zeroize::Zeroizing;

const MAX_PASSWORD_BYTES: usize = 127;
const VALIDATION_FAILED: &str = "The protected copy failed validation and was not saved.";
/// Print, modify, copy, annotate, fill, accessibility, assemble and high-quality print bits.
const EXPOSED_PERMISSION_BITS: i64 =
    (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5) | (1 << 8) | (1 << 9) | (1 << 10) | (1 << 11);

fn open_with_password(bytes: &[u8], password: &str) -> lopdf::Result<Document> {
    Document::load_mem_with_options(bytes, lopdf::LoadOptions::with_password(password))
}

#[derive(Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequest {
    pub print: bool,
    pub print_high_quality: bool,
    pub copy: bool,
    pub modify: bool,
    pub annotate: bool,
    pub fill_forms: bool,
    pub assemble: bool,
    pub accessibility: bool,
}

impl PermissionRequest {
    pub fn all() -> Self {
        Self {
            print: true,
            print_high_quality: true,
            copy: true,
            modify: true,
            annotate: true,
            fill_forms: true,
            assemble: true,
            accessibility: true,
        }
    }

    fn all_granted(&self) -> bool {
        self.print
            && self.print_high_quality
            && self.copy
            && self.modify
            && self.annotate
            && self.fill_forms
            && self.assemble
            && self.accessibility
    }

    fn flags(&self) -> Permissions {
        [
            (self.print, Permissions::PRINTABLE),
            (
                self.print_high_quality,
                Permissions::PRINTABLE_IN_HIGH_QUALITY,
            ),
            (self.copy, Permissions::COPYABLE),
            (self.modify, Permissions::MODIFIABLE),
            (self.annotate, Permissions::ANNOTABLE),
            (self.fill_forms, Permissions::FILLABLE),
            (self.assemble, Permissions::ASSEMBLABLE),
            (self.accessibility, Permissions::COPYABLE_FOR_ACCESSIBILITY),
        ]
        .into_iter()
        .filter(|(granted, _)| *granted)
        .fold(Permissions::empty(), |flags, (_, flag)| flags | flag)
    }
}

/// The cipher for a protected copy. AES-256 is the default; the others exist only for
/// compatibility with old readers and are much weaker.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EncryptionLevel {
    #[default]
    Aes256,
    Aes128,
    Rc4128,
    Rc440,
}

fn yes() -> bool {
    true
}

/// Deliberately has no `Debug` implementation so passwords cannot be formatted into logs.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectionRequest {
    pub user_password: Zeroizing<String>,
    pub owner_password: Zeroizing<String>,
    pub permissions: PermissionRequest,
    #[serde(default)]
    pub encryption: EncryptionLevel,
    /// When false the XMP metadata stream stays readable for search and cataloguing tools.
    /// Only AES levels can leave metadata unencrypted.
    #[serde(default = "yes")]
    pub encrypt_metadata: bool,
}

impl ProtectionRequest {
    pub fn user_only(password: impl Into<String>) -> Self {
        Self {
            user_password: password.into().into(),
            owner_password: String::new().into(),
            permissions: PermissionRequest::all(),
            encryption: EncryptionLevel::Aes256,
            encrypt_metadata: true,
        }
    }
}

/// Encrypts an unprotected document with the requested cipher, AES-256 (security handler
/// revision 6) unless an older level is chosen for compatibility.
pub fn protect(
    bytes: &[u8],
    request: &ProtectionRequest,
    expected_pages: u32,
) -> Result<Vec<u8>, String> {
    let owner = owner_password(request)?;
    let mut doc = super::load(bytes)?;
    if doc.get_pages().len() != expected_pages as usize {
        return Err("The document changed before protection was applied. Try again.".into());
    }
    ensure_file_id(&mut doc)?;
    let level = request.encryption;
    if !request.encrypt_metadata
        && matches!(level, EncryptionLevel::Rc4128 | EncryptionLevel::Rc440)
    {
        return Err("Leaving metadata unencrypted needs AES encryption.".into());
    }
    // Revisions 2 to 4 use only the first 32 bytes of a password, so longer passwords would
    // silently accept other passwords that share that prefix.
    if level != EncryptionLevel::Aes256
        && [request.user_password.as_str(), owner.as_str()]
            .iter()
            .any(|password| password.len() > 32 || !password.is_ascii())
    {
        return Err(
            "Older encryption levels need passwords of at most 32 plain ASCII characters.".into(),
        );
    }
    let user = request.user_password.as_str();
    let permissions = request.permissions.flags();
    let mut key = [0_u8; 32];
    getrandom::fill(&mut key).map_err(|_| "Secure key generation is unavailable.")?;
    let filters = |filter: Arc<dyn CryptFilter>| BTreeMap::from([(b"StdCF".to_vec(), filter)]);
    let version = match level {
        EncryptionLevel::Aes256 => EncryptionVersion::V5 {
            encrypt_metadata: request.encrypt_metadata,
            crypt_filters: filters(Arc::new(Aes256CryptFilter)),
            file_encryption_key: &key,
            stream_filter: b"StdCF".to_vec(),
            string_filter: b"StdCF".to_vec(),
            owner_password: &owner,
            user_password: user,
            permissions,
        },
        EncryptionLevel::Aes128 => EncryptionVersion::V4 {
            document: &doc,
            encrypt_metadata: request.encrypt_metadata,
            crypt_filters: filters(Arc::new(Aes128CryptFilter)),
            stream_filter: b"StdCF".to_vec(),
            string_filter: b"StdCF".to_vec(),
            owner_password: &owner,
            user_password: user,
            permissions,
        },
        EncryptionLevel::Rc4128 => EncryptionVersion::V2 {
            document: &doc,
            owner_password: &owner,
            user_password: user,
            key_length: 128,
            permissions,
        },
        EncryptionLevel::Rc440 => EncryptionVersion::V1 {
            document: &doc,
            owner_password: &owner,
            user_password: user,
            permissions,
        },
    };
    let state = EncryptionState::try_from(version);
    key.fill(0);
    let state = state.map_err(|_| "These passwords cannot be used for this encryption level.")?;
    doc.encrypt(&state)
        .map_err(|_| "The document could not be encrypted.")?;
    if matches!(level, EncryptionLevel::Aes256 | EncryptionLevel::Aes128) {
        declare_key_lengths(&mut doc, level == EncryptionLevel::Aes256)?;
    }
    let output = super::save(&mut doc)?;
    validate_protected(&output, &request.user_password, &owner, expected_pages)?;
    Ok(output)
}

/// Readers such as poppler fall back to a 40-bit key when `/Length` is absent, so the AES key
/// size is declared on the security handler and its crypt filter. For AES-256 these entries do
/// not feed revision 6 key derivation; for AES-128 they restate the 128-bit key lopdf derives.
fn declare_key_lengths(doc: &mut Document, aes_256: bool) -> Result<(), String> {
    const UNAVAILABLE: &str = "The encryption dictionary could not be completed.";
    let id = doc
        .trailer
        .get(b"Encrypt")
        .and_then(Object::as_reference)
        .map_err(|_| UNAVAILABLE)?;
    let encrypt = doc.get_dictionary_mut(id).map_err(|_| UNAVAILABLE)?;
    encrypt.set("Length", if aes_256 { 256 } else { 128 });
    let filter = encrypt
        .get_mut(b"CF")
        .and_then(Object::as_dict_mut)
        .and_then(|filters| filters.get_mut(b"StdCF"))
        .and_then(Object::as_dict_mut)
        .map_err(|_| UNAVAILABLE)?;
    filter.set("Length", if aes_256 { 32 } else { 16 });
    filter.set("AuthEvent", "DocOpen");
    Ok(())
}

#[cfg(test)]
mod key_length_tests {
    use super::*;
    use crate::engine::content::tests::page_document;
    use lopdf::dictionary;

    #[test]
    fn protected_output_declares_aes_256_key_lengths() {
        let (mut doc, _) =
            page_document("BT /F1 12 Tf 72 700 Td (Key length) Tj ET", dictionary! {});
        let source = crate::engine::save(&mut doc).unwrap();
        let user_password = uuid::Uuid::new_v4().simple().to_string();
        let request = ProtectionRequest {
            user_password: user_password.into(),
            owner_password: String::new().into(),
            permissions: PermissionRequest::all(),
            encryption: EncryptionLevel::Aes256,
            encrypt_metadata: true,
        };
        let output = protect(&source, &request, 1).unwrap();
        let locked = Document::load_mem(&output).unwrap();
        assert_eq!(request.encryption, EncryptionLevel::Aes256);
        let encrypt = locked.get_encrypted().unwrap();
        assert_eq!(encrypt.get(b"Length").unwrap().as_i64().unwrap(), 256);
        let filter = encrypt
            .get(b"CF")
            .unwrap()
            .as_dict()
            .unwrap()
            .get(b"StdCF")
            .unwrap()
            .as_dict()
            .unwrap();
        assert_eq!(filter.get(b"Length").unwrap().as_i64().unwrap(), 32);
        assert_eq!(filter.get(b"CFM").unwrap().as_name().unwrap(), b"AESV3");
        assert_eq!(
            filter.get(b"AuthEvent").unwrap().as_name().unwrap(),
            b"DocOpen"
        );
    }
}

/// The permissions password that protection will use, after validating the request.
pub fn owner_password(request: &ProtectionRequest) -> Result<Zeroizing<String>, String> {
    let (user, owner) = (&request.user_password, &request.owner_password);
    if user.len() > MAX_PASSWORD_BYTES || owner.len() > MAX_PASSWORD_BYTES {
        return Err("Passwords can be at most 127 bytes long.".into());
    }
    if user.is_empty() {
        if owner.is_empty() {
            return Err(
                "Enter an open password or a separate permissions password for this copy.".into(),
            );
        }
        if request.permissions.all_granted() {
            return Err(
                "An open-without-password copy must restrict at least one permission.".into(),
            );
        }
        return Ok(owner.clone());
    }
    if request.permissions.all_granted() {
        return Ok(if owner.is_empty() {
            user.clone()
        } else {
            owner.clone()
        });
    }
    if owner.is_empty() || owner == user {
        return Err(
            "Restrictions need a separate permissions password that differs from the open password."
                .into(),
        );
    }
    Ok(owner.clone())
}

/// Independent of unencrypted validation: the copy must stay unreadable without a
/// password, open with both passwords at the expected page count and reject a wrong one.
pub fn validate_protected(
    bytes: &[u8],
    user: &str,
    owner: &str,
    expected_pages: u32,
) -> Result<(), String> {
    let loaded = Document::load_mem(bytes).map_err(|_| VALIDATION_FAILED)?;
    if !loaded.is_encrypted() && !loaded.was_encrypted() {
        return Err(VALIDATION_FAILED.into());
    }
    let opened = open_with_password(bytes, user).map_err(|_| VALIDATION_FAILED)?;
    if expected_pages == 0 || opened.get_pages().len() != expected_pages as usize {
        return Err(VALIDATION_FAILED.into());
    }
    if user.is_empty() {
        // lopdf's loader tries an empty password before the supplied password. When the
        // user password is intentionally empty, that fallback makes it impossible to
        // independently authenticate the owner password through the loader. The encrypted
        // state and page-count checks above still verify that this is an encrypted copy.
        return Ok(());
    }
    let opened = open_with_password(bytes, owner).map_err(|_| VALIDATION_FAILED)?;
    if opened.get_pages().len() != expected_pages as usize {
        return Err(VALIDATION_FAILED.into());
    }
    // A different printable first character changes the password in every security revision:
    // legacy ones read only the first 32 bytes, and password preparation drops control
    // characters. The probe is random, so no fixed password is ever tried.
    let wrong = loop {
        let random = uuid::Uuid::new_v4().simple().to_string();
        if let Some(prefix) = random.chars().find(|c| !user.starts_with(*c)) {
            break format!("{prefix}{user}");
        }
    };
    if open_with_password(bytes, &wrong).is_ok() {
        return Err(VALIDATION_FAILED.into());
    }
    Ok(())
}

/// Decrypts a protected document into an unencrypted working copy.
///
/// Opening with the user password only removes protection when the document grants every
/// permission; otherwise the owner password is required so restrictions are not bypassed.
pub fn unlock(bytes: &[u8], password: &str) -> Result<Vec<u8>, String> {
    if password.is_empty() {
        return Err("Enter the document password.".into());
    }
    let locked = Document::load_mem(bytes).map_err(|_| "The protected PDF could not be read.")?;
    if !locked.trailer.has(b"Encrypt") {
        return Err("This PDF is not password protected.".into());
    }
    let restricted = locked
        .get_encrypted()
        .ok()
        .and_then(|dict| dict.get(b"P").ok())
        .and_then(|value| value.as_i64().ok())
        .is_none_or(|flags| flags & EXPOSED_PERMISSION_BITS != EXPOSED_PERMISSION_BITS);
    if locked.authenticate_owner_password(password).is_err() {
        if locked.authenticate_user_password(password).is_err() {
            return Err("That password did not unlock the document.".into());
        }
        if restricted {
            return Err(
                "This PDF restricts changes. Enter its permissions (owner) password to unlock it for editing."
                    .into(),
            );
        }
    }
    let mut doc = open_with_password(bytes, password)
        .map_err(|_| "That password did not unlock the document.")?;
    let pages = doc.get_pages().len();
    if let Ok(id) = doc.trailer.get(b"Encrypt").and_then(Object::as_reference) {
        doc.objects.remove(&id);
    }
    doc.trailer.remove(b"Encrypt");
    doc.encryption_state = None;
    let output = super::save(&mut doc)?;
    let plain = super::load(&output)?;
    if pages == 0 || plain.get_pages().len() != pages {
        return Err("The unlocked working copy failed validation.".into());
    }
    Ok(output)
}

fn ensure_file_id(doc: &mut Document) -> Result<(), String> {
    if doc.trailer.has(b"ID") {
        return Ok(());
    }
    let mut id = [0_u8; 16];
    getrandom::fill(&mut id).map_err(|_| "Secure identifier generation is unavailable.")?;
    let value = Object::String(id.to_vec(), StringFormat::Hexadecimal);
    doc.trailer
        .set("ID", Object::Array(vec![value.clone(), value]));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::content::tests::page_document;
    use lopdf::dictionary;

    fn fixture() -> Vec<u8> {
        let (mut doc, _) = page_document(
            "BT /F1 12 Tf 72 700 Td (Protected canary) Tj ET",
            dictionary! {},
        );
        crate::engine::save(&mut doc).unwrap()
    }

    fn password() -> String {
        uuid::Uuid::new_v4().simple().to_string()
    }

    fn request(user: &str, owner: &str, permissions: PermissionRequest) -> ProtectionRequest {
        ProtectionRequest {
            user_password: user.to_string().into(),
            owner_password: owner.to_string().into(),
            permissions,
            encryption: EncryptionLevel::Aes256,
            encrypt_metadata: true,
        }
    }

    #[test]
    fn every_encryption_level_opens_only_with_its_password() {
        for level in [
            EncryptionLevel::Aes256,
            EncryptionLevel::Aes128,
            EncryptionLevel::Rc4128,
            EncryptionLevel::Rc440,
        ] {
            let user = password()[..20].to_string();
            let empty = String::new();
            let mut chosen = request(&user, &empty, PermissionRequest::all());
            chosen.encryption = level;
            let output = protect(&fixture(), &chosen, 1).unwrap();
            assert!(
                !output.windows(15).any(|w| w == b"Protected canar"),
                "{level:?} left plaintext"
            );
            let opened = open_with_password(&output, &user).unwrap();
            assert_eq!(
                opened.extract_text(&[1]).unwrap().trim(),
                "Protected canary",
                "{level:?}"
            );
            assert!(
                open_with_password(&output, &password()).is_err(),
                "{level:?}"
            );
            let encrypt = Document::load_mem(&output)
                .unwrap()
                .get_encrypted()
                .unwrap()
                .clone();
            let expected = match level {
                EncryptionLevel::Aes256 => (5, 6),
                EncryptionLevel::Aes128 => (4, 4),
                EncryptionLevel::Rc4128 => (2, 3),
                EncryptionLevel::Rc440 => (1, 2),
            };
            assert_eq!(
                (
                    encrypt.get(b"V").unwrap().as_i64().unwrap(),
                    encrypt.get(b"R").unwrap().as_i64().unwrap()
                ),
                expected,
                "{level:?}"
            );
        }
    }

    #[test]
    fn metadata_can_stay_readable_only_with_aes() {
        let user = password();
        let empty = String::new();
        let mut chosen = request(&user, &empty, PermissionRequest::all());
        chosen.encrypt_metadata = false;
        let output = protect(&fixture(), &chosen, 1).unwrap();
        let encrypt = Document::load_mem(&output)
            .unwrap()
            .get_encrypted()
            .unwrap()
            .clone();
        assert!(!encrypt.get(b"EncryptMetadata").unwrap().as_bool().unwrap());
        chosen.encryption = EncryptionLevel::Rc4128;
        assert!(protect(&fixture(), &chosen, 1).unwrap_err().contains("AES"));
    }

    #[test]
    fn legacy_levels_reject_passwords_they_would_truncate() {
        // A separate generated owner password keeps every request free of fixed values.
        let owner = password();
        // 64 ASCII characters, longer than the 32 bytes legacy handlers read.
        let long = password().repeat(2);
        let mut chosen = request(&long, &owner, PermissionRequest::all());
        chosen.encryption = EncryptionLevel::Aes128;
        assert!(protect(&fixture(), &chosen, 1).unwrap_err().contains("32"));
        // A short password ending in "ÿ" (U+00FF), outside ASCII.
        let accented_password = format!("{}{}", &password()[..8], char::from(u8::MAX));
        let mut accented = request(&accented_password, &owner, PermissionRequest::all());
        accented.encryption = EncryptionLevel::Rc440;
        assert!(protect(&fixture(), &accented, 1)
            .unwrap_err()
            .contains("ASCII"));
        // AES-256 keeps accepting long Unicode passwords.
        let unicode = request(
            &format!("{long}{}", char::from(u8::MAX)),
            &owner,
            PermissionRequest::all(),
        );
        assert!(protect(&fixture(), &unicode, 1).is_ok());
    }

    #[test]
    fn protected_copy_requires_the_password_and_hides_plaintext() {
        let user = password();
        let wrong = password();
        let invalid_page_password = password();
        let empty = String::new();
        let output = protect(
            &fixture(),
            &request(&user, &empty, PermissionRequest::all()),
            1,
        )
        .unwrap();
        assert!(!output.windows(15).any(|w| w == b"Protected canar"));
        assert!(Document::load_mem(&output).unwrap().get_pages().is_empty());
        assert!(open_with_password(&output, &wrong).is_err());
        assert_eq!(
            open_with_password(&output, &user)
                .unwrap()
                .get_pages()
                .len(),
            1
        );
        let unlocked = unlock(&output, &user).unwrap();
        let plain = crate::engine::load(&unlocked).unwrap();
        assert_eq!(plain.extract_text(&[1]).unwrap().trim(), "Protected canary");
        assert!(protect(
            &fixture(),
            &request(&invalid_page_password, &empty, PermissionRequest::all()),
            2
        )
        .is_err());
    }

    #[test]
    fn restrictions_need_a_distinct_owner_password_to_remove() {
        let user = password();
        let same = user.clone();
        let owner = password();
        let empty = String::new();
        let wrong = password();
        let restricted = PermissionRequest {
            print: true,
            ..PermissionRequest::default()
        };
        assert!(protect(&fixture(), &request(&user, &empty, restricted), 1).is_err());
        assert!(protect(&fixture(), &request(&user, &same, restricted), 1).is_err());
        assert!(protect(
            &fixture(),
            &request(&empty, &owner, PermissionRequest::all()),
            1
        )
        .is_err());
        let output = protect(&fixture(), &request(&user, &owner, restricted), 1).unwrap();
        let error = unlock(&output, &user).unwrap_err();
        assert!(error.contains("owner"), "{error}");
        assert!(unlock(&output, &wrong)
            .unwrap_err()
            .contains("did not unlock"));
        assert!(unlock(&output, &owner).is_ok());
        assert!(unlock(&fixture(), &owner).is_err());
    }

    #[test]
    fn permissions_only_protection_opens_without_a_user_password() {
        let empty = String::new();
        let owner = password();
        let restricted = PermissionRequest {
            print: true,
            copy: false,
            ..PermissionRequest::default()
        };
        let output = protect(&fixture(), &request(&empty, &owner, restricted), 1).unwrap();
        assert!(open_with_password(&output, &empty).is_ok());
        assert!(open_with_password(&output, &owner).is_ok());
        assert!(validate_protected(&output, &empty, &owner, 1).is_ok());
    }

    #[test]
    fn validator_rejects_unencrypted_and_wrong_page_counts() {
        let user = password();
        let wrong = password();
        let empty = String::new();
        assert!(validate_protected(&fixture(), &user, &user, 1).is_err());
        let output = protect(
            &fixture(),
            &request(&user, &empty, PermissionRequest::all()),
            1,
        )
        .unwrap();
        assert!(validate_protected(&output, &user, &user, 1).is_ok());
        assert!(validate_protected(&output, &user, &user, 3).is_err());
        assert!(validate_protected(&output, &wrong, &wrong, 1).is_err());
    }
}
