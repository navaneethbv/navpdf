# ADR-0004: Page mutation engine selection and structural preservation boundaries

Date: 2026-09-13
Status: Accepted for Phase 4.

## Context

Phase 4 requires page operations including reorder, rotation, deletion, cropping, blank/image page insertion, extraction, splitting and merging.
The delivery roadmap evaluated `qpdf` behind Rust alongside the current `pdf-lib` implementation.
The chosen engine must preserve document integrity, catalog structures, outlines, forms, annotations and page geometry.
Memory overhead, binary size, packaging complexity, platform portability and licensing must be balanced against mutation fidelity.

## Decision

Retain and harden `pdf-lib` within `src/services/document-commands.ts` for Phase 4 page mutations.
Use in-place page tree manipulation for in-document operations (reorder, rotate, delete, crop, insert).
Rearranging the existing `/Pages` tree preserves catalog-level structures including document outlines (bookmarks), AcroForms, metadata and existing page annotations.
For multi-document composition (extract, split, merge), inspect source structures and present explicit warnings before commit (`describeStructureLoss`).
Resolve duplicate form field names automatically during merge to prevent corrupted AcroForm structures.
Enforce durable working revision ownership and stale base revision rejection behind native handles via `commit_working_revision`.

## Alternatives

- Bundling `qpdf` via C++ FFI or subprocess:
  Adds substantial native packaging complexity, dynamic library linking across macOS universal architectures (aarch64 and x86_64), Windows and Linux, and increases binary size by 15-20 MB without providing superior in-document catalog preservation over in-place page tree permutation.
- Introducing PDFium in Phase 4:
  PDFium adds large binary overhead and is deferred to Phase 7 where existing-object editing and redaction require its rendering and content-stream rewrite capabilities.
- Pure client-side array manipulation without native revision ownership:
  Lacks base-revision concurrency guards and fails to protect working state against race conditions between background tasks and user edits.

## Consequences

- Zero native C++ dependency bloat, preserving fast compilation and clean multi-platform packaging.
- Complete preservation of bookmarks, forms and page boxes during in-document page operations.
- Explicit, predictable user warnings when composing new documents that cannot inherit source catalogs.
- Stale base revisions are rejected by native handles, preventing concurrent write collisions.
- Memory usage is bounded by in-memory document size; documents up to several hundred pages operate smoothly within existing memory budgets.
