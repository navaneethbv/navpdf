# NavPDF

A local PDF editor for macOS, built with React, Electron and PyMuPDF.
Documents are processed on your device without accounts, document uploads or a cloud service.

## Open the app

The locally built macOS app is at `release/mac-arm64/NavPDF.app`.
Double-click it in Finder, or run:

```sh
open release/mac-arm64/NavPDF.app
```

To run from source:

```sh
npm install
npm run setup
npm run desktop
```

`npm run setup` needs Python 3 and an internet connection to install dependencies and download English OCR data.
Subsequent desktop editing and OCR work offline.
The local macOS package uses the Python installation on this Mac; it is not a standalone installer for other computers.
It is not notarized for public distribution.

For browser development, run `npm run dev` and open http://127.0.0.1:5173.
The development server supports one shared workspace and binds to loopback only.
Restarting it resets that workspace, so use the desktop app for normal editing.

## Features

| Feature | How to use it |
| --- | --- |
| Open, render, thumbnails, text selection | Open PDF, then select a thumbnail or copy visible text. |
| Search | Document tools > Search document. |
| Zoom and page navigation | Use the controls below the page; Fit scales to the available space. |
| Edit existing text | Choose Edit text, click a line, edit its text or standard font, and apply. |
| Add text | Drag an area, enter text, select font, size and color, then apply. |
| Highlight | Drag across text and apply the highlight. |
| Comments | Choose Comment, click the page, enter your note, and apply. |
| Drawing and signatures | Draw directly on the page; each stroke becomes a PDF ink annotation. |
| Add images | Choose Image, select a PNG or JPEG, drag its area, and apply. |
| Page organization | Add, remove, move, rotate or crop pages using the sidebar and Organize pages. |
| Merge | Merge PDF appends another PDF, including its form fields. |
| Split / extract | Export selected page numbers or ranges, such as `1, 3-5`. |
| Forms | Fill text, checkbox, radio and choice fields through Fill forms. |
| OCR | Recognize English text on the current scanned page locally. |
| Redaction | Select content, apply removal, and export a sanitized copy. |
| Password protection | Set an opening password in Export PDF or Password protection. |
| Metadata | Edit title, author, subject, keywords and creator. |
| Undo / redo | Toolbar or Command-Z / Command-Shift-Z. |

The welcome document is an actual editable three-page PDF, suitable for trying the tools.
Export creates a new copy by default and never silently writes to the source file.

## Editing behavior and limits

Existing-text editing replaces one selected line with a standard PDF font and preserves its original baseline.
It supports Latin characters, and rejects replacements that do not fit instead of clipping them or deleting neighboring text.
It does not reconstruct paragraphs, preserve arbitrary embedded fonts, or edit arbitrary vector objects.
Adding text supports multiline text boxes in the same standard fonts.

A drawn signature is a visible ink mark, not a certificate-based digital signature.
Certificate signing, XFA forms, prepress validation, arbitrary object editing and exact Acrobat font/layout parity are not implemented.

OCR recognizes English at 200 DPI and replaces the selected page with a raster image plus a searchable text layer.
Existing forms and annotations on that page become part of the image.
Other pages remain unchanged.

Redaction removes intersecting text, graphics and image pixels.
Sanitized export also removes metadata, attachments, document outlines, links, hidden text and comments.
Text replacement currently uses the same export sanitization policy.
Review the saved PDF before sharing it, especially when the same sensitive information occurs in multiple places.
Cropping changes the visible page boundary and is not secure redaction.

An opening password encrypts the exported PDF with AES-256.
Leaving the password empty exports an unencrypted copy, including when the input was encrypted.
Passwords are limited to 40 characters and 127 UTF-8 bytes by the engine.

The app supports one open document at a time and keeps working data in memory.
Export before closing; there is no crash recovery or autosave to disk.
Undo retains up to 20 changes within a 128 MB history budget, with at least the latest change retained.
Inputs are limited to 100 MB, and oversized render/OCR operations are bounded.

## Development and validation

```sh
npm run build
npm run lint
npm test
npm run test:integration
npm run package
```

The engine suite validates exported PDF contents, adjacent-line preservation, rotated coordinates, form preservation, OCR, image-pixel redaction, password reopening, and atomic rollback.
The transport suite exercises a separate local server, including cross-origin rejection and edited-document round trips.
Browser interaction checks and design comparison are recorded in [docs/VERIFICATION.md](docs/VERIFICATION.md).

## Structure

- `src/components/Canvas.tsx`: page rendering, selection, drawing and text targets.
- `src/components/Inspector.tsx`: editing controls and document tools.
- `src/App.tsx`: workspace state, file import, export and keyboard shortcuts.
- `engine/pdf_engine.py`: PDF operations and in-memory undo transactions.
- `electron/bridge.cjs`: serialized process communication with the PDF engine.
- `electron/main.cjs`: isolated desktop window and atomic native save.
- `vite.config.ts`: loopback-only development transport with same-origin checks and a session token.

Rendering uses PyMuPDF to keep displayed content and saved-file coordinates on the same PDF engine.
Page edits use unrotated coordinates internally, following the [PyMuPDF coordinate rules](https://pymupdf.readthedocs.io/en/latest/page.html).
Electron uses context isolation, a sandboxed renderer and restricted IPC following the [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security).
