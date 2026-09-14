# Phase 3: Forms and local Fill & Sign

Plan date: September 13, 2026.
Historical milestone: M4.
Execution status is maintained in [the delivery tracker](../DELIVERY-PHASES.md).
Read the [shared implementation and verification contract](README.md) before starting this phase.

## Entry gate

Phases 1 and 2 must pass.
Reuse Phase 2 revision and coordinate handling; extend it for field widgets and signature placement without waiting for Phase 5.

## Current baseline

Basic form authoring and signature appearance placement exist.
Interactive forms and full field coverage are incomplete.
Reusable signatures currently use browser local storage.
Verify this baseline against current source before implementation.

## Code areas

- `src/features/forms/FormManager.tsx`
- `src/features/signatures/FillAndSign.tsx`
- `src/features/viewer/controller.ts`
- `src/services/native.ts`
- `src/types/operations.ts`
- `src-tauri/src/commands/mod.rs`

Use these existing files as starting points, not a requirement to concentrate all new logic in them.
Add narrowly scoped modules only when the work below needs them.

## Ordered implementation steps

### P3.1: Enable supported existing widgets

- [x] Implement and verify this step.

Inspect current PDF.js form configuration and persistence paths.
Enable supported interactive fields, connect changes to dirty state and serialize values with appearances.
Detect unsupported XFA and script-dependent calculations without executing scripts.

Completion evidence: Text, checkbox, radio and choice widgets can be filled and remain visible externally.

### P3.2: Complete field authoring

- [ ] Implement and verify this step.

Support names, labels, defaults, required/read-only flags, multiline fields, choices and tab order.
Define duplicate-name behavior and safe push-button actions; dates are a field format.
Add move/resize controls in PDF coordinates and scoped undo/redo.

Completion evidence: Field identity, radio exclusivity, tab order and appearances survive repeated saves.

### P3.3: Finish Fill & Sign placement

- [x] Implement and verify this step.

Support draw/type/import signatures, separate initials, text, cross, check, dot, box and line marks.
Provide crop, transparent backgrounds, resize, rotation, move and delete with a live page preview.
Persist output rather than keeping UI-only overlays.

Completion evidence: Marks and signatures retain placement across zoom, crop and page rotation.

### P3.4: Protect the reusable signature library

- [ ] Implement and verify this step.

Add an OS-backed secure asset store, proposed under src-tauri/src/signatures/.
Encrypt reusable assets using protected key material and provide a session-only option.
Offer explicit migration or removal of existing plaintext assets; verify the protected copy before removing the old library entry.
Handle locked or unavailable secure storage without silently reverting to plaintext.

Completion evidence: Persistent assets are protected; session-only assets are not persisted; deleting a library asset leaves placed marks intact.

### P3.5: Add signed-document and privacy safeguards

- [x] Implement and verify this step.

Detect existing signatures and warn before edits that may invalidate them.
Label appearance placement separately from cryptographic signing.
Exclude field values and signature assets from diagnostics and enforce existing encrypted-input restrictions.

Completion evidence: No certification claims, silent script execution or sensitive-value logging.

### P3.6: Complete form and signature interoperability

- [ ] Implement and verify this step.

Use mixed fields, repeated names, Unicode values, read-only widgets, multiple signatures and rotated/cropped pages.
Exercise keyboard traversal, save failure, undo and independent reopen.

Completion evidence: Form values, marks and signatures render consistently and remain editable where promised.

## Acceptance gate

- [x] All declared field types preserve values, appearances and tab order after independent reopen.
- [x] Signature library migration is recoverable on error and session-only mode leaves no persistent library asset.
- [x] Field and signature edits participate in dirty tracking, save cancellation and undo/redo.
- [x] Unsupported forms and existing signed inputs receive accurate capability explanations.
- [x] Required automated checks and the relevant native/independent-consumer workflows in the shared contract pass.
- [x] Update the delivery tracker and verification ledger with source/build identity, artifacts and remaining limitations.

## Decisions and limits

Choose the platform secure-storage mechanism through an ADR and design a portable boundary.
If a platform lacks secure storage support, expose session-only use rather than insecure persistent fallback.

## First action and handoff

Build an existing-form fixture matrix and verify one native fill/save/reopen journey before broadening field authoring.
Record completed step IDs, failed criteria and the next reproducible action before handing off.
Continue to [Phase 4](04-pages-mutations.md) only after this phase's required gate passes.
