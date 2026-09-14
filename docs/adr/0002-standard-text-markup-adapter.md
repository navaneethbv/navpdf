# ADR-0002: Use a local adapter for standard text markup and sticky notes

Date: 2026-09-13
Status: Accepted for Phase 2.

## Context

The current PDF.js editor provides highlight, ink and free-text editing but does not expose interoperable underline, strike-through or sticky-note authoring.
Phase 2 requires those annotations to survive save and reopen with standard PDF semantics, page geometry, text contents, author, color and opacity.
The annotation inputs are local document data and must remain behind the existing staged revision boundary.

## Decision

Use a narrowly scoped pdf-lib adapter in `src/services/document-commands.ts` for `/Underline`, `/StrikeOut` and `/Text` annotations.
Convert browser selection rectangles to PDF-point quads before calling the adapter.
Load the adapter output into a new PDF.js proxy, validate the candidate before replacing the active proxy, and record the byte-backed revision for bounded undo and redo.
Use standard annotation dictionaries with stable local names, author, contents, color, opacity, flags, rectangles and quad points.

## Alternatives

- Waiting for a PDF.js editor implementation would leave the Phase 2 controls unavailable and does not provide a delivery path for existing documents.
- Painting marks into page content would not preserve selectable annotation semantics or allow independent readers to inspect the mark.
- Reusing the freehand editor would produce `/Ink` objects rather than standard text markup or sticky-note objects.
- Introducing a larger native PDF engine would expand packaging, licensing and interoperability scope before the current adapter is proven.

## Consequences

The three supported types are persisted as standard PDF annotations and can be reopened by NavPDF, Preview and Acrobat.
The adapter must continue to validate page bounds and geometry, preserve the source bytes on failure, and remain separate from serializable UI state.
Full property editing, deletion, replies, resolution and additional annotation families remain later Phase 2 work.
The output still needs broader rotated, cropped, multi-line, non-ASCII and repeated-edit acceptance before claiming complete annotation parity.
