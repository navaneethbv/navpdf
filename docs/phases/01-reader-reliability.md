# Phase 1: Reader reliability and file safety

Plan date: September 13, 2026.
Historical milestone: M0.
Execution status is maintained in [the delivery tracker](../DELIVERY-PHASES.md).
Read the [shared implementation and verification contract](README.md) before starting this phase.

## Entry gate

This is the active phase; no later phase may be marked complete until its acceptance gate passes.

## Current baseline

The reader, native file dialogs, atomic saves and recovery exist.
The delivery tracker records 240 frontend tests, 10 Rust tests and passing lint, typecheck, build and Clippy at the reviewed baseline.
Those results are historical evidence, not a substitute for checks after a fix.
P1-01 reproduces a freehand highlight that is readable in NavPDF but opaque in Preview.
Verify this baseline against current source before implementation.

## Code areas

- `src/app/useDocumentSession.ts`
- `src/features/viewer/controller.ts`
- `src/features/viewer/ViewerHost.tsx`
- `src/services/native.ts`
- `src-tauri/src/commands/mod.rs`
- `src-tauri/src/filesystem/mod.rs`
- `tests/unit/document-session-native.test.ts`
- `tests/integration/pdf-roundtrip.test.ts`

Use these existing files as starting points, not a requirement to concentrate all new logic in them.
Add narrowly scoped modules only when the work below needs them.

## Ordered implementation steps

### P1.1: Resolve P1-01 first

- [x] Implement and verify this step.

Repeat the native reproduction with both text-selection and freehand highlights; inspect annotation subtype, opacity and appearance resources in saved bytes.
Compare Preview and NavPDF rendering before choosing an output fix; the root cause is not yet established.
Restrict any compatibility transformation to annotations created or edited by NavPDF and preserve unrelated objects.
Add a saved-object regression and repeat the 500-page native round trip.

Completion evidence: Readable highlights in both consumers; object inspection identifies exactly what changed.

### P1.2: Verify session replacement and cancellation

- [x] Implement and verify this step.

Exercise dirty A, Open B, Discard, then cancel the picker or choose a damaged file.
Exercise parser failure, late viewer attachment failure and cleanup failure separately.
Keep ownership, dirty state, visible revision and recovery consistent until replacement commits.

Completion evidence: A remains recoverable after failure; successful replacement releases only retired resources.

### P1.3: Complete Save and Save As acceptance

- [x] Implement and verify this step.

Verify cancellation, new destination, existing destination, renamed display metadata, actual saved size, recent entry and remembered page.
Test external modification before save and a competing new destination created after selection.
Retain immutable source range lengths independently of output metadata.

Completion evidence: Original data survives rejected saves; successful outputs reopen with correct metadata.

### P1.4: Complete close, quit and recovery acceptance

- [x] Implement and verify this step.

Test Cancel, Save and Discard from both close and quit.
Use synthetic dirty edits, wait for a completed recovery write, interrupt the test process and relaunch.
Check failed recovery load, recovery Save As cancellation, successful recovery Save As and cleanup only after the intended commit.

Completion evidence: No silent loss of edits; recovery belongs to the correct document and survives failed recovery actions.

### P1.5: Add bounded filesystem failure coverage

- [x] Implement and verify this step.

Start with native reproduction on a disposable constrained destination when available.
Add a narrowly scoped test seam for write, flush and persistence errors; inject disk-full behavior without filling the user's drive.
Check permissions, validation failures, destination collisions, original byte identity and cleanup of job-owned temporary files.

Completion evidence: Failure leaves no partial destination and retains unsaved/recovery state; production writes retain their existing safety checks.

### P1.6: Rebuild and reconcile evidence

- [x] Implement and verify this step.

Rebuild and relaunch the exact app bundle after fixes.
Record source revision, executable hash, synthetic inputs, screenshots and output hashes.
Keep the residual existing-file fingerprint-to-rename race and incomplete ACL/extended-attribute preservation explicit.

Completion evidence: Tracker and verification ledger agree; no outstanding Phase 1 failure is marked passed.

## Acceptance gate

- [x] 500-page search, highlight, Save As, close and reopen succeed in NavPDF and Preview; use Acrobat as an additional compatibility check when available.
- [x] Each cancellation, recovery and failed-save case retains the expected document, dirty state and bytes.
- [x] No unencrypted recovery is produced from encrypted inputs, which remain read-only.
- [x] The corrected toolbar renders without overlap at supported window sizes and with keyboard navigation.
- [x] Required automated checks and the relevant native/independent-consumer workflows in the shared contract pass.
- [x] Update the delivery tracker and verification ledger with source/build identity, artifacts and remaining limitations.

## Decisions and limits

Choose the smallest interoperable highlight fix only after comparing both annotation types.
Do not introduce a universal PDF rewrite or a new rendering engine solely to work around an unverified hypothesis.

## First action and handoff

Begin with P1.1 using the saved P1-01 artifact and fixture documented in the delivery tracker.
Record completed step IDs, failed criteria and the next reproducible action before handing off.
Continue to [Phase 2](02-local-annotations.md) only after this phase's required gate passes.
