# NavPDF

A local desktop PDF workspace for macOS Apple Silicon, built with Tauri, Rust, React, TypeScript, Tailwind, Zustand, and PDF.js.
Documents stay on your computer.
There is no account, server backend, upload, analytics, or telemetry.

## Current milestone

This implementation follows **Phase 1: Foundation** in [the supplied specification](docs/PRODUCT-SPEC.txt), plus its requested persistent-highlight milestone.
It is a reader with standard PDF highlights and validated saving.
The complete eight-phase editor and MVP feature list are not yet finished.

Available features:

- Native Open, Save, and Save As dialogs.
- Continuous, single-page, and two-page viewing.
- Fit page, fit width, 25% to 500% zoom, trackpad zoom, and a hand tool.
- Page navigation and virtualized thumbnails.
- Text selection and copying.
- Whole-document search with case and whole-word options, context, match counts, and occurrence navigation.
- Bookmarks and inspection of saved notes/highlights.
- Standard highlight annotations, colors, deletion, undo, and redo.
- Password prompts for reading encrypted PDFs.
- Light, dark, and system themes, viewing preferences, and optional local recent history.
- Validated atomic saves, external-change detection, private recovery copies, and unsaved-change prompts.

Encrypted documents are read-only in this milestone.
The app does not silently decrypt or resave them.
The limit is 1 GB per source PDF.
Search results show the first 250 entries, while Next/Previous match can navigate the entire result set.
Image-only scans display normally, but require an existing OCR text layer for search.

## Run locally

Prerequisites: Node.js 22.13 or newer, Rust 1.88 or newer, and Xcode Command Line Tools.
The application itself does not require Node, Python, or a local server after packaging.

```sh
npm ci
npm run desktop
```

For a browser-only development preview:

```sh
npm run dev
```

Open `http://localhost:1420`.
The browser preview uses file selection and downloads; native atomic saving, recents, and recovery are verified in the desktop build.

## Build

```sh
npm run package
```

The macOS application is written to `src-tauri/target/release/bundle/macos/NavPDF.app`.
The installer is written under `src-tauri/target/release/bundle/dmg/`.
For an app-only build, use `npx tauri build --bundles app`.
Local builds are not claimed to be signed with a distribution identity or notarized.
Windows and Linux have not been acceptance-tested.

## File safety and privacy

Opening a file creates a private immutable source snapshot.
PDF.js accesses it through an opaque handle and bounded binary range reads.
Saving serializes edits, independently parses the result with lopdf, verifies page count, writes a temporary file beside the destination, flushes it, and atomically replaces the destination.
If the original changed externally, Save stops and asks you to use Save As.

Unencrypted recovery copies are saved locally every ten seconds while there are unsaved edits.
The home screen offers recovery after a crash.
Saving a recovered document always requires a destination selected through Save As.
Recovery is a convenience copy, not a backup of all historical versions.

Settings, recent paths, recovery, and structured operation logs are stored under macOS Application Support in `local.navpdf.reader`.
Logs do not contain PDF text, passwords, signatures, or form values.
Network access is disabled by the production content security policy and native navigation handler.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| Cmd/Ctrl + O | Open |
| Cmd/Ctrl + S | Save |
| Cmd/Ctrl + Shift + S | Save As |
| Cmd/Ctrl + F | Search |
| Cmd/Ctrl + Z | Undo annotation edit |
| Cmd/Ctrl + Shift + Z | Redo annotation edit |
| Cmd/Ctrl + plus / minus | Zoom |
| Cmd/Ctrl + 0 | Fit page |
| Escape | Return to text selection |

## Validation

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm run test:native
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

`npm test` generates the standard 5, 100, 500, and 1,000-page corpus before running tests.
Small special fixtures are checked in for encrypted files, embedded fonts, and image-only scans.
Their optional regeneration script uses PyMuPDF as a development-only reference engine; it is not part of the product or build.
See [verification evidence](docs/VERIFICATION.md) for actual UI checks and remaining acceptance work.

## Architecture and next phases

[ARCHITECTURE.md](ARCHITECTURE.md) explains the boundaries, library decisions, licenses, performance model, and OCR strategy.
[ADR 0001](docs/adr/0001-tauri-pdfjs-foundation.md) records the foundation choice.
The original Electron/Python prototype is preserved in Git history at `40dbac6`.

The next phase is page operations: reorder, delete, rotate, extract, insert, merge, and split.
Later phases add the remaining annotation tools, content editing, forms/signatures, OCR, redaction, compression, protection, print, and final polish in the order specified.
