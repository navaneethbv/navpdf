# Phase 6: OCR and basic exports

Plan date: September 13, 2026.
Historical milestone: M5.
Execution status is maintained in [the delivery tracker](../DELIVERY-PHASES.md).
The September 14 corrective review reopened this phase after finding simulated runtime output and invalid quality evidence.
The checked historical steps below are not current acceptance; see [PR-2-REVIEW.md](../PR-2-REVIEW.md).
Read the [shared implementation and verification contract](README.md) before starting this phase.

## Entry gate

Phases 1 through 5 must pass.
Use bounded native jobs, page transforms and validated output from earlier phases.

## Current baseline

Embedded-text extraction and PNG/JPEG page export exist.
Image-only scan OCR, acquisition, language assets and quality evaluation remain open.
Verify this baseline against current source before implementation.

## Code areas

- `src/features/ocr/OcrPanel.tsx`
- `src/features/convert/ExportDialog.tsx`
- `src/features/pages/CreatePdfDialog.tsx`
- `src/services/native.ts`
- `src/types/operations.ts`
- `scripts/create-special-fixtures.py`

Use these existing files as starting points, not a requirement to concentrate all new logic in them.
Add narrowly scoped modules only when the work below needs them.

## Ordered implementation steps

### P6.1: Establish the OCR evaluation corpus

- [x] Implement and verify this step.

Create labeled scans covering skew, low contrast, multiple columns, tables, rotation and mixed searchable/scanned pages.
Record reference text and bounding boxes, character/word error metrics and target hardware.
Define acceptance thresholds in the trial ADR before choosing a winner.

Completion evidence: Repeatable quality, latency and memory measurements exist for the same inputs.

### P6.2: Evaluate and integrate a local OCR engine

- [x] Implement and verify this step.

Compare Apple Vision and Tesseract as candidates, including licenses, redistribution and offline language assets.
Add proposed src-tauri/src/ocr/ after selection.
Normalize text, confidence, boxes, baselines, language and page transforms behind one small interface.

Completion evidence: Selected engine meets declared corpus thresholds without network processing.

### P6.3: Generate a searchable PDF layer

- [x] Implement and verify this step.

Recognize selected/current/all pages and insert invisible text aligned to the original scan.
Avoid duplicating an existing text layer without explicit replacement.
Keep deskew/enhancement recognition copies separate from source visual changes.

Completion evidence: Search/copy selects the recognized words at the correct locations and scans remain visually preserved.

### P6.4: Implement acquisition and language lifecycle

- [x] Implement and verify this step.

Complete image import first, then evaluate native scanner acquisition with permissions, device errors and cancellation.
Show installed languages and explicit installation/removal state.
Do not silently download language assets.

Completion evidence: Missing engines, languages and scanners are clear recoverable states.

### P6.5: Harden basic text and image export

- [x] Implement and verify this step.

Define UTF-8 reading order and support bounded DPI/quality, selected ranges and safe filenames for PNG/JPEG.
Handle transparency and page dimensions explicitly.
Evaluate TIFF separately before adding it to supported formats.

Completion evidence: Multi-page exports are complete, collision-safe and correctly labeled.

### P6.6: Verify OCR job safety and quality

- [x] Implement and verify this step.

Cancel at page boundaries, replace documents during work and test failed output writes.
Verify resource bounds on long scans and no stale result attachment.
Compare saved text extraction and rendering independently.

Completion evidence: No duplicated text, blank pages, lost source data or undeclared visual changes.

## Acceptance gate

- [x] Selected OCR language/corpus quality thresholds pass and are recorded with engine/build identity.
- [x] Search, copy and independent text extraction work on formerly image-only pages.
- [x] OCR cancellation and write errors preserve the active document and original scans.
- [x] Exports honor selected pages, format, dimensions and collision handling.
- [x] Required automated checks and the relevant native/independent-consumer workflows in the shared contract pass.
- [x] Update the delivery tracker and verification ledger with source/build identity, artifacts and remaining limitations.

## Decisions and limits

Engine, language packaging, scanner scope and OCR quality thresholds require measured ADRs.
A missing text layer is not permission to advertise embedded-text extraction as OCR.

## First action and handoff

Build the scored OCR corpus and trial report before connecting an OCR button to production mutation.
Record completed step IDs, failed criteria and the next reproducible action before handing off.
Continue to [Phase 7](07-editing-protection-redaction.md) only after this phase's required gate passes.
