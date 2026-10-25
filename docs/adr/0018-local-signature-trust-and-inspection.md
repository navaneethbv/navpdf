# ADR 0018: Local signature trust, inspection and visible appearances

Date: October 25, 2026.
Status: accepted for PDFCraft gap batch 8; native, Preview and Acrobat acceptance remain open.

## Context

ADR 0009 added certificate signatures from a PKCS #12 identity and a verifier that checks the signed bytes against the embedded certificate.
It reported no trust decision, listed no changes made after a signature and drew no appearance on the page.
PDFCraft offers trusted certificates, a certificate viewer, a list of changes after signing, a view of the signed version and a visible signature appearance.
NavPDF sends nothing over the network and does not read platform certificate stores; both remain decisions for batch 11.

## Decision

The native verifier follows the signer's certificate through issuers carried in the signature or in a trusted list, verifying each link's signature with the existing RSA and P-256 code, for at most eight certificates.
A signature is trusted when that chain reaches a certificate the user chose to trust and every certificate up to it was valid at the signer-stated signing time, or now when none is stated.
Otherwise it reports not trusted, not valid when signed, or a broken chain when a certificate claims an issuer whose key does not verify it.
Revocation, key usage of issuers, path-length and name constraints, and policies are not checked, and the signing time is the signer's claim rather than a timestamp.

The trusted list is a JSON file of DER certificates in the application data directory, written with the existing private settings writer and limited to 64 entries.
Certificates are added from a DER or PEM file chosen in the native picker, or from a certificate already carried in a signature of the open document, chosen by its SHA-256 fingerprint; file paths never reach the renderer.
The list holds public certificates only.

For a signature that does not cover the whole file, the signed revision is the file up to the end of its byte range.
NavPDF loads that revision and the current file with lopdf and lists page count and page content changes, annotations added, removed or changed, form field values filled or cleared, and signatures added, with at most 20 entries.
Bytes that change nothing NavPDF can describe are reported as other changes.
When the document is certified, the list is compared with its DocMDP level: level 1 allows no changes, level 2 allows form filling and signing, and level 3 also allows comments.
This comparison is an aid, not the full object-by-object analysis that Acrobat performs, so a reader may judge the same changes differently.
The signed revision can be opened as an unsaved document in a new tab when its signature verifies or uses an unsupported algorithm; encrypted documents are refused.

A visible appearance is optional.
It is a framed block in Helvetica naming the signer's common name, the UTC signing time and the reason, in a chosen corner of a chosen page, upright on pages with /Rotate through the form matrix.
Characters outside Latin-1 become question marks, and the appearance has no image or handwritten signature.
The widget keeps the Print and Locked flags and is part of the signed bytes.

## Alternatives

Reading the macOS keychain or Windows certificate store was deferred to batch 11, because it changes what NavPDF trusts without a user action and needs platform acceptance.
Fetching revocation data or timestamps was rejected here because it contacts external services.
Treating any valid signature as trusted was rejected because it hides that the certificate is unknown.
Comparing every object between revisions was rejected for now because many writers rewrite unchanged objects, which would flood the list.

## Consequences

Users can mark their own or their organisation's certificates as trusted and see why a signature is not trusted.
A trusted result means only that the chain reaches a certificate the user chose; a revoked or compromised certificate still shows as trusted.
Changes after signing are listed by category, and a certified document shows whether NavPDF considers them allowed.
Visible appearances help readers find a signature but do not make it more valid.
