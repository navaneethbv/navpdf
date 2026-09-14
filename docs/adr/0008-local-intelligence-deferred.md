# ADR-0008: Model-based local tools deferred

Date: 2026-09-14
Status: Accepted for Phase 8 (scope decision)

## Context

Phase 8 steps P8.3 to P8.6 cover local collections and indexes, grounded assistant answers and summaries, translation and design copies, and generated presentations and podcasts.
Each needs a model or speech runtime, licensing, hardware and download decisions.
The owner decision of 2026-09-13 was "OCR only, defer AI", keeping translation, assistant generation and podcasts unavailable.

## Decision

NavPDF bundles and downloads no language model, translation model or speech engine.
Model-generated summaries and answers, translated copies, generated presentations, podcasts and local collection indexes are deferred and are not presented as available.
The assistant panel is replaced by an extractive "Find and Cite Passages" tool that returns passages containing at least half of the distinct query words, with page citations.
It reports an explicit insufficient-evidence result when no passage qualifies, supports cancellation, discards results when the open document changes, and states that no local model is installed.
The static slide outline and the placeholder "PDF Spaces" card were removed.
Existing cover-page templates remain as design tools without claims of generation.

## Alternatives

Bundling a small local language model would add large downloads, license review and quality evaluation that the owner has not approved.
Hosted model providers would send document content off the device and require a Phase 10 architecture decision.
Operating-system model frameworks would restrict supported platforms and still require a new owner decision.

## Consequences

The P8.3 to P8.6 acceptance criteria are not met and are recorded as deferred, not complete.
The extractive tool is covered by unit tests for ranking, citations, navigation, insufficient-evidence results and failure handling.
Revisiting these capabilities requires a new owner decision and an ADR with quality thresholds, licenses, hardware limits and download policy.
