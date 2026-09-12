# ADR-0001: Adopt Tauri and PDF.js for the reader foundation

Date: 2026-09-11
Status: Accepted for Phase 1 under the supplied product specification.

## Context

The product specification explicitly requires Tauri, Rust, React, TypeScript, Vite, Tailwind and Zustand, with PDF.js rendering.
The previous prototype used Electron and a Python PDF engine and did not meet those architectural or redistribution requirements.
The requested sequence starts with a proven reader, including large-document navigation and an externally verifiable highlight-save journey.

## Decision

Use Tauri 2 for native dialogs, scoped file handles, range reads, safe saves and local services.
Use PDF.js's maintained viewer, text layer, worker, search controller and standard highlight editor, rather than reimplementing those PDF behaviors.
Use lopdf only to validate output at the native save boundary.
Use React, Zustand and Tailwind for the application shell and serializable UI state.

## Alternatives

- Retaining Electron/Python conflicts with the requested stack and requires a Python runtime plus a separate MuPDF redistribution decision.
- Building a new renderer from canvas primitives would duplicate difficult layout, selection, rotation and font behavior already maintained in PDF.js.
- Using pdf-lib as the universal editor exceeds its supported capabilities and relies on an old release line.
- Bundling PDFium or qpdf immediately would add native packaging complexity without improving the Phase 1 reader acceptance criteria.

## Consequences

The native app needs no server or Python runtime, and documents remain local.
The viewer gets established rendering and annotation behavior with a bounded rendering queue.
Future editing engines must pass PDF round-trip and licensing gates before their capabilities are exposed.
The first milestone intentionally excludes later-phase tools rather than retaining misleading prototype controls.

See [ARCHITECTURE.md](../../ARCHITECTURE.md) for the evaluated libraries, sources, data flow and security model.
