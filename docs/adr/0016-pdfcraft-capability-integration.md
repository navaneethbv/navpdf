# ADR 0016: Selective PDFCraft capability integration

Date: October 16, 2026.
Status: accepted architecture direction; implementation and acceptance remain in progress.

## Context

The requested outcome is to add capabilities PDFCraft implements that NavPDF lacks, then open a PR.
The user delegated the decision between preserving NavPDF's architecture and preparing a replacement-engine integration.
The inspected PDFCraft revision is `f0c9901c398372782a4eb001c95638289a5edab0` from `https://github.com/storytold/pdfcraft`.
Its checklist contains 437 shipped, 93 partial, 285 planned and 23 not-applicable entries.
These are upstream classifications, not independently established NavPDF gaps or interoperability evidence.

PDFCraft's engine facade depends directly on its own object model, renderer, forms, XFA and JavaScript crates.
Its workspace declares Rust 1.95 and patches several third-party dependencies.
NavPDF already has PDF.js rendering, typed native document ownership, bounded revision history, recovery, PDF operations and native safety boundaries.
Replacing those systems would require revalidating every existing lifecycle and persisted-output gate.
PDFCraft's script execution also conflicts with NavPDF's explicit prohibition on executing embedded scripts.

## Decision

Retain NavPDF's existing architecture and security rules.
Use the pinned upstream source to identify implemented capabilities and their limits.
Implement compatible capabilities within existing service and UI boundaries.
Consider narrowly scoped upstream code reuse only after reviewing the dependency graph, license notices, supported toolchain, cancellation and interoperability.
Do not import the entire upstream engine as a shortcut to parity.
Do not add embedded-script execution, automatic attachment launching, external services or model downloads as implicit consequences of this request.

The changes copy no upstream source or branding.
XFDF imports use the pinned MIT-licensed `@xmldom/xmldom` 0.9.12 package to parse XML outside the browser DOM.
The maintained pure JavaScript parser requires no native runtime or network access and bundles through Vite.
Parser errors are fatal; document types, entity declarations, foreign elements and non-plain values remain rejected.
Round-trip tests verify literal escaped markup, checkbox export states and saved PDF form values.
The existing Node 24 toolchain satisfies its Node 14.6 minimum.
They add tool search, poster composition, initial-view editing, bookmark/size ZIP splitting, XFDF form-data exchange, and additional accessibility structure checks and reports.
The shared tool catalog keeps panel and palette actions aligned.
PDF mutations continue through the existing revision transaction, and exports retain native destination selection.
Poster output explicitly contains page content only, with annotations, fields and links remaining in the source document.
It is a print composition operation, never a sanitization or redaction operation.

## Licensing

Upstream code is offered under MIT OR Apache-2.0.
Any future code reuse must retain the applicable license and notices.
Assets have independent attribution requirements in upstream `ATTRIBUTION.md`.
ArtCraft branding has separate restrictions and is not part of this implementation.

## Consequences

This is a staged capability integration, not a claim of full parity.
Upstream planned features are not implementation targets until they actually exist.
Upstream partial features require comparison of their implemented subset, not their aspirational title.
Advanced encryption-preserving lifecycle, signatures, automation, accessibility remediation, PDF/A conversion and UI/platform features remain separate work with explicit acceptance gates.
The active delivery tracker owns current progress and verification status.
