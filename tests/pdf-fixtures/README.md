# PDF fixture corpus

All documents contain synthetic test content.
`npm run fixtures` regenerates the standard reader files at 5, 100, 500, and 1,000 pages, the mixed-dimension form/annotation document, and the deliberately damaged file.

The three special PDFs are checked in to keep the test suite independent of a Python installation.
To regenerate them optionally, install PyMuPDF in an isolated development environment and run `scripts/create-special-fixtures.py` after the standard generator.
PyMuPDF is a test-data generator only and is not included in NavPDF.

| File | Coverage |
| --- | --- |
| `reader-*.pdf` | Native text, exact page markers, repeated search terms, large page counts |
| `mixed-forms-annotations.pdf` | Existing AcroForm, sticky note, 90-degree rotation, mixed page dimensions |
| `encrypted.pdf` | AES-256, test password `reader-fixture`, incorrect-password retry |
| `scanned-images.pdf` | Twelve high-resolution image-only pages, no synthetic OCR claims |
| `embedded-font.pdf` | Embedded Liberation Sans, accented text, bookmark |
| `damaged.pdf` | Invalid object structure and missing cross-reference table |

The embedded Liberation Sans font is distributed with PDF.js.
Its license is copied to `LICENSE_LIBERATION` beside this file.
