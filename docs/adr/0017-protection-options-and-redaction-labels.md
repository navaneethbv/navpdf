# ADR 0017: Protection options, redaction labels and faux-redaction detection

Date: October 21, 2026.
Status: accepted for PDFCraft gap batch 5; native and Acrobat acceptance remain open.

## Context

PDFCraft offers RC4 and AES-128 encryption alongside AES-256, an option to leave metadata unencrypted, redaction fill colours with overlay text and code sets, and an audit for faux redactions.
NavPDF previously wrote only AES-256 with encrypted metadata and painted black redaction boxes.
Its redaction audit rejected any text inside a redacted region, so overlay text could not pass without a rule change.
ADR 0006 places protection and redaction in the native lopdf engine, and its verification rules still apply.

## Decision

Protection offers AES-256 (default and recommended), AES-128, RC4 128-bit and RC4 40-bit through lopdf's security handlers.
The dialog explains that RC4 is weak and only for old readers.
Legacy levels read only the first 32 bytes of a password, so NavPDF rejects longer or non-ASCII passwords there instead of silently truncating them.
Leaving metadata unencrypted is offered only for AES levels, where `/EncryptMetadata false` is defined by the crypt filter.
The saved copy is still reopened with the user password and rejected with a wrong one before it replaces anything.
The password strength meter is a local estimate and never leaves the device.

Redaction regions may carry a label of up to 60 printable ASCII characters drawn in Helvetica inside the region, in a chosen fill colour with contrasting text.
Labelled regions must not overlap other regions and the label must fit.
The label font is added as a dedicated `NavRedactLabel` resource.
The audit allows glyphs inside a labelled region only when they use that font and their text, ignoring whitespace, equals the requested label; anything else in the region still fails.
The label map is persisted with the audit specification, so later saves keep auditing it.
Whole-page marks use the page's displayed bounds.

Faux-redaction detection lists filled paths painted after the glyphs they cover, unapplied Redact annotations and filled Square or Circle annotations, with a bounded number of findings.
Findings are marked for real redaction rather than removed automatically, because transparent or decorative shapes can be listed.

## Alternatives

Keeping AES-256 only was rejected because the user asked for every PDFCraft capability; the default stays AES-256.
Allowing any text inside labelled regions was rejected because it would let original text survive under a label.
Removing detected cover shapes automatically was rejected because it changes documents without review and does not remove the hidden text.

## Consequences

Users can create documents that old readers open, at the cost of much weaker RC4 protection.
Unencrypted metadata exposes title, author and other XMP fields to anyone holding the file.
Redaction labels are visible text and are extractable by design.
Faux-redaction detection is a heuristic aid; it does not inspect images, transparency or clipping and is not proof that a document is clean.
