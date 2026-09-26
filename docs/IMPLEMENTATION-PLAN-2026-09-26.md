# September 26 implementation plan

The owner authorized all twelve prioritized additions in this session.
Keep the existing image-margin work and local-only architecture.
The owner subsequently authorized committing, pushing and opening a pull request after Preview verification.
Merge and distribution publication remain outside that authorization.

## Ordered delivery

| Order | Scope | Implementation and acceptance |
| --- | --- | --- |
| 1 | Native rendering | Reproduce the stale WebKit display with the synthetic crop PDF; disable the affected accelerated canvas path and verify repeated open without resizing. |
| 2 | Merge preservation | Copy AcroForm field trees, widgets and resources with a shared object copier; namespace conflicting fields; remap bookmark and internal-link destinations; refuse unsupported signed/XFA structures. |
| 3 | Adjustable crop | Add draggable edges/corners and bounded numeric coordinates with keyboard support. |
| 4 | Crop comparison | Display the original image with a crop outline and the output preview before import. |
| 5 | Padding and sensitivity | Expose bounded controls and preserve reset to original. |
| 6 | OCR correction | Review editable recognized words before applying; persist app-owned OCR word geometry for later correction without changing scan pixels. |
| 7 | Bookmark editing | Reuse the outline model for adding, renaming, nesting, moving and deleting local page destinations, with undo and saved-output tests. |
| 8 | Target compression | Try existing presets from least to most destructive, report measured target attainment, and preview before applying. |
| 9 | Scan cleanup | Add reversible straightening and background cleanup to image preparation before OCR, with preview and original retention. |
| 10 | Batch trimming | Sequential bounded processing with per-file results, overrides and cancellation that retains completed previews. |
| 11 | Image compatibility | Decode HEIC and multipage TIFF locally through macOS ImageIO, validate allocation limits, preserve orientation/frame order, and provide explicit unsupported-platform errors. |
| 12 | PDF comparison | Compare text and rendered page images locally with bounded render sizes, inserted/deleted page handling and synchronized original/revised views. |

## Shared contracts

New actions use the existing document mutation queue and expected-source checks.
PDF writing retains supported structures and refuses unsupported ones instead of silently dropping them.
Image preparation operates on copies and commits only an explicitly accepted result.
Native image decoding uses bounded byte IPC with no renderer-provided filesystem paths.
No remote service, model download, upload, analytics or account is introduced.
Perspective correction remains outside the approved twelve items.

## Verification

Use synthetic fixtures and independent PDF.js/Poppler inspections for saved dimensions, pixels, text, forms and bookmark destinations.
Run lint, typecheck, coverage with existing gates, build, Rust tests, Clippy and diff checks.
Rebuild the native app and installer for final acceptance.
Record exact hashes, native results and blocked reader/platform checks in the verification ledger.
The existing Preview computer-use approval rejection remains a verification limit unless access is granted separately.

## Delivery evidence

All twelve scopes are implemented locally.
Detailed native actions, independent saved-output checks, current test results and remaining platform/reader limits are recorded in `docs/VERIFICATION.md`.
Scan straightening is a manual angle control for imported images, including converted TIFF pages, not automatic perspective correction or editing of arbitrary PDF page objects.
Editable saved OCR requires a layer created by this implementation; older or third-party layers can be recognized again.
The existing PDF.js/Poppler checks do not substitute for the blocked Preview gate.
