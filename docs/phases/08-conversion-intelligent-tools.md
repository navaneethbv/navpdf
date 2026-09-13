# Phase 8: Office conversion and local intelligent tools

Plan date: September 13, 2026.
Historical milestone: M7.
Execution status is maintained in [the delivery tracker](../DELIVERY-PHASES.md).
Read the [shared implementation and verification contract](README.md) before starting this phase.

## Entry gate

Phases 1 through 7 must pass.
Model/provider downloads and external processing are decision gates, not implied by planning or tool selection.

## Current baseline

HTML outlines, CSV extraction, an extractive page index and template cover pages exist.
Genuine Office conversion, translation and model-backed generation remain incomplete.
Verify this baseline against current source before implementation.

## Code areas

- `src/features/convert/OfficeExport.tsx`
- `src/features/design/DesignTools.tsx`
- `src/features/assistant/AssistantPanel.tsx`
- `src/services/native.ts`
- `src/types/operations.ts`

Use these existing files as starting points, not a requirement to concentrate all new logic in them.
Add narrowly scoped modules only when the work below needs them.

## Ordered implementation steps

### P8.1: Select conversion and model capabilities

- [ ] Implement and verify this step.

Score local conversion candidates on paragraphs, columns, tables, equations, charts, images and multilingual text.
Separately assess inference/speech engines for quality, license, hardware memory and offline distribution.
Record thresholds before scoring and keep failed capabilities unavailable.

Completion evidence: ADRs define engines, supported formats, quality limits and installation requirements.

### P8.2: Deliver real Office import/export

- [ ] Implement and verify this step.

Generate valid DOCX, PPTX, XLSX and scoped RTF outputs with editable content where claimed.
Separate rasterized-slide output from editable conversion.
Preview table extraction, numeric/date types and formula-safe cell handling.
Run imports in bounded isolation with macros and external resource loading disabled.

Completion evidence: Files open in an independent Office-compatible application and preserve declared editable content.

### P8.3: Build local document collections and indexing

- [ ] Implement and verify this step.

Add proposed src/features/spaces/ for local references, notes and optional indexes.
Track document identity/revision and page-referenced chunks.
Invalidate or delete stale indexes on document replacement/removal and handle missing source files.

Completion evidence: Citations navigate to the correct source revision and deleted content is removed from indexes.

### P8.4: Implement grounded assistant and summaries

- [ ] Implement and verify this step.

Use retrieved page references, explicit insufficient-evidence responses, length controls and cancellation.
Treat PDF text as untrusted data and never as permission to run tools or alter files.
Keep local model availability visible without automatic downloads.

Completion evidence: Answers and exported summaries include testable source references and fail safely without a model.

### P8.5: Implement translation and design copies

- [ ] Implement and verify this step.

Map extracted/OCR text blocks to translated layout with font shaping, overflow preview and original-page references.
Extend existing templates and cover insertion rather than duplicating placement tooling.
Preserve the source and label reconstruction limits.

Completion evidence: Translated/stylized copies are real PDFs with reviewed layout and accessible text where supported.

### P8.6: Deliver presentations and podcasts

- [ ] Implement and verify this step.

Generate a reviewable cited outline before editable slides and an editable script before local speech synthesis.
Export genuine presentation and playable audio files with explicit language/voice availability.
Test cancellation, missing runtime and output failures.

Completion evidence: No HTML file masquerades as PPTX; no text-only output is labeled generated audio.

### P8.7: Validate privacy and quality

- [ ] Implement and verify this step.

Use a held-out corpus for grounding, translation, tables and artifact fidelity.
Inspect network activity and deletion behavior; verify model absence, resource bounds and no stale result attachment.

Completion evidence: Declared quality thresholds pass without undeclared network traffic or retained deleted indexes.

## Acceptance gate

- [ ] Office outputs validate as their actual formats and open independently with the promised editability.
- [ ] Citation destinations are correct and unsupported questions receive an insufficient-evidence response.
- [ ] Translation and generated artifacts pass declared corpus thresholds and user-visible preview checks.
- [ ] Model installation, absence, cancellation and index deletion behave explicitly and privately.
- [ ] Required automated checks and the relevant native/independent-consumer workflows in the shared contract pass.
- [ ] Update the delivery tracker and verification ledger with source/build identity, artifacts and remaining limitations.

## Decisions and limits

Converter, model runtime, licenses, language support and download distribution need explicit decisions.
Hosted processing is outside this phase and cannot be silently substituted for local quality shortfalls.

## First action and handoff

Separate the current limited exports from genuine-format acceptance fixtures and define conversion scoring.
Record completed step IDs, failed criteria and the next reproducible action before handing off.
Continue to [Phase 9](09-distribution-platforms.md) only after this phase's required gate passes.
