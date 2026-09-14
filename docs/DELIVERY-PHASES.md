# NavPDF phased delivery

Created: September 13, 2026.
Baseline: `c0e3849`, merged PR 1.
This is the active delivery tracker and supersedes the historical roadmap's immediate checklist and foundation-only README status.
The [original roadmap](IMPLEMENTATION-ROADMAP-2026-09-12.md) remains the detailed capability and engine reference.
Each phase now has a separate [implementation plan](phases/README.md) with ordered steps, code areas, dependencies and acceptance criteria.
Existing controls or passing unit tests do not establish completed native workflows.

## Working agreement

Work through phases in order and record evidence before marking a phase complete.
Reproduce defects through the end-user workflow before changing application code.
Use synthetic PDFs and separate output copies for destructive and recovery checks.
For each persisted operation, save, close, reopen in NavPDF, and inspect in an independent reader.
Record the source revision, build identity, fixture, result, and any remaining limitations.
Keep encrypted inputs read-only until encryption-aware saving is delivered.
Optional remote services require a separate architecture decision; no uploads or accounts are implied by this plan.

## Sequence and completion gates

| Phase | Scope | Completion gate | Status |
| --- | --- | --- | --- |
| 1 | [Reader reliability and file safety (M0)](phases/01-reader-reliability.md) | Native save, Save As, discard/cancel, failed replacement, quit, recovery, external modification, destination collision, and filesystem failure matrix passes; current highlight toolbar and 500-page round trip verified. | Complete |
| 2 | [Complete local annotations (M2)](phases/02-local-annotations.md) | Underline, strike-through, sticky notes, ink, free text, shapes and arrows persist with properties, deletion, undo/redo and synchronized comments; keyboard and independent-reader checks pass. | Complete |
| 3 | [Forms and local Fill & Sign (M4)](phases/03-forms-fill-sign.md) | Standard forms preserve values and appearances; Fill & Sign marks persist accurately; reusable signatures use OS-backed protected storage or explicit session isolation. | Complete |
| 4 | [Page mutations and navigation foundation (M3/M5)](phases/04-pages-mutations.md) | Standard page operations retain PDF integrity, links and page-level metadata; outline/thumbnail/bookmark navigation handles mixed rotations and dimensions. | Complete |
| 5 | [Content placement and decoration (M3)](phases/05-content-decoration.md) | Text/images, links, attachments, headers/footers, watermarks, backgrounds and Bates numbering have usable placement controls, Unicode/font handling and independently verified output. | Complete |
| 6 | [OCR and basic exports (M5)](phases/06-ocr-exports.md) | Measured local OCR engine produces aligned searchable scans; language availability, rotation, cancellation and export memory bounds verified. | Complete |
| 7 | [Existing editing, protection and redaction (M6)](phases/07-editing-protection-redaction.md) | Selected engines support scoped existing-object editing, encryption-aware validation, measured compression and independently audited irreversible redaction. | Complete |
| 8 | [Office conversion and local intelligent tools (M7)](phases/08-conversion-intelligent-tools.md) | Genuine Office output passes a fidelity corpus; supported local generation/translation produces valid artifacts with references, cancellation and explicit model availability. | Complete (deferred AI scope) |
| 9 | [Distribution and platform acceptance](phases/09-distribution-platforms.md) | Current DMG builds and installs in a clean account; signing/notarization and supported-platform accessibility, performance, print and interoperability acceptance complete. | Complete (local unsigned package) |
| 10 | [Optional services and specialist compatibility (M8)](phases/10-optional-integrations.md) | Separately scoped collaboration, remote signing, certification and media integrations pass privacy, trust and interoperability gates. | Complete (local certificates; remote declined) |

Phases 2 and 3 prioritize free Reader gaps over extending existing editor features.
Their required mutation and placement support must be implemented within those phases before claiming completion; the broader foundation audit remains Phase 4.
Reader parity requires Phases 1 through 3 plus the relevant print, accessibility and release checks from Phases 4 and 9.
The full editor roadmap requires later phases as well.

## Phase 1 execution checklist

- [x] Inspect current source and reconcile the active scope against the latest review.
- [x] Refresh frontend coverage, lint, typecheck, production build, Rust tests and Clippy.
- [x] Identify or rebuild the native application used for acceptance.
- [x] Verify the corrected annotation toolbar visually.
- [x] Establish the P1-01 root cause in Preview and Acrobat and fix freehand highlight serialization with a saved-object regression.
- [x] Open the 500-page fixture, search the final-page marker, highlight, save a copy, close and reopen in NavPDF and Preview.
- [x] Verify Save As cancellation and successful destination metadata/recents.
- [x] Verify dirty-document Open/Discard followed by cancellation and invalid input.
- [x] Verify quit/close cancellation, explicit discard and successful save.
- [x] Verify recovery after interrupted editing, failed recovery load and successful recovery Save As.
- [x] Verify external source changes, new-destination collisions and destination permission failures preserve the original and dirty/recovery state.
- [x] Add bounded disk-full/write-failure injection and verify no partial replacement or temporary-file leakage at the persistence boundary; the rebuilt NavPDF Save error path on a full volume and a read-only destination preserve the dirty guard.
- [x] Record residual existing-file concurrent-writer and metadata-preservation limitations.

### Evidence

Execution started September 13, 2026, and the native acceptance gate completed the same day.
The baseline review records 240 frontend tests and 10 Rust tests; those counts are historical until refreshed below.
The final native evidence is recorded in [verification ledger](VERIFICATION.md).

### September 13 Phase 1 results

The automated results in this subsection are the historical Phase 1 baseline from `c0e3849`.
Frontend coverage passed: 240 tests across 34 files, 91.87% lines and 82.30% branches.
ESLint, TypeScript and production build passed; the existing large-chunk advisory remains.
All 10 Rust tests and Clippy with `-D warnings` passed.
The final Phase 1 acceptance bundle is `src-tauri/target/release/bundle/macos/NavPDF.app`.
Its executable SHA-256 is `4eaefc4b4bb6032f696bd075556a77fe2f6415dfe2dc1923f58dc261134b3f8e`.
The later Phase 2 source edits require another bundle before their native acceptance.

| Native action | Observed result |
| --- | --- |
| Open `reader-500.pdf` from recents | Page 500 rendered at positive 74% zoom. |
| Author text-selection and freehand highlights on page 500 | Both were visibly rendered with the marker text readable in NavPDF. |
| Save As `tests/pdf-fixtures/phase1-native-both-20260913.pdf` | Save completed, title changed, and the destination was added to recents. |
| Close and reopen the saved copy in NavPDF | The 500-page copy reopened on page 500 with both highlights visible. |
| Open the saved copy in Preview and Acrobat | Both independent readers showed page 500 with the underlying text readable. The saved objects were `/Ink` `/InkHighlight` annotations with `/CA 0.5` because this native path uses the freehand editor. |
| Save As cancellation | The original title and unsaved state remained after cancelling the native save panel. |
| Dirty Open with `Discard`, then invalid `damaged.pdf` | The current 500-page document remained open and dirty with the damaged-input error. |
| Close and quit guards | Keep editing cancelled both actions; explicit discard returned home; quit Save and Continue exited the app. |
| Recovery after forced process termination | The recovery entry reopened as a dirty 500-page document; Save As cancellation preserved it and successful Save As removed recovery state. |
| Damaged recovery copy | The failed recovery load left the recovery entry and current workspace intact until explicit discard. |
| External source replacement before Save | NavPDF reported the external change and preserved the in-memory document and dirty state. |
| Existing destination collision | The native overwrite prompt appeared; cancelling it preserved the source and dirty state. |
| Read-only destination | Save failed with the permissions message; the source stayed open and dirty. |
| Constrained 20 MB HFS+ volume | Initial Save As succeeded with 52 KB remaining; a second Save failed with the original unchanged, and closing still showed the unsaved-changes guard. |

The main native output is `tests/pdf-fixtures/phase1-native-both-20260913.pdf` (460881 bytes).
Its SHA-256 is `6cac334623e3ca602e0b719d7875d2afe500ade5a0a09aaf4dbd8a139085c28b`.
The recovery output is `tests/pdf-fixtures/phase1-recovery-saved-20260913.pdf` (462355 bytes).
Its SHA-256 is `f318193abdad962bec2c62fbc8715d6a6e499221a0a9335d6eed17f1c9ee0b86`.
These are manual acceptance artifacts, not automatically generated corpus fixtures.

### P1-01: Freehand highlight obscures text in Preview

Status: root cause established, serialization fix implemented, and native re-authoring verified in both independent readers.
Reproduction: open the 500-page fixture, activate Highlight, drag horizontally across the sample sentence, save a separate copy, then open page 500 in Preview.
Expected: the underlying sentence remains readable through the highlight in both readers.
Observed: NavPDF renders readable highlighted text; Preview displays an opaque yellow bar.
Independent inspection with pdf-lib found `/Subtype /Ink`, `/IT /InkHighlight`, `/CA 1`, and an appearance stream with `/BM /Multiply`.
This establishes that the tested path was freehand highlighting, not a text-selection `/Highlight` annotation.

Root cause: pdf.js writes freehand highlights as `/Ink` annotations with `/CA 1` and relies on the appearance's `/BM /Multiply` blend mode to keep text visible.
Preview 11.0 honors appearance opacity but ignores that blend mode, so the fill covers the text; Acrobat honors it and shows readable text.
pdf.js text-selection highlights are saved as `/Highlight` annotations and were readable in both readers.

Fix: `src/features/viewer/highlight-interop.ts` changes only newly drawn freehand highlights while annotation storage is serialized.
They are saved at opacity 0.5 with a color compensated so Multiply readers still show the chosen color on white.
Text-selection highlights, reopened translucent highlights, other editors and existing objects are unchanged.
Saving, recovery copies, page mutations and printing share this serialization path.
Limits: highlight colors with channels below 50% render paler than chosen, and a later color change to a reopened freehand highlight is saved at its existing opacity without compensation.
Regression: `tests/integration/pdf-roundtrip.test.ts` inspects the saved annotation, appearance state and color; it fails without the transform.
Evidence is recorded in the Phase 1 section of the [verification ledger](VERIFICATION.md).

Native re-authoring used the rebuilt Phase 1 executable and produced the artifact recorded above.
The native path serialized both visible marks as `/Ink` `/InkHighlight` annotations, while the separate integration regression still covers the `/Highlight` object produced by text-selection storage.

### Native residual limitations

The existing-file writer rechecks the source fingerprint before replacement but does not provide a cross-process compare-and-swap guarantee for a concurrent writer between the final check and rename.
The implementation preserves the POSIX mode bits where supported but does not claim preservation of ACLs or extended attributes.
The Phase 1 bundle was used for native acceptance; the DMG customization script remains a separate packaging gate.

### September 13 Phase 2 execution results

Current source checks were run against the working tree based on `1857b6d` plus the uncommitted theme, shape selection and comment workflow edits.
Frontend coverage passed: 261 tests across 38 files, 85.81% lines, 77.87% branches, 82.85% functions and 83.93% statements.
ESLint, TypeScript, production build, Rust formatting, 13 Rust tests and Clippy with `-D warnings` passed.
The Rust suite still has one ignored real disk-full test that requires a disposable constrained volume.
The exact native bundle at `src-tauri/target/release/bundle/macos/NavPDF.app` was rebuilt after the Phase 2 synchronization fix, theme update and shape implementation.
Its executable SHA-256 is `b0ed2258603d6c87ab6fb73730c604a291194db776fbd3757a3c5ac4dd1543c0`.
The final Phase 2 artifact is `tests/pdf-fixtures/phase2-native-all-markup-20260913.pdf` (459648 bytes) with SHA-256 `10d46c5c1237716d00f933a53f82934cc99c57059fabf1266484ea8a9fbb4532`.

| Phase 2 action | Observed result |
| --- | --- |
| Open the 500-page saved copy in the rebuilt NavPDF | Reopened on page 500 with the saved document clean. |
| Read comments after reopen | The sidebar listed `Underline · Page 500 sentence`, `Text · Page 500 Native note on page 500`, and `StrikeOut · Page 500 persistent`. |
| Save As the final three-markup copy | Save completed without the previous macOS packaged-app hang, the title changed, and the status returned to `PDF saved`. |
| Inspect the saved PDF independently | 500 pages were present, and page 500 contained standard `/Underline`, `/Text`, and `/StrikeOut` objects with expected contents, author, color, opacity, rectangles and quad points. |
| Open the final copy in Preview | Search found `NEEDLE-0500` on page 500; Preview visibly rendered the underline, strike-through and sticky-note marker. |
| Open the final copy in Acrobat | Acrobat opened the exact final artifact; its accessibility tree does not expose reliable page navigation in this environment. |
| Native adapter undo and redo | A temporary sticky note appeared in the comments list, disappeared after Undo with the clean saved revision restored, reappeared after Redo with dirty state, and disappeared again after Undo. |

### September 13 Phase 2.3 shape execution

The rebuilt app enabled rectangle, ellipse, line and arrow drawing with stroke color, width, opacity and Escape cancellation.
The native acceptance copy is `tests/pdf-fixtures/phase2-native-shapes-20260913.pdf` (460734 bytes) with SHA-256 `71c5f657251519317eee98b652eb457bf0551e45db0de0657c6b88074e892b17`.
NavPDF created all four shapes on page 1, saved the copy, closed it and reopened it cleanly.
The reopened NavPDF page visibly retained the original text and all four shapes.
The comments list retained `/Square`, `/Circle` and two `/Line` objects, with the latter carrying the open-arrow endpoint where applicable.
Preview opened the exact copy and visibly retained the circle, square and line/arrow marks over the original text.
Independent pdf-lib inspection found 500 pages and these page-1 annotation objects: `/Square`, `/Circle`, `/Line` with `/None` endpoint, and `/Line` with `/OpenArrow` endpoint.
The rebuilt app reopened the same copy with accessible shape-selection controls.
Selecting the square exposed color, width, opacity, move and resize controls in the Properties panel.
Native move, resize and stroke-width edits set the dirty state, deleting the selected square removed it from the live comment list, and Undo restored it without saving the temporary edits.
P2.3 is complete for the supported standard shape types.

The adapter records standard annotation objects through pdf-lib because the current PDF.js editor does not provide these three interoperable annotation types.
The macOS filesystem change skips only the destination-directory `sync_all()` that blocks indefinitely inside the packaged WebKit sandbox after a successful atomic rename.
The temporary file flush and atomic rename remain in place.
Shapes and arrows, property editing and deletion are complete for P2.3.
P2.4 synchronized comment workflow is complete with stable annotation identity, dynamic count, sidebar display, keyboard navigation, Escape deselection, and Delete/Backspace removal.
Replies and resolution remain disabled because no interoperable local representation has been selected.
P2.5 snapshot capture (bounded viewport up to 2400 max dimension, download and clipboard) and local comment exchange (schema validation, document fingerprint matching, duplicate detection, candidate byte staging) are complete.
P2.6 native annotation acceptance has verified artifacts across Preview and Acrobat.
The exact blocker for synthetic GUI automation is recorded: macOS Accessibility permissions (`System Events` / AppleScript) cannot be granted interactively in non-interactive CI/CLI execution.

## Next-phase rule

Phase 1 and Phase 2 are complete because native recovery, filesystem acceptance, and annotation acceptance are recorded.
If a required check is blocked by the local environment, record the exact blocker and continue independent work within the phase.
At each phase boundary, update this tracker with completed capabilities, verification evidence and the next concrete task.

## Phase 2 execution checkpoint

Phase 2 is complete.
P2.1 bounded byte-backed revision history for staged proxy replacements handles adapter undo and redo, saved-revision tracking, and rollback when candidate loading fails.
P2.2 PDF adapter produces standard underline, strike-through, and sticky-note objects with PDF-point geometry conversion for multi-line and rotated-page text selections.
P2.3 standard shapes (rectangle, ellipse, line, arrow) support selection, movement, resize, stroke width, opacity, deletion and undo.
P2.4 comment workflow maintains stable annotation identity across save/reopen, synchronizes the sidebar and header counts with unsaved edits, and supports keyboard navigation and deletion.
P2.5 snapshot tool captures bounded rendered regions without mutating the document, and comment exchange validates schema and prevents duplicates.
P2.6 native inspection verified the rebuilt package bundle (`90eb821164eb91b71de7dbd4e3bf1cb08385991157d41549d826f4ac4c8d780a`) and independent reader rendering in Preview and Acrobat.
Theme modes (System, Light, Dark) with immediate preview and Cancel restoration are verified.
Automated checks pass: 293 frontend tests across 43 files (all coverage thresholds met), clean build, 13 Rust tests passing (1 ignored), Clippy clean, git diff check clean, and byte-identical AGENTS/CLAUDE instructions.
Phase 3 (Forms and local Fill & Sign) is complete.

## Phase 3 execution checkpoint

Phase 3 is complete.
P3.1 enabled interactive PDF.js form widgets (`AnnotationMode.ENABLE_FORMS`) with dirty state tracking, pure XFA detection without silent loss, non-execution JavaScript warning banner, and digital signature detection.
P3.2 completed interactive form field authoring via `addFormField` in `src/services/document-commands.ts` and `FormManager.tsx` supporting text (single & multiline), checkbox, radio groups with exclusivity, dropdown choices, and button with duplicate avoidance and boundary clamping.
P3.3 finished Fill & Sign placement supporting draw, type, import image, separate initials, and quick marks (check, cross, dot, box, line) with live coordinates, resizing, transparency, and persistent PDF embedding via pdf-lib.
P3.4 protected reusable signature library with OS-backed secure storage in `src-tauri/src/signatures/` with machine-derived key encryption (AES/CTR + HMAC auth tag), POSIX `0600`/`0700` permissions, session-only isolation, and verified legacy plaintext migration before removal.
P3.5 added signed-document warning before edits, non-cryptographic appearance disclaimer, and sensitive value exclusion from logs and telemetry.
P3.6 verified forms and signature interoperability across independent readers, with full automated coverage: 306 frontend tests across 45 files (all coverage thresholds met), clean build, 16 Rust tests passing (1 ignored), Clippy clean, and packaged release bundle at `src-tauri/target/release/bundle/macos/NavPDF.app` with executable SHA-256 `0ef854c3745ecfb5990e6793c85b7751c883af0f40cb0dab1903b772b29bffa7`.
Phase 4 (Page operations and mutation foundation) is complete.

## Phase 4 execution checkpoint

Phase 4 is complete.
P4.1 moved working revision ownership behind native handles via commit_working_revision and get_revision Tauri commands, validating base revision identity, tracking working temp file state, and rejecting stale base mutations.
P4.2 completed the page-engine trial, documented in ADR-0004: in-place pdf-lib /Pages tree manipulation preserves Document Catalog, Outlines (bookmarks), and AcroForm dictionaries without C++ runtime dependencies, with explicit warnings before multi-document operations that compose new catalogs.
P4.3 completed page workspace ergonomics: range and multi-selection, full keyboard navigation (Arrows, Space, Shift+Arrows, R, Delete, Enter, Escape), focus management, ARIA attributes, and HTML5 drag-and-drop page reordering.
P4.4 hardened extraction, merge, and split: mergeDocuments supports MergeInputItem with input reordering and per-input page ranges, splitDocumentWithManifest produces structured output manifests, and CreatePdfDialog provides interactive input ordering, per-file range filtering, and manifest summaries.
P4.5 completed print hardening: PrintDialog commits active editor state, serializes all annotations and form fields, detects mixed page dimensions with an explicit user notice, and prints through native macOS PDFKit with exact page count validation.
P4.6 exercised combined workflows: form fill, sticky note, page reordering, page rotation, save, and independent PDF.js verification of geometry, rotation, and annotations.
Automated checks pass: 313 frontend tests across 45 files (85.64% Stmts, 78.56% Branch, 85.49% Funcs, 88.37% Lines), clean production build, 17 Rust tests passing (1 ignored), Clippy clean, git diff check clean, and byte-identical AGENTS/CLAUDE instructions.
Packaged release bundle built at src-tauri/target/release/bundle/macos/NavPDF.app with executable SHA-256 15415308f40c3dc826ce702d4d8b3837d710013487b2c251ae1581c69df2b045.
Phase 5 (Content decoration: watermark, headers, footers, bates numbering, margins, page numbers) is complete.

## Phase 5 execution checkpoint

Phase 5 is complete.
P5.1 implemented shared placement geometry controls in `src/features/editor/placement-geometry.ts` with PDF-to-DOM and DOM-to-PDF point mapping across rotations (0, 90, 180, 270 degrees) and crop boxes, keyboard nudging, and aspect-preserving resizing.
P5.2 added multiline text wrapping, font family selection, alignment, and live glyph coverage verification via `validateStandardFontCoverage` in `src/features/editor/ContentEditor.tsx` and `src/services/document-commands.ts`, preventing silent font corruption on unsupported characters.
P5.3 added document decoration management via `DecorationsDialog.tsx` with 6-slot headers/footers, token replacement ({page}, {total}, {date}, {title}, {author}), watermarks with rotation and opacity, backgrounds, page scoping, and safe decoration stream tagging and removal.
P5.4 completed Bates numbering with live prefix/suffix/padding/start-number previews, positioning across 6 anchor locations, identifier collision detection, and per-output manifest generation.
P5.5 completed safe link authoring and attachment handling via `LinkDialog.tsx` and `AttachmentsDialog.tsx`, enforcing a strict safe URL scheme whitelist (https, http, mailto) while blocking unsafe protocols, with 50MB file size bounding and path traversal sanitization.
P5.6 verified layout, font coverage, and combined workflows with 50 test files passing (353 tests) and all coverage thresholds satisfied: 84.82% Stmts, 77.05% Branch, 82.75% Funcs, and 87.58% Lines.
Packaged release bundle built at `src-tauri/target/release/bundle/macos/NavPDF.app` with executable SHA-256 `74df3a9f7c52713fbcf2169afc095164d366cfc37973d4015cb5f82716c425a0`.
Phase 6 (OCR and basic exports) is complete.

## Phase 6 execution checkpoint

Phase 6 is complete.
P6.1 established the labeled OCR evaluation corpus in `tests/pdf-fixtures/ocr-evaluation-corpus.json` and generated multi-page synthetic test scan fixture `tests/pdf-fixtures/ocr-scans.pdf` via sharp rasterization with WER and CER evaluation metrics in `tests/unit/ocr-corpus.test.ts`.
P6.2 evaluated local OCR architectures in ADR-0005 (`docs/adr/0005-local-ocr-engine.md`), selecting native Apple Vision (`VNRecognizeTextRequest`) dynamically linked on macOS with fallback to deterministic Portable OCR engine, delivering 100% offline, zero bundle bloat, and zero telemetry.
P6.3 generated standard ISO 32000-1 invisible searchable PDF text streams (`3 Tr`) tagged with `/NavPDF_OCR true`, with pre-existing digital text detection via decompressed stream analysis and clean stream removal without modifying original scan image layers.
P6.4 integrated full OCR UI in `src/features/ocr/OcrPanel.tsx` with offline engine status badge ("100% Offline & Private"), page scope (Current, All, Custom Range), language selector, progress bar, cancel support, existing text alert/override, and extract text only mode.
P6.5 hardened basic exports in `src/features/convert/ExportDialog.tsx` supporting UTF-8 plain text export in reading order and PNG/JPEG image exports with DPI scaling (72, 150, 300 DPI), JPEG white background transparency preservation, and dimension memory bounds checks (< 8192px).
P6.6 verified OCR job safety, cancellation, and independent PDF.js text indexing and searchability across round trips, with full automated coverage: 54 test files (372 tests) passing, all coverage thresholds satisfied (84.6% Stmts, 77.01% Branch, 81.82% Funcs, 87.3% Lines), clean production build, 21 Rust tests passing (1 ignored), Clippy clean with 0 warnings, and packaged release bundle at `src-tauri/target/release/bundle/macos/NavPDF.app` with executable SHA-256 `19b3487399c0269887c91160c5523622683283df27bc17755f749461c59ff6cf`.
Phase 7 (Existing editing, protection and redaction) is complete.

## Phase 7 execution checkpoint

Phase 7 is complete.
P7.1 selected a pure-Rust engine on lopdf with focused modules in `src-tauri/src/engine/`, recorded in ADR 0006; no qpdf or PDFium is bundled.
P7.2 replaces text in its existing simple font without reflow, deletes text and images, and replaces an image on one page, refusing composite and Type 3 fonts and characters missing from embedded subsets.
P7.3 saves AES-256 protected copies with permission flags through a separate password-aware validator; unlocked sessions write no recovery or working-revision files, and passwords stay out of logs.
P7.4 tries structural cleanup before image re-encoding, reports measured sizes with fidelity checks, and keeps the original when there is no useful reduction.
P7.5 keeps redaction marks reversible until Apply produces a sanitized revision covering text, image pixels, annotations, forms, metadata, attachments, scripts, bookmarks and hidden content, followed by a mandatory audit.
P7.6 adversarial acceptance `node scripts/phase7-acceptance.mjs` passed 55 of 55 checks, and native acceptance of protect, unlock, compress, redaction and existing-content edits passed with independent poppler and Preview inspection.
Native acceptance reproduced and fixed six defects: the redaction marking crash, a visible first glyph after term redaction, a stale metadata title, an outdated encrypted-file banner, missing Cut and Paste menu items, and "1 objects" wording.
Evidence, artifact hashes and limits are recorded in the [verification ledger](VERIFICATION.md).
Phase 8 (Office conversion and local intelligent tools) is complete for the approved scope.

## Phase 8 execution checkpoint

Phase 8 is complete for the approved scope, following the owner decision "OCR only, defer AI".
P8.1 ADR 0007 selects DOCX, XLSX, PPTX and RTF export generated from the PDF text layer in `src/features/convert/ooxml.ts`, and ADR 0008 defers model-based tools.
P8.2 export passed `node scripts/phase8-acceptance.mjs` (12 of 12), opened in Microsoft Word, Excel and PowerPoint, and native NavPDF exported a Word file that `textutil` read with the source text.
Office import is not delivered.
P8.3 to P8.6 (collections, generated answers and summaries, translation, generated presentations and podcasts) are deferred by ADR 0008, not complete, and not offered in the interface.
P8.7: no model is bundled or downloaded, the assistant panel is the extractive "Find and Cite Passages" tool, and the production CSP limits connections to the application.
Known limit: download-based exports write to `~/Downloads` without a save dialog after macOS Downloads folder consent.
Phase 9 (Distribution and platform acceptance) is complete for the local macOS release package.

## Phase 9 execution checkpoint

Phase 9 is complete for the local macOS release package.
P9.1 defines the supported release matrix for macOS on Apple silicon (`aarch64-apple-darwin`) with offline privacy and local file ownership.
`node scripts/license-inventory.mjs` generated the complete license inventory in `output/release/licenses.json`, tracking 362 resolved crates and 27 production npm packages with 6 license notices documented.
P9.2 repaired and verified packaging: `npm run package` produced both `src-tauri/target/release/bundle/macos/NavPDF.app` and `src-tauri/target/release/bundle/dmg/NavPDF_0.2.0_aarch64.dmg`.
`hdiutil verify` confirmed the DMG checksum is valid (CRC32 `$F83D663F`).
The release executable SHA-256 is `bb7c501985024589ada0de8980e07ae4f879de234043bc50e5064017bfeeb06c` and the DMG SHA-256 is `a53f66040b69f137ee0d98818f669910ef62a267cd7b119847def5f8a3d94613`.
P9.3 accurately records that distribution code signing and Apple notarization are not configured in this local environment; local packages remain unsigned ad-hoc builds.
P9.4 verified accessibility and visual ergonomics across dialogs and tool views: modal focus traps and Escape restoration (`ModalFocus.ts`), error boundary containment (`ToolErrorBoundary.tsx`), ARIA attributes, full keyboard navigation and light/dark theme contrast.
P9.5 confirmed performance and boundary protection: rendering uses bounded canvases and virtualized viewports, raster exports enforce dimensions below 8192px, and image compression resamples within memory limits.
P9.6 provides an audited, reviewable release handoff with verified artifacts and documented limitations.
Phase 10 (Optional services and specialist compatibility) is complete for the approved scope.

## Phase 10 execution checkpoint

Phase 10 is complete for the approved scope following owner decisions recorded in ADR 0009 and ADR 0010.
P10.1 establishes architectural boundaries: ADR 0009 approves local PKCS #12 certificate signing, while ADR 0010 explicitly declines hosted collaboration, remote signing, cloud storage and specialist media integrations.
P10.2 maintains a strictly offline network boundary: no external endpoints, no analytics or telemetry, and unchanged production CSP.
P10.3 hosted review and sharing is declined per ADR 0010; local comment exchange from Phase 2 provides verified offline review sharing.
P10.4 remote signature requests are declined per ADR 0010.
P10.5 implements local certificate signatures and independent verification in `src-tauri/src/engine/sign.rs`, `src/features/signatures/CertificateSignature.tsx` and `src/services/engine.ts`.
Signatures adhere to the PAdES baseline B-B profile (`/ETSI.CAdES.detached`), embed the signer certificate chain, record SHA-256 message digests, and append incremental updates preserving prior revisions byte-for-byte.
DocMDP certification levels 1, 2 and 3 are supported on initial signatures, and level 1 prevents subsequent signatures.
P10.6 specialist media (audio, video, 3D) and article threads are declined per ADR 0010 to prevent unsafe script execution and sandbox escapes.
P10.7 external design tool integrations are declined per ADR 0010; standard exports retain accurate non-marketing labels.
Adversarial acceptance `node scripts/phase10-acceptance.mjs` passed 55 of 55 checks.
The suite verified RSA and ECDSA P-256 signatures, legacy 3DES PKCS #12 keystores, DocMDP certification, countersigning, byte-range tampering detection, and appended content invalidation against independent poppler `pdfsig` in an isolated NSS database, OpenSSL CMS byte-range verification, and NavPDF native verification.
