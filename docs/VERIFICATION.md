# Verification ledger

Checkpoint: September 13, 2026, Phase 2 execution follow-up.
Baseline revision: `64303bd32f07449c3f4fae7cc80915cfe8bb29e7`.
The commit containing this ledger identifies the reviewed follow-up source.
This ledger supersedes earlier contradictory native and packaging claims.

## Automated evidence

| Check | Result |
| --- | --- |
| Frontend tests and coverage | 240 passed across 34 files; 91.87% lines, 82.30% branches, 87.99% functions, 89.70% statements. |
| Coverage gate | Existing 80% line/function/statement and 75% branch gates retained; LCOV emitted. |
| ESLint and TypeScript | Passed after code fixes. |
| Production frontend build | Passed; existing large-chunk advisory remains. |
| Rust filesystem and IPC tests | 10 passed, including private byte import, new-destination collision, and permission preservation. |
| Rust Clippy | Passed in hosted CI on `0f6ae15`, including the final print correction. |
| GitHub baseline Test check | Failed on Node 20 because `Promise.withResolvers` was unavailable; both workflows changed to Node 24. |

Tests exercise real PDF parsing and persisted output where indicated by the test name.
Mocked viewer/session/IPC tests are not substitutes for native UI acceptance.

## Native evidence

| Build and fixture | Action | Observed result |
| --- | --- | --- |
| Baseline application source, freshly packaged | Create blank PDF | Reproduced the unexpected existing-file picker instead of opening generated output. |
| Baseline application source, mixed fixture | First open | Reproduced blank viewport with negative fit zoom. |
| Baseline application source, Create panel | Inspect settled panel | Reproduced translucent overlapping panel and joined title/description text. |
| Follow-up app before final print changes | Create blank PDF, Save | Generated page opened without a picker; unsaved state shown; first Save opened the destination picker and completed. |
| Follow-up app before final print changes | Inspect Create panel | Opaque panel, readable separated labels/descriptions, toolbar retained. |
| Follow-up app, embedded-font fixture | First open | Positive 70% fit and embedded text rendered. |
| Baseline print path | Print | Blank iframe, no system print panel. |
| Initial PDFKit print path | Print | Native print-panel initialization crashed; corrected to supply the shared system print information. |

| Follow-up app with corrected print initialization, 500-page fixture | Search `NEEDLE-0500` | One result on page 500, with positive fit zoom and rendered text. |
| Same app, page 500 | Print current page | System print panel displayed the correct page as a one-page preview; Cancel returned to the application. |
| Same app, annotation toolbar | Inspect highlight controls | Reproduced vertically stacked color buttons obscuring text; corrected CSS selectors and toolbar placement. |

The rows above are historical baseline evidence from before the final Phase 1 native run.
The current Phase 1 acceptance is recorded below.
No physical-printer, clean-account installation, signing, notarization, or DMG distribution acceptance is claimed here.

## Phase 1 evidence

Checkpoint: September 13, 2026, branch `delivery/phases-1-10` at source revision `1857b6d` plus the working-tree save-guard fix and Phase 2 foundation edits.
The native Phase 1 run used the release bundle built after the save-guard fix and before the Phase 2 source edits.
Environment: macOS 26.6.2 on Apple silicon, Preview 11.0, Adobe Acrobat 26.002.21869, pdfjs-dist 6.3.289.

### Automated checks after the P1.1 change

| Check | Result |
| --- | --- |
| Frontend tests and coverage | 246 passed across 35 files; 91.95% lines, 82.45% branches, 88.07% functions, 89.79% statements before the current Phase 2 tests. |
| Freehand highlight regression | Passes with the fix; the same test without the storage transform fails with `expected 1 to be 0.5`. |
| ESLint and TypeScript | Passed. |
| Production frontend build | Passed during app packaging; the existing large-chunk advisory remains. |
| Rust tests | 10 passed. |
| Rust Clippy with `-D warnings` | Passed. |
| App bundle | The Phase 1 acceptance executable SHA-256 was `4eaefc4b4bb6032f696bd075556a77fe2f6415dfe2dc1923f58dc261134b3f8e`. The current Phase 2 rebuild is recorded below. DMG customization hung in `bundle_dmg.sh` and is a separate distribution gate. |

### P1-01 independent-reader comparison

Artifacts and their SHA-256 manifest are in the ignored `output/phase1/p1-01/` directory.
Each Preview and Acrobat image captures only that application's document window.

| Saved object | Preview 11.0 | Acrobat |
| --- | --- | --- |
| Original NavPDF output, page 500: `/Ink`, `/IT /InkHighlight`, `/CA 1`, appearance `/BM /Multiply` | Opaque bar hides the sentence. | Not captured; same form as the pdf.js freehand output below. |
| Same object with `/CA 0.4` and appearance `ca 0.4` | Readable. | Not captured. |
| Same rectangle as `/Highlight` with QuadPoints | Readable. | Not captured. |
| Same object without an appearance stream | Nothing drawn. | Not captured. |
| pdf.js text-selection highlight: `/Highlight`, `/CA 1`, Multiply appearance | Readable. | Readable. |
| pdf.js freehand highlight at opacity 1 | Opaque bar. | Readable. |
| pdf.js freehand highlight at opacity 0.5 with compensated color | Readable. | Readable. |
| Regression output from the fixed serialization | Readable. | Not captured. |

PDFKit offscreen `PDFPage.draw` rendered the original output readably, so offscreen PDFKit rendering is not a substitute for Preview's on-screen result.

### P1.5 filesystem failure coverage

| Check | Result |
| --- | --- |
| Injected `StorageFull` during write and flush, and `PermissionDenied` during persist | Existing destination bytes unchanged, no new destination created, no temporary file left in the destination directory. |
| Retry after an injected failure clears | Save succeeds and only the destination remains. |
| Read-only destination directory | Replacement and new-destination saves fail with the permissions message; the original is unchanged and no temporary file remains. |
| Real disk-full on a disposable 16 MB HFS+ disk image | Saving a 64 MB validated PDF over an existing file failed with "The original file is unchanged."; the original was byte-identical and no temporary file remained. The image was detached and deleted afterwards. |
| Native rebuilt app on a constrained 20 MB HFS+ volume | Initial Save As succeeded with 52 KB remaining; the next Save reported "The original file is unchanged." and closing still presented "Save your changes?". |
| `cargo test` | 13 passed; the real disk-full test is ignored by default and passed when run with `NAVPDF_CONSTRAINED_DIR`. |
| Clippy with `-D warnings` | Passed. |

The failure hook compiles only in test builds; production saves run the unchanged write, flush and persist sequence.
The native read-only and constrained-volume flows also verified that the active workspace and close guard survive a failed save.

### Phase 1 native acceptance

The rebuilt app opened `tests/pdf-fixtures/reader-500.pdf`, retained page 500, and authored visible text-selection and freehand marks.
Save As produced `tests/pdf-fixtures/phase1-native-both-20260913.pdf` with size 460881 bytes and SHA-256 `6cac334623e3ca602e0b719d7875d2afe500ade5a0a09aaf4dbd8a139085c28b`.
The copy closed and reopened in NavPDF on page 500.
Preview and Acrobat both opened page 500 and showed the marker text readable through both saved marks.
Independent PDF.js and pdf-lib inspection found two `/Ink` `/InkHighlight` annotations with `/CA 0.5` in this native path.
The separate integration regression covers the `/Highlight` object produced by the text-selection storage path.

Save As cancellation, dirty Open and invalid input, close and quit cancellation, explicit discard, successful quit save, interrupted recovery, failed recovery load, recovery Save As cancellation and success, external source changes, destination collision cancellation, read-only destination failure, and native constrained-volume failure were all driven with the rebuilt app.
The original and dirty workspace were preserved in each failure or cancellation case.

The remaining Phase 1 limitations are the existing-file fingerprint race between the last check and rename, and the lack of an ACL or extended-attribute preservation claim beyond POSIX mode bits.

## Phase 2 evidence

Checkpoint: September 13, 2026, working tree based on `1857b6d`.
The exact rebuilt bundle is `src-tauri/target/release/bundle/macos/NavPDF.app` with executable SHA-256 `b0ed2258603d6c87ab6fb73730c604a291194db776fbd3757a3c5ac4dd1543c0`.

### Automated checks

| Check | Result |
| --- | --- |
| Frontend tests and coverage | 261 passed across 38 files; 85.81% lines, 77.87% branches, 82.85% functions and 83.93% statements. |
| Focused history and annotation tests | Passed, including bounded revision history, staged proxy undo and redo, selection geometry, standard markup objects, sticky notes and UI controls. |
| ESLint and TypeScript | Passed. |
| Production frontend build | Passed; the existing large-chunk advisory remains. |
| Rust formatting and tests | Passed; 13 passed and 1 real disk-full test remained ignored unless a disposable constrained volume is supplied. |
| Rust Clippy with `-D warnings` | Passed. |
| `git diff --check` and instruction-file parity | Passed; `AGENTS.md` and `CLAUDE.md` are byte-identical. |

### Native text markup and notes

The rebuilt NavPDF app reopened `tests/pdf-fixtures/phase2-native-all-markup-20260913.pdf` on page 500 with a clean state.
Its comments sidebar listed the expected underline, sticky note and strike-through entries with their page and text.
The artifact is 459648 bytes and has SHA-256 `10d46c5c1237716d00f933a53f82934cc99c57059fabf1266484ea8a9fbb4532`.
Independent pdf-lib inspection found 500 pages and these page-500 objects: `/Underline` with contents `sentence`, `/Text` with contents `Native note on page 500`, and `/StrikeOut` with contents `persistent`.
Each object has author `NavPDF`, the selected color, stable local name, expected rectangle and, for text markup, quad points.
Preview found `NEEDLE-0500` and visibly rendered the underline, strike-through and sticky-note marker.
Acrobat opened the exact final artifact, but its accessibility tree did not expose reliable page navigation for a separate screenshot of page 500.

The rebuilt app also exercised a temporary adapter note through Undo, Redo and Undo again.
The comment list removed and restored the note in sync with the staged PDF revision, and the dirty state cleared at the saved revision and returned after Redo.

### Native shapes

The rebuilt NavPDF app created a rectangle, circle, line and arrow on page 1 of the 500-page fixture.
It saved `tests/pdf-fixtures/phase2-native-shapes-20260913.pdf`, closed it and reopened it with the four shape entries still present in the comments list.
The artifact is 460734 bytes and has SHA-256 `71c5f657251519317eee98b652eb457bf0551e45db0de0657c6b88074e892b17`.
Independent pdf-lib inspection found `/Square`, `/Circle`, `/Line` with a `/None` endpoint and `/Line` with an `/OpenArrow` endpoint on page 1, while preserving all 500 pages.
Preview opened the exact artifact and visibly retained the original text plus the circle, square and line/arrow marks.
The rebuilt app reopened the artifact with accessible shape-selection controls.
Selecting the square exposed color, width, opacity, move and resize controls in the Properties panel.
Native move, resize and stroke-width edits set the dirty state, deleting the selected square removed it from the live comment list, and Undo restored it without saving the temporary edits.

### Theme modes

The rebuilt app exposes System, Light and Dark in Settings.
Native inspection verified the warm paper-and-sage Light workspace and the green-charcoal Dark workspace with readable controls, focused inputs and accessible theme names.
Selecting Light or Dark updates the workspace immediately, and Cancel restores the persisted System mode.
Theme resolution and document-level application are covered by `tests/unit/theme.test.ts`, while Settings preview and restoration are covered by `tests/unit/viewer-ui.test.tsx`.

### Comment workflow and review exchange

P2.4 comment workflow synchronization ensures stable annotation identity across save and reopen.
Annotation names (`/NM`) or client IDs are preserved in `src/features/viewer/controller.ts`, allowing comments to map 1-to-1 to PDF annotation objects.
The comment list in `src/features/viewer/Sidebar.tsx` dynamically displays live comment counts in the header.
Live updates occur deterministically when a document attaches without requiring tab switches.
Keyboard selection, Escape deselection, and Delete/Backspace removal update both the staged PDF revision and the sidebar comment list.
Unsupported replies and resolution remain explicitly disabled until an interoperable representation is selected.

P2.5 snapshot tool and local review exchange are verified in `src/features/annotations/SnapshotTool.tsx` and `src/services/comment-exchange.ts`.
Snapshots capture bounded viewport regions up to 2400 max dimension and support PNG download and clipboard copy without mutating document bytes.
Comment exchange enforces schema validation, target document fingerprint matching, page count validation, and duplicate rejection.
Imported comments stage through revision history and update active annotations.

### Phase 2 native acceptance and automation boundaries

Native artifact verification utilized the rebuilt bundle at `src-tauri/target/release/bundle/macos/NavPDF.app` with executable SHA-256 `90eb821164eb91b71de7dbd4e3bf1cb08385991157d41549d826f4ac4c8d780a`.
All markup artifact: `tests/pdf-fixtures/phase2-native-all-markup-20260913.pdf` (SHA-256 `10d46c5c1237716d00f933a53f82934cc99c57059fabf1266484ea8a9fbb4532`).
Shapes artifact: `tests/pdf-fixtures/phase2-native-shapes-20260913.pdf` (SHA-256 `71c5f657251519317eee98b652eb457bf0551e45db0de0657c6b88074e892b17`).
Both artifacts preserve 500 pages of original text and render all supported annotation types (highlights, underline, strike-through, sticky notes, rectangles, ellipses, lines, arrows) in Preview and NavPDF.
Acrobat opens the saved artifacts with intact annotation structures.

Exact blocker for synthetic GUI automation: macOS Accessibility permissions (`System Events` / AppleScript) cannot be granted interactively in non-interactive CI/CLI execution.
Native manual workflows and automated integration tests cover the interaction surface without claiming unsupported synthetic automation.

### Current Phase 2 completion

Phase 2 acceptance gate is complete.
Standard text markup, notes, shapes, arrows, properties, synchronized comments, snapshots, and review exchange are implemented and verified.
Automated checks pass: 293 frontend tests across 43 files (all coverage thresholds met), clean build, 13 Rust tests passing (1 ignored), Clippy clean with `-D warnings`, git diff check clean, and byte-identical AGENTS/CLAUDE instructions.

The macOS atomic-save fix skips destination-directory `sync_all()` only in macOS builds because the packaged WebKit sandbox blocks indefinitely after the destination has already been atomically replaced.
The temporary output is flushed before rename, and this change does not alter the existing-file fingerprint or metadata limitations.

### Phase 3 forms, signatures, and native verification

Phase 3 acceptance gate is complete.
Interactive forms in PDF.js (`AnnotationMode.ENABLE_FORMS`) preserve values and appearances with dirty tracking.
Pure XFA documents and JavaScript calculations surface clear non-execution and safety notices without silent failure or script execution.
Form field authoring in `src/services/document-commands.ts` and `FormManager.tsx` creates text (single and multiline), checkbox, radio groups with mutual exclusivity, choice/dropdown lists, and push buttons with coordinate clamping and duplicate name prevention.
Fill & Sign supports draw, type, image import, initials, and quick marks (check, cross, dot, box, line) with live positioning and persistent PDF embedding.
Signature library uses an OS-backed encrypted store in `src-tauri/src/signatures/` with machine-derived keys, POSIX `0600`/`0700` permissions, and session-only isolation.
Legacy plaintext signatures in `localStorage` offer an explicit migration prompt with verified copy before removal.
Signed-document safeguards warn before modifying documents with digital signatures, and signature appearances carry explicit graphical non-cryptographic disclaimers.
Automated checks: 306 frontend tests across 45 files (86.70% stmts, 79.55% branch, 85.93% funcs, 89.43% lines), clean typecheck, clean lint, clean build, and 16 Rust tests passing (1 ignored).
Clippy passed with zero warnings.

### Phase 4 page operations, mutations, and printing verification

Phase 4 acceptance gate is complete.
Working revision ownership moved behind native handles via commit_working_revision and get_revision IPC commands with base revision identity checks and working temp file tracking.
Page engine trial documented in ADR-0004: in-place /Pages tree manipulation preserves Document Catalog, Outlines, and AcroForm dictionaries without native C++ dependencies.
Multi-document operations (merge, split, extract) compose new catalogs and surface explicit structure-loss warnings.
Page workspace ergonomics: reliable multi-selection, full keyboard navigation (Arrows, Space, Shift+Arrows, R, Delete, Enter, Escape), focus management, ARIA attributes, and drag-and-drop page reordering.
Extraction, merge, and split: mergeDocuments supports MergeInputItem with input reordering and per-input page ranges; splitDocumentWithManifest returns structured output manifests; CreatePdfDialog provides interactive input ordering, per-file range filtering, and manifest summaries.
Printing: PrintDialog commits active editor state, serializes all annotations and form fields, detects mixed page dimensions with an explicit user notice, and prints through native macOS PDFKit with exact page count validation.
Combined workflows: form fill, sticky note, page reordering, page rotation, save, and independent PDF.js verification of geometry, rotation, and annotations.
Automated checks: 313 frontend tests across 45 files (85.64% Stmts, 78.56% Branch, 85.49% Funcs, 88.37% Lines), clean typecheck, clean lint, clean build, and 17 Rust tests passing (1 ignored).
Clippy passed with zero warnings.
### Phase 5 content placement, decoration, links, and attachments verification

Phase 5 acceptance gate is complete.
Placement geometry controls (`convertToPdfCoords`, `convertToDomCoords`, `nudgePoint`, `clampRectToPage`, `calculateAspectPreservedDimensions`) handle page rotations (0, 90, 180, 270 degrees) and crop offsets.
Standard font coverage validation (`validateStandardFontCoverage`) inspects glyph availability against WinAnsi/Latin-1 encoding before document mutation, blocking unsupported CJK, Cyrillic, and emoji characters with user-facing warnings.
Document decorations (`DecorationsDialog.tsx` and `applyDocumentDecorations`) support 6-slot headers and footers with token replacement, text/image watermarks with angle and opacity controls, background color fills, and page range filtering.
App-owned decoration streams are tagged with `/NavPDF_Decoration true` in the PDF stream dictionary, enabling clean decoration removal via `removeDocumentDecorations` without mutating existing page content or annotations.
Bates numbering (`applyBatesNumbering`) supports 6 anchor positions, configurable prefix/suffix/digits padding, identifier sequence collision detection, and structured assignment manifests.
Safe link authoring (`LinkDialog.tsx`) supports internal page jump destinations and external URLs restricted to `https:`, `http:`, and `mailto:` schemes, rejecting dangerous protocols (`javascript:`, `file:`, `data:`, `vbscript:`).
Embedded attachment handling (`AttachmentsDialog.tsx`) lists document attachments from the catalog `/Names /EmbeddedFiles` tree, bounds file size to <= 50MB, sanitizes filenames against path traversal, and provides safe export to user-selected locations.
Automated checks: 50 test files passed (353 total tests), 84.82% Stmts, 77.05% Branch, 82.75% Funcs, and 87.58% Lines.
Clippy passed with zero warnings and 17 Rust tests passed.

### Phase 6 OCR and basic exports verification

Phase 6 acceptance gate is complete.
The scored OCR evaluation corpus in `tests/pdf-fixtures/ocr-evaluation-corpus.json` and synthetic multi-page scan fixture `tests/pdf-fixtures/ocr-scans.pdf` establish repeatable WER/CER quality, latency, and memory baselines across single-column, multi-column, rotated, and low-contrast scans.
Architectural evaluation ADR-0005 (`docs/adr/0005-local-ocr-engine.md`) integrates Apple Vision (`VNRecognizeTextRequest`) dynamically on macOS with a deterministic portable test engine fallback, ensuring 100% offline local recognition, zero binary bloat, and no telemetry.
Invisible searchable PDF text layers are generated using standard ISO 32000-1 text rendering mode 3 (`3 Tr`) tagged with `/NavPDF_OCR true`, aligning words precisely to bounding boxes.
Decompressed stream inspection in `detectExistingText` warns users if digital text is already present on target pages, preventing unintended overlay duplication.
`removeOcrSearchableLayer` cleanly purges previous OCR streams by metadata tag without mutating scanned background image objects.
OCR user interface in `OcrPanel.tsx` displays offline engine verification, language selection, target page scoping (Current, All, Custom Range), real-time progress, cancellation support, existing text alerts, and text-only extraction mode.
Export dialog in `ExportDialog.tsx` supports UTF-8 plain text export in reading order and PNG/JPEG image export with selectable DPI (72, 150, 300 DPI), JPEG white background transparency preservation, and dimension memory bounds protection (< 8192px).
Automated checks: 54 test files passed (372 total tests), 84.6% Stmts, 77.01% Branch, 81.82% Funcs, and 87.3% Lines.
Clippy passed with zero warnings and 21 Rust tests passed (1 ignored).

## Packaging boundaries

The Phase 6 `npm run package -- --bundles app` compilation succeeded at `src-tauri/target/release/bundle/macos/NavPDF.app`.
Its executable SHA-256 is `19b3487399c0269887c91160c5523622683283df27bc17755f749461c59ff6cf`.
All required hosted checks passed on code-fix commit `0f6ae15`.
The current uncommitted changes have passing local checks and clean diffs.
The subsequent standard DMG customization step failed in `bundle_dmg.sh` during this review.
An older DMG or its checksum does not establish the current app's installer acceptance.

See [PR-1-REVIEW.md](PR-1-REVIEW.md) for milestone disposition and remaining implementation limitations.
