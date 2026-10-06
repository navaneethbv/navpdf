# ADR-0014: Additional local export formats

Date: 2026-10-06
Status: Accepted for the October 6 export format delivery

## Context

The owner requested export to the formats that Adobe Acrobat's Export PDF tool offers, specifically naming JPEG, PNG, Word and Excel.
Acrobat documents export to Word (DOCX and Word 97-2003 DOC), Excel (XLSX and XML Spreadsheet 2003), PowerPoint, RTF, JPEG, JPEG 2000, PNG, TIFF, HTML, plain and accessible text, XML 1.0, PostScript and Encapsulated PostScript, and CSV from selected text.
Before this decision NavPDF exported DOCX, XLSX, PPTX, RTF, plain text, PNG and JPEG under [ADR 0007](0007-office-export.md).
Multipage PNG and JPEG exports asked for one destination per page, and plain text joined every line of a page into one line.

## Decision

NavPDF adds CSV, XML Spreadsheet 2003, HTML and XML 1.0 exports built from the PDF text layer in `src/features/convert/formats.ts`.
They reuse the ADR 0007 layout reconstruction, so they carry text, headings, paragraphs and aligned columns only.
CSV is UTF-8 with a byte order mark and RFC 4180 quoting, and cells that a spreadsheet would evaluate as formulas are prefixed with an apostrophe.
XML Spreadsheet 2003 writes typed number and date cells and never writes formulas, matching the XLSX export.
HTML output escapes all PDF text and declares a content security policy that blocks scripts, remote resources and form submission.
Plain text now writes one reconstructed line per line in column-aware reading order.

NavPDF adds TIFF, PostScript and EPS exports of rendered pages in `src/features/convert/raster.ts`.
TIFF output is a baseline little-endian RGB file with one directory per page, PackBits compression and the chosen resolution recorded.
Pages are compressed as they are rendered, so raw page pixels are released before the next page renders.
PostScript output is DSC-conforming language level 2 with one page per PDF page and each page embedded as an ASCII85-wrapped JPEG image.
EPS output is EPSF-3.0 with one page per file and no preview image.
When several page images or EPS files are exported, they are packaged in one stored ZIP archive so only one destination is requested.

## Alternatives

Word 97-2003 binary `.doc` output is not delivered.
A genuine writer requires the compound file container, file information block, piece table and formatting tables, and no Microsoft Word installation was available to verify acceptance.
Saving RTF or HTML under a `.doc` name was rejected for the same reason ADR 0007 rejected it: it misrepresents the format.
DOCX and RTF remain available for older word processors.

JPEG 2000 output is not delivered.
WebKit and Chromium cannot encode JPEG 2000, and a bundled encoder such as OpenJPEG compiled to WebAssembly would need a dependency, licensing and packaging decision.

Accessible text is not offered separately.
Acrobat's accessible text follows the PDF structure tree and alternate text, which NavPDF does not read during export, so labeling the reconstructed text as accessible would overstate it.

Vector PostScript was not attempted.
PDF.js renders to a canvas and has no PostScript backend, and a native PDF-to-PostScript converter would be a new engine dependency.

## Consequences

`node scripts/export-formats-acceptance.mjs` checks every new format with independent consumers: Python's csv, HTML and XML parsers, LibreOffice, Pillow, ImageMagick and Ghostscript.
PostScript and EPS output is raster: text is not selectable and drawings are not resolution independent.
TIFF output is lossless; the PostScript, EPS and JPEG outputs use the chosen JPEG quality.
Multipage PNG, JPEG and EPS exports now save a ZIP archive rather than separate files.
Native macOS acceptance, Microsoft Excel and Adobe Acrobat opening of these files, and Preview inspection of TIFF and EPS output remain separate gates.
