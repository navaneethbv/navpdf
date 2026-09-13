# Phase 5: Content placement and decoration

Plan date: September 13, 2026.
Historical milestone: M3.
Execution status is maintained in [the delivery tracker](../DELIVERY-PHASES.md).
Read the [shared implementation and verification contract](README.md) before starting this phase.

## Entry gate

Phases 1 through 4 must pass.
Reuse shared revision history, native jobs and PDF-point placement transforms.

## Current baseline

Initial inserted text/images, decorations, attachments and cover-page creation exist.
Complete object manipulation, link authoring, typography and placement ergonomics remain incomplete.
Verify this baseline against current source before implementation.

## Code areas

- `src/features/editor/ContentEditor.tsx`
- `src/features/decorations/DecorationsDialog.tsx`
- `src/features/attachments/AttachmentsDialog.tsx`
- `src/features/design/DesignTools.tsx`
- `src/services/document-commands.ts`
- `src/types/operations.ts`

Use these existing files as starting points, not a requirement to concentrate all new logic in them.
Add narrowly scoped modules only when the work below needs them.

## Ordered implementation steps

### P5.1: Finish shared placement controls

- [ ] Implement and verify this step.

Implement selection, move, aspect-preserving resize, rotation, delete and layer order for app-inserted objects.
Map viewport coordinates through page rotation and crop transforms.
Support keyboard nudging and accurate preview without making DOM overlays the saved artifact.

Completion evidence: Inserted objects keep their PDF-point geometry after save and zoom changes.

### P5.2: Implement robust text and image insertion

- [ ] Implement and verify this step.

Add multiline text, alignment, wrapping and font selection with glyph coverage and embedding-license checks.
Define Unicode and right-to-left shaping support with fixtures.
Handle PNG/JPEG transparency, resolution and aspect ratio; report unsupported fonts before applying changes.

Completion evidence: No missing glyphs, silent substitutions or image distortion in declared supported cases.

### P5.3: Complete document decorations

- [ ] Implement and verify this step.

Add header/footer slots and page/date/title tokens, text/image watermarks and color/image backgrounds.
Share range preview while retaining distinct object types.
Mark app-owned decoration groups so update/remove affects only their own content.

Completion evidence: Repeated updates do not accumulate duplicates or erase unrelated page content.

### P5.4: Complete Bates numbering

- [ ] Implement and verify this step.

Preview ordered inputs, prefix/suffix, start value, padding and page ranges.
Detect identifier/output collisions and write a manifest of assigned identifiers.
Use the batch output safety model from Phase 4.

Completion evidence: Numbering is deterministic across files and failures are reported per output.

### P5.5: Add safe link and attachment authoring

- [ ] Implement and verify this step.

Create/edit/remove internal destinations and links with an explicit safe URL policy.
Keep external navigation opt-in rather than automatically launching links.
List embedded attachments, handle duplicate names and bounded sizes, and save out only to a selected destination.

Completion evidence: Links navigate correctly; attachment extraction cannot traverse paths or launch content.

### P5.6: Verify saved layout and accessibility

- [ ] Implement and verify this step.

Test mixed geometry, overlapping objects, non-ASCII filenames, embedded fonts and repeated updates.
Inspect layout and editable object selection after reopening in independent readers.

Completion evidence: All tools produce persistent content with accessible placement and dialog controls.

## Acceptance gate

- [ ] Text, images and decoration appearance match previews after independent reopen.
- [ ] Unsupported font/script cases are surfaced before mutation; supported Unicode fixtures retain text extraction.
- [ ] Removing app-owned content preserves existing PDF content and annotations.
- [ ] Links and attachments obey the native privacy and filesystem boundaries.
- [ ] Required automated checks and the relevant native/independent-consumer workflows in the shared contract pass.
- [ ] Update the delivery tracker and verification ledger with source/build identity, artifacts and remaining limitations.

## Decisions and limits

Choose font/shaping support only after embedding and script-coverage evaluation.
Existing arbitrary PDF text/image replacement remains Phase 7 scope.

## First action and handoff

Audit current placement transforms and add rotated/cropped-page insertion fixtures.
Record completed step IDs, failed criteria and the next reproducible action before handing off.
Continue to [Phase 6](06-ocr-exports.md) only after this phase's required gate passes.
