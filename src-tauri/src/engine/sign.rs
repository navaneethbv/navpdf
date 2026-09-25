//! Local certificate signatures from a PKCS #12 identity.
//!
//! Signatures follow the PAdES baseline B-B profile (`ETSI.CAdES.detached`) and are appended as
//! an incremental update, so earlier revisions and signatures stay byte-for-byte intact. The
//! signature has no visible appearance, and timestamps, revocation data and trust evaluation are
//! out of scope. Scope and limits are recorded in ADR 0009.

use super::content::deref;
use super::load;
use cms::builder::SignerInfoBuilder;
use cms::cert::{CertificateChoices, IssuerAndSerialNumber};
use cms::content_info::{CmsVersion, ContentInfo};
use cms::signed_data::{
    CertificateSet, DigestAlgorithmIdentifiers, EncapsulatedContentInfo, SignedData,
    SignerIdentifier, SignerInfos,
};
use const_oid::db::{rfc5280, rfc5911, rfc5912};
use const_oid::ObjectIdentifier;
use der::asn1::{OctetString, SetOfVec};
use der::{Any, Decode, Encode, Sequence};
use lopdf::{dictionary, Dictionary, Document, IncrementalDocument, Object, StringFormat};
use p12_keystore::KeyStore;
use rsa::pkcs8::{DecodePrivateKey, DecodePublicKey, EncodePublicKey, PrivateKeyInfo};
use rsa::signature::Verifier;
use rsa::traits::PublicKeyParts;
use serde::{Deserialize, Serialize};
// The signing path hashes with the sha2 release that rsa, cms and p256 are built against.
use rsa::sha2::{Digest, Sha256, Sha384, Sha512};
use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};
use x509_cert::attr::Attribute;
use x509_cert::builder::Builder;
use x509_cert::ext::pkix::{KeyUsage, KeyUsages};
use x509_cert::spki::AlgorithmIdentifierOwned;
use x509_cert::Certificate;

/// Largest accepted PKCS #12 file.
pub const MAX_IDENTITY_BYTES: usize = 1024 * 1024;
const MIN_RSA_BITS: usize = 2048;
/// Fixed-width stand-in for byte offsets until the final file layout is known.
const BYTE_RANGE_PLACEHOLDER: i64 = 9_999_999_999;
/// Bytes reserved for the signature value beyond the certificates it embeds.
const SIGNATURE_OVERHEAD: usize = 8192;
const MAX_TEXT_CHARS: usize = 256;
const MAX_FIELD_DEPTH: usize = 32;

const UNREADABLE: &str = "The PDF could not be prepared for signing.";
const CREATE_FAILED: &str = "The signature could not be created. The document is unchanged.";
const NOT_CMS: &str = "The signature value is not a supported CMS signature.";
const MISPLACED: &str = "The signature value is not where its byte range says.";

enum SignerKey {
    Rsa(Box<rsa::RsaPrivateKey>),
    P256(p256::ecdsa::SigningKey),
}

impl SignerKey {
    fn from_pkcs8(der: &[u8]) -> Result<Self, String> {
        let info =
            PrivateKeyInfo::try_from(der).map_err(|_| "The private key could not be read.")?;
        if info.algorithm.oid == rfc5912::RSA_ENCRYPTION {
            let key = rsa::RsaPrivateKey::from_pkcs8_der(der)
                .map_err(|_| "The RSA private key could not be read.")?;
            if key.size() * 8 < MIN_RSA_BITS {
                return Err("RSA keys shorter than 2048 bits are not accepted.".into());
            }
            Ok(Self::Rsa(Box::new(key)))
        } else if info.algorithm.oid == rfc5912::ID_EC_PUBLIC_KEY {
            p256::ecdsa::SigningKey::from_pkcs8_der(der)
                .map(Self::P256)
                .map_err(|_| "Only P-256 elliptic-curve keys are supported.".into())
        } else {
            Err("Only RSA and P-256 keys are supported.".into())
        }
    }

    fn public_key_der(&self) -> Result<Vec<u8>, String> {
        match self {
            Self::Rsa(key) => rsa::RsaPublicKey::from(key.as_ref()).to_public_key_der(),
            Self::P256(key) => key.verifying_key().to_public_key_der(),
        }
        .map(|document| document.as_bytes().to_vec())
        .map_err(|_| "The public key could not be encoded.".into())
    }

    fn description(&self) -> String {
        match self {
            Self::Rsa(key) => format!("RSA {}-bit", key.size() * 8),
            Self::P256(_) => "ECDSA P-256".into(),
        }
    }
}

/// What the user needs to confirm before signing; never includes key material.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CertificateSummary {
    pub subject: String,
    pub issuer: String,
    pub not_before: String,
    pub not_after: String,
    pub key_type: String,
    pub chain_length: usize,
    pub self_signed: bool,
}

/// A decrypted signing key and its certificate chain, leaf first.
pub struct SigningIdentity {
    key: SignerKey,
    chain: Vec<Certificate>,
    pub summary: CertificateSummary,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Certification {
    #[default]
    None,
    NoChanges,
    FormFilling,
    FormFillingAndComments,
}

impl Certification {
    /// The DocMDP permission level when the signature certifies the document.
    fn permission(self) -> Option<i64> {
        match self {
            Self::None => None,
            Self::NoChanges => Some(1),
            Self::FormFilling => Some(2),
            Self::FormFillingAndComments => Some(3),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SignRequest {
    pub reason: String,
    pub location: String,
    pub certification: Certification,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SignatureStatus {
    /// The signed bytes are unchanged and the signature matches the embedded certificate.
    Valid,
    /// The signed bytes no longer match the signed digest.
    Modified,
    Invalid,
    Unsupported,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureInfo {
    pub field: String,
    pub signer: Option<String>,
    pub issuer: Option<String>,
    pub signed_at: Option<String>,
    pub reason: Option<String>,
    pub sub_filter: Option<String>,
    pub status: SignatureStatus,
    pub message: String,
    pub covers_whole_document: bool,
    pub certification: Option<i64>,
}

/// Opens a PKCS #12 identity and checks that its key matches a currently valid signing certificate.
pub fn load_identity(
    data: &[u8],
    password: &str,
    now: SystemTime,
) -> Result<SigningIdentity, String> {
    if data.len() > MAX_IDENTITY_BYTES {
        return Err("The certificate file is too large.".into());
    }
    let store = KeyStore::from_pkcs12(data, password).map_err(|_| {
        "The certificate file could not be opened. Check the password and that it is a PKCS #12 (.p12 or .pfx) file."
    })?;
    let (_, entry) = store
        .private_key_chain()
        .ok_or("The certificate file has no private key with a certificate.")?;
    let chain = entry
        .chain()
        .iter()
        .map(|certificate| Certificate::from_der(certificate.as_der()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "A certificate in the file could not be read.")?;
    let leaf = chain
        .first()
        .ok_or("The certificate file has no signing certificate.")?;
    let key = SignerKey::from_pkcs8(entry.key())?;
    let leaf_key = leaf
        .tbs_certificate
        .subject_public_key_info
        .to_der()
        .map_err(|_| "The certificate's public key could not be read.")?;
    if key.public_key_der()? != leaf_key {
        return Err("The private key does not belong to the signing certificate.".into());
    }
    let validity = &leaf.tbs_certificate.validity;
    let now = now.duration_since(UNIX_EPOCH).unwrap_or_default();
    if now < validity.not_before.to_unix_duration() {
        return Err("The certificate is not valid yet.".into());
    }
    if now > validity.not_after.to_unix_duration() {
        return Err("The certificate has expired.".into());
    }
    if !allows_signing(leaf) {
        return Err("The certificate is not allowed to create digital signatures.".into());
    }
    let tbs = &leaf.tbs_certificate;
    let summary = CertificateSummary {
        subject: tbs.subject.to_string(),
        issuer: tbs.issuer.to_string(),
        not_before: calendar_date(validity.not_before.to_unix_duration().as_secs()),
        not_after: calendar_date(validity.not_after.to_unix_duration().as_secs()),
        key_type: key.description(),
        chain_length: chain.len(),
        self_signed: tbs.subject == tbs.issuer,
    };
    Ok(SigningIdentity {
        key,
        chain,
        summary,
    })
}

fn allows_signing(certificate: &Certificate) -> bool {
    let Some(extension) = certificate
        .tbs_certificate
        .extensions
        .iter()
        .flatten()
        .find(|extension| extension.extn_id == rfc5280::ID_CE_KEY_USAGE)
    else {
        return true;
    };
    KeyUsage::from_der(extension.extn_value.as_bytes()).is_ok_and(|usage| {
        usage.0.contains(KeyUsages::DigitalSignature) || usage.0.contains(KeyUsages::NonRepudiation)
    })
}

/// Appends an invisible signature field on the first page and signs the resulting file.
pub fn sign(
    bytes: &[u8],
    identity: &SigningIdentity,
    request: &SignRequest,
    now: SystemTime,
) -> Result<Vec<u8>, String> {
    let doc = load(bytes)?;
    if doc.xref_start == 0 || !xref_offset_is_exact(bytes, doc.xref_start) {
        return Err(
            "This PDF's cross-reference table is damaged. Save a repaired copy before signing."
                .into(),
        );
    }
    let certify = request.certification.permission();
    if certify.is_some() && !signature_fields(&doc).is_empty() {
        return Err(
            "Only the first signature can certify a document. Sign without certification.".into(),
        );
    }
    if document_certification(&doc) == Some(1) {
        return Err("The document's certification does not allow further signatures.".into());
    }
    let reason = optional_text(&request.reason)?;
    let location = optional_text(&request.location)?;
    let page_id = *doc.get_pages().values().next().ok_or(UNREADABLE)?;
    let catalog_id = doc
        .trailer
        .get(b"Root")
        .and_then(Object::as_reference)
        .map_err(|_| UNREADABLE)?;
    let field_name = unused_field_name(&doc);
    let reserved = identity
        .chain
        .iter()
        .map(|certificate| certificate.to_der().map(|der| der.len()))
        .sum::<Result<usize, _>>()
        .map_err(|_| CREATE_FAILED)?
        + SIGNATURE_OVERHEAD;

    let mut update = IncrementalDocument::create_from(bytes.to_vec(), doc);
    let mut signature = dictionary! {
        "Type" => "Sig",
        "Filter" => "Adobe.PPKLite",
        "SubFilter" => "ETSI.CAdES.detached",
        "ByteRange" => vec![
            Object::Integer(0),
            Object::Integer(BYTE_RANGE_PLACEHOLDER),
            Object::Integer(BYTE_RANGE_PLACEHOLDER),
            Object::Integer(BYTE_RANGE_PLACEHOLDER),
        ],
        "Contents" => Object::String(vec![0; reserved], StringFormat::Hexadecimal),
        "M" => Object::string_literal(pdf_date(now)),
    };
    if let Some(reason) = reason {
        signature.set("Reason", reason);
    }
    if let Some(location) = location {
        signature.set("Location", location);
    }
    if let Some(level) = certify {
        signature.set(
            "Reference",
            vec![Object::Dictionary(dictionary! {
                "Type" => "SigRef",
                "TransformMethod" => "DocMDP",
                "TransformParams" => dictionary! {
                    "Type" => "TransformParams",
                    "P" => Object::Integer(level),
                    "V" => "1.2",
                },
            })],
        );
    }
    let signature_id = update.new_document.add_object(signature);
    let widget_id = update.new_document.add_object(dictionary! {
        "Type" => "Annot",
        "Subtype" => "Widget",
        "FT" => "Sig",
        "T" => Object::string_literal(field_name),
        "V" => signature_id,
        // Print and Locked.
        "F" => Object::Integer(132),
        "Rect" => vec![Object::Integer(0); 4],
        "P" => page_id,
    });

    let page = update
        .get_prev_documents()
        .get_dictionary(page_id)
        .map_err(|_| UNREADABLE)?
        .clone();
    let page = append_item(&mut update, page, b"Annots", Object::Reference(widget_id))?;
    update.new_document.set_object(page_id, page);

    let mut catalog = update
        .get_prev_documents()
        .get_dictionary(catalog_id)
        .map_err(|_| UNREADABLE)?
        .clone();
    let field = Object::Reference(widget_id);
    match catalog.get(b"AcroForm").ok().cloned() {
        Some(Object::Reference(form_id)) => {
            let form = update
                .get_prev_documents()
                .get_dictionary(form_id)
                .map_err(|_| UNREADABLE)?
                .clone();
            let form = signature_form(&mut update, form, field)?;
            update.new_document.set_object(form_id, form);
        }
        Some(Object::Dictionary(form)) => {
            let form = signature_form(&mut update, form, field)?;
            catalog.set("AcroForm", form);
        }
        _ => {
            let form = update.new_document.add_object(dictionary! {
                "Fields" => vec![field],
                "SigFlags" => Object::Integer(3),
            });
            catalog.set("AcroForm", form);
        }
    }
    if certify.is_some() {
        let prev = update.get_prev_documents();
        let mut permissions = catalog
            .get(b"Perms")
            .ok()
            .and_then(|perms| deref(prev, perms).as_dict().ok())
            .cloned()
            .unwrap_or_default();
        permissions.set("DocMDP", signature_id);
        catalog.set("Perms", permissions);
    }
    update.new_document.set_object(catalog_id, catalog);

    let mut output = Vec::with_capacity(bytes.len() + reserved * 2 + 4096);
    update.save_to(&mut output).map_err(|_| CREATE_FAILED)?;
    let (start, end) = placeholder_span(&output, bytes.len(), reserved)?;
    write_byte_range(&mut output, bytes.len(), start, end)?;
    let digest = Sha256::new()
        .chain_update(&output[..start])
        .chain_update(&output[end..])
        .finalize();
    let value = signed_data(identity, &digest)?;
    let hex: String = value.iter().map(|byte| format!("{byte:02X}")).collect();
    if hex.len() > end - start - 2 {
        return Err("The certificate chain is too large to embed in the signature.".into());
    }
    output[start + 1..start + 1 + hex.len()].copy_from_slice(hex.as_bytes());
    Ok(output)
}

/// How far from the end of the file the final `startxref` keyword is searched for.
const STARTXREF_SEARCH_BYTES: usize = 1024;

/// True when the final `startxref` names `offset` and a cross-reference section starts there.
/// The reader silently corrects small offset errors, and an incremental update built on a
/// corrected offset would carry a `/Prev` that other readers cannot follow.
fn xref_offset_is_exact(bytes: &[u8], offset: usize) -> bool {
    let tail = &bytes[bytes.len().saturating_sub(STARTXREF_SEARCH_BYTES)..];
    let Some(keyword) = tail.windows(9).rposition(|window| window == b"startxref") else {
        return false;
    };
    let digits: String = tail[keyword + 9..]
        .iter()
        .skip_while(|byte| byte.is_ascii_whitespace())
        .take_while(|byte| byte.is_ascii_digit())
        .map(|byte| char::from(*byte))
        .collect();
    if digits.parse::<usize>().ok() != Some(offset) {
        return false;
    }
    bytes
        .get(offset..)
        .is_some_and(|section| section.starts_with(b"xref") || starts_indirect_object(section))
}

/// Whether `bytes` begins with an `N G obj` header, as a cross-reference stream does.
fn starts_indirect_object(bytes: &[u8]) -> bool {
    let mut rest = bytes;
    for _ in 0..2 {
        let digits = rest.iter().take_while(|byte| byte.is_ascii_digit()).count();
        let spaces = rest[digits..]
            .iter()
            .take_while(|byte| byte.is_ascii_whitespace())
            .count();
        if digits == 0 || spaces == 0 {
            return false;
        }
        rest = &rest[digits + spaces..];
    }
    rest.starts_with(b"obj")
}

/// Adds the field and sets SignaturesExist and AppendOnly.
fn signature_form(
    update: &mut IncrementalDocument,
    form: Dictionary,
    field: Object,
) -> Result<Dictionary, String> {
    let mut form = append_item(update, form, b"Fields", field)?;
    let flags = form.get(b"SigFlags").and_then(Object::as_i64).unwrap_or(0);
    form.set("SigFlags", Object::Integer(flags | 3));
    Ok(form)
}

/// Appends to an array entry that may be direct or an indirect object of its own.
fn append_item(
    update: &mut IncrementalDocument,
    mut owner: Dictionary,
    key: &[u8],
    item: Object,
) -> Result<Dictionary, String> {
    match owner.get(key).ok().cloned() {
        Some(Object::Reference(id)) => {
            update
                .opt_clone_object_to_new_document(id)
                .map_err(|_| UNREADABLE)?;
            update
                .new_document
                .get_object_mut(id)
                .and_then(Object::as_array_mut)
                .map_err(|_| UNREADABLE)?
                .push(item);
        }
        Some(Object::Array(mut items)) => {
            items.push(item);
            owner.set(key.to_vec(), items);
        }
        _ => owner.set(key.to_vec(), vec![item]),
    }
    Ok(owner)
}

/// Locates the single zero-filled `/Contents` placeholder written after the previous revision.
fn placeholder_span(output: &[u8], from: usize, reserved: usize) -> Result<(usize, usize), String> {
    let digits = reserved * 2;
    let mut spans = Vec::new();
    let mut cursor = from;
    while let Some(offset) = find(&output[cursor..], b"/Contents") {
        let mut start = cursor + offset + b"/Contents".len();
        while output.get(start).is_some_and(u8::is_ascii_whitespace) {
            start += 1;
        }
        let end = start + digits + 2;
        if output.get(start) == Some(&b'<')
            && output.get(end - 1) == Some(&b'>')
            && output[start + 1..end - 1]
                .iter()
                .all(|&digit| digit == b'0')
        {
            spans.push((start, end));
        }
        cursor = start;
    }
    match spans.as_slice() {
        [span] => Ok(*span),
        _ => Err(CREATE_FAILED.into()),
    }
}

fn write_byte_range(
    output: &mut [u8],
    from: usize,
    start: usize,
    end: usize,
) -> Result<(), String> {
    let key = from + find(&output[from..], b"/ByteRange").ok_or(CREATE_FAILED)?;
    if find(&output[key + 1..], b"/ByteRange").is_some() {
        return Err(CREATE_FAILED.into());
    }
    let open = key
        + output[key..]
            .iter()
            .position(|&byte| byte == b'[')
            .ok_or(CREATE_FAILED)?;
    let close = open
        + output[open..]
            .iter()
            .position(|&byte| byte == b']')
            .ok_or(CREATE_FAILED)?;
    let text = format!("0 {start} {end} {}", output.len() - end);
    let slot = &mut output[open + 1..close];
    if text.len() > slot.len() {
        return Err(CREATE_FAILED.into());
    }
    slot.fill(b' ');
    slot[..text.len()].copy_from_slice(text.as_bytes());
    Ok(())
}

/// ESS signing-certificate-v2 value, required by PAdES to bind the signer's certificate.
#[derive(Sequence)]
struct EssCertIdV2 {
    cert_hash: OctetString,
}

#[derive(Sequence)]
struct SigningCertificateV2 {
    certs: Vec<EssCertIdV2>,
}

fn signed_data(identity: &SigningIdentity, digest: &[u8]) -> Result<Vec<u8>, String> {
    let leaf = identity.chain.first().ok_or(CREATE_FAILED)?;
    let sid = SignerIdentifier::IssuerAndSerialNumber(IssuerAndSerialNumber {
        issuer: leaf.tbs_certificate.issuer.clone(),
        serial_number: leaf.tbs_certificate.serial_number.clone(),
    });
    let digest_algorithm = AlgorithmIdentifierOwned {
        oid: rfc5912::ID_SHA_256,
        parameters: None,
    };
    let content = EncapsulatedContentInfo {
        econtent_type: rfc5911::ID_DATA,
        econtent: None,
    };
    let certificate_hash = Sha256::digest(leaf.to_der().map_err(|_| CREATE_FAILED)?);
    let signing_certificate = Attribute {
        oid: rfc5911::ID_AA_SIGNING_CERTIFICATE_V_2,
        values: SetOfVec::try_from(vec![Any::encode_from(&SigningCertificateV2 {
            certs: vec![EssCertIdV2 {
                cert_hash: OctetString::new(certificate_hash.to_vec())
                    .map_err(|_| CREATE_FAILED)?,
            }],
        })
        .map_err(|_| CREATE_FAILED)?])
        .map_err(|_| CREATE_FAILED)?,
    };
    let signer_info = match &identity.key {
        SignerKey::Rsa(key) => {
            let signer = rsa::pkcs1v15::SigningKey::<Sha256>::new(key.as_ref().clone());
            let mut builder = SignerInfoBuilder::new(
                &signer,
                sid,
                digest_algorithm.clone(),
                &content,
                Some(digest),
            )
            .map_err(|_| CREATE_FAILED)?;
            builder
                .add_signed_attribute(signing_certificate)
                .map_err(|_| CREATE_FAILED)?;
            // The randomized path blinds the private-key operation.
            builder.build_with_rng::<rsa::pkcs1v15::Signature>(&mut rsa::rand_core::OsRng)
        }
        SignerKey::P256(key) => {
            let mut builder =
                SignerInfoBuilder::new(key, sid, digest_algorithm.clone(), &content, Some(digest))
                    .map_err(|_| CREATE_FAILED)?;
            builder
                .add_signed_attribute(signing_certificate)
                .map_err(|_| CREATE_FAILED)?;
            builder.build::<p256::ecdsa::DerSignature>()
        }
    }
    .map_err(|_| CREATE_FAILED)?;
    let certificates = identity
        .chain
        .iter()
        .cloned()
        .map(CertificateChoices::Certificate)
        .collect::<Vec<_>>();
    let signed = SignedData {
        version: CmsVersion::V1,
        digest_algorithms: DigestAlgorithmIdentifiers::try_from(vec![digest_algorithm])
            .map_err(|_| CREATE_FAILED)?,
        encap_content_info: content,
        certificates: Some(CertificateSet::try_from(certificates).map_err(|_| CREATE_FAILED)?),
        crls: None,
        signer_infos: SignerInfos::try_from(vec![signer_info]).map_err(|_| CREATE_FAILED)?,
    };
    ContentInfo {
        content_type: rfc5911::ID_SIGNED_DATA,
        content: Any::encode_from(&signed).map_err(|_| CREATE_FAILED)?,
    }
    .to_der()
    .map_err(|_| CREATE_FAILED.into())
}

/// Checks every signature field in the document against the bytes it claims to sign.
pub fn verify(bytes: &[u8]) -> Result<Vec<SignatureInfo>, String> {
    let doc =
        Document::load_mem(bytes).map_err(|_| "The PDF could not be read by the local engine.")?;
    if doc.trailer.has(b"Encrypt") {
        return Err("Signatures in password-protected PDFs cannot be checked yet.".into());
    }
    Ok(signature_fields(&doc)
        .into_iter()
        .map(|(field, signature)| {
            let mut info = SignatureInfo {
                field,
                signer: None,
                issuer: None,
                signed_at: text_entry(&signature, b"M"),
                reason: text_entry(&signature, b"Reason"),
                sub_filter: signature
                    .get(b"SubFilter")
                    .and_then(Object::as_name)
                    .ok()
                    .map(|name| String::from_utf8_lossy(name).into_owned()),
                status: SignatureStatus::Valid,
                message: String::new(),
                covers_whole_document: false,
                certification: certification_level(&doc, &signature),
            };
            match check_signature(bytes, &signature, &mut info) {
                Ok(message) => info.message = message,
                Err((status, message)) => {
                    info.status = status;
                    info.message = message;
                }
            }
            info
        })
        .collect())
}

/// Accepts a saved candidate only when its newest signature is valid and covers the whole file.
pub fn validate_signed(bytes: &[u8], expected_pages: u32) -> Result<(), String> {
    const NOT_VERIFIED: &str = "The signed copy did not verify. Nothing was saved.";
    if load(bytes)?.get_pages().len() != expected_pages as usize {
        return Err("The signed copy has an unexpected page count. Nothing was saved.".into());
    }
    let newest = verify(bytes)?
        .into_iter()
        .find(|signature| signature.covers_whole_document)
        .ok_or(NOT_VERIFIED)?;
    if newest.status != SignatureStatus::Valid {
        return Err(NOT_VERIFIED.into());
    }
    Ok(())
}

type Failure = (SignatureStatus, String);

fn check_signature(
    bytes: &[u8],
    signature: &Dictionary,
    info: &mut SignatureInfo,
) -> Result<String, Failure> {
    let invalid = |message: &str| (SignatureStatus::Invalid, message.to_string());
    let unsupported = |message: &str| (SignatureStatus::Unsupported, message.to_string());
    let range: Vec<i64> = signature
        .get(b"ByteRange")
        .and_then(Object::as_array)
        .map(|items| items.iter().filter_map(|item| item.as_i64().ok()).collect())
        .unwrap_or_default();
    let &[0, first_end, second_start, second_len] = range.as_slice() else {
        return Err(invalid("The signature's byte range is malformed."));
    };
    let (Ok(first_end), Ok(second_start), Ok(second_len)) = (
        usize::try_from(first_end),
        usize::try_from(second_start),
        usize::try_from(second_len),
    ) else {
        return Err(invalid("The signature's byte range is malformed."));
    };
    let second_end = second_start
        .checked_add(second_len)
        .filter(|end| *end <= bytes.len())
        .ok_or_else(|| invalid("The signature's byte range is malformed."))?;
    if first_end == 0
        || second_start < first_end + 2
        || bytes[first_end] != b'<'
        || bytes[second_start - 1] != b'>'
    {
        return Err(invalid(MISPLACED));
    }
    let contents = signature
        .get(b"Contents")
        .and_then(Object::as_str)
        .map_err(|_| invalid("The signature has no value."))?;
    if decode_hex(&bytes[first_end + 1..second_start - 1]).as_deref() != Some(contents) {
        return Err(invalid(MISPLACED));
    }
    info.covers_whole_document = second_end == bytes.len();

    let der = der_element(contents).ok_or_else(|| unsupported(NOT_CMS))?;
    let content_info = ContentInfo::from_der(der).map_err(|_| unsupported(NOT_CMS))?;
    if content_info.content_type != rfc5911::ID_SIGNED_DATA {
        return Err(unsupported(NOT_CMS));
    }
    let signed = content_info
        .content
        .decode_as::<SignedData>()
        .map_err(|_| unsupported(NOT_CMS))?;
    let [signer] = signed.signer_infos.0.as_slice() else {
        return Err(unsupported(
            "Signatures with several signers are not supported.",
        ));
    };
    let certificate = signer_certificate(&signed, &signer.sid)
        .ok_or_else(|| invalid("The signer's certificate is not included in the signature."))?;
    info.signer = Some(certificate.tbs_certificate.subject.to_string());
    info.issuer = Some(certificate.tbs_certificate.issuer.to_string());
    let digest = content_digest(
        signer.digest_alg.oid,
        &[&bytes[..first_end], &bytes[second_start..second_end]],
    )
    .ok_or_else(|| unsupported("The signature uses an unsupported digest algorithm."))?;
    let attributes = signer
        .signed_attrs
        .as_ref()
        .ok_or_else(|| unsupported("Signatures without signed attributes are not supported."))?;
    let message_digest = attributes
        .iter()
        .find(|attribute| attribute.oid == rfc5911::ID_MESSAGE_DIGEST)
        .and_then(|attribute| attribute.values.iter().next())
        .and_then(|value| value.decode_as::<OctetString>().ok())
        .ok_or_else(|| invalid("The signature has no message digest."))?;
    if message_digest.as_bytes() != digest.as_slice() {
        return Err((
            SignatureStatus::Modified,
            "The signed content was changed after signing.".into(),
        ));
    }
    let signed_attributes = attributes.to_der().map_err(|_| unsupported(NOT_CMS))?;
    match verify_value(
        certificate,
        signer.signature_algorithm.oid,
        signer.digest_alg.oid,
        &signed_attributes,
        signer.signature.as_bytes(),
    ) {
        Some(true) if info.covers_whole_document => Ok("The signed content is unchanged.".into()),
        Some(true) => Ok(
            "The signed revision is unchanged, but the document was changed after this signature."
                .into(),
        ),
        Some(false) => Err(invalid(
            "The signature does not match the signer's certificate.",
        )),
        None => Err(unsupported("The signature algorithm is not supported.")),
    }
}

fn signer_certificate<'a>(
    signed: &'a SignedData,
    sid: &SignerIdentifier,
) -> Option<&'a Certificate> {
    let SignerIdentifier::IssuerAndSerialNumber(id) = sid else {
        return None;
    };
    signed
        .certificates
        .as_ref()?
        .0
        .iter()
        .find_map(|choice| match choice {
            CertificateChoices::Certificate(certificate)
                if certificate.tbs_certificate.issuer == id.issuer
                    && certificate.tbs_certificate.serial_number == id.serial_number =>
            {
                Some(certificate)
            }
            _ => None,
        })
}

fn content_digest(algorithm: ObjectIdentifier, parts: &[&[u8]]) -> Option<Vec<u8>> {
    fn hash<D: Digest>(parts: &[&[u8]]) -> Vec<u8> {
        let mut digest = D::new();
        for part in parts {
            digest.update(part);
        }
        digest.finalize().to_vec()
    }
    if algorithm == rfc5912::ID_SHA_256 {
        Some(hash::<Sha256>(parts))
    } else if algorithm == rfc5912::ID_SHA_384 {
        Some(hash::<Sha384>(parts))
    } else if algorithm == rfc5912::ID_SHA_512 {
        Some(hash::<Sha512>(parts))
    } else {
        None
    }
}

/// `None` when the algorithm or key type is unsupported.
fn verify_value(
    certificate: &Certificate,
    algorithm: ObjectIdentifier,
    digest: ObjectIdentifier,
    message: &[u8],
    value: &[u8],
) -> Option<bool> {
    use rsa::pkcs1v15::VerifyingKey;
    let key = certificate
        .tbs_certificate
        .subject_public_key_info
        .to_der()
        .ok()?;
    let rsa_algorithms = [
        rfc5912::RSA_ENCRYPTION,
        rfc5912::SHA_256_WITH_RSA_ENCRYPTION,
        rfc5912::SHA_384_WITH_RSA_ENCRYPTION,
        rfc5912::SHA_512_WITH_RSA_ENCRYPTION,
    ];
    if rsa_algorithms.contains(&algorithm) {
        let key = rsa::RsaPublicKey::from_public_key_der(&key).ok()?;
        let Ok(signature) = rsa::pkcs1v15::Signature::try_from(value) else {
            return Some(false);
        };
        return if digest == rfc5912::ID_SHA_256 {
            Some(
                VerifyingKey::<Sha256>::new(key)
                    .verify(message, &signature)
                    .is_ok(),
            )
        } else if digest == rfc5912::ID_SHA_384 {
            Some(
                VerifyingKey::<Sha384>::new(key)
                    .verify(message, &signature)
                    .is_ok(),
            )
        } else if digest == rfc5912::ID_SHA_512 {
            Some(
                VerifyingKey::<Sha512>::new(key)
                    .verify(message, &signature)
                    .is_ok(),
            )
        } else {
            None
        };
    }
    if algorithm == rfc5912::ECDSA_WITH_SHA_256 && digest == rfc5912::ID_SHA_256 {
        let key = p256::ecdsa::VerifyingKey::from_public_key_der(&key).ok()?;
        let Ok(signature) = p256::ecdsa::DerSignature::try_from(value) else {
            return Some(false);
        };
        return Some(key.verify(message, &signature).is_ok());
    }
    None
}

/// The complete DER element at the start of a zero-padded signature value.
fn der_element(bytes: &[u8]) -> Option<&[u8]> {
    let mut reader = der::SliceReader::new(bytes).ok()?;
    let header = der::Header::decode(&mut reader).ok()?;
    let length = (header.encoded_len().ok()? + header.length).ok()?;
    bytes.get(..usize::try_from(length).ok()?)
}

fn decode_hex(text: &[u8]) -> Option<Vec<u8>> {
    let digits: Vec<u32> = text
        .iter()
        .filter(|byte| !byte.is_ascii_whitespace())
        .map(|&byte| char::from(byte).to_digit(16))
        .collect::<Option<_>>()?;
    Some(
        digits
            .chunks(2)
            .map(|pair| (pair[0] * 16 + pair.get(1).copied().unwrap_or(0)) as u8)
            .collect(),
    )
}

/// Signature fields that carry a signature value, with fully qualified names.
fn signature_fields(doc: &Document) -> Vec<(String, Dictionary)> {
    let mut found = Vec::new();
    let Some(fields) = form_fields(doc) else {
        return found;
    };
    let mut visited = HashSet::new();
    for field in fields {
        collect_fields(doc, field, "", None, 0, &mut visited, &mut found);
    }
    found
}

fn form_fields(doc: &Document) -> Option<&Vec<Object>> {
    let catalog = doc.catalog().ok()?;
    let form = deref(doc, catalog.get(b"AcroForm").ok()?).as_dict().ok()?;
    deref(doc, form.get(b"Fields").ok()?).as_array().ok()
}

fn collect_fields<'a>(
    doc: &'a Document,
    object: &'a Object,
    parent: &str,
    inherited_type: Option<&'a [u8]>,
    depth: usize,
    visited: &mut HashSet<lopdf::ObjectId>,
    found: &mut Vec<(String, Dictionary)>,
) {
    if depth > MAX_FIELD_DEPTH {
        return;
    }
    if let Object::Reference(id) = object {
        if !visited.insert(*id) {
            return;
        }
    }
    let Ok(field) = deref(doc, object).as_dict() else {
        return;
    };
    let name = match field.get(b"T").and_then(Object::as_str).map(decode_text) {
        Ok(partial) if parent.is_empty() => partial,
        Ok(partial) => format!("{parent}.{partial}"),
        Err(_) => parent.to_string(),
    };
    let field_type = field
        .get(b"FT")
        .and_then(Object::as_name)
        .ok()
        .or(inherited_type);
    if field_type == Some(b"Sig".as_slice()) {
        if let Some(value) = field
            .get(b"V")
            .ok()
            .and_then(|value| deref(doc, value).as_dict().ok())
        {
            found.push((name.clone(), value.clone()));
        }
    }
    if let Some(kids) = field
        .get(b"Kids")
        .ok()
        .and_then(|kids| deref(doc, kids).as_array().ok())
    {
        for kid in kids {
            collect_fields(doc, kid, &name, field_type, depth + 1, visited, found);
        }
    }
}

fn unused_field_name(doc: &Document) -> String {
    let taken: HashSet<String> = form_fields(doc)
        .into_iter()
        .flatten()
        .filter_map(|field| {
            deref(doc, field)
                .as_dict()
                .and_then(|field| field.get(b"T"))
                .and_then(Object::as_str)
                .ok()
                .map(decode_text)
        })
        .collect();
    (1..)
        .map(|index| format!("Signature{index}"))
        .find(|name| !taken.contains(name))
        .unwrap_or_else(|| "Signature".into())
}

fn document_certification(doc: &Document) -> Option<i64> {
    let catalog = doc.catalog().ok()?;
    let permissions = deref(doc, catalog.get(b"Perms").ok()?).as_dict().ok()?;
    let signature = deref(doc, permissions.get(b"DocMDP").ok()?)
        .as_dict()
        .ok()?;
    certification_level(doc, signature)
}

/// The DocMDP permission of a certifying signature; a missing level means 2.
fn certification_level(doc: &Document, signature: &Dictionary) -> Option<i64> {
    let references = deref(doc, signature.get(b"Reference").ok()?)
        .as_array()
        .ok()?;
    references
        .iter()
        .filter_map(|reference| deref(doc, reference).as_dict().ok())
        .find(|reference| {
            reference
                .get(b"TransformMethod")
                .and_then(Object::as_name)
                .ok()
                == Some(b"DocMDP".as_slice())
        })
        .map(|reference| {
            reference
                .get(b"TransformParams")
                .ok()
                .and_then(|params| deref(doc, params).as_dict().ok())
                .and_then(|params| params.get(b"P").and_then(Object::as_i64).ok())
                .unwrap_or(2)
        })
}

fn optional_text(text: &str) -> Result<Option<Object>, String> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(None);
    }
    if text.chars().count() > MAX_TEXT_CHARS {
        return Err("Keep the reason and location under 256 characters.".into());
    }
    if text.chars().any(char::is_control) {
        return Err("The reason and location cannot contain control characters.".into());
    }
    Ok(Some(if text.is_ascii() {
        Object::string_literal(text)
    } else {
        let mut encoded = vec![0xFE, 0xFF];
        encoded.extend(text.encode_utf16().flat_map(u16::to_be_bytes));
        Object::String(encoded, StringFormat::Hexadecimal)
    }))
}

fn text_entry(dictionary: &Dictionary, key: &[u8]) -> Option<String> {
    dictionary
        .get(key)
        .and_then(Object::as_str)
        .ok()
        .map(decode_text)
}

/// PDF text strings are UTF-16BE with a byte order mark, or single-byte text otherwise.
fn decode_text(bytes: &[u8]) -> String {
    match bytes.strip_prefix(&[0xFE, 0xFF]) {
        Some(rest) => String::from_utf16_lossy(
            &rest
                .as_chunks::<2>()
                .0
                .iter()
                .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
                .collect::<Vec<_>>(),
        ),
        None => bytes.iter().map(|&byte| char::from(byte)).collect(),
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// Calendar fields in UTC for seconds since the Unix epoch.
fn utc_fields(seconds: u64) -> (i64, u64, u64, u64, u64, u64) {
    let days = (seconds / 86_400) as i64;
    let time = seconds % 86_400;
    // Civil-from-days conversion for the proleptic Gregorian calendar.
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_index + 2) / 5 + 1) as u64;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    } as u64;
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day, time / 3600, time % 3600 / 60, time % 60)
}

fn pdf_date(now: SystemTime) -> String {
    let seconds = now
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0);
    let (year, month, day, hour, minute, second) = utc_fields(seconds);
    format!("D:{year:04}{month:02}{day:02}{hour:02}{minute:02}{second:02}Z")
}

fn calendar_date(seconds: u64) -> String {
    let (year, month, day, ..) = utc_fields(seconds);
    format!("{year:04}-{month:02}-{day:02}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::content::tests::page_document;
    use p12_keystore::{KeyStoreEntry, PrivateKeyChain};
    use rsa::pkcs8::EncodePrivateKey;
    use rsa::rand_core::OsRng;
    use std::str::FromStr;
    use std::time::Duration;
    use x509_cert::builder::{CertificateBuilder, Profile};
    use x509_cert::name::Name;
    use x509_cert::serial_number::SerialNumber;
    use x509_cert::spki::SubjectPublicKeyInfoOwned;
    use x509_cert::time::Validity;

    fn test_password() -> String {
        uuid::Uuid::new_v4().simple().to_string()
    }

    /// A one-page PDF with an existing text field and a referenced annotation array.
    fn pdf(modern: bool) -> Vec<u8> {
        let (mut doc, page) =
            page_document("BT /F1 12 Tf 72 720 Td (Signed page) Tj ET", dictionary! {});
        let field = doc.add_object(dictionary! {
            "Type" => "Annot", "Subtype" => "Widget", "FT" => "Tx",
            "T" => Object::string_literal("Name"), "Rect" => vec![Object::Integer(0); 4], "P" => page,
        });
        let annots = doc.add_object(vec![Object::Reference(field)]);
        doc.get_dictionary_mut(page).unwrap().set("Annots", annots);
        let root = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
        doc.get_dictionary_mut(root).unwrap().set(
            "AcroForm",
            dictionary! {"Fields" => vec![Object::Reference(field)]},
        );
        let mut bytes = Vec::new();
        if modern {
            doc.save_modern(&mut bytes).unwrap();
        } else {
            doc.save_to(&mut bytes).unwrap();
        }
        bytes
    }

    fn name() -> Name {
        Name::from_str("CN=Synthetic Signer,O=NavPDF Tests").unwrap()
    }

    fn leaf_profile() -> Profile {
        Profile::Leaf {
            issuer: name(),
            enable_key_agreement: false,
            enable_key_encipherment: false,
        }
    }

    fn validity() -> Validity {
        Validity::from_now(Duration::from_secs(3600)).unwrap()
    }

    fn p256_parts() -> (p256::ecdsa::SigningKey, Certificate) {
        let key = p256::ecdsa::SigningKey::random(&mut OsRng);
        let spki = SubjectPublicKeyInfoOwned::from_key(*key.verifying_key()).unwrap();
        let serial = SerialNumber::new(&[7]).unwrap();
        let certificate =
            CertificateBuilder::new(leaf_profile(), serial, validity(), name(), spki, &key)
                .unwrap()
                .build::<p256::ecdsa::DerSignature>()
                .unwrap();
        (key, certificate)
    }

    fn keystore(pkcs8: &[u8], certificate: &Certificate, password: &str) -> Vec<u8> {
        let chain = [p12_keystore::Certificate::from_der(&certificate.to_der().unwrap()).unwrap()];
        let mut store = KeyStore::new();
        store.add_entry(
            "signer",
            KeyStoreEntry::PrivateKeyChain(PrivateKeyChain::new(pkcs8, [1_u8], chain)),
        );
        store.writer(password).write().unwrap()
    }

    fn p256_identity() -> (Vec<u8>, String) {
        let (key, certificate) = p256_parts();
        let password = test_password();
        (
            keystore(
                key.to_pkcs8_der().unwrap().as_bytes(),
                &certificate,
                &password,
            ),
            password,
        )
    }

    /// Offsets of the `<` and just past the `>` of the only signature value.
    fn signature_value_span(bytes: &[u8]) -> (usize, usize) {
        let doc = Document::load_mem(bytes).unwrap();
        let (_, signature) = signature_fields(&doc).pop().unwrap();
        let range = signature.get(b"ByteRange").unwrap().as_array().unwrap();
        (
            range[1].as_i64().unwrap() as usize,
            range[2].as_i64().unwrap() as usize,
        )
    }

    #[test]
    fn signs_incrementally_and_verifies_the_whole_document() {
        let source = pdf(false);
        let (identity_file, password) = p256_identity();
        let identity = load_identity(&identity_file, &password, SystemTime::now()).unwrap();
        assert_eq!(identity.summary.key_type, "ECDSA P-256");
        assert!(identity.summary.subject.contains("Synthetic Signer"));
        assert!(identity.summary.self_signed);
        let request = SignRequest {
            reason: "Approved résumé".into(),
            location: "Test lab".into(),
            certification: Certification::None,
        };
        let signed = sign(&source, &identity, &request, SystemTime::now()).unwrap();
        assert!(
            signed.starts_with(&source),
            "the earlier revision is preserved byte for byte"
        );

        let report = verify(&signed).unwrap();
        assert_eq!(report.len(), 1);
        let signature = &report[0];
        assert_eq!(
            signature.status,
            SignatureStatus::Valid,
            "{}",
            signature.message
        );
        assert!(signature.covers_whole_document);
        assert_eq!(signature.field, "Signature1");
        assert_eq!(signature.reason.as_deref(), Some("Approved résumé"));
        assert_eq!(signature.sub_filter.as_deref(), Some("ETSI.CAdES.detached"));
        assert!(signature
            .signer
            .as_deref()
            .unwrap()
            .contains("Synthetic Signer"));
        assert_eq!(signature.certification, None);
        validate_signed(&signed, 1).unwrap();
        assert!(validate_signed(&signed, 2).is_err());

        let doc = Document::load_mem(&signed).unwrap();
        let form = doc
            .catalog()
            .unwrap()
            .get(b"AcroForm")
            .unwrap()
            .as_dict()
            .unwrap();
        assert_eq!(form.get(b"SigFlags").unwrap().as_i64().unwrap(), 3);
        assert_eq!(form.get(b"Fields").unwrap().as_array().unwrap().len(), 2);
        let page = *doc.get_pages().values().next().unwrap();
        let annots = doc.get_dictionary(page).unwrap().get(b"Annots").unwrap();
        assert_eq!(deref(&doc, annots).as_array().unwrap().len(), 2);
    }

    #[test]
    fn refuses_to_sign_when_startxref_does_not_name_the_cross_reference_section() {
        let source = pdf(false);
        let keyword = source
            .windows(9)
            .rposition(|window| window == b"startxref")
            .unwrap();
        let start = keyword
            + 9
            + source[keyword + 9..]
                .iter()
                .take_while(|byte| byte.is_ascii_whitespace())
                .count();
        let end = start
            + source[start..]
                .iter()
                .take_while(|byte| byte.is_ascii_digit())
                .count();
        let offset: usize = std::str::from_utf8(&source[start..end])
            .unwrap()
            .parse()
            .unwrap();
        let with_offset = |declared: usize| {
            let mut bytes = source[..start].to_vec();
            bytes.extend_from_slice(declared.to_string().as_bytes());
            bytes.extend_from_slice(&source[end..]);
            bytes
        };
        // An offset one byte early lands on the line break before `xref`. The reader accepts it
        // and records it as the section start, so an update would carry an inexact `/Prev`.
        let damaged = with_offset(offset - 1);
        assert_eq!(Document::load_mem(&damaged).unwrap().xref_start, offset - 1);
        assert!(damaged[offset - 1].is_ascii_whitespace());

        let (identity_file, password) = p256_identity();
        let identity = load_identity(&identity_file, &password, SystemTime::now()).unwrap();
        let request = SignRequest {
            reason: "Approved".into(),
            location: "Test lab".into(),
            certification: Certification::None,
        };
        let error = sign(&damaged, &identity, &request, SystemTime::now()).unwrap_err();
        assert!(error.contains("cross-reference"), "{error}");
        assert!(sign(&source, &identity, &request, SystemTime::now()).is_ok());
        assert!(sign(&pdf(true), &identity, &request, SystemTime::now()).is_ok());
    }

    #[test]
    fn reports_changes_inside_and_after_the_signed_range() {
        let (identity_file, password) = p256_identity();
        let identity = load_identity(&identity_file, &password, SystemTime::now()).unwrap();
        let signed = sign(
            &pdf(false),
            &identity,
            &SignRequest::default(),
            SystemTime::now(),
        )
        .unwrap();

        let mut appended = signed.clone();
        appended.extend_from_slice(b"\n% a later change\n");
        let report = verify(&appended).unwrap();
        assert_eq!(report[0].status, SignatureStatus::Valid);
        assert!(!report[0].covers_whole_document);
        assert!(validate_signed(&appended, 1).is_err());

        let mut tampered = signed.clone();
        let marker = find(&tampered, b"\n%").unwrap() + 2;
        tampered[marker] ^= 0x01;
        let report = verify(&tampered).unwrap();
        assert_eq!(report[0].status, SignatureStatus::Modified);
        assert!(validate_signed(&tampered, 1).is_err());

        // Corrupting the signature value itself must never verify.
        let mut corrupted = signed;
        let (start, _) = signature_value_span(&corrupted);
        corrupted[start + 1] = if corrupted[start + 1] == b'3' {
            b'2'
        } else {
            b'3'
        };
        assert_ne!(
            verify(&corrupted).unwrap()[0].status,
            SignatureStatus::Valid
        );
    }

    #[test]
    fn certification_is_limited_to_the_first_signature() {
        let (identity_file, password) = p256_identity();
        let identity = load_identity(&identity_file, &password, SystemTime::now()).unwrap();
        let now = SystemTime::now();
        let certify = |level| SignRequest {
            certification: level,
            ..SignRequest::default()
        };
        let certified = sign(
            &pdf(true),
            &identity,
            &certify(Certification::FormFilling),
            now,
        )
        .unwrap();
        assert_eq!(verify(&certified).unwrap()[0].certification, Some(2));
        let doc = Document::load_mem(&certified).unwrap();
        let permissions = doc.catalog().unwrap().get(b"Perms").unwrap();
        assert!(permissions.as_dict().unwrap().has(b"DocMDP"));
        assert!(sign(
            &certified,
            &identity,
            &certify(Certification::NoChanges),
            now
        )
        .unwrap_err()
        .contains("first signature"));

        let countersigned = sign(&certified, &identity, &SignRequest::default(), now).unwrap();
        let report = verify(&countersigned).unwrap();
        assert_eq!(report.len(), 2);
        assert_eq!(report[1].field, "Signature2");
        assert!(report
            .iter()
            .all(|signature| signature.status == SignatureStatus::Valid));
        assert!(!report[0].covers_whole_document && report[1].covers_whole_document);
        validate_signed(&countersigned, 1).unwrap();

        let locked = sign(
            &pdf(false),
            &identity,
            &certify(Certification::NoChanges),
            now,
        )
        .unwrap();
        assert!(sign(&locked, &identity, &SignRequest::default(), now)
            .unwrap_err()
            .contains("does not allow"));
    }

    #[test]
    fn refuses_wrong_passwords_invalid_dates_and_foreign_keys() {
        let (file, password) = p256_identity();
        let now = SystemTime::now();
        assert!(load_identity(&file, &test_password(), now).is_err());
        let later = now + Duration::from_secs(7200);
        assert!(load_identity(&file, &password, later)
            .err()
            .unwrap()
            .contains("expired"));
        let earlier = now - Duration::from_secs(7200);
        assert!(load_identity(&file, &password, earlier)
            .err()
            .unwrap()
            .contains("not valid yet"));

        let (_, certificate) = p256_parts();
        let (other_key, _) = p256_parts();
        let foreign = keystore(
            other_key.to_pkcs8_der().unwrap().as_bytes(),
            &certificate,
            &password,
        );
        assert!(load_identity(&foreign, &password, now)
            .err()
            .unwrap()
            .contains("does not belong"));
        assert!(load_identity(&[0; 16], &password, now).is_err());
        assert!(
            load_identity(&vec![0; MAX_IDENTITY_BYTES + 1], &password, now)
                .err()
                .unwrap()
                .contains("too large")
        );

        let identity = load_identity(&file, &password, now).unwrap();
        let long = SignRequest {
            reason: "x".repeat(MAX_TEXT_CHARS + 1),
            ..SignRequest::default()
        };
        assert!(sign(&pdf(false), &identity, &long, now).is_err());
    }

    #[test]
    fn signs_with_rsa_keys() {
        let private = rsa::RsaPrivateKey::new(&mut OsRng, 2048).unwrap();
        let signer = rsa::pkcs1v15::SigningKey::<Sha256>::new(private.clone());
        let spki = SubjectPublicKeyInfoOwned::from_key(rsa::RsaPublicKey::from(&private)).unwrap();
        let serial = SerialNumber::new(&[9]).unwrap();
        let certificate =
            CertificateBuilder::new(leaf_profile(), serial, validity(), name(), spki, &signer)
                .unwrap()
                .build::<rsa::pkcs1v15::Signature>()
                .unwrap();
        let password = test_password();
        let file = keystore(
            private.to_pkcs8_der().unwrap().as_bytes(),
            &certificate,
            &password,
        );
        let identity = load_identity(&file, &password, SystemTime::now()).unwrap();
        assert_eq!(identity.summary.key_type, "RSA 2048-bit");
        let signed = sign(
            &pdf(true),
            &identity,
            &SignRequest::default(),
            SystemTime::now(),
        )
        .unwrap();
        let report = verify(&signed).unwrap();
        assert_eq!(
            report[0].status,
            SignatureStatus::Valid,
            "{}",
            report[0].message
        );
        assert!(report[0].covers_whole_document);
    }

    #[test]
    fn pdf_dates_use_utc_calendar_fields() {
        assert_eq!(
            pdf_date(UNIX_EPOCH + Duration::from_secs(1_789_344_000)),
            "D:20260914000000Z"
        );
        assert_eq!(
            pdf_date(UNIX_EPOCH + Duration::from_secs(1_709_164_800 + 3_723)),
            "D:20240229010203Z"
        );
        assert_eq!(calendar_date(0), "1970-01-01");
        assert_eq!(decode_hex(b"0a 1F"), Some(vec![0x0a, 0x1f]));
        assert_eq!(decode_hex(b"zz"), None);
    }
}
