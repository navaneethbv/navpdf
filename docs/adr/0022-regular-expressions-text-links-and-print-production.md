# ADR 0022: Regular expressions, text links and print production

Date: November 15, 2026.
Status: accepted for PDFCraft gap batches 18 to 20; native, independent-reader and packaging acceptance remain open.

## Context

The [mid-November gap programme](../PDFCRAFT-MID-NOVEMBER-GAPS.md) compared PDFCraft at `a11ea7a` and listed three capabilities that need a decision rather than a tool inside existing scope.
Redaction by regular expression runs a user-written expression over untrusted document text.
Clickable plain-text web addresses widen what a click can do.
Printer marks, hairline fixing and colour conversion rewrite page content for print.

## Decision

Regular expressions are matched in the native engine with the `regex` crate, version 1, licensed MIT or Apache-2.0.
It was already in the lockfile as a transitive dependency, so no new code is downloaded or packaged.
It guarantees matching time linear in the text and has no look-around or back-references, which removes catastrophic backtracking.
The expression is limited to 1,024 bytes, a compiled size of 1 MB and a nesting depth of 50; text is limited to 64 MB and results to 10,000 matches.
An expression that can match the empty string is refused.
JavaScript's `RegExp` was rejected because it backtracks and runs on the interface thread.
The expression and the matched text are never logged.

Plain-text web addresses use the PDF.js auto-link layer.
A click goes through the same confirmation dialog and address validation as a link annotation, and nothing is opened automatically.
PDF.js keeps external links disabled; NavPDF records the address on the element and reads it at click time.

Print production runs in a new native module, `engine::prepress`, on lopdf.
Colour conversion uses the device formulas of ISO 32000 and no colour management system.
The interface says so, and every colour space the tool cannot convert is counted and reported instead of being approximated.
Printer marks are ordinary page content tagged so they can be removed, with the original page boxes saved on the page.
A colour management library and ICC profiles were rejected for this batch because they add licensing, packaging and correctness work that needs printed evidence.

## Alternatives

Matching in the renderer with a time limit was rejected because a synchronous match cannot be interrupted.
Writing link annotations for detected addresses was rejected because viewing must not change the file.
Rasterising pages to convert colour was rejected because it destroys text and vector content.

## Consequences

Users can mark arbitrary patterns for redaction; applying still goes through the existing redaction review and saved-output inspection.
Expressions written for JavaScript that use look-around need rewriting.
Converted colours are not suitable where a press profile is contractually required.
The output of the prepress tools was rendered with poppler on Linux; Preview, Acrobat and press preflight acceptance remain open.
