//! Inspecting certificate signatures without the network: certificate details, a trust check
//! against certificates the user chose to trust on this device, and what changed in the
//! document after each signature. Revocation and timestamps are not checked (ADR 0018).

use super::{calendar_date, decode_text, deref, rfc5912, verify_value, Certificate, Document};
use const_oid::ObjectIdentifier;
use der::Encode;
use lopdf::{Dictionary, Object, ObjectId};
use rsa::sha2::{Digest, Sha256};
use serde::Serialize;
use std::collections::{BTreeMap, HashSet};

/// The longest issuer chain followed from a signer's certificate.
const MAX_CHAIN: usize = 8;
/// The most changes listed for one signature.
const MAX_CHANGES: usize = 20;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CertificateDetails {
    pub subject: String,
    pub issuer: String,
    /// Serial number in hexadecimal.
    pub serial: String,
    pub not_before: String,
    pub not_after: String,
    /// SHA-256 of the certificate, in colon-separated hexadecimal pairs.
    pub fingerprint: String,
    pub self_signed: bool,
    /// The certificate is one the user chose to trust.
    pub trusted: bool,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TrustStatus {
    Trusted,
    NotTrusted,
    NotValidAtSigning,
    BrokenChain,
}

pub struct ChainReport {
    pub certificates: Vec<CertificateDetails>,
    pub trust: TrustStatus,
    pub message: String,
}

/// SHA-256 of DER bytes as colon-separated uppercase hexadecimal pairs.
pub fn fingerprint(der: &[u8]) -> String {
    Sha256::digest(der)
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

fn certificate_fingerprint(certificate: &Certificate) -> String {
    certificate
        .to_der()
        .map(|der| fingerprint(&der))
        .unwrap_or_default()
}

pub fn details(certificate: &Certificate, trusted: bool) -> CertificateDetails {
    let tbs = &certificate.tbs_certificate;
    CertificateDetails {
        subject: tbs.subject.to_string(),
        issuer: tbs.issuer.to_string(),
        serial: tbs
            .serial_number
            .as_bytes()
            .iter()
            .map(|byte| format!("{byte:02X}"))
            .collect(),
        not_before: calendar_date(tbs.validity.not_before.to_unix_duration().as_secs()),
        not_after: calendar_date(tbs.validity.not_after.to_unix_duration().as_secs()),
        fingerprint: certificate_fingerprint(certificate),
        self_signed: tbs.subject == tbs.issuer,
        trusted,
    }
}

/// The digest a certificate signature algorithm uses, or None when unsupported.
fn digest_for(algorithm: ObjectIdentifier) -> Option<ObjectIdentifier> {
    [
        (rfc5912::SHA_256_WITH_RSA_ENCRYPTION, rfc5912::ID_SHA_256),
        (rfc5912::SHA_384_WITH_RSA_ENCRYPTION, rfc5912::ID_SHA_384),
        (rfc5912::SHA_512_WITH_RSA_ENCRYPTION, rfc5912::ID_SHA_512),
        (rfc5912::ECDSA_WITH_SHA_256, rfc5912::ID_SHA_256),
    ]
    .into_iter()
    .find_map(|(signature, digest)| (signature == algorithm).then_some(digest))
}

/// Whether `issuer` signed `certificate`.
fn issued_by(certificate: &Certificate, issuer: &Certificate) -> bool {
    if certificate.tbs_certificate.issuer != issuer.tbs_certificate.subject {
        return false;
    }
    let algorithm = certificate.signature_algorithm.oid;
    let (Some(digest), Ok(message)) = (digest_for(algorithm), certificate.tbs_certificate.to_der())
    else {
        return false;
    };
    let Some(value) = certificate.signature.as_bytes() else {
        return false;
    };
    verify_value(issuer, algorithm, digest, &message, value) == Some(true)
}

fn valid_at(certificate: &Certificate, seconds: u64) -> bool {
    let validity = &certificate.tbs_certificate.validity;
    validity.not_before.to_unix_duration().as_secs() <= seconds
        && seconds <= validity.not_after.to_unix_duration().as_secs()
}

/// Follows the signer's certificate through its issuers, verifying each link, and reports
/// whether the chain reaches a certificate the user trusts and was valid at `signed_at`.
pub fn evaluate_chain(
    leaf: &Certificate,
    embedded: &[&Certificate],
    anchors: &[Certificate],
    signed_at: u64,
) -> ChainReport {
    let trusted: HashSet<String> = anchors.iter().map(certificate_fingerprint).collect();
    let mut chain = vec![leaf];
    let mut broken = false;
    while chain.len() < MAX_CHAIN {
        let current = chain[chain.len() - 1];
        let tbs = &current.tbs_certificate;
        if tbs.subject == tbs.issuer {
            broken |= !issued_by(current, current);
            break;
        }
        let candidates: Vec<&Certificate> = embedded
            .iter()
            .copied()
            .chain(anchors.iter())
            .filter(|candidate| candidate.tbs_certificate.subject == tbs.issuer)
            .filter(|candidate| !chain.iter().any(|link| std::ptr::eq(*link, *candidate)))
            .collect();
        match candidates
            .iter()
            .find(|candidate| issued_by(current, candidate))
        {
            Some(issuer) => chain.push(issuer),
            None => {
                broken |= !candidates.is_empty();
                break;
            }
        }
    }
    let certificates: Vec<CertificateDetails> = chain
        .iter()
        .map(|certificate| {
            details(
                certificate,
                trusted.contains(&certificate_fingerprint(certificate)),
            )
        })
        .collect();
    let anchor = certificates.iter().position(|details| details.trusted);
    let (trust, message) = match anchor {
        _ if broken => (
            TrustStatus::BrokenChain,
            "A certificate in the signer's chain does not verify with its issuer.".to_string(),
        ),
        None => (
            TrustStatus::NotTrusted,
            "No certificate in the signer's chain is one you chose to trust.".to_string(),
        ),
        Some(index) if !chain[..=index].iter().all(|link| valid_at(link, signed_at)) => (
            TrustStatus::NotValidAtSigning,
            "A certificate in the signer's chain was not valid when the document was signed."
                .to_string(),
        ),
        Some(index) => (
            TrustStatus::Trusted,
            format!(
                "The signer's certificate leads to a certificate you trust: {}.",
                certificates[index].subject
            ),
        ),
    };
    ChainReport {
        certificates,
        trust,
        message,
    }
}

/// Seconds since the Unix epoch for a PDF date such as `D:20261024153000+02'00'`.
pub fn parse_pdf_date(text: &str) -> Option<u64> {
    let digits = text.strip_prefix("D:").unwrap_or(text);
    let number = |range: std::ops::Range<usize>, fallback: i64| -> Option<i64> {
        match digits.get(range) {
            Some(part) if part.bytes().all(|byte| byte.is_ascii_digit()) => part.parse().ok(),
            Some(_) => None,
            None => Some(fallback),
        }
    };
    let year = number(0..4, 0).filter(|year| *year > 0)?;
    let month = number(4..6, 1).filter(|month| (1..=12).contains(month))?;
    let day = number(6..8, 1).filter(|day| (1..=31).contains(day))?;
    let hour = number(8..10, 0)?;
    let minute = number(10..12, 0)?;
    let second = number(12..14, 0)?;
    // Days from the civil date, the inverse of the calendar conversion used for display.
    let shifted = if month <= 2 { year - 1 } else { year };
    let era = shifted.div_euclid(400);
    let year_of_era = shifted - era * 400;
    let day_of_year = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days = era * 146_097 + day_of_era - 719_468;
    let mut seconds = days * 86_400 + hour * 3600 + minute * 60 + second;
    // A local time is moved to UTC with its offset.
    let zone = digits.get(14..).unwrap_or("");
    if let Some(sign) = zone
        .chars()
        .next()
        .filter(|sign| *sign == '+' || *sign == '-')
    {
        let offset: Vec<i64> = zone[1..]
            .split('\'')
            .filter_map(|part| part.parse().ok())
            .collect();
        let shift =
            offset.first().copied().unwrap_or(0) * 3600 + offset.get(1).copied().unwrap_or(0) * 60;
        seconds -= if sign == '+' { shift } else { -shift };
    }
    u64::try_from(seconds).ok()
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Pages,
    Comments,
    FormFields,
    Signatures,
    Other,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RevisionChange {
    pub kind: ChangeKind,
    pub description: String,
}

fn change(kind: ChangeKind, description: String) -> RevisionChange {
    RevisionChange { kind, description }
}

fn name_of(dictionary: &Dictionary, key: &[u8]) -> String {
    dictionary
        .get(key)
        .and_then(Object::as_name)
        .map(|name| String::from_utf8_lossy(name).into_owned())
        .unwrap_or_default()
}

/// Each annotation on a page by object number, with its subtype and a print of its entries.
fn annotations(doc: &Document, page: ObjectId) -> BTreeMap<ObjectId, (String, bool, String)> {
    let Ok(page) = doc.get_dictionary(page) else {
        return BTreeMap::new();
    };
    let Ok(list) = page
        .get(b"Annots")
        .map(|value| deref(doc, value))
        .and_then(Object::as_array)
    else {
        return BTreeMap::new();
    };
    list.iter()
        .filter_map(|entry| {
            let id = entry.as_reference().ok()?;
            let dictionary = doc.get_dictionary(id).ok()?;
            let signature = name_of(dictionary, b"FT") == "Sig";
            Some((
                id,
                (
                    name_of(dictionary, b"Subtype"),
                    signature,
                    format!("{dictionary:?}"),
                ),
            ))
        })
        .collect()
}

/// Form field values by fully qualified name, marking signature fields.
fn field_values(doc: &Document) -> BTreeMap<String, (bool, String)> {
    let mut values = BTreeMap::new();
    let Some(fields) = doc
        .catalog()
        .ok()
        .and_then(|catalog| catalog.get(b"AcroForm").ok())
        .and_then(|form| deref(doc, form).as_dict().ok())
        .and_then(|form| form.get(b"Fields").ok())
        .and_then(|fields| deref(doc, fields).as_array().ok())
    else {
        return values;
    };
    let mut stack: Vec<(&Object, String, bool, usize)> = fields
        .iter()
        .map(|field| (field, String::new(), false, 0))
        .collect();
    let mut seen = HashSet::new();
    while let Some((object, parent, parent_signature, depth)) = stack.pop() {
        if depth > 32 || object.as_reference().is_ok_and(|id| !seen.insert(id)) {
            continue;
        }
        let Ok(field) = deref(doc, object).as_dict() else {
            continue;
        };
        let partial = field.get(b"T").and_then(Object::as_str).map(decode_text);
        let name = match (parent.is_empty(), partial) {
            (_, Err(_)) => parent.clone(),
            (true, Ok(partial)) => partial,
            (false, Ok(partial)) => format!("{parent}.{partial}"),
        };
        // The field type is inherited by kids that do not set their own.
        let signature = match field.get(b"FT").and_then(Object::as_name) {
            Ok(kind) => kind == b"Sig",
            Err(_) => parent_signature,
        };
        if let Ok(value) = field.get(b"V") {
            values.insert(
                name.clone(),
                (signature, format!("{:?}", deref(doc, value))),
            );
        }
        if let Ok(kids) = field.get(b"Kids").map(|kids| deref(doc, kids)) {
            if let Ok(kids) = kids.as_array() {
                stack.extend(
                    kids.iter()
                        .map(|kid| (kid, name.clone(), signature, depth + 1)),
                );
            }
        }
    }
    values
}

fn page_changes(signed: &Document, current: &Document, changes: &mut Vec<RevisionChange>) {
    let before: Vec<ObjectId> = signed.get_pages().into_values().collect();
    let after: Vec<ObjectId> = current.get_pages().into_values().collect();
    if after.len() > before.len() {
        changes.push(change(
            ChangeKind::Pages,
            format!("{} page(s) added", after.len() - before.len()),
        ));
    } else if after.len() < before.len() {
        changes.push(change(
            ChangeKind::Pages,
            format!("{} page(s) removed", before.len() - after.len()),
        ));
    }
    for (index, (old, new)) in before.iter().zip(&after).enumerate() {
        let number = index + 1;
        if signed.get_page_content(*old) != current.get_page_content(*new) {
            changes.push(change(
                ChangeKind::Pages,
                format!("Page {number}: content changed"),
            ));
        }
        let (old, new) = (annotations(signed, *old), annotations(current, *new));
        for (id, (subtype, signature, print)) in &new {
            let what = match old.get(id) {
                None => "added",
                // Widget appearances follow their field values, which are compared separately.
                Some((_, _, before)) if before != print && subtype != "Widget" => "changed",
                Some(_) => continue,
            };
            changes.push(annotation_change(number, subtype, *signature, what));
        }
        for (id, (subtype, signature, _)) in &old {
            if !new.contains_key(id) {
                changes.push(annotation_change(number, subtype, *signature, "removed"));
            }
        }
    }
}

fn annotation_change(page: usize, subtype: &str, signature: bool, what: &str) -> RevisionChange {
    if signature {
        return change(
            ChangeKind::Signatures,
            format!("Page {page}: signature field {what}"),
        );
    }
    if subtype == "Widget" {
        return change(
            ChangeKind::FormFields,
            format!("Page {page}: form field {what}"),
        );
    }
    change(
        ChangeKind::Comments,
        format!("Page {page}: {subtype} comment {what}"),
    )
}

/// What changed between a signed revision and the current document, most significant first.
pub fn revision_changes(signed: &Document, current: &Document, other: bool) -> Vec<RevisionChange> {
    let mut changes = Vec::new();
    page_changes(signed, current, &mut changes);
    let (before, after) = (field_values(signed), field_values(current));
    for (name, value) in &after {
        if before.get(name) != Some(value) {
            changes.push(match value.0 {
                true => change(ChangeKind::Signatures, format!("Signature {name} signed")),
                false => change(
                    ChangeKind::FormFields,
                    format!("Field {name} filled in or changed"),
                ),
            });
        }
    }
    for (name, (signature, _)) in before.iter().filter(|(name, _)| !after.contains_key(*name)) {
        let kind = if *signature {
            ChangeKind::Signatures
        } else {
            ChangeKind::FormFields
        };
        changes.push(change(kind, format!("Field {name} cleared or removed")));
    }
    if changes.is_empty() && other {
        changes.push(change(
            ChangeKind::Other,
            "Other changes, such as document information or structure".into(),
        ));
    }
    changes.sort_by_key(|item| item.kind);
    if changes.len() > MAX_CHANGES {
        let more = changes.len() - (MAX_CHANGES - 1);
        changes.truncate(MAX_CHANGES - 1);
        changes.push(change(
            ChangeKind::Other,
            format!("and {more} more changes"),
        ));
    }
    changes
}

/// Whether a certified document's permission level allows these later changes: 1 allows none,
/// 2 allows form filling and signing, and 3 also allows comments.
pub fn changes_permitted(level: i64, changes: &[RevisionChange]) -> bool {
    changes.iter().all(|item| match item.kind {
        ChangeKind::FormFields | ChangeKind::Signatures => level >= 2,
        ChangeKind::Comments => level >= 3,
        ChangeKind::Pages | ChangeKind::Other => false,
    })
}

/// The largest certificate file accepted for the trust list.
pub const MAX_CERTIFICATE_BYTES: usize = 64 * 1024;

/// Reads one certificate from DER bytes or a PEM `CERTIFICATE` block.
pub fn parse_certificate(data: &[u8]) -> Result<Certificate, String> {
    use der::{Decode, DecodePem};
    const UNREADABLE: &str = "The file is not a readable X.509 certificate.";
    if data.len() > MAX_CERTIFICATE_BYTES {
        return Err("The certificate file is too large.".into());
    }
    if let Ok(certificate) = Certificate::from_der(data) {
        return Ok(certificate);
    }
    let text = std::str::from_utf8(data).map_err(|_| UNREADABLE)?;
    let start = text.find("-----BEGIN CERTIFICATE-----").ok_or(UNREADABLE)?;
    let end = text[start..]
        .find("-----END CERTIFICATE-----")
        .map(|offset| start + offset + "-----END CERTIFICATE-----".len())
        .ok_or(UNREADABLE)?;
    Certificate::from_pem(&text[start..end]).map_err(|_| UNREADABLE.into())
}
