# PDF fixture corpus

All documents contain synthetic test content.
`npm run fixtures` regenerates the standard reader files at 5, 100, 500, and 1,000 pages, the mixed-dimension form/annotation document, the rotated/offset-page fixture, the OCR scan corpus, and the deliberately damaged file.

The three special PDFs are checked in to keep the test suite independent of a Python installation.
To regenerate them optionally, install PyMuPDF in an isolated development environment and run `python3 scripts/create-special-fixtures.py` from the repository root after the standard generator.
PyMuPDF is a test-data generator only and is not included in NavPDF.

| File                          | Coverage                                                                  |
| ----------------------------- | ------------------------------------------------------------------------- |
| `reader-*.pdf`                | Native text, exact page markers, repeated search terms, large page counts |
| `mixed-forms-annotations.pdf` | Existing AcroForm, sticky note, 90-degree rotation, mixed page dimensions |
| `rotated-offset.pdf`         | Offset page boxes and page rotations for geometry round trips              |
| `ocr-scans.pdf`              | Rasterized samples from `ocr-evaluation-corpus.json` for real native OCR     |
| `encrypted.pdf`               | AES-256, test password `reader-fixture`, incorrect-password retry         |
| `scanned-images.pdf`          | Twelve high-resolution image-only pages, no synthetic OCR claims          |
| `embedded-font.pdf`           | Embedded Liberation Sans, accented text, bookmark                         |
| `damaged.pdf`                 | Invalid object structure and missing cross-reference table                |

The embedded Liberation Sans font is distributed with PDF.js.
Its license is copied to `LICENSE_LIBERATION` beside this file.
