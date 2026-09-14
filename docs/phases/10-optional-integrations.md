# Phase 10: Optional services and specialist compatibility

Plan date: September 13, 2026.
Historical milestone: M8.
Execution status is maintained in [the delivery tracker](../DELIVERY-PHASES.md).
Read the [shared implementation and verification contract](README.md) before starting this phase.

## Entry gate

The supported core release and relevant Phase 9 checks must pass.
Each optional integration needs its own approved scope and architecture; this plan does not authorize sending documents or messages.

## Current baseline

Hosted collaboration, remote signing, cloud storage, and specialist media integrations are declined by ADR-0010.
Local PKCS #12 certificate signing and certification are delivered under ADR-0009 with independent verification evidence.
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

- [x] Implement and verify this step.

Create an ADR per hosted review, remote signing, certification, media or external design integration.
Specify supported actions, data destination, retention, credentials, deletion, offline behavior and licensing.
Keep unavailable packages absent or accurately labeled.

Completion evidence: Product scope and trust boundaries are explicit before any service code or account setup.
Current evidence: ADR-0009 approves local PKCS #12 certificate signing and certification.
ADR-0010 explicitly declines hosted collaboration, remote signing, cloud storage, and specialist media to protect offline privacy.

### P10.2: Implement a constrained remote-service boundary

- [x] Implement and verify this step (offline boundary enforced per ADR-0010).

Add proposed native service modules only for approved providers.
Use scoped credentials, per-action document/recipient preview, retry-safe identifiers and limited endpoints.
Do not broadly relax renderer networking or permit document-driven tool execution.

Completion evidence: Every transmission is intentional, attributable to the requested workflow and safely retryable.
Current evidence: Strict offline network boundary enforced; no remote service modules or credentials exist.

### P10.3: Deliver hosted review and sharing

- [x] Evaluated and declined per ADR-0010.

Support versioned documents, permissioned links, comment synchronization, conflicts, revocation and retention/deletion.
Keep local-copy exchange from Phase 2 usable offline.

Completion evidence: Revoked access fails and concurrent comments resolve without silent loss or cross-document leakage.
Current evidence: Hosted review is declined per ADR-0010.
Local offline comment exchange from Phase 2 remains the verified review mechanism.

### P10.4: Deliver remote signature requests

- [x] Evaluated and declined per ADR-0010.

Implement recipient roles/order, field assignment, expiry, cancellation, authenticated access and envelope status.
Preview the exact document and recipients before sending; distinguish provider status from verified signature validity.

Completion evidence: Duplicate retries do not send multiple envelopes and canceled requests cannot continue signing.
Current evidence: Cloud-hosted signature workflows are declined per ADR-0010.

### P10.5: Implement certificate signatures and certification

- [x] Implement and verify this step (ADR-0009).

Support byte ranges, allowed subsequent changes, certificate chains, trust status and optional timestamps.
Protect private keys through the chosen secure mechanism.
Verify saved outputs with an independent signature validator and surface invalidating edits.

Completion evidence: Certification wording appears only for independently valid certificate-based output.
Current evidence: Delivered in `src-tauri/src/engine/sign.rs`, `src/features/signatures/CertificateSignature.tsx`, and `src/services/engine.ts`.
Supports RSA and ECDSA P-256 keys, PKCS #12 keystores, DocMDP levels 1 to 3, and PAdES baseline B-B profiles.
All 55 checks in `node scripts/phase10-acceptance.mjs` pass.

### P10.6: Trial specialist media and article threads

- [x] Evaluated and declined per ADR-0010.

Evaluate video, audio, 3D and article-thread authoring, preservation and playback separately.
Define codec/container limits and cross-reader support without enabling scripts or automatic attachment execution.
Reject unsupported playback instead of implying that preservation equals rendering.

Completion evidence: Compatibility matrix distinguishes supported authoring, playback and preservation.
Current evidence: Specialist media embedding and execution are declined per ADR-0010 to prevent sandbox escapes and script vulnerabilities.

### P10.7: Evaluate external design integration and release

- [x] Evaluated and declined per ADR-0010.

Use a supported integration route for external design tools only after destination/processing approval.
Label ordinary exports accurately when no integration exists.
Repeat affected security, native, privacy and Phase 9 distribution checks for each enabled package.

Completion evidence: Optional features can be disabled without breaking core local workflows.
Current evidence: External SaaS design bridges are declined per ADR-0010; standard local exports retain precise technical labels.

## Acceptance gate

- [x] Each enabled package has an approved data-flow/retention design, scoped credentials and explicit transmission workflow.
- [x] No declined remote package is represented as an enabled integration; remote access revocation and delivery retry tests are therefore not applicable.
- [x] Certificate outputs pass independent validation; signature appearances are never called certification.
- [x] Media/design claims match measured cross-reader behavior and core offline functionality remains intact.
- [x] Required automated checks and the relevant native/independent-consumer workflows in the shared contract pass.
- [x] Update the delivery tracker and verification ledger with source/build identity, artifacts and remaining limitations.

## Decisions and limits

Providers, backend architecture, account model, retention, trust services, codecs and specialist engines remain unselected.
Declining an optional integration should be recorded as a scope decision, not implemented as a fake control.

## First action and handoff

Select one optional package and approve its architecture before creating provider-specific modules.
Record completed step IDs, failed criteria and the next reproducible action before handing off.
Each optional package must repeat affected release checks before publication.
