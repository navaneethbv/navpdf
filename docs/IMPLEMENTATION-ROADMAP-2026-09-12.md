# NavPDF implementation review and Acrobat feature roadmap

Date: September 12, 2026.
Scope: review of the current staged, unstaged, and untracked implementation, followed by implementation details for all options visible in the five supplied Acrobat screenshots.
This is a planning document, not a claim that the listed features have been implemented.
The current working tree is the review baseline; the earlier Electron/Python implementation in Git history does not establish capabilities in the new application.

## 1. Review outcome

The migration establishes a Tauri/Rust desktop shell and a React/PDF.js reader with persisted highlights.
It does not yet deliver the full PDF editor MVP in [PRODUCT-SPEC.txt](PRODUCT-SPEC.txt).
Keep the current architecture and finish file-lifecycle acceptance before extending it with page and content mutation.
Implement functional equivalents of the supplied tools using NavPDF's own visual design and icons.
The existing specification explicitly prefers a document-focused interface and prohibits an exact Adobe visual clone.

The screenshot inventory is authoritative for the requested menu coverage.
A visible Acrobat item does not establish that it works offline, is included in Reader, or is enabled for the document shown.
Several screenshot controls are disabled, and no subscription or entitlement assumptions are made here.
An attempt to inspect the open desktop applications timed out, so no live Acrobat interaction or fresh native NavPDF acceptance is claimed for this review.

### Current implementation evidence

| Area | Status and source |
| --- | --- |
| Desktop foundation | Implemented in `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, and `src-tauri/capabilities/default.json`. |
| Reader | Implemented in `src/features/viewer/controller.ts` and `ViewerHost.tsx`: PDF.js viewer, text layer, layouts, zoom, navigation, hand interaction. |
| Search and thumbnails | Implemented in `src/features/search/`, `src/features/viewer/Thumbnails.tsx`, and the viewer controller. |
| Highlights | Implemented through PDF.js annotation editor and `saveDocument()`; colors, delete, undo, and redo are exposed. |
| Existing comments and bookmarks | Partial: outline navigation and saved Text/Highlight inspection; no complete comment authoring or review workflow. |
| File operations | Native picker, snapshots, range IPC, validated atomic save, Save As, external-change detection, and recovery exist. |
| Forms | Existing form content is included in fixtures, but the viewer uses `AnnotationMode.ENABLE`; interactive form filling is not delivered. |
| Encryption | Password-open path exists; editing and saving encrypted files are explicitly blocked. |
| Editing engines | No production page/content/OCR engine is integrated; `pdf-lib` is a development dependency for fixtures. |
| Privacy | Native handles hide paths from the renderer; production networking and external navigation are restricted. |
| Distribution | Packaging configuration exists; a fresh installer build and signed/notarized distribution acceptance are separate gates. |

### Review findings and pending corrections

These are source-confirmed control-flow or documentation findings unless otherwise labeled.
They have not been reproduced through the native UI during this review.
Start each fix with the user-facing reproduction described below, then add a focused regression.

| ID | Priority | Finding, impact, and evidence | Required implementation and acceptance |
| --- | --- | --- | --- |
| R1 | High | `discardAndContinue` in `src/app/useDocumentSession.ts` deletes recovery and clears dirty state before executing the deferred Open/Recent action. If the picker is cancelled or loading fails, the edited document remains visible but no longer has a reliable unsaved-change guard. | Highlight A, choose Open, choose Discard, cancel picker; repeat with damaged B. Keep A dirty and recoverable until replacement commits, or explicitly revert A if discard is committed. The resulting visible document and dirty state must agree, including on quit. |
| R2 | High | `load` detaches and destroys the previous task and releases its native handle before `controller.attach(loaded)` and `firstPagePromise` finish. A failure in outline/viewer initialization can leave the old document unavailable despite the generic promise that it is unchanged. | Reproduce a late attach/first-page failure while A is open. Stage and validate B before committing ownership; retain a rollback path to A until B is usable. Test parser failure separately from attach failure, cancellation, and release failure. |
| R3 | Medium | Save As updates `Opened.source` but does not insert/update a recent entry for its new destination. `remember_page` subsequently looks up that new path, which may have no recent entry. The frontend updates only the document name, leaving displayed file size stale. | Save A as B, navigate, return Home, reopen B from recents, and verify destination, remembered page, and actual saved size. Return a typed save result with current display metadata and update recents only when enabled. Keep immutable range-snapshot length separate from saved output size. |
| R4 | Medium | `docs/HANDOFF.md` says the native save/Preview workflow and DMG verification passed at its top, but later says those same checks are pending or failed. `docs/VERIFICATION.md` still reports 19 JavaScript tests. | Replace conflicting checkpoint claims with one evidence ledger containing source revision, build identity, fixture, action, result, and artifact path. Existing claims cannot establish latest-build acceptance. |
| R5 | Medium | Outline mapping in `controller.ts` filters out nodes without a destination before retaining their children. Group headings without destinations can hide valid child bookmarks. | Open a fixture with a destination-less parent and navigable children. Retain expandable parent groups and verify keyboard navigation and child destinations. |
| R6 | Verification gap | Current tests cover parsing and selected session paths, not the full native edit/save/recovery lifecycle. Atomic save tests do not establish all destination races, disk-full behavior, or permission preservation. | Add native workflow evidence and filesystem fault injection for replacement, cancellation, recovery, external edits, and destination collisions. Document residual concurrent-writer limitations honestly. |

No application fixes are included in this documentation task.
Do not discard the user's staged deletions or untracked migration files when implementing the follow-up work.

## 2. Delivery gates and order

Use the original eight phases as the core delivery sequence, with the screenshot additions explicitly attached below.
The latest specification commentary puts difficult existing-text replacement after OCR; follow that refinement while delivering text/image insertion earlier.

| Milestone | Deliverable | Depends on | Exit gate |
| --- | --- | --- | --- |
| M0 | Reader reliability and reconciled verification | Current code | R1-R6 resolved or explicitly dispositioned; latest native 500-page highlight/save/reopen journey and failure paths pass. |
| M1 | Tool navigation, page operations, create PDF, print | M0 | Reorder/delete/rotate/crop/extract/insert/merge/split survive external reopen; print includes edits. |
| M2 | Complete local annotations | M1 | Notes, markup, ink, shapes, text boxes, snapshot, and comment list round-trip with undo/redo. |
| M3 | Add text/images and document decoration | M1-M2 | Text/image placement, headers/footers, watermarks, backgrounds, links, attachments, and Bates output survive reopening. |
| M4 | Forms and local Fill & Sign | M2-M3 | Existing fields fill correctly, new fields persist, and signature/initial appearances remain visible externally. |
| M5 | Scan/OCR and basic exports | M1-M3 | Searchable scans preserve appearance; text/image exports have honest format and fidelity labels. |
| M6 | Existing content editing, protection, compression, redaction | M3-M5 plus engine trials | Object edits persist; secure-redaction audit passes; protected outputs reopen with expected passwords. |
| M7 | Office conversion and local design/AI tools | M3-M6 plus conversion/model trials | Each advertised format or generated output passes its own correctness and privacy tests. |
| M8 | Optional collaboration, remote signing, certificate signing, specialist PDF content | Separate product decisions | Defined service/security model, integration tests, and actual interoperability evidence. |
| Every milestone | Accessibility, performance, packaging, recovery | Its changed surfaces | No new dead controls, UI defects, lint errors, test failures, or silent data loss. |

MVP remains the specification's open/read/search/highlight/add text/signature/page operations/merge/split/image/save/external-reopen journey.
Full screenshot parity is broader than MVP and includes service-backed and specialist functionality.
Do not describe M1-M6 completion as full Acrobat parity.

## 3. Application shell and tool behavior

Add `src/features/tools/ToolPanel.tsx` and a small typed tool list consumed by `src/app/Toolbar.tsx`.
Provide All tools, Edit, Convert, and E-Sign modes plus a Create entry point.
Keep document title, dirty state, Save, undo/redo, and navigation available across modes.
Keep navigation thumbnails and tool settings independently collapsible so tool selection does not erase page context.
Use Lucide icons, compact spacing, and existing light/dark/system theme tokens.
Do not copy Acrobat branding, promotional cards, icons, or its exact sidebar dimensions.

All tools provides a searchable list grouped into Edit, Pages, Review, Convert, Forms & Sign, Protect, and optional intelligent tools.
A mode change preserves page, zoom, selection where compatible, and document edits.
Edit displays Modify page, Add content, Design, and Other options groups corresponding to the screenshots.
Convert displays format selection, format-specific settings, page range, destination, and one explicit export action.
E-Sign separates Fill and sign yourself from signature requests and cryptographic certification.
The quick tool rail provides select/hand, comment, markup/drawing, signature, snapshot, and overflow once those tools work.
Allow hiding the rail rather than requiring duplicate controls everywhere.

Tool availability is derived from an implemented capability plus document conditions such as encryption, permissions, selection, and active job.
Unavailable entries may appear in the roadmap, but must not behave like working tools in the released interface.
Explain a disabled document-specific action in accessible text.
Avoid generic disabled placeholders for all future features.
At narrow widths, collapse optional panels into drawers and retain a usable document viewport.
Test keyboard focus, focus return, tooltips, selected states, escape/cancel, contrast, and reduced motion at supported window sizes.

## 4. Complete screenshot capability map

Status: Existing means source implementation exists, Partial means only a subset exists, Pending means no delivered end-user workflow, Decision means implementation needs a product or engine decision first.

### All tools

| Screenshot option | Status | NavPDF implementation target |
| --- | --- | --- |
| Generate presentation | Pending | M7: outline from selected document content, review/edit slide structure, export actual PPTX with editable text and cited source pages. |
| AI Assistant | Decision | M7: optional local inference, document indexing, page citations, and no unsupported cloud upload assumptions. |
| Generative summary | Pending | M7: local summary with source references, length controls, cancellation, and export. |
| Create a PDF Space / Try PDF Spaces | Decision | M7 local workspace collection; M8 shared spaces only after a separate network/storage decision. |
| Generate podcast | Pending | M7: reviewable cited script, local speech synthesis, voice/language settings, and playable audio export. |
| Export a PDF | Pending | M5 basic text/images, M7 Office formats and conversion fidelity validation. |
| Stylize this PDF | Pending | M7: local template/design workflow producing a new PDF copy. |
| Fill & Sign | Pending | M4: form values and text/check/cross/dot/box/line overlays plus signature/initial appearances. |
| Edit a PDF | Partial | Existing highlights are annotation editing; M3 adds content and M6 handles existing objects/text. |
| Request e-signatures | Decision | M8: recipient workflow, delivery, signer access, status, and evidence; cannot be fulfilled by a local signature stamp. |
| Translate this PDF | Pending | M7: page-aware translation, language controls, original/translation comparison, font shaping, and overflow handling. |
| Create a PDF | Pending | M1 blank/image input; M7 document-format import with a conversion adapter. |
| Combine files | Pending | M1 PDF/image composition with ordering and per-input page ranges; M7 Office inputs. |
| Organize pages | Pending | M1 grid with multi-select, reorder, rotate, delete, extract, insert, split, and crop. |
| Send for comments | Decision | M2 local annotated-copy exchange; M8 hosted review links, recipients, replies, and permissions. |
| Scan & OCR | Pending | M5 scanner/image acquisition and searchable text-layer generation. |
| Protect a PDF | Partial | Can read password-protected input; M6 adds encryption and permission settings. |
| Redact a PDF | Pending | M6 mark, inspect, apply, sanitize, and independently verify permanent content removal. |

### Edit mode, including disabled screenshot entries

| Screenshot option | Status | Implementation detail |
| --- | --- | --- |
| Rotate / crop / delete / extract page icons | Pending | M1 labeled actions operating on selected pages with range preview and undo. |
| Organize pages | Pending | Reuse the M1 page workspace, not a second implementation. |
| Text | Pending | M3 inserted text with font, size, color, alignment, wrapping, and embedding; M6 existing-text replacement. |
| Image | Pending | M3 import, aspect-preserving resize, move, rotate, replace, delete, and layer ordering. |
| Header and footer | Pending | M3 left/center/right slots, page number/date/title tokens, margins, font, and page range. |
| Watermark | Pending | M3 text/image, opacity, rotation, scale, position, range, and foreground/background choice. |
| Link | Partial | Internal navigation exists; M3 creates/edits link annotations and destinations with safe URL handling. |
| Bates numbering | Pending | M3 ordered batch, prefix/suffix, start value, zero padding, page range, and collision preview. |
| Button | Pending | M4 AcroForm push-button widget with explicitly supported safe actions; do not execute arbitrary PDF JavaScript. |
| Video / Sound | Decision | M8 explicit embedded-media authoring/playback trial, codec/container limits, and external-reader compatibility matrix. |
| 3D media | Decision | M8 separate 3D annotation/rendering engine investigation; no implied PDF.js support. |
| Attach file | Pending | M3 embedded file stream and file specification, listing, save-out dialog, duplicate names, and size limits. |
| Background | Pending | M3 solid color/image layer with page range, scaling, opacity, and update/remove of app-owned layers. |
| Article box | Decision | M8 article-thread beads and reading order editor; verify navigation with a reader supporting article threads. |
| Stylize this PDF | Pending | M7 local editable design copy with fidelity warning for reconstructed content. |
| Use design tools | Pending | M7 templates, typography, color, alignment, and page composition tools shared with M3. |
| Generate cover page | Pending | M7 template-first cover creation with optional local generation and explicit insert/replace action. |
| Combine files / Redact a PDF | Pending | Route to M1/M6 implementations. |
| Prepare a form | Pending | M4 manual field authoring first, optional field detection after measured evaluation. |

### Convert mode

| Screenshot option | Status | Implementation detail |
| --- | --- | --- |
| Adobe Express export | Decision | M8 explicit external integration only if supported and authorized; local design tools are an alternative workflow, not an Adobe Express integration. |
| Microsoft Word / DOCX | Pending | M7 layout reconstruction with editable text, headings, images, tables, and reading order; label fidelity limitations. |
| Microsoft PowerPoint / PPTX | Pending | M7 separate editable conversion and image-per-slide modes; do not call image slides editable conversion. |
| Microsoft Excel / XLSX | Pending | M7 table extraction preview, cell/row correction, sheet selection, and explicit numeric/text typing. |
| Image format / JPEG and submenu | Pending | M5 PNG/JPEG initially; DPI, quality, page ranges, transparency where supported, and multi-page naming. Evaluate TIFF separately. |
| Other format / RTF and submenu | Pending | M5 UTF-8 text; M7 RTF and explicitly scoped additional formats. The screenshot does not reveal every submenu value. |
| Convert to PDF | Pending | M1 images/blank; M7 Office/RTF via local conversion adapter. |
| Compress a PDF | Pending | M6 quality presets, preview, actual byte savings, and safe original retention. |
| Scan & OCR / Translate this PDF | Pending | Route to M5/M7 workflows. |

### E-Sign and quick tools

| Screenshot option | Status | Implementation detail |
| --- | --- | --- |
| Request e-signatures / More e-sign options | Decision | M8 envelope creation, recipient roles/order, fields, review-before-send, expiry, cancellation, and status. |
| Text / cross / check / dot / box / line | Pending | M4 reusable placement controls, resize/move/delete, consistent PDF coordinates, and saved appearances. |
| Saved signature / remove signature | Pending | M4 draw/type/import, reusable local assets, delete from library independently of placed marks. |
| Add initials | Pending | M4 separate initial assets and placement with the same protection model. |
| Save a certified copy | Decision | M8 actual certificate-based PDF signing/certification and validation; a flattened copy is not certification. |
| E-Sign settings | Pending | M4 local signature storage preferences; M8 provider/certificate configuration only when integrated. |
| Select pointer | Existing | Retain selection and hand mode with appropriate cursor and keyboard behavior. |
| Comment / pencil / signature | Partial | Highlights exist; M2 comments/ink and M4 signatures complete the tool families. |
| Snapshot / overflow | Pending | M2 selected-region image capture with clipboard/export choices and accessible additional actions. |

## 5. Shared mutation and job contract

Extend `src/app/useDocumentSession.ts` and `src/services/native.ts` around a single active document revision before adding engines.
Keep PDF.js for viewing and tested annotation serialization.
Use Rust to own working revisions, selected destinations, validation, and native engine jobs.
Never combine stale PDF.js annotation bytes with a newly reordered native document.

A mutation request contains document handle, base revision, typed operation, page IDs/ranges, and validated options.
A successful result contains new revision, page mapping, capabilities, display metadata, and validation warnings.
Reject stale revisions rather than applying coordinates to different pages.
Use PDF points with explicit page rotation and crop-box transforms, never CSS pixels as persisted geometry.
Keep frontend stores serializable; native handles and PDF proxies remain session-owned.

Before native mutation, commit pending editor input and serialize current annotations into a staged revision.
Run one mutation at a time for that document outside the UI thread.
Validate the result, attach the new PDF.js revision, and only then commit the session transition.
Retain the previous working revision for undo and attach failure rollback.
Use a bounded snapshot history first; avoid a plugin framework or elaborate inverse-command system before it is needed.
Track saved revision separately from undo depth so undoing to the saved revision can correctly clear dirty state.

Long jobs expose job ID, operation, progress, cancellation, and structured safe errors.
Cancel at safe boundaries and delete only job-owned temporary files.
Close/quit and document replacement must account for editing, serialization, native jobs, and recovery writes.
Recovery records need a document identity/revision and atomic metadata consistency, rather than a global snapshot accidentally cleared by unrelated operations.
Persist no passwords, form values, document text, or signature assets in diagnostic logs.

Proposed additions are `src/services/document-commands.ts`, `src/types/operations.ts`, and `src-tauri/src/pdf/` modules added only when their milestone needs them.
Extend the native save result instead of overloading the immutable read descriptor.
For page-changing operations, validate the expected output page count computed from the operation; the existing same-count save path alone is insufficient.

## 6. Implementation packages

### P1: Native foundation and page workspace

Own files: `src/app/useDocumentSession.ts`, `src/features/pages/`, `src/services/native.ts`, `src-tauri/src/commands/`, and `src-tauri/src/pdf/pages/`.
Implement R1-R3 before adding mutation jobs.
Add thumbnail grid, shift/range selection, keyboard reorder, drag reorder, rotate, delete, and extraction.
Prevent deletion of the final page unless a deliberate empty-document creation flow exists.
Merge and split use native-selected inputs/destinations with collision handling and explicit output lists.
Preserve or remap outlines, internal links, labels, annotations, and form references; warn or reject unsupported structures instead of silently dropping them.
Crop changes page boxes and must be labeled as cropping, not removal of hidden information.
Print from the current edited revision with page range, orientation, scale, and annotation options through a native document-print path.
Acceptance includes mixed rotation/page dimensions, duplicate form names, multi-input failure, undo/redo, and external reopen.

### P2: Annotations and local review

Own files: `src/features/annotations/`, `src/features/viewer/controller.ts`, and a native annotation adapter only for unsupported operations.
Add underline, strike-through, sticky notes, free text, ink, line/arrow, rectangle, and ellipse using standard PDF objects.
Provide author, contents, color, opacity, stroke width, selection, keyboard deletion, and property editing where applicable.
Keep the comments list synchronized with unsaved edits rather than requiring a save/reopen cycle.
Add replies and resolution only with a documented interoperable representation.
Snapshot exports a selected rendered region without modifying the source PDF.
Local review exchange exports an annotated copy and imports comments with document identity checks and duplicate detection.
Acceptance reopens every annotation type in NavPDF, Preview, and Acrobat and checks text, geometry, appearance, and persistence.

### P3: Content placement and decoration

Own files: `src/features/editor/`, `src/features/decorations/`, `src/features/attachments/`, and `src-tauri/src/pdf/edit/`.
Start with new text/image placement and shared selection handles.
Font selection must verify embedding permissions and glyph coverage; expose substitution before applying it.
Support rotation, multiline text, Unicode, right-to-left shaping, and image aspect ratio with scoped acceptance fixtures.
Decorations share page range and preview logic, but keep text watermarks, backgrounds, and headers distinct in the document model.
Mark app-created decoration groups so update/remove cannot delete unrelated existing page content.
Bates numbering previews the entire ordered batch and reports assigned identifiers with its output manifest.
Links allow internal destinations and selected safe URL schemes; creating a link must not enable automatic network access or arbitrary file launching.
Attachments stay inert until explicitly saved to a chosen destination.
Acceptance includes embedded fonts, rotated/cropped pages, non-ASCII filenames, overlapping objects, and saved output independent of React overlays.

### P4: Forms and local signatures

Own files: `src/features/forms/`, `src/features/signatures/`, `src-tauri/src/pdf/forms/`, and a native secure asset store.
Enable supported interactive widgets, serialize values, and generate appearances visible outside NavPDF.
Cover text, checkbox, radio groups, dropdown/list choices, required/read-only states, multiline fields, and tab order.
Treat dates as a defined field format, not an assumption that every PDF has a dedicated date field type.
Manual form creation supports field names, defaults, labels, widget rectangles, choice values, and duplicate-name rules.
Reject or clearly mark unsupported XFA and JavaScript-dependent calculations.
Signature appearance assets support draw/type/import, transparent background, crop, position, resize, and rotation.
Use OS-protected key storage for reusable signature asset encryption; retain a session-only option and never upload assets.
Deleting a library signature must not silently remove marks already placed in a PDF.
A signature appearance or flatten action must never be labeled cryptographic certification.
Acceptance verifies radio exclusivity, exports after reopen, field appearance consistency, encrypted-input behavior, and existing signed-document warnings.

### P5: Scan/OCR and basic export

Own files: `src/features/ocr/`, `src/features/convert/`, `src-tauri/src/ocr/`, and a bounded image/export worker.
Image import is the first acquisition path; scanner hardware access is a separate native integration with permission and device-error handling.
Offer current/selected/all pages, installed languages, orientation, deskew, and optional image enhancement.
Normalize OCR results into text, confidence, bounding boxes, baseline, language, and page transform.
Insert an invisible searchable layer aligned to the preserved scan; do not duplicate existing searchable text without explicit replacement.
English ships first, with explicit language-pack installation and offline availability state.
Compare candidate engines on the same skewed, low-resolution, mixed-layout, and rotated scans before choosing the default.
Text export preserves a documented reading-order policy; image export bounds resolution/memory and sanitizes output names.
Acceptance measures recognition quality against fixture text, search/copy alignment, cancellation, visual preservation, and multi-page output completeness.

### P6: Existing editing, protection, compression, and redaction

Own files: `src/features/editor/`, `src/features/protect/`, `src/features/compress/`, `src/features/redact/`, and corresponding native modules.
Existing-text editing begins with supported runs and object identity, not unrestricted paragraph reflow.
Resolve font/encoding, transformation matrices, clipping, shared resources, and content streams before replacement.
Offer a clearly described replacement-font fallback and reject unsupported cases without painting over recoverable text.
Existing image replacement must handle shared image resources without unintentionally changing other pages.

Protection uses a tested engine to set/remove known-password encryption and supported permission flags.
Treat permissions as viewer-enforced restrictions, not a guarantee against extraction by an authorized decrypting reader.
Do not put secrets in command-line arguments, logs, recovery, or preferences.
The current validator rejects encrypted output, so introduce a dedicated encryption-aware validation path with password reopen tests rather than weakening validation globally.

Compression first tries safe structural cleanup, then optional image downsampling/re-encoding with explicit quality settings.
Show measured original/output size and avoid replacing the original when no useful reduction occurs.
Validate visual fidelity, text extraction, forms, links, and fonts after each preset.

Redaction separates reversible marks from an explicit permanent apply operation.
Remove intersecting content with a vetted engine, sanitize metadata/attachments/hidden content according to an explicit policy, and write a fresh output with no recoverable prior incremental revisions.
Define handling for OCR layers, shared XObjects, clipping, soft masks, comments, and optional-content layers.
Offer a separately labeled rasterized sanitized-copy fallback only with an explicit fidelity/search/accessibility tradeoff.
Clear sensitive undo/recovery remnants associated with the sanitized output and explain that the original source still exists.
Acceptance uses independent text extraction, object inspection, image extraction, and render inspection with secret canary values in every hidden-data category.
Do not ship redaction based solely on a black rectangle or a successful parser check.

### P7: Office conversion, design, and intelligent document tools

Own files: `src/features/convert/`, `src/features/design/`, `src/features/assistant/`, `src/features/spaces/`, and isolated native job adapters.
Office export requires a dedicated conversion trial; none of the currently integrated libraries establishes high-fidelity DOCX/PPTX/XLSX conversion.
Compare candidate local engines against a scored corpus of paragraphs, columns, tables, equations, charts, images, and multilingual text.
Keep editable reconstruction and rasterized output as separate user-visible modes.
For spreadsheet exports, prevent extracted text from becoming executable formulas and validate numeric/date interpretation in a preview.
Office import runs in an isolated process with macros and external resource loading disabled, bounded resources, and no automatic network access.

Local design uses templates and explicit selection of reconstructed content, with original PDF preserved.
Cover-page generation creates a preview and then inserts a real page through the page pipeline.
Translation requires text extraction/OCR, block mapping, translation, shaping, overflow review, and a saved translated copy with access to original page references.
The assistant and summary use page-referenced chunks, retrieval, cancellation, and clear insufficient-evidence responses.
Treat document text as untrusted input, never as permission to execute tools, upload data, or alter files.
Presentation generation builds a reviewable outline before generating editable slides.
Podcast generation builds an editable script before synthesis and exports actual audio.
Model/runtime selection remains a measured decision based on quality, license, memory, supported hardware, and offline distribution.
No provider, account, model download, or remote processing is silently authorized by this roadmap.

A local Space stores document references, notes, and optional indexes in private storage with missing-file handling and deletion controls.
It does not imply shared cloud access.
Acceptance checks citation destinations, deleted-document index removal, model absence, cancellation, generated artifact validity, and absence of unexpected network traffic.

### P8: Optional services and specialist compatibility

Remote signature requests and hosted comments require a separately approved service architecture because the current product has no accounts, backend, or uploads.
Plan a native service boundary with explicit per-action consent, document/recipient preview, scoped credentials, retention/deletion controls, and retry-safe request identifiers.
A signature envelope needs recipient roles/order, field assignments, delivery status, authenticated signing access, expiry, cancellation, and tamper-evident evidence.
Hosted review needs document versions, comment synchronization, permissions, revocation, and conflict handling.
No message or document should be sent simply because a tool is selected.

Certification requires a signing implementation that handles PDF byte ranges, allowed subsequent changes, certificate validation, trust status, and optional timestamping.
An audit log alone does not make a PDF certified, and later edits can invalidate signatures.
Verify outputs with an independent signature validator before exposing certification wording.

Video, sound, 3D media, and article threads need separate implementation and interoperability trials.
Define authoring, rendering, and preservation support independently so preserving an unknown object is not advertised as playback support.
Do not enable embedded scripts or automatic attachment/media execution to obtain feature parity.
Adobe Express integration requires an actual supported integration route and explicit external processing approval; do not imitate it with a misleading export button.

## 7. Engine decisions and evidence

These are bounded candidates, not newly adopted dependencies.
Pin versions and record redistribution notices and platform artifacts when a candidate is accepted.

| Responsibility | Decision direction | Required proof |
| --- | --- | --- |
| Viewing and current highlights | Retain PDF.js | Preserve current round-trip and WebKit compatibility tests through upgrades. |
| Structural validation | Retain lopdf for current unencrypted path | Extend validation per operation, including encrypted outputs and semantic preservation. |
| Page composition / encryption / structural optimization | Evaluate qpdf behind Rust | Page tree, forms/outlines preservation, protected output, cancellation, and native packaging. |
| Content object manipulation | Evaluate PDFium behind Rust | Exact supported object operations, font handling, thread/ownership rules, and output persistence. |
| Limited creation | Evaluate isolated pdf-lib use if needed | Do not promote fixture dependency into a universal editing engine. |
| OCR | Compare Apple Vision and Tesseract | Same-corpus quality and coordinate tests, offline language assets, and distribution checks. |
| Secure redaction | No engine selected | Independent removal audit and licensing decision before implementation is exposed. |
| Office conversion and local generation | No engine/model selected | Representative fidelity/quality benchmark and privacy/distribution decision. |

The qpdf manual documents page selection, transformations, encryption, and optimization options; it also cautions that structural checking cannot detect every PDF problem. [qpdf CLI documentation](https://qpdf.readthedocs.io/en/stable/cli.html).
The pdf-lib project documents creation and forms while stating limitations around general existing-page text editing and encrypted documents. [pdf-lib project](https://github.com/Hopding/pdf-lib).
PDFium exposes page-object editing APIs, which motivates a trial but does not prove arbitrary paragraph reconstruction or secure redaction. [PDFium public editing API](https://pdfium.googlesource.com/pdfium/+/refs/heads/main/public/fpdf_edit.h).
Tesseract provides OCR and searchable PDF output capabilities; integrating that output with existing documents remains NavPDF work. [Tesseract documentation](https://tesseract-ocr.github.io/tessdoc/).
These upstream sources were consulted during this review; the package roadmap and architecture choices above are engineering proposals based on the repository requirements.

## 8. Acceptance and evidence ledger

Every delivered tool must complete open, edit, save a copy, close, reopen in NavPDF, and reopen in an independent application.
Include annotations, forms, links, rotation, fonts, mixed sizes, encrypted input, damaged input, and large documents appropriate to the operation.
Test errors through the user workflow before changing code for a reported bug.
Native WebKit checks remain essential because browser parsing tests did not catch the earlier stream-iteration problem.
Record source revision or working-tree snapshot, build identity, fixture, expected result, observed result, screenshots/output path, and remaining limitations.
Do not infer native acceptance from passing unit tests or old screenshots.

### Checks run for this review

| Check | Current review result |
| --- | --- |
| `npm run lint` | Passed. |
| `npm run build` | Passed, including `tsc -b` and Vite production build. |
| `npm test` | Passed: 22 tests across 6 files, including fixture generation. |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Passed: 7 native tests. |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Passed. |
| `git diff --check` | Passed for the tracked working-tree changes. |

Vite reports a chunk-size advisory for the approximately 750 kB minified application chunk.
This is a performance follow-up, not a failed build or measured startup regression.
The reviewed Git base is `ad0a999`, with the migration still present as local staged, unstaged, and untracked changes.
Tests regenerated their designated fixtures and build outputs; application source was not edited for this review.
No installer build, notarization check, performance benchmark, or new native end-to-end run is included in this review.

### Immediate implementation checklist

- [ ] Reproduce and fix R1 and R2 with session regression coverage and native confirmation.
- [ ] Fix Save As metadata/recents behavior and bookmark grouping.
- [ ] Reconcile HANDOFF and VERIFICATION against actual evidence.
- [ ] Validate latest native save, quit, discard, recovery, cancellation, and Preview/Acrobat reopen paths.
- [ ] Rebuild and identify the tested app/installer; verify packaging separately from signing/notarization.
- [ ] Approve the page-engine trial through an ADR and start M1.
- [ ] Deliver each tool only after its persisted-output acceptance passes.
- [ ] Resolve optional network/service, conversion-engine, model-distribution, and specialist-media decisions before dependent implementation.
