# Phase 1 verification and evidence ledger

This report tracks the verified capabilities, automated test ledger, and findings disposition for NavPDF.

## Automated evidence ledger

| Category | Command | Result | Details |
| --- | --- | --- | --- |
| TypeScript | `npm run typecheck` (`tsc -b`) | Passed | Strict type check with zero errors |
| Linter | `npm run lint` (`eslint`) | Passed | Clean codebase, zero warnings or errors |
| Frontend Tests | `npm test` (`vitest run`) | Passed (233/233 tests, 33 files) | Real PDF parsing, range transport, search navigation, viewing inputs, session flows (dirty guard, attach rollback, Save As metadata, autosave, close-requested), mutation-pipeline commits, page-operation structure preservation, print range resolution, download safety, and honest capability gating |
| Coverage | `npm run test:coverage` (`vitest --coverage`, 80% gate) | Passed (91.7% lines, 89.6% statements, 82.1% branches) | Enforced thresholds in `vite.config.ts` (lines/functions/statements 80, branches 75); excludes only `main.tsx` and the WebKit stream shim |
| Native Rust Tests | `cargo test --manifest-path src-tauri/Cargo.toml` | Passed (7/7 tests) | Bounded reads, snapshot immutability, atomic save, corrupt output refusal, page count check, external change refusal |
| Rust Linter | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Passed | Zero warnings |

## Implementation milestones (M0–M7)

| Milestone | Status | Components & Capabilities |
| --- | --- | --- |
| **M0 (Tool Navigation & Workspace Shell)** | Completed | Mode switcher tabs (All tools, Edit, Convert, E-Sign, Create), categorized `ToolPanel` drawer, quick tool rail toggle. |
| **M1 (Page Operations Engine & Workspace)** | Shipped (local pdf-lib) | `document-commands.ts` (rotate, delete, move, extract, insert blank/image, crop, merge, split) + visual grid organizer `PageWorkspace.tsx`, `PrintDialog.tsx`, `CreatePdfDialog.tsx`. Mutations commit via `ViewerController.replaceWithBytes`. Reorder preserves the catalog in place (outline, AcroForm, metadata); extract/merge/split compose a new document and warn up front about what cannot carry over. Print applies a real page range. Native Rust page-engine trial still pending. |
| **M2 (Annotation Suite & Markup)** | Partial | Highlight, freehand ink, and text boxes work through the PDF.js editor with undo/redo; `SnapshotTool.tsx` captures regions to clipboard/PNG. Underline, strike-through, shapes, sticky notes, and replies are disabled with explanations pending the M2 adapter. |
| **M3 (Content Placement & Decorations)** | Shipped (local pdf-lib) | `ContentEditor.tsx` (styled text & images), `DecorationsDialog.tsx` (watermarks, headers/footers with tokens, Bates numbering, backgrounds), `AttachmentsDialog.tsx` (embed & extract files). All commit via `replaceWithBytes`. |
| **M4 (Interactive Forms & Fill and Sign)** | Partial | `FormManager.tsx` (AcroForm text fields, checkboxes, buttons) and `FillAndSign.tsx` (drawn/typed signature images, quick marks, local library) place real content. XFA, JS calculations, certificate signing, and OS-keychain encryption are pending. |
| **M5 (OCR & Document Exports)** | Partial | `ExportDialog.tsx` (plain text, PNG, JPEG) works. `OcrPanel.tsx` reads embedded page text only; true OCR needs the M5 engine trial. |
| **M6 (True Redaction, Compression, Security)** | Partial | `CompressDialog.tsx` re-encodes structurally with measured before/after sizes and keeps the original when nothing is saved. `RedactionTool.tsx` marks regions only (no black-rectangle fake). `ProtectDialog.tsx` explains status only; real encryption needs the M6 engine. |
| **M7 (Office Formats, Design, Local AI)** | Partial | `OfficeExport.tsx` produces Word/slide HTML outlines plus formula-safe CSV with explicit fidelity labels (not OOXML). `DesignTools.tsx` inserts a real cover page. `AssistantPanel.tsx` builds an extractive cited page index; abstractive generation needs the M7 model decision. |
| **M8 (Cloud & PKI Boundaries)** | Enforced | Strictly local-first: no remote telemetry, no unauthenticated cloud endpoints, no mock PKI certificates. |

## Findings disposition (R1–R6)

| Finding | Status | Verification & Resolution |
| --- | --- | --- |
| **R1 (Discard unsaved guard)** | Resolved | `discardAndContinue` retains dirty state and recovery until the replacement document actually commits. Tested in `tests/unit/document-session.test.ts`. |
| **R2 (Load attach rollback)** | Resolved | `load` stages candidate attachment and first-page render before destroying previous task. Rolls back to previous PDF on failure. Tested in `tests/unit/document-session.test.ts`. |
| **R3 (Save As recents & metadata)** | Resolved | `save_document` returns typed `SaveResult { name, size }`, updates `Opened.name`, updates `local.recents` on Save As for `remember_page` lookups. State updates display name and size. |
| **R4 (Documentation reconciliation)** | Resolved | Reconciled `HANDOFF.md` and `VERIFICATION.md` into an honest, unified evidence ledger. |
| **R5 (Bookmark hierarchy)** | Resolved | Outline mapping retains parent nodes without destinations if they have children, mapped as section headings. Tested in `tests/unit/viewing.test.ts`. |
| **R6 (Verification gaps)** | Partially resolved | Automated suites cover document replacement, discard cancellation, attachment rollback, and Save As metadata. Filesystem fault injection (disk-full, permission preservation, destination races) and the native edit/save/recovery lifecycle are still not covered. |

## Findings raised by the 2026-09-12 roadmap audit

| Finding | Status | Verification & Resolution |
| --- | --- | --- |
| **A1 (Page operations silently dropped document structure)** | Resolved | `reorderPages` rebuilt the document with `copyPages`, discarding the outline, the AcroForm and its fields, and document metadata. It now permutes the existing page tree in place, preserving all three. Measured against a probe document carrying an outline, one text field, and a title; covered by `tests/unit/document-structure.test.ts`. |
| **A2 (Extract, merge, and split drop structure without warning)** | Resolved by warning | These operations compose a genuinely new document, so source outlines and form fields cannot carry over. `describeStructureLoss()` now reports the specific loss, and `PageWorkspace` and `CreatePdfDialog` show it before the action. Remapping structure across documents remains unimplemented. |
| **A3 (Downloads revoked their object URL synchronously)** | Resolved | Six duplicated download paths revoked the blob URL immediately after `click()`, which cancels the download in WebKit. Consolidated into `src/utils/download.ts` with a delayed revoke and filename sanitizing; covered by `tests/unit/download.test.ts`. |
| **A4 (Print offered dead range and orientation controls)** | Resolved | `PrintDialog` collected page range and orientation but always printed the whole document. The range now genuinely restricts printed pages via `parsePageRange()`; the orientation control was removed because the system print dialog owns it. Covered by `tests/unit/print-range.test.ts`. |
| **A5 (HANDOFF contradicted itself on native acceptance)** | Resolved | `HANDOFF.md` claimed the native UI-to-Preview round trip had passed while also stating that saving and Preview interoperability were unverified, and listed printing and DMG packaging as pending after both had progressed. Reconciled against observed evidence. |

## Acceptance boundaries

- Parser tests are not a substitute for native user-interface checks.
- No native end-to-end run (500-page highlight, Save As, Preview reopen, recovery, DMG install) has been performed against this revision.
- Extract, merge, and split do not carry source outlines or form fields into their output; the loss is reported, not repaired.
- Synthetic 1,000-page text PDFs do not establish a memory or responsiveness guarantee for arbitrary 1 GB scanned documents.
- Only nearby pages are rasterized, but searching a whole document requires extracting its text.
- Windows and Linux have not been tested.
- Local-first architecture: no cloud storage, accounts, or background telemetry.
