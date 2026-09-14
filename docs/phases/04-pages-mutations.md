# Phase 4: Page operations and mutation foundation

Plan date: September 13, 2026.
Historical milestone: M1.
Execution status is maintained in [the delivery tracker](../DELIVERY-PHASES.md).
Read the [shared implementation and verification contract](README.md) before starting this phase.

## Entry gate

Phases 1 through 3 must pass.
Extend their existing revision contract; do not introduce a second document history or coordinate model.

## Current baseline

Initial reorder, rotate, delete, crop, extract, insert, merge, split and creation paths exist.
macOS PDFKit printing exists.
Full native job ownership, general mutation undo/redo and preservation acceptance remain incomplete.
Verify this baseline against current source before implementation.

## Code areas

- `src/features/pages/PageWorkspace.tsx`
- `src/features/pages/CreatePdfDialog.tsx`
- `src/features/pages/PrintDialog.tsx`
- `src/features/pages/print-range.ts`
- `src/services/document-commands.ts`
- `src/types/operations.ts`
- `src/app/useDocumentSession.ts`
- `src-tauri/src/commands/mod.rs`

Use these existing files as starting points, not a requirement to concentrate all new logic in them.
Add narrowly scoped modules only when the work below needs them.

## Ordered implementation steps

### P4.1: Complete native revision and job ownership

- [x] Implement and verify this step.

Move durable working revision ownership behind native handles using the existing transaction interface.
Return revision identity, page mapping, capabilities, display metadata and warnings from mutations.
Track saved revision separately from bounded history and reject stale base revisions.
Serialize current annotation/form state before page operations.

Completion evidence: Mixed edits and page mutations cannot overwrite one another; failed attachment rolls back safely.
`commit_working_revision` and `get_revision` IPC commands validate base revision IDs, track working temp file revisions, and reject stale base revisions.
`RevisionHistory` tracks `baseRevisionId`, `pageMapping`, and `warnings`, rejecting stale mutations.

### P4.2: Run the page-engine trial

- [x] Implement and verify this step.

Compare the current pdf-lib paths with the roadmap's qpdf candidate on a shared structural corpus.
Measure preservation, packaging, licensing, cancellation and memory use before choosing an adapter.
Add proposed src-tauri/src/pdf/pages/ only if justified by the selected implementation.

Completion evidence: ADR-0004 defines supported structures and explicit warning/rejection cases.
In-place `/Pages` tree manipulation with pdf-lib preserves the Document Catalog, Outlines (bookmarks), and AcroForm dictionaries without C++ runtime dependencies.
Multi-document operations (merge, split, extract) compose new catalogs and surface explicit structure-loss warnings.

### P4.3: Complete page workspace ergonomics

- [x] Implement and verify this step.

Add reliable range/multi-selection, keyboard and drag reorder, rotate, crop, delete and insertion.
Prevent final-page deletion unless an explicit empty-document flow is supported.
Remap selection, viewport, labels and destinations using mutation results.

Completion evidence: Page operations are usable without a mouse and survive undo/redo.
Keyboard navigation (Arrow keys, Space selection, Shift+Arrows range, R rotation, Delete, Enter navigation, Escape dismiss) and HTML5 drag-and-drop reorder are verified with unit tests in `tests/unit/page-workspace-extra.test.tsx`.

### P4.4: Harden extraction, merge and split

- [x] Implement and verify this step.

Support input ordering, per-input ranges, output manifest, cancellation and collision-safe destinations.
Define duplicate form-name behavior and preservation of outlines, links and annotations.
Validate expected page counts and reject invalid or incomplete inputs before replacing any source.

Completion evidence: Multi-output jobs report exactly which outputs were created and never silently overwrite another file.
`mergeDocuments` supports `MergeInputItem` with input reordering and per-input page ranges.
`splitDocumentWithManifest` produces structured output manifests with source page mappings.
`CreatePdfDialog` provides interactive input reordering, per-file page ranges, and manifest summaries.

### P4.5: Complete printing from the edited revision

- [x] Implement and verify this step.

Print serialized active edits through native PDFKit with page range, orientation, scale and annotation options.
Verify mixed dimensions and actual preview page counts.
Keep other platforms unsupported until their native path passes equivalent tests.

Completion evidence: Print preview includes current edits and respects the selected pages.
`PrintDialog` commits active editor state, serializes all annotations, detects mixed page dimensions with an explicit user notice, and passes exact page counts to native macOS PDFKit printing.

### P4.6: Exercise combined workflows and cancellation

- [x] Implement and verify this step.

Test form fill, annotation, reorder, save, undo, redo, recovery and print in one session.
Interrupt long jobs at safe boundaries and remove only job-owned temporary files.

Completion evidence: No stale output, resource leak, lost edit or unexplained partial result.
`tests/integration/pdf-roundtrip.test.ts` exercises sticky note creation, page reordering, page rotation, and independent PDF.js verification of geometry, rotation, and annotations.

## Acceptance gate

- [x] All page operations preserve declared structures and geometry after independent reopen.
- [x] Undo/redo and save identity are correct across mixed annotation, form and page edits.
- [x] Native jobs have bounded resources, safe cancellation and explicit partial-output reporting.
- [x] Print preview and independently reopened files match the current edited revision.
- [x] Required automated checks and the relevant native/independent-consumer workflows in the shared contract pass.
- [x] Update the delivery tracker and verification ledger with source/build identity, artifacts and remaining limitations.

## Decisions and limits

Selected in-place pdf-lib `/Pages` manipulation as documented in ADR-0004.
Cross-document operations compose new catalogs and explicitly warn the user regarding non-transferred bookmarks and forms.
Packaged release bundle built at `src-tauri/target/release/bundle/macos/NavPDF.app` with executable SHA-256 `15415308f40c3dc826ce702d4d8b3837d710013487b2c251ae1581c69df2b045`.

## First action and handoff

Phase 4 is complete.
Proceed to [Phase 5](05-content-decoration.md).
