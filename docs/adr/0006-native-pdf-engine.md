# ADR-0006: Native PDF engine for protection, compression, existing-object edits and redaction

Date: 2026-09-14
Status: Accepted for Phase 7

## Context

The Phase 7 plan listed PDFium and qpdf as candidates for object editing, protection and structural optimization.
On 2026-09-13 the owner chose a pure Rust approach: lopdf plus focused Rust code, with no bundled qpdf or PDFium.
Phase 7 requires AES-256 protection with password-aware validation, measured compression, scoped edits of existing objects, and irreversible redaction verified by independent consumers.

## Decision

NavPDF implements these capabilities in `src-tauri/src/engine/` on top of lopdf 0.45, exposed through typed IPC in `src-tauri/src/commands/engine.rs`.
Document bytes are staged in memory under opaque identifiers, and passwords travel only as JSON arguments that are never logged.

Protection uses security handler revision 6 (AES-256, `/V 5`) with a random 32-byte file key from `getrandom`.
The encryption dictionary declares `/Length 256` and a crypt filter with `/Length 32` and `/AuthEvent /DocOpen`, because poppler otherwise decrypts with a 40-bit default key.
A separate validator requires that the copy is unreadable without a password, opens with both passwords at the expected page count and rejects a wrong password.
Protected copies are written through Save As with `filesystem::atomic_save_with`, keeping the flush, fingerprint and no-clobber rules.
Unlocking requires the owner password when the document restricts any exposed permission, and an unlocked session writes no recovery copy or working-revision file.

Compression first prunes unused objects, merges byte-identical streams by SHA-256 and writes object and cross-reference streams.
Lossy presets downsample only images placed in page content that are stored above 1.25 times the target density (150 or 96 dpi), resample their soft masks and keep the smaller of Flate and JPEG encodings.
Images reached through annotation appearances, tiling patterns or soft masks are never resampled.
A compressed copy is offered only when page count, extracted text, annotations, fonts, image placements, form fields, bookmarks and attachments are unchanged and the saving is at least 1% and 1 KiB.

Existing-object edits use a content interpreter with exact AFM widths generated from `@pdf-lib/standard-fonts`.
Text replacement is limited to simple fonts; embedded subsets accept only character codes already drawn with that font, and a width preview is shown because text is not reflowed.
Deleting text replaces it with an equal `TJ` advance so neighboring text keeps its position.
Replacing an image adds a new image to page-owned resources, so other pages that share the original are unchanged.
Object identifiers include a page-content fingerprint, so edits against a stale scan are rejected.

Redaction is a separate apply step that rewrites a fresh copy.
Glyphs with exact metrics are removed individually; strings with approximate metrics are removed whole when near a region.
Decodable 8-bit grayscale and RGB images (raw, Flate or JPEG) are blackened on page-private copies with soft masks made opaque and a 16-sample JPEG margin; other images and inline images in a region are removed.
Form XObjects are cloned per page, fully enclosed vector paths and overlapping annotations are removed, and form fields left without widgets are removed with their values.
Selected sanitization removes document information and XMP metadata, attachments, JavaScript and launch or submission actions, hidden optional content and invisible text, comments and bookmarks; tagged structure, thumbnails and XFA are always removed.
Prior incremental revisions do not survive because the output is a full rewrite followed by pruning.
Before the output is returned, an audit reloads it and blocks on any glyph, unblackened image sample or annotation inside a region, or any audit term in page text, decoded strings or decompressed streams.
Digitally signed documents require acknowledgement, and their signature values are removed.

## Rejection conditions

Encrypted input must be unlocked first.
Pages whose tiling patterns paint text or objects are rejected for redaction.
Form nesting deeper than 12 levels is rejected.
Text in composite (CID) or Type 3 fonts cannot be replaced.
Images with custom decode arrays, stencil or explicit masks, CMYK JPEG data, indexed color or other bit depths are not processed pixel by pixel.

## Alternatives

PDFium and qpdf would add C++ binaries, packaging and license review, and were declined by the owner decision.
Rasterizing redacted pages would lose text, search and accessibility, so it is not offered.
Painting boxes over content without removing it is not redaction and is rejected.

## Consequences

`node scripts/phase7-acceptance.mjs` passed 55 of 55 checks against poppler utilities, raw, inflated and decoded-string scans, rendered pixels and extracted image samples.
Vector paths that only partly overlap a region remain beneath the black box.
Audit text for composite fonts without a ToUnicode map is unknown, although raw stream scans still apply.
Images that cannot be redacted pixel by pixel are removed rather than partly kept.
PDF permission flags are advisory; poppler extracted text from a copy-restricted file with the open password.
Passwords are not persisted or logged, but memory zeroization is not guaranteed.
The original file on disk is unchanged until Save As, and no physical secure erasure of storage is implied.
New dependencies: `jpeg-encoder` 0.7.1 (MIT or Apache-2.0, with the Independent JPEG Group notice), `zune-jpeg` 0.5.15 (MIT, Apache-2.0 or Zlib) and `getrandom` 0.4 (MIT or Apache-2.0).
