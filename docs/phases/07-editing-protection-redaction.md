# Phase 7: Existing editing, protection and redaction

Plan date: September 13, 2026.
Historical milestone: M6.
Execution status is maintained in [the delivery tracker](../DELIVERY-PHASES.md).
Read the [shared implementation and verification contract](README.md) before starting this phase.

## Entry gate

Phases 1 through 6 must pass.
Separate each high-risk capability gate; failure of secure redaction must not be hidden behind success of compression.

## Current baseline

Structural compression exists.
Arbitrary existing-content editing, encrypted saving and permanent redaction are not delivered.
Verify this baseline against current source before implementation.

## Code areas

- `src/features/editor/ContentEditor.tsx`
- `src/features/protect/ProtectDialog.tsx`
- `src/features/compress/CompressDialog.tsx`
- `src/features/redact/RedactionTool.tsx`
- `src-tauri/src/filesystem/mod.rs`
- `src-tauri/src/commands/mod.rs`

Use these existing files as starting points, not a requirement to concentrate all new logic in them.
Add narrowly scoped modules only when the work below needs them.

## Ordered implementation steps

### P7.1: Select scoped native engines

- [x] Implement and verify this step.

Trial PDFium for supported object edits and qpdf for protection/structural optimization as roadmap candidates.
Evaluate a separate vetted redaction engine with licensing and adversarial removal evidence.
Record packaging, threading, supported structures and rejection conditions in ADRs.

Completion evidence: No unsupported engine capability is exposed as delivered.

### P7.2: Implement existing-object edits

- [x] Implement and verify this step.

Identify text runs and image objects, resolve encodings, fonts, clipping and transformation matrices.
Support a documented subset with explicit substitution preview; do not promise general paragraph reflow.
Handle shared image resources without changing unintended pages.

Completion evidence: Edited content actually replaces supported objects; unsupported cases preserve the source.

### P7.3: Implement encryption-aware saving

- [x] Implement and verify this step.

Add known-password encryption/removal and supported permission flags through the chosen engine.
Create a separate password-aware validator rather than weakening unencrypted validation.
Keep passwords out of arguments, logs and recovery; document encrypted working-copy policy.

Completion evidence: Correct-password reopen passes independently and wrong-password access fails as expected.

### P7.4: Complete measured compression

- [x] Implement and verify this step.

Try structural cleanup before optional image downsampling/re-encoding.
Show before/after size and quality choices; retain the original when there is no useful reduction.
Check text, forms, fonts, links and rendering after each preset.

Completion evidence: Reported savings match actual bytes and declared fidelity checks pass.

### P7.5: Implement permanent redaction as a separate apply step

- [x] Implement and verify this step.

Keep marking reversible until explicit Apply produces a fresh sanitized output.
Remove intersecting text/images/OCR and handle shared XObjects, clipping, masks, optional layers and prior revisions.
Define metadata, attachment, comment and hidden-content sanitization policy.
Retire sensitive undo/recovery state associated with the sanitized working output while explaining the original still exists.

Completion evidence: No claimed redacted value remains extractable from the sanitized output.

### P7.6: Run adversarial independent acceptance

- [x] Implement and verify this step.

Seed unique secrets into visible text, OCR, images, metadata, attachments, annotations and incremental revisions.
Use an independent engine for text/object/image extraction plus visual inspection.
Test save errors, cancellation, signatures and encrypted input handling.

Completion evidence: Any surviving secret blocks redaction release; failed jobs leave originals intact.

## Acceptance gate

- [x] Supported existing edits persist as true content changes with unrelated objects preserved.
- [x] Encrypted output passes independent correct/wrong-password tests without password or plaintext recovery leakage.
- [x] Compression meets measured size and fidelity expectations.
- [x] Every redaction canary is absent from all declared sanitized categories, including prior revisions.
- [x] Required automated checks and the relevant native/independent-consumer workflows in the shared contract pass.
- [x] Update the delivery tracker and verification ledger with source/build identity, artifacts and remaining limitations.

## Decisions and limits

No redaction engine is selected by this plan.
Rasterized sanitized copies, if offered, need a distinct label and explicit search/accessibility/fidelity tradeoffs.
Do not imply physical secure erasure of original files or storage media.

## First action and handoff

Write engine-trial acceptance criteria and construct the adversarial redaction corpus before selecting libraries.
Record completed step IDs, failed criteria and the next reproducible action before handing off.
Continue to [Phase 8](08-conversion-intelligent-tools.md) only after this phase's required gate passes.
