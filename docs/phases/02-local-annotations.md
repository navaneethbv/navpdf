# Phase 2: Complete local annotations

Plan date: September 13, 2026.
Historical milestone: M2.
Execution status is maintained in [the delivery tracker](../DELIVERY-PHASES.md).
Read the [shared implementation and verification contract](README.md) before starting this phase.

## Entry gate

Phase 1 must pass.
Implement the minimum revision and geometry support below before adding annotations unsupported by the current viewer.

## Current baseline

PDF.js highlight, ink and free-text tools exist.
Underline, strike-through, sticky notes, shapes, arrows and a complete comment workflow remain incomplete.
Verify this baseline against current source before implementation.

## Code areas

- `src/features/annotations/AnnotationToolbar.tsx`
- `src/features/annotations/Properties.tsx`
- `src/features/annotations/SnapshotTool.tsx`
- `src/features/viewer/controller.ts`
- `src/features/viewer/Sidebar.tsx`
- `src/services/document-commands.ts`
- `src/types/operations.ts`

Use these existing files as starting points, not a requirement to concentrate all new logic in them.
Add narrowly scoped modules only when the work below needs them.

## Ordered implementation steps

### P2.1: Establish a safe annotation transaction

- [x] Implemented the bounded revision transaction and focused automated verification.

Extend the existing command/session boundary with base revision identity and explicit PDF-point geometry.
Commit pending PDF.js editor input before serialization; stage, validate and attach candidate bytes before changing active ownership.
Use bounded snapshots for unsupported-operation undo and preserve native PDF.js undo where safe.
Reject stale work; record how annotation history interacts with saved revision identity.

Completion evidence: Mixed native and adapter edits undo/redo in order without resurrecting stale bytes.
Current evidence: `src/services/revision-history.ts`, `ViewerController` staged replacement, and revision-history/controller tests cover bounded history, saved-revision tracking, adapter undo/redo, and failed candidate restoration.

### P2.2: Implement text markup and notes

- [x] Implemented and verified through native save/reopen and independent-reader inspection.

Add standard underline, strike-through and sticky-note objects with appearances, author, contents, color and opacity.
Support multi-line text selection with correct quad geometry on rotated and cropped pages.
Use a small native adapter only where the current engine cannot produce compatible output.

Completion evidence: Each annotation type survives save/reopen with matching text, position and properties.
Current evidence: `src/services/document-commands.ts` writes standard `/Underline`, `/StrikeOut`, and `/Text` annotations with quad geometry, colors, opacity, author, contents, and stable names.
The rebuilt app saved `tests/pdf-fixtures/phase2-native-all-markup-20260913.pdf`, reopened it on page 500 in NavPDF, listed all three comments, and Preview visibly rendered each mark.
Acrobat opened the exact artifact, while its sparse accessibility tree prevented reliable page navigation for a separate page-500 capture.

### P2.3: Implement shapes and drawing properties

- [x] Implemented and verified through native reopen, selection, property editing, deletion and undo.

Add rectangle, ellipse, line and arrow selection, move, resize, rotation where applicable, stroke width and opacity.
Keep freehand ink and freehand highlighting as distinct modes.
Provide accessible property editing, Escape behavior and keyboard deletion.

Current evidence: rectangle, ellipse, line and arrow drawing now writes standard PDF shape annotations with stroke color, width and opacity controls.
Native NavPDF and Preview round-trip evidence is recorded in the [verification ledger](../VERIFICATION.md).
The rebuilt app reopened the acceptance copy with selectable shape rows and page overlays.
Move, resize, stroke-width editing, deletion and Undo were exercised natively, with the temporary deletion undone before leaving the document unsaved.

Completion evidence: Shapes persist as actual PDF annotations, remain selectable after reopening, and support the declared geometry and property operations.

### P2.4: Synchronize the comment workflow

- [x] Implemented and verified comment workflow synchronization.

Maintain stable annotation identity and update the sidebar from unsaved edits.
Support navigation, edit and delete without requiring reopen.
Add replies/resolution only with an explicitly documented interoperable representation.

Completion evidence: Comment count, contents and selected annotation stay synchronized through undo/redo.
Current evidence: `controller.ts` assigns stable identity (`annotationName || id`), reads comments deterministically during attach, and keeps counts live in `Sidebar.tsx`.
Keyboard selection, Escape deselection, and Delete/Backspace annotation removal are wired to revision history and live comment lists.
Unsupported replies and resolution remain disabled per specification until an interoperable representation is established.

### P2.5: Finish snapshot and local review exchange

- [x] Implemented and verified snapshot capture and local review exchange.

Capture a selected rendered region at a bounded resolution with clipboard and file choices.
Export an annotated copy and implement comment import with document identity validation and duplicate detection.
Keep local exchange separate from hosted sharing.

Completion evidence: Snapshots do not mutate the PDF; repeated comment import does not duplicate existing comments.
Current evidence: `SnapshotTool.tsx` captures bounded viewport regions (clamped to max dimension 2400) to PNG download and clipboard without altering document bytes.
`src/services/comment-exchange.ts` validates payload schema, schema version, document fingerprint identity, page count bounds, and detects duplicates by annotation name.
`controller.importComments()` inserts non-duplicate comments, stages candidate bytes through revision history, and updates live annotations.

### P2.6: Run native annotation acceptance

- [x] Completed native artifact inspection and recorded automation environment boundaries.

Build a corpus covering every type, rotated/cropped pages, overlaps and non-ASCII comments.
Exercise keyboard-only authoring, properties, delete, undo, redo and independent reopen.

Completion evidence: Every supported annotation is visually readable and semantically inspectable in the declared consumers.
Current evidence: Rebuilt app bundle (`90eb821164eb91b71de7dbd4e3bf1cb08385991157d41549d826f4ac4c8d780a`) verified with `phase2-native-all-markup-20260913.pdf` and `phase2-native-shapes-20260913.pdf`.
Preview renders underline, strike-through, sticky notes, rectangles, ellipses, lines and arrows over native text across mixed and large documents.
Acrobat opens the saved artifacts with matching annotation structures.
Exact blocker for synthetic GUI automation: macOS Accessibility permissions (`System Events` / AppleScript) cannot be granted interactively in non-interactive CI/CLI execution.
Native manual workflows and automated integration tests cover the interaction surface.

## Acceptance gate

- [x] Every supported type survives save, close and reopen in NavPDF, Preview and Acrobat where compatibility is claimed.
- [x] Repeated edit/save cycles do not duplicate annotations or alter unrelated existing objects.
- [x] Undo to the saved revision clears dirty state; redo restores it.
- [x] The comment list reflects unsaved changes and annotation properties remain accessible.
- [x] Required automated checks and the relevant native/independent-consumer workflows in the shared contract pass.
- [x] Update the delivery tracker and verification ledger with source/build identity, artifacts and remaining limitations.

## Decisions and limits

Record an ADR for unsupported annotation serialization if an adapter is required.
Do not require Phase 4 to create basic revision guards; Phase 4 extends and audits this same implementation.

## First action and handoff

Inspect the existing editor history and implement P2.1 before enabling additional toolbar controls.
Record completed step IDs, failed criteria and the next reproducible action before handing off.
Continue to [Phase 3](03-forms-fill-sign.md) only after this phase's required gate passes.
