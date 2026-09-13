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

- [ ] Implement and verify this step.

Extend the existing command/session boundary with base revision identity and explicit PDF-point geometry.
Commit pending PDF.js editor input before serialization; stage, validate and attach candidate bytes before changing active ownership.
Use bounded snapshots for unsupported-operation undo and preserve native PDF.js undo where safe.
Reject stale work; record how annotation history interacts with saved revision identity.

Completion evidence: Mixed native and adapter edits undo/redo in order without resurrecting stale bytes.

### P2.2: Implement text markup and notes

- [ ] Implement and verify this step.

Add standard underline, strike-through and sticky-note objects with appearances, author, contents, color and opacity.
Support multi-line text selection with correct quad geometry on rotated and cropped pages.
Use a small native adapter only where the current engine cannot produce compatible output.

Completion evidence: Each annotation type survives save/reopen with matching text, position and properties.

### P2.3: Implement shapes and drawing properties

- [ ] Implement and verify this step.

Add rectangle, ellipse, line and arrow selection, move, resize, rotation where applicable, stroke width and opacity.
Keep freehand ink and freehand highlighting as distinct modes.
Provide accessible property editing, Escape behavior and keyboard deletion.

Completion evidence: Shapes persist as actual PDF annotations and remain selectable after reopening.

### P2.4: Synchronize the comment workflow

- [ ] Implement and verify this step.

Maintain stable annotation identity and update the sidebar from unsaved edits.
Support navigation, edit and delete without requiring reopen.
Add replies/resolution only with an explicitly documented interoperable representation.

Completion evidence: Comment count, contents and selected annotation stay synchronized through undo/redo.

### P2.5: Finish snapshot and local review exchange

- [ ] Implement and verify this step.

Capture a selected rendered region at a bounded resolution with clipboard and file choices.
Export an annotated copy and implement comment import with document identity validation and duplicate detection.
Keep local exchange separate from hosted sharing.

Completion evidence: Snapshots do not mutate the PDF; repeated comment import does not duplicate existing comments.

### P2.6: Run native annotation acceptance

- [ ] Implement and verify this step.

Build a corpus covering every type, rotated/cropped pages, overlaps and non-ASCII comments.
Exercise keyboard-only authoring, properties, delete, undo, redo and independent reopen.

Completion evidence: Every supported annotation is visually readable and semantically inspectable in the declared consumers.

## Acceptance gate

- [ ] Every supported type survives save, close and reopen in NavPDF, Preview and Acrobat where compatibility is claimed.
- [ ] Repeated edit/save cycles do not duplicate annotations or alter unrelated existing objects.
- [ ] Undo to the saved revision clears dirty state; redo restores it.
- [ ] The comment list reflects unsaved changes and annotation properties remain accessible.
- [ ] Required automated checks and the relevant native/independent-consumer workflows in the shared contract pass.
- [ ] Update the delivery tracker and verification ledger with source/build identity, artifacts and remaining limitations.

## Decisions and limits

Record an ADR for unsupported annotation serialization if an adapter is required.
Do not require Phase 4 to create basic revision guards; Phase 4 extends and audits this same implementation.

## First action and handoff

Inspect the existing editor history and implement P2.1 before enabling additional toolbar controls.
Record completed step IDs, failed criteria and the next reproducible action before handing off.
Continue to [Phase 3](03-forms-fill-sign.md) only after this phase's required gate passes.
