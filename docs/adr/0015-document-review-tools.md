# ADR-0015: Document review and preparation tools

Date: 2026-10-06
Status: Accepted for the October 6 document tools delivery

## Context

The owner asked for ten must-have features that NavPDF lacked.
A comparison of the tool panel, the delivery tracker and the October 4 review against common Acrobat Standard tools found these gaps: review stamps, flattening, page labels, pages per sheet and booklets, comment summaries, sensitive-data search for redaction, moving and resizing existing form fields (follow-up item 3 of the October 4 review), an accessibility check, exporting embedded images, and measurement.
Stamps had a backend command but no tool and no appearance, so several readers did not draw them.
NavPDF's own markup annotations are saved without appearance streams, which flattening needs.

## Decision

All ten tools run locally on pdf-lib and PDF.js, with engines under `src/services/pdf/` and dialogs registered in `src/features/tools/document-tools.ts`.
Edits that change the open document go through `useDocumentEdit`, which records undo history and discards a result when another document has been opened.
Tools that create a separate file (imposition, comment summaries, image export) save through the existing native Save dialog and leave the open document unchanged.

- Stamps carry their own appearance, use standard stamp names, and are counter-rotated to read upright on rotated pages.
- Flattening draws each annotation and widget appearance into page content with the ISO 32000 appearance-to-rectangle transform, generating appearances for common markup that has none; links stay, and signed and XFA forms are refused.
- Page labels are written as the catalog number tree and previewed with the same rules readers apply.
- Imposition embeds each page's visible box, honors page rotation and pads booklets to a multiple of four.
- Comment summaries read the saved annotations, thread replies and record review states as status.
- Sensitive-data search uses bounded expressions plus Luhn, IBAN and SSN-range validation, and adds matched text to the redaction audit.
- Field geometry is edited in displayed coordinates; resized widgets are rebuilt on unrotated pages, while rotated widgets keep their appearance and set NeedAppearances because pdf-lib does not rebuild rotated appearances correctly.
- The accessibility check reports what can be verified from the file and fixes the title, title display, language and tab order.
- Image export decodes images with PDF.js and writes PNG with the platform's zlib compressor, exporting each image object once.
- Measurements are Line, PolyLine and Polygon annotations with measurement intents, a `/Measure` scale dictionary, a caption and an appearance.

## Alternatives

Adding tags or alternate text was not attempted: correct structure requires the authoring application's knowledge of the content.
Interactive placement by dragging was deferred for stamps and fields in favor of preset positions and numeric geometry, which are keyboard accessible and exact.
Vector-preserving imposition with annotations was rejected for this delivery because embedded pages carry content only.
Sensitive-data search across text items, such as a number split over two lines, would need text-run reconstruction and is not claimed.

## Consequences

`npm run acceptance:document-tools` checks saved output with pypdf, Poppler, Ghostscript and Pillow.
Passing the accessibility check does not make a document accessible.
Flattening is not redaction, and stamps are not signatures.
Mark positions for sensitive data are estimates without canvas measurement; the post-redaction audit still verifies the matched text.
Native macOS, Preview and Acrobat acceptance of these tools remains open.
