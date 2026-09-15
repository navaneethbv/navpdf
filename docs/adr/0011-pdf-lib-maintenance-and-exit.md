# ADR 0011: pdf-lib maintenance boundary and exit path

Date: 2026-09-14.

Status: Accepted.

## Context

NavPDF uses pdf-lib 1.17.1 for browser-side annotation, form, page composition, decoration, OCR layer and metadata writers.
The package is permissively licensed, but its release cadence is stale and it does not provide the structural guarantees required for encrypted saving, secure redaction, arbitrary existing-text editing or large-document memory limits.
The September 14 review identified stream ownership and deleted-object risks when pdf-lib mutations were composed without independent validation.

## Decision

Keep pdf-lib for annotation and form writers, page composition, decorations, OCR layers and metadata behind the helpers in `src/services/pdf/`.
Every persisted candidate remains subject to native validation and independent saved-byte inspection.
Route destructive object pruning, protection, compression, redaction and certificate signing through the Rust engine under `src-tauri/src/engine/`.
Evaluate moving decorations and OCR layer generation to the Rust engine in Tranche 6 if the current memory and interoperability measurements require it.

## Consequences

pdf-lib remains a bounded writer dependency with explicit compatibility limits.
Native engine operations own security-sensitive transformations and can reject unsupported structures before replacement.
The application must continue to document that drawing over content, deleting a visible annotation and creating an appearance are not secure redaction or cryptographic signing.
Replacing pdf-lib requires an ADR with licensing, saved-output and independent-reader evidence before changing the boundary.
