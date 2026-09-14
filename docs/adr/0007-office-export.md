# ADR-0007: Genuine Office export from the PDF text layer

Date: 2026-09-14
Status: Accepted for Phase 8

## Context

Phase 8 step P8.2 requires genuine DOCX, XLSX and PPTX output with editable content where claimed.
The earlier exports saved HTML with `.doc` and `.ppt` names and plain CSV, which did not meet that requirement.
The owner decision of 2026-09-13 selected genuine Office export and deferred model-based tools.

## Decision

NavPDF writes Office Open XML packages locally in `src/features/convert/ooxml.ts`, rendered from `OfficeExport.tsx` in the webview.
Packages are stored ZIP archives with UTF-8 names and CRC32 checks; no network access, macros or external resources are involved.
Page layout is rebuilt from PDF.js text items: lines grouped by baseline, cells split at wide gaps, a two-column gutter detected, and headings chosen by size relative to the lower median.
DOCX output contains paragraphs, Heading 1 and Heading 2 styles and a page break per page.
XLSX output has one sheet per page with cells aligned to shared column anchors; plain numbers and ISO dates become typed cells, all other text is an inline string, and formulas are never written.
PPTX output is either editable text slides, with one text box per line, or picture slides rendered at 150 dpi, limited to 4096 pixels per edge and 200 pages.
RTF output contains paragraphs and headings with Unicode escapes.
Documents without a text layer are refused with guidance to run OCR or export page pictures.
Office-to-PDF import is not delivered, because no local converter was selected; it remains unavailable.

## Alternatives

LibreOffice in headless mode would add a very large bundle and is not installed on the acceptance machine.
Commercial conversion SDKs would add licensing review and often network activation.
Saving HTML under Office extensions was rejected because it misrepresents the format.

## Consequences

`node scripts/phase8-acceptance.mjs` passed 12 of 12 checks using Python zipfile and XML parsing, Apple `textutil` for DOCX and RTF, direct inspection of typed XLSX cells, and Quick Look renders of PPTX, DOCX and XLSX.
Editable formats carry text only: fonts, images, vector drawings and exact positions are not reproduced, and scanned pages need OCR first.
Tables are recognized only where text aligns into columns, and layouts with rotated text or more than two columns are approximated.
Microsoft Word opened the DOCX and returned its six paragraphs, including the heading and accented text.
Microsoft Excel opened the XLSX with sheets and used ranges matching the package, and Microsoft PowerPoint opened the editable PPTX with its two slides.
