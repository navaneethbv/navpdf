# Phase 10: Optional services and specialist compatibility

Plan date: September 13, 2026.
Historical milestone: M8.
Execution status is maintained in [the delivery tracker](../DELIVERY-PHASES.md).
Read the [shared implementation and verification contract](README.md) before starting this phase.

## Entry gate

The supported core release and relevant Phase 9 checks must pass.
Each optional integration needs its own approved scope and architecture; this plan does not authorize sending documents or messages.

## Current baseline

Hosted collaboration, remote signing, certificate certification and specialist media integrations are not delivered.
The core application remains local-first with no accounts or automatic uploads.
Verify this baseline against current source before implementation.

## Code areas

- `src/features/tools/ToolPanel.tsx`
- `src/features/signatures/FillAndSign.tsx`
- `src/features/settings/Settings.tsx`
- `src/services/native.ts`
- `src-tauri/src/security/mod.rs`
- `src-tauri/tauri.conf.json`
- `docs/adr/README.md`

Use these existing files as starting points, not a requirement to concentrate all new logic in them.
Add narrowly scoped modules only when the work below needs them.

## Ordered implementation steps

### P10.1: Choose independent optional work packages

- [ ] Implement and verify this step.

Create an ADR per hosted review, remote signing, certification, media or external design integration.
Specify supported actions, data destination, retention, credentials, deletion, offline behavior and licensing.
Keep unavailable packages absent or accurately labeled.

Completion evidence: Product scope and trust boundaries are explicit before any service code or account setup.

### P10.2: Implement a constrained remote-service boundary

- [ ] Implement and verify this step.

Add proposed native service modules only for approved providers.
Use scoped credentials, per-action document/recipient preview, retry-safe identifiers and limited endpoints.
Do not broadly relax renderer networking or permit document-driven tool execution.

Completion evidence: Every transmission is intentional, attributable to the requested workflow and safely retryable.

### P10.3: Deliver hosted review and sharing

- [ ] Implement and verify this step.

Support versioned documents, permissioned links, comment synchronization, conflicts, revocation and retention/deletion.
Keep local-copy exchange from Phase 2 usable offline.

Completion evidence: Revoked access fails and concurrent comments resolve without silent loss or cross-document leakage.

### P10.4: Deliver remote signature requests

- [ ] Implement and verify this step.

Implement recipient roles/order, field assignment, expiry, cancellation, authenticated access and envelope status.
Preview the exact document and recipients before sending; distinguish provider status from verified signature validity.

Completion evidence: Duplicate retries do not send multiple envelopes and canceled requests cannot continue signing.

### P10.5: Implement certificate signatures and certification

- [ ] Implement and verify this step.

Support byte ranges, allowed subsequent changes, certificate chains, trust status and optional timestamps.
Protect private keys through the chosen secure mechanism.
Verify saved outputs with an independent signature validator and surface invalidating edits.

Completion evidence: Certification wording appears only for independently valid certificate-based output.

### P10.6: Trial specialist media and article threads

- [ ] Implement and verify this step.

Evaluate video, audio, 3D and article-thread authoring, preservation and playback separately.
Define codec/container limits and cross-reader support without enabling scripts or automatic attachment execution.
Reject unsupported playback instead of implying that preservation equals rendering.

Completion evidence: Compatibility matrix distinguishes supported authoring, playback and preservation.

### P10.7: Evaluate external design integration and release

- [ ] Implement and verify this step.

Use a supported integration route for external design tools only after destination/processing approval.
Label ordinary exports accurately when no integration exists.
Repeat affected security, native, privacy and Phase 9 distribution checks for each enabled package.

Completion evidence: Optional features can be disabled without breaking core local workflows.

## Acceptance gate

- [ ] Each enabled service has an approved data-flow/retention design, scoped credentials and explicit transmission workflow.
- [ ] Access revocation, deletion, retry behavior and recipient/document isolation pass integration tests.
- [ ] Certificate outputs pass independent validation; signature appearances are never called certification.
- [ ] Media/design claims match measured cross-reader behavior and core offline functionality remains intact.
- [ ] Required automated checks and the relevant native/independent-consumer workflows in the shared contract pass.
- [ ] Update the delivery tracker and verification ledger with source/build identity, artifacts and remaining limitations.

## Decisions and limits

Providers, backend architecture, account model, retention, trust services, codecs and specialist engines remain unselected.
Declining an optional integration should be recorded as a scope decision, not implemented as a fake control.

## First action and handoff

Select one optional package and approve its architecture before creating provider-specific modules.
Record completed step IDs, failed criteria and the next reproducible action before handing off.
Each optional package must repeat affected release checks before publication.
