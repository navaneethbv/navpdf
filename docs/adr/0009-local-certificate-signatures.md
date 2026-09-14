# ADR-0009: Local certificate signatures from a PKCS #12 identity

Date: 2026-09-14
Status: Accepted for Phase 10 (P10.5)

## Context

Phase 10 step P10.5 covers certificate signatures, certification and independent validation.
The owner decision of 2026-09-13 limits Phase 10 to local certificate signing from a user-supplied `.p12` file, with independent validation and no network access.
Fill & Sign marks are appearances only and must never be described as certificate signatures or certification.
NavPDF processes PDFs in pure Rust through lopdf (ADR 0006) and bundles no C or C++ PDF engine.

## Decision

NavPDF signs a copy of the open document with a key and certificate chain read from a PKCS #12 file that the user selects in the native file picker.
The stable RustCrypto crate line provides the cryptography: `p12-keystore` 0.1.5 for PKCS #12, `cms` 0.2.3 and `x509-cert` 0.2.5 for CMS and certificates, `rsa` 0.9 for RSA PKCS #1 v1.5 with SHA-256, and `p256` 0.13 for ECDSA P-256.
These crates are MIT or Apache-2.0 licensed; the pre-release `cms` 0.3 and `rsa` 0.10 lines were not used.

The signature follows the PAdES baseline B-B profile: `/SubFilter /ETSI.CAdES.detached`, a SHA-256 message digest, the ESS signing-certificate-v2 attribute, the certificate chain from the file, and the signing time in the signature dictionary's `/M` entry.
The signature dictionary, an invisible signature widget on the first page and the updated form, page and catalog objects are appended as an incremental update.
Earlier revisions and existing signatures therefore stay byte-for-byte intact.
The signed copy is written through the native Save As picker only after NavPDF reloads the candidate, checks the page count and verifies that its newest signature is valid and covers the whole file.
The open document stays unsigned, and saving the signed copy over the open file is refused.

Optional certification adds a DocMDP transform with permission level 1, 2 or 3 and a catalog `/Perms` entry.
Only the first signature may certify, and a level 1 certification blocks further signatures.
The PKCS #12 password is used once to decrypt the file and is never stored or logged.
The decrypted key stays in native memory until the dialog closes, another certificate is chosen or the app exits.
RSA keys shorter than 2048 bits, keys other than RSA and P-256, certificates outside their validity period, certificates whose key usage excludes signing, and private keys that do not match the certificate are refused.

NavPDF also lists the signatures in the opened file with a local integrity check.
The byte range must bracket the stored value, the signed digest must match, and the signature must verify against the embedded signer certificate.

## Alternatives

Poppler's `pdfsig` can sign through NSS, but bundling poppler and NSS would add a C and C++ runtime and a certificate database that the owner has not approved.
Signing through the macOS keychain would tie the feature to one platform and needs a separate key-access design.
Remote signing services and RFC 3161 timestamp authorities need network access and are outside the approved scope.

## Consequences

Independent validation uses poppler `pdfsig` with a synthetic trusted root in a temporary NSS database and OCSP disabled, and `openssl cms -verify` over the extracted byte ranges.
NavPDF does not evaluate certificate trust, revocation or long-term validation, adds no timestamp and draws no visible signature appearance; readers decide trust with their own settings.
Signatures in password-protected PDFs cannot be created or checked yet.
The `rsa` 0.9 crate carries advisory RUSTSEC-2023-0071 about timing side channels in private-key operations.
NavPDF signs locally through the randomized, blinded signing path and exposes no network-reachable signing or decryption operation.
The decrypted PKCS #8 bytes held briefly by `p12-keystore` are not zeroized when freed, while the parsed `rsa` and `p256` keys are.
The local verifier re-encodes signed attributes as DER, so a third-party signature with non-canonical attribute encoding can be reported as not matching even when other validators accept it.
