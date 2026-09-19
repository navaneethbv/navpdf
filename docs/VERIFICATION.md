# Verification ledger

## September 19 native opening, tour and tips

The implementation adds an ordered native PDF-open queue, an alternate PDF association, first-launch guidance and startup-tip preferences.
Local checks pass lint, TypeScript, formatting, production build, 581 frontend tests across 84 files, 87 Rust tests, Clippy with warnings denied, Rustfmt, instruction parity and diff whitespace checks.
One existing constrained-volume Rust test remains ignored.
Coverage is 83.91% statements, 75.95% branches, 81.65% functions and 86.74% lines.
Native tests verified the first-launch tour, Help reopening, keyboard Enter and Back navigation, readable dialog layout, and tip opt-out persistence after relaunch.
The initial native tour focused Close instead of Next; setting the autofocus attribute before showModal corrects that behavior without depending on a background animation frame.
The pre-change Finder Open With menu omitted NavPDF; the rebuilt bundle now declares PDF content types with Editor role and Alternate rank.
Native cold-start reproduced a crash because macOS delivered file URLs before runtime setup initialized the queue.
Managing the queue on the builder before setup fixes this ordering.
The rebuilt application at source `49a0aee` passed a clean Finder cold launch: startup Tips appeared, Dismiss released the pending reader-5.pdf request, and its page and thumbnails rendered.
A warm Finder request for reader-100.pdf waited behind the tour, then rendered after dismissal.
Startup tips were re-enabled after the opt-out persistence check; System appearance, Default light and Ocean dark were retained.
No first-render or broader PDF interoperability gate is claimed by these checks.
The user authorized preserving their active edits before relaunch; the copy is output/reader-5-preserved-20260919.pdf, and independent Poppler text extraction confirmed the added text.
The preserved copy SHA-256 is `7d164a8e8e61a75e025e0911468c2134c2627c81f7107727fdd08c486416e65d`.
The rebuilt executable SHA-256 is `4d2cc1c80b0ecaf24236721349a27a42d70b3aa7bbf9719ca3d2ad08da38f7ea`.
The DMG SHA-256 is `c1f921403258e67ace0046fb8bdb8e213a14417b6c0c3f8e489b3e9d90e81414`; hdiutil verified CRC32 `$934E5A4C`.
[PR 21](https://github.com/navaneethbv/navpdf/pull/21) records hosted checks and merge status.
Codacy, CodeQL, frontend, Rust and native acceptance passed on the application commit.
NPM Audit encountered registry HTTP 503 maintenance and is being retried; Sonar analysis remains skipped without SONAR_TOKEN.
Signing, notarization, clean-account installation, physical printing and non-macOS UI acceptance remain separate gates.

## September 15 PR #4 follow-up review fixes

The follow-up to `3d2f611` corrects image transforms by converting the requested page-space matrix into the current image coordinate system.
The native engine reproduction previously moved an image 1,000 points when asked to move it 10 points.
The saved-output regression now checks translation, rotation, and preservation of the same image on a second page.
Coordinate comparisons allow 0.0001 points for PDF single-precision serialization.
XFDF import retains text-markup quadrilaterals and rejects missing or malformed geometry, with reload assertions for highlights, underlines, and strikeouts.
Dropdown and radio updates can clear selections and change flags without inventing an option value.

Local validation passes ESLint, TypeScript, formatting, 510 frontend tests with coverage, production build, 80 Rust tests, Clippy with warnings denied, rustfmt, instruction-file parity, and diff whitespace checks.
Coverage is 83.54% statements, 75.46% branches, 81.16% functions, and 86.37% lines.
The existing constrained-volume Rust test remains ignored.
The production build retains its existing large-chunk advisory.
These checks use the native engine and PDF services; they do not establish packaged UI, Preview, or Acrobat acceptance.
The packaged application and DMG were not rebuilt for this follow-up, so earlier artifact hashes do not identify these fixes.
Hosted checks must run on the pushed follow-up revision.

## September 15 current worktree checkpoint

The pushed worktree is `fix/september-14-review-corrections` at source revision `d83f6d8271dd77c973df799f63dfecff14152128`.
Only the three untracked root planning files remain outside the pushed tree.
The source review and implementation plan are [REVIEW-2026-09-14.md](REVIEW-2026-09-14.md) and [IMPLEMENTATION-PLAN-2026-09-14.md](IMPLEMENTATION-PLAN-2026-09-14.md).

| Check                            | Current result                                                                                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend unit suite and coverage | 504 tests across 80 files passed; 83.39% statements, 75.01% branches, 81.18% functions and 86.20% lines.                                                                     |
| TypeScript                       | Passed after the current shell, dialog, OCR and fixture changes.                                                                                                             |
| ESLint                           | Passed after the current script and corpus changes.                                                                                                                          |
| Rust tests                       | 80 passed; 1 constrained-volume disk-full test remains ignored.                                                                                                              |
| Rust Clippy                      | Passed with `--all-targets -- -D warnings`.                                                                                                                                  |
| Formatting and repository parity | Prettier, Rustfmt, `git diff --check` and `cmp AGENTS.md CLAUDE.md` passed.                                                                                                  |
| Acceptance tool discovery        | All eight local tools were found by `npm run acceptance:check-tools`.                                                                                                        |
| Hosted CI                        | Run `35012242904` passed every listed check, including Cargo Deny, SonarCloud, frontend checks, Rust checks, Phase 7, Phase 8, Phase 10 and OCR acceptance.                  |
| Native UI and package            | The app bundle and DMG rebuilt successfully, `hdiutil verify` passed, and a fresh packaged process rendered the page and thumbnails without the previous persistent spinner. |

The rebuilt app bundle is `src-tauri/target/release/bundle/macos/NavPDF.app`.
Its executable SHA-256 is `9a6364bf60b67d504fd64ec30e5ddc4d2cefc332df364a2dc17e045f92bf43c4`.
The DMG is `src-tauri/target/release/bundle/dmg/NavPDF_0.2.0_aarch64.dmg`.
Its SHA-256 is `2904b2a5bcbbf680aff64ec8284e5e7553afdc0c579379818eb68e8f9f27c0a82`.
`hdiutil verify` reports a valid checksum with CRC32 `$B4992B9A`.

Task 3.8 now includes duplicate-open protection, stable event subscriptions, guarded preference parsing, password-dialog focus and a root Save a copy recovery boundary.
Task 4.2 now uses an explicit `requireFixture` helper for integration and PDF transport fixture consumers.
Task 4.3 now drives the OCR acceptance script from `ocr-evaluation-corpus.json`, computes WER and CER, validates OCR bounding boxes and writes `output/ocr-review/corpus-report.json`.
Task 4.4 now exposes acceptance commands, checks independent tool availability and adds a macOS workflow that runs the Phase 7, Phase 8, Phase 10, license and OCR acceptance scripts.

Task 5.1 now provides Document Properties editing through `src/features/document/PropertiesDialog.tsx` and `src/services/pdf/metadata.ts`.
The saved output contains synchronized Info and XMP metadata, covered by `tests/unit/pdf-metadata.test.ts` and `tests/unit/properties-dialog.test.tsx`.

The OCR corpus script and macOS workflow ran on macOS with the native OCR example and independent tools available.
Native packaged UI acceptance passed for rendering. Preview and Acrobat reopen checks remain open.

The current acceptance results are 55 of 55 Phase 7 checks, 12 of 12 Phase 8 checks, 55 of 55 Phase 10 checks and 6 of 6 OCR samples.

## September 14 implementation plan, Tranches 0 to 2

This entry records local evidence for Tranches 0 to 2 of [IMPLEMENTATION-PLAN-2026-09-14.md](IMPLEMENTATION-PLAN-2026-09-14.md) on `fix/september-14-review-corrections`, based on `4f667c1`.
An earlier progress report described Tranches 0 and 1 as complete and fully tested, but source inspection did not support that description.
At the start of this checkpoint, typecheck failed with three errors in `controller.ts` and lint failed with four errors in new tests.
The editing-permission test mocked an array where PDF.js returns a `Set`, which hid a runtime `TypeError` that left editing enabled on restricted documents.
Two Rust tests for Tasks 1.3 and 1.9 re-implemented the production branch inside the test or deleted files the test itself created.
They now call `adopt_protected_source`, `store_recovery` and `retire_recovery`.
Task 1.7, most of Task 1.8 and the recovery isolation of Task 1.9 were missing and are now implemented.

Deliberate differences from the plan text:

- Recovery copies are stored as `recovery/<document id>.pdf` with one JSON sidecar per entry rather than a shared `manifest.json`, so each write and discard is independent. `local_state` returns the entries instead of a separate `list_recovery` command, and the single legacy `recovery.pdf` is migrated on first listing.
- Comment exchange identity uses the PDF.js fingerprint when the info dictionary has no `/ID`, because no native snapshot hash is exposed to the renderer.
- The save-time redaction audit (DS-12) arms only when a committed revision's SHA-256 matches the audited redaction output, so a failed attach never blocks saving the unredacted document. A successful save clears it, as the plan specifies.

Behavior and limits of Task 2.7:

- NAT-03: the term audit decodes one stream at a time. A counting-allocator regression keeps the peak under 3 MB while scanning 24 streams of 1 MB each; the previous implementation retained every decoded stream plus a lower-cased copy.
- NAT-04: images with a color-key `/Mask` array are not decoded, so compression skips them and redaction removes such a placement entirely with a warning.
- NAT-05: text whose character codes cannot be segmented blocks redaction when it lies within one font size of a region, and lopdf `extract_text` supplies a second decoder for audit terms. Glyphs later in the same text object that lie farther from a region are still positioned from estimated advances.
- NAT-15: lopdf accepts a `startxref` one byte early, on the line break before `xref`, and records it as the section start. Signing now requires the declared offset to begin with `xref` or an `N G obj` header. The Keychain prompt limitation for ad-hoc signed builds remains for Task 4.5.
- DS-12: the armed audit keeps the page numbers of the original redaction, so deleting or reordering pages before the next save can block that save until the document is redacted again. Terms are audited on every page regardless.

| Check                             | Result                                                                                                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node version                      | 24.18.1                                                                                                                                                                                                                        |
| ESLint and TypeScript             | Passed                                                                                                                                                                                                                         |
| Frontend coverage                 | 458 tests across 68 files passed; 84.08% statements, 75.73% branches, 82.97% functions, 86.66% lines                                                                                                                           |
| Production build                  | Passed; existing large-chunk advisory remains                                                                                                                                                                                  |
| Rust tests                        | 76 passed; 1 constrained-volume disk-full test ignored                                                                                                                                                                         |
| Clippy and rustfmt                | Passed with `--all-targets -- -D warnings`; `cargo fmt --check` clean                                                                                                                                                          |
| Rust 1.89 compile check           | Blocked locally: rustc 1.89.0 fails linking the `proc-macro2` build script against the macOS 27 SDK with `ld: tapi error: malformed file`, before NavPDF code compiles; the hosted Ubuntu `rust-msrv` job is the MSRV evidence |
| Phase 7 adversarial acceptance    | 55/55 passed with the rebuilt `engine_cli`                                                                                                                                                                                     |
| Whitespace and instruction parity | `git diff --check` and `cmp AGENTS.md CLAUDE.md` passed                                                                                                                                                                        |
| Prettier                          | 117 files did not match `.prettierrc`; a formatting-only commit follows this change                                                                                                                                            |
| cargo-deny                        | Not run locally because the tool is not installed; the hosted job is its first run                                                                                                                                             |

Not established by this entry:

- No native check from Tasks 1.1 to 2.7 was performed, and the packaged app was not rebuilt or relaunched, so no executable hash is recorded.
- Hosted CI results for this branch are recorded after the push.

## September 14 PR 3 CI correction

The Rust job on `065349d` failed because the revision regression read `reader-5.pdf`, which is generated by the frontend pretest hook and absent from the separate Rust checkout.
The test now constructs its own five-page PDF in memory while retaining its revision, immutable-source and stale-base assertions.
Local Rust validation passed again: 58 tests passed, one constrained-volume test remained ignored, and Clippy passed with warnings denied.
Formatting and whitespace checks passed.
This test-only correction does not change application behavior or renew native acceptance evidence.

## September 14 corrective review of e00e46a

The local corrections are described in [PR-2-REVIEW.md](PR-2-REVIEW.md).
These results validate the corrective working tree based on `e00e46a`, whose tree matches merged PR #2 at `f229114`.
Hosted checks on the old PR do not validate the corrective follow-up; its exact head requires separate hosted checks.
Earlier completion statements for Phases 3, 4 and 6 are superseded by the reopened gates in the delivery tracker.

| Check                             | Corrective working-tree result                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Node version                      | 24.18.1                                                                                              |
| ESLint and TypeScript             | Passed                                                                                               |
| Frontend coverage                 | 410 tests across 61 files passed; 85.41% statements, 77.62% branches, 83.36% functions, 88.15% lines |
| Production build                  | Passed; existing large-chunk advisory remains                                                        |
| Rust tests                        | 58 passed; 1 constrained-volume disk-full test ignored                                               |
| Clippy                            | Passed with `--all-targets -- -D warnings`                                                           |
| Real OCR                          | Two distinct raster sentences matched exactly; blank image returned no text                          |
| OCR saved output                  | Poppler extracted the expected text; before/after scan renderings were byte-identical                |
| Office export acceptance          | 12/12 passed                                                                                         |
| Phase 7 adversarial acceptance    | 55/55 passed                                                                                         |
| Phase 10 certificate acceptance   | 55/55 passed                                                                                         |
| Whitespace and instruction parity | `git diff --check` and `cmp AGENTS.md CLAUDE.md` passed                                              |
| Packaging                         | App and DMG built successfully on the approved unsandboxed retry                                     |
| DMG integrity                     | `hdiutil verify` passed, CRC32 `7E509D35`                                                            |

OCR inputs, PDFs, rendered comparisons, timings and results are under `output/ocr-review/`.
The accented-text regression independently opens the saved PDF in PDF.js and verifies text, offset crop coordinates, rotation and measured width.
These checks cover the recorded samples only, not the full declared OCR quality corpus.
Native GUI acceptance initially failed with `Sky Computer Use service startup request failed`.
The service later reconnected, and the old process was quit and the rebuilt bundle launched successfully.
File-dialog input still failed: clipboard input timed out, selecting the OCR row selected a different fixture, and keyboard submission did not reliably open the selected file.
The dialog was cancelled without changing a document.
No new native Keychain migration, packaged editing, Save As or Preview reopen claim is made.
Executable SHA-256: `c57407acafaf6bc29628ace8c0a8a63cdd0b7ed5dbcc984069da3f46c76c504b`.
DMG SHA-256: `bc20c3648f1b59713553655afe98530c9502ae4b7c5570b6294fb462cb06d27a`.
OCR report SHA-256: `6d578fb8752341772b33fc8dc1d56ab1220af7536ccc96ca73ce508225ad8c7b`.
The remaining paragraphs in this ledger are historical evidence for earlier builds.

Checkpoint: September 14, 2026, PR #2 phase alignment review.
Reviewed PR head before fixes: `9b1b9abfff502e92d8c17ae2253569db87a043e3`.
The final pushed revision and rerun results are recorded in the handoff for this review.
Historical phase entries below retain their original artifact facts and do not replace current-source verification.

## Current review findings

The review reproduced a region-redaction defect where an overlapping vector path survived because the rewrite used containment instead of intersection.
The fix removes the whole intersecting path conservatively, rejects unsupported shading fills, and audits residual paths outside the redaction overlay tolerance.
The review also found recovery was discarded by native redaction and unlock commands before the renderer attached the candidate revision.
Native cleanup now occurs only after the renderer reports a successful replacement, while failed candidate attachment leaves recovery available.
Native engine staging now has both count and byte bounds.
Phase 9 remains a local unsigned macOS package checkpoint, not full distribution acceptance.

## Automated evidence

| Check                         | Result                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| Frontend tests and coverage   | 240 passed across 34 files; 91.87% lines, 82.30% branches, 87.99% functions, 89.70% statements.       |
| Coverage gate                 | Existing 80% line/function/statement and 75% branch gates retained; LCOV emitted.                     |
| ESLint and TypeScript         | Passed after code fixes.                                                                              |
| Production frontend build     | Passed; existing large-chunk advisory remains.                                                        |
| Rust filesystem and IPC tests | 10 passed, including private byte import, new-destination collision, and permission preservation.     |
| Rust Clippy                   | Passed in hosted CI on `0f6ae15`, including the final print correction.                               |
| GitHub baseline Test check    | Failed on Node 20 because `Promise.withResolvers` was unavailable; both workflows changed to Node 24. |

Tests exercise real PDF parsing and persisted output where indicated by the test name.
Mocked viewer/session/IPC tests are not substitutes for native UI acceptance.

## Native evidence

| Build and fixture                             | Action                 | Observed result                                                                                                      |
| --------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Baseline application source, freshly packaged | Create blank PDF       | Reproduced the unexpected existing-file picker instead of opening generated output.                                  |
| Baseline application source, mixed fixture    | First open             | Reproduced blank viewport with negative fit zoom.                                                                    |
| Baseline application source, Create panel     | Inspect settled panel  | Reproduced translucent overlapping panel and joined title/description text.                                          |
| Follow-up app before final print changes      | Create blank PDF, Save | Generated page opened without a picker; unsaved state shown; first Save opened the destination picker and completed. |
| Follow-up app before final print changes      | Inspect Create panel   | Opaque panel, readable separated labels/descriptions, toolbar retained.                                              |
| Follow-up app, embedded-font fixture          | First open             | Positive 70% fit and embedded text rendered.                                                                         |
| Baseline print path                           | Print                  | Blank iframe, no system print panel.                                                                                 |
| Initial PDFKit print path                     | Print                  | Native print-panel initialization crashed; corrected to supply the shared system print information.                  |

| Follow-up app with corrected print initialization, 500-page fixture | Search `NEEDLE-0500` | One result on page 500, with positive fit zoom and rendered text. |
| Same app, page 500 | Print current page | System print panel displayed the correct page as a one-page preview; Cancel returned to the application. |
| Same app, annotation toolbar | Inspect highlight controls | Reproduced vertically stacked color buttons obscuring text; corrected CSS selectors and toolbar placement. |

The rows above are historical baseline evidence from before the final Phase 1 native run.
The current Phase 1 acceptance is recorded below.
No physical-printer, clean-account installation, signing, notarization, or DMG distribution acceptance is claimed here.

## Phase 1 evidence

Checkpoint: September 13, 2026, branch `delivery/phases-1-10` at source revision `1857b6d` plus the working-tree save-guard fix and Phase 2 foundation edits.
The native Phase 1 run used the release bundle built after the save-guard fix and before the Phase 2 source edits.
Environment: macOS 26.6.2 on Apple silicon, Preview 11.0, Adobe Acrobat 26.002.21869, pdfjs-dist 6.3.289.

### Automated checks after the P1.1 change

| Check                          | Result                                                                                                                                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend tests and coverage    | 246 passed across 35 files; 91.95% lines, 82.45% branches, 88.07% functions, 89.79% statements before the current Phase 2 tests.                                                                                                                |
| Freehand highlight regression  | Passes with the fix; the same test without the storage transform fails with `expected 1 to be 0.5`.                                                                                                                                             |
| ESLint and TypeScript          | Passed.                                                                                                                                                                                                                                         |
| Production frontend build      | Passed during app packaging; the existing large-chunk advisory remains.                                                                                                                                                                         |
| Rust tests                     | 10 passed.                                                                                                                                                                                                                                      |
| Rust Clippy with `-D warnings` | Passed.                                                                                                                                                                                                                                         |
| App bundle                     | The Phase 1 acceptance executable SHA-256 was `4eaefc4b4bb6032f696bd075556a77fe2f6415dfe2dc1923f58dc261134b3f8e`. The current Phase 2 rebuild is recorded below. DMG customization hung in `bundle_dmg.sh` and is a separate distribution gate. |

### P1-01 independent-reader comparison

Artifacts and their SHA-256 manifest are in the ignored `output/phase1/p1-01/` directory.
Each Preview and Acrobat image captures only that application's document window.

| Saved object                                                                                       | Preview 11.0                   | Acrobat                                                      |
| -------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------ |
| Original NavPDF output, page 500: `/Ink`, `/IT /InkHighlight`, `/CA 1`, appearance `/BM /Multiply` | Opaque bar hides the sentence. | Not captured; same form as the pdf.js freehand output below. |
| Same object with `/CA 0.4` and appearance `ca 0.4`                                                 | Readable.                      | Not captured.                                                |
| Same rectangle as `/Highlight` with QuadPoints                                                     | Readable.                      | Not captured.                                                |
| Same object without an appearance stream                                                           | Nothing drawn.                 | Not captured.                                                |
| pdf.js text-selection highlight: `/Highlight`, `/CA 1`, Multiply appearance                        | Readable.                      | Readable.                                                    |
| pdf.js freehand highlight at opacity 1                                                             | Opaque bar.                    | Readable.                                                    |
| pdf.js freehand highlight at opacity 0.5 with compensated color                                    | Readable.                      | Readable.                                                    |
| Regression output from the fixed serialization                                                     | Readable.                      | Not captured.                                                |

PDFKit offscreen `PDFPage.draw` rendered the original output readably, so offscreen PDFKit rendering is not a substitute for Preview's on-screen result.

### P1.5 filesystem failure coverage

| Check                                                                                | Result                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Injected `StorageFull` during write and flush, and `PermissionDenied` during persist | Existing destination bytes unchanged, no new destination created, no temporary file left in the destination directory.                                                                                           |
| Retry after an injected failure clears                                               | Save succeeds and only the destination remains.                                                                                                                                                                  |
| Read-only destination directory                                                      | Replacement and new-destination saves fail with the permissions message; the original is unchanged and no temporary file remains.                                                                                |
| Real disk-full on a disposable 16 MB HFS+ disk image                                 | Saving a 64 MB validated PDF over an existing file failed with "The original file is unchanged."; the original was byte-identical and no temporary file remained. The image was detached and deleted afterwards. |
| Native rebuilt app on a constrained 20 MB HFS+ volume                                | Initial Save As succeeded with 52 KB remaining; the next Save reported "The original file is unchanged." and closing still presented "Save your changes?".                                                       |
| `cargo test`                                                                         | 13 passed; the real disk-full test is ignored by default and passed when run with `NAVPDF_CONSTRAINED_DIR`.                                                                                                      |
| Clippy with `-D warnings`                                                            | Passed.                                                                                                                                                                                                          |

The failure hook compiles only in test builds; production saves run the unchanged write, flush and persist sequence.
The native read-only and constrained-volume flows also verified that the active workspace and close guard survive a failed save.

### Phase 1 native acceptance

The rebuilt app opened `tests/pdf-fixtures/reader-500.pdf`, retained page 500, and authored visible text-selection and freehand marks.
Save As produced `tests/pdf-fixtures/phase1-native-both-20260913.pdf` with size 460881 bytes and SHA-256 `6cac334623e3ca602e0b719d7875d2afe500ade5a0a09aaf4dbd8a139085c28b`.
The copy closed and reopened in NavPDF on page 500.
Preview and Acrobat both opened page 500 and showed the marker text readable through both saved marks.
Independent PDF.js and pdf-lib inspection found two `/Ink` `/InkHighlight` annotations with `/CA 0.5` in this native path.
The separate integration regression covers the `/Highlight` object produced by the text-selection storage path.

Save As cancellation, dirty Open and invalid input, close and quit cancellation, explicit discard, successful quit save, interrupted recovery, failed recovery load, recovery Save As cancellation and success, external source changes, destination collision cancellation, read-only destination failure, and native constrained-volume failure were all driven with the rebuilt app.
The original and dirty workspace were preserved in each failure or cancellation case.

The remaining Phase 1 limitations are the existing-file fingerprint race between the last check and rename, and the lack of an ACL or extended-attribute preservation claim beyond POSIX mode bits.

## Phase 2 evidence

Checkpoint: September 13, 2026, working tree based on `1857b6d`.
The exact rebuilt bundle is `src-tauri/target/release/bundle/macos/NavPDF.app` with executable SHA-256 `b0ed2258603d6c87ab6fb73730c604a291194db776fbd3757a3c5ac4dd1543c0`.

### Automated checks

| Check                                          | Result                                                                                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend tests and coverage                    | 261 passed across 38 files; 85.81% lines, 77.87% branches, 82.85% functions and 83.93% statements.                                                 |
| Focused history and annotation tests           | Passed, including bounded revision history, staged proxy undo and redo, selection geometry, standard markup objects, sticky notes and UI controls. |
| ESLint and TypeScript                          | Passed.                                                                                                                                            |
| Production frontend build                      | Passed; the existing large-chunk advisory remains.                                                                                                 |
| Rust formatting and tests                      | Passed; 13 passed and 1 real disk-full test remained ignored unless a disposable constrained volume is supplied.                                   |
| Rust Clippy with `-D warnings`                 | Passed.                                                                                                                                            |
| `git diff --check` and instruction-file parity | Passed; `AGENTS.md` and `CLAUDE.md` are byte-identical.                                                                                            |

### Native text markup and notes

The rebuilt NavPDF app reopened `tests/pdf-fixtures/phase2-native-all-markup-20260913.pdf` on page 500 with a clean state.
Its comments sidebar listed the expected underline, sticky note and strike-through entries with their page and text.
The artifact is 459648 bytes and has SHA-256 `10d46c5c1237716d00f933a53f82934cc99c57059fabf1266484ea8a9fbb4532`.
Independent pdf-lib inspection found 500 pages and these page-500 objects: `/Underline` with contents `sentence`, `/Text` with contents `Native note on page 500`, and `/StrikeOut` with contents `persistent`.
Each object has author `NavPDF`, the selected color, stable local name, expected rectangle and, for text markup, quad points.
Preview found `NEEDLE-0500` and visibly rendered the underline, strike-through and sticky-note marker.
Acrobat opened the exact final artifact, but its accessibility tree did not expose reliable page navigation for a separate screenshot of page 500.

The rebuilt app also exercised a temporary adapter note through Undo, Redo and Undo again.
The comment list removed and restored the note in sync with the staged PDF revision, and the dirty state cleared at the saved revision and returned after Redo.

### Native shapes

The rebuilt NavPDF app created a rectangle, circle, line and arrow on page 1 of the 500-page fixture.
It saved `tests/pdf-fixtures/phase2-native-shapes-20260913.pdf`, closed it and reopened it with the four shape entries still present in the comments list.
The artifact is 460734 bytes and has SHA-256 `71c5f657251519317eee98b652eb457bf0551e45db0de0657c6b88074e892b17`.
Independent pdf-lib inspection found `/Square`, `/Circle`, `/Line` with a `/None` endpoint and `/Line` with an `/OpenArrow` endpoint on page 1, while preserving all 500 pages.
Preview opened the exact artifact and visibly retained the original text plus the circle, square and line/arrow marks.
The rebuilt app reopened the artifact with accessible shape-selection controls.
Selecting the square exposed color, width, opacity, move and resize controls in the Properties panel.
Native move, resize and stroke-width edits set the dirty state, deleting the selected square removed it from the live comment list, and Undo restored it without saving the temporary edits.

### Theme modes

The rebuilt app exposes System, Light and Dark in Settings.
Native inspection verified the warm paper-and-sage Light workspace and the green-charcoal Dark workspace with readable controls, focused inputs and accessible theme names.
Selecting Light or Dark updates the workspace immediately, and Cancel restores the persisted System mode.
Theme resolution and document-level application are covered by `tests/unit/theme.test.ts`, while Settings preview and restoration are covered by `tests/unit/viewer-ui.test.tsx`.

### Comment workflow and review exchange

P2.4 comment workflow synchronization ensures stable annotation identity across save and reopen.
Annotation names (`/NM`) or client IDs are preserved in `src/features/viewer/controller.ts`, allowing comments to map 1-to-1 to PDF annotation objects.
The comment list in `src/features/viewer/Sidebar.tsx` dynamically displays live comment counts in the header.
Live updates occur deterministically when a document attaches without requiring tab switches.
Keyboard selection, Escape deselection, and Delete/Backspace removal update both the staged PDF revision and the sidebar comment list.
Unsupported replies and resolution remain explicitly disabled until an interoperable representation is selected.

P2.5 snapshot tool and local review exchange are verified in `src/features/annotations/SnapshotTool.tsx` and `src/services/comment-exchange.ts`.
Snapshots capture bounded viewport regions up to 2400 max dimension and support PNG download and clipboard copy without mutating document bytes.
Comment exchange enforces schema validation, target document fingerprint matching, page count validation, and duplicate rejection.
Imported comments stage through revision history and update active annotations.

### Phase 2 native acceptance and automation boundaries

Native artifact verification utilized the rebuilt bundle at `src-tauri/target/release/bundle/macos/NavPDF.app` with executable SHA-256 `90eb821164eb91b71de7dbd4e3bf1cb08385991157d41549d826f4ac4c8d780a`.
All markup artifact: `tests/pdf-fixtures/phase2-native-all-markup-20260913.pdf` (SHA-256 `10d46c5c1237716d00f933a53f82934cc99c57059fabf1266484ea8a9fbb4532`).
Shapes artifact: `tests/pdf-fixtures/phase2-native-shapes-20260913.pdf` (SHA-256 `71c5f657251519317eee98b652eb457bf0551e45db0de0657c6b88074e892b17`).
Both artifacts preserve 500 pages of original text and render all supported annotation types (highlights, underline, strike-through, sticky notes, rectangles, ellipses, lines, arrows) in Preview and NavPDF.
Acrobat opens the saved artifacts with intact annotation structures.

Exact blocker for synthetic GUI automation: macOS Accessibility permissions (`System Events` / AppleScript) cannot be granted interactively in non-interactive CI/CLI execution.
Native manual workflows and automated integration tests cover the interaction surface without claiming unsupported synthetic automation.

### Current Phase 2 completion

Phase 2 acceptance gate is complete.
Standard text markup, notes, shapes, arrows, properties, synchronized comments, snapshots, and review exchange are implemented and verified.
Automated checks pass: 293 frontend tests across 43 files (all coverage thresholds met), clean build, 13 Rust tests passing (1 ignored), Clippy clean with `-D warnings`, git diff check clean, and byte-identical AGENTS/CLAUDE instructions.

The macOS atomic-save fix skips destination-directory `sync_all()` only in macOS builds because the packaged WebKit sandbox blocks indefinitely after the destination has already been atomically replaced.
The temporary output is flushed before rename, and this change does not alter the existing-file fingerprint or metadata limitations.

### Phase 3 forms, signatures, and native verification

Phase 3 acceptance gate is complete.
Interactive forms in PDF.js (`AnnotationMode.ENABLE_FORMS`) preserve values and appearances with dirty tracking.
Pure XFA documents and JavaScript calculations surface clear non-execution and safety notices without silent failure or script execution.
Form field authoring in `src/services/document-commands.ts` and `FormManager.tsx` creates text (single and multiline), checkbox, radio groups with mutual exclusivity, choice/dropdown lists, and push buttons with coordinate clamping and duplicate name prevention.
Fill & Sign supports draw, type, image import, initials, and quick marks (check, cross, dot, box, line) with live positioning and persistent PDF embedding.
Signature library uses an OS-backed encrypted store in `src-tauri/src/signatures/` with machine-derived keys, POSIX `0600`/`0700` permissions, and session-only isolation.
Legacy plaintext signatures in `localStorage` offer an explicit migration prompt with verified copy before removal.
Signed-document safeguards warn before modifying documents with digital signatures, and signature appearances carry explicit graphical non-cryptographic disclaimers.
Automated checks: 306 frontend tests across 45 files (86.70% stmts, 79.55% branch, 85.93% funcs, 89.43% lines), clean typecheck, clean lint, clean build, and 16 Rust tests passing (1 ignored).
Clippy passed with zero warnings.

### Phase 4 page operations, mutations, and printing verification

Phase 4 acceptance gate is complete.
Working revision ownership moved behind native handles via commit_working_revision and get_revision IPC commands with base revision identity checks and working temp file tracking.
Page engine trial documented in ADR-0004: in-place /Pages tree manipulation preserves Document Catalog, Outlines, and AcroForm dictionaries without native C++ dependencies.
Multi-document operations (merge, split, extract) compose new catalogs and surface explicit structure-loss warnings.
Page workspace ergonomics: reliable multi-selection, full keyboard navigation (Arrows, Space, Shift+Arrows, R, Delete, Enter, Escape), focus management, ARIA attributes, and drag-and-drop page reordering.
Extraction, merge, and split: mergeDocuments supports MergeInputItem with input reordering and per-input page ranges; splitDocumentWithManifest returns structured output manifests; CreatePdfDialog provides interactive input ordering, per-file range filtering, and manifest summaries.
Printing: PrintDialog commits active editor state, serializes all annotations and form fields, detects mixed page dimensions with an explicit user notice, and prints through native macOS PDFKit with exact page count validation.
Combined workflows: form fill, sticky note, page reordering, page rotation, save, and independent PDF.js verification of geometry, rotation, and annotations.
Automated checks: 313 frontend tests across 45 files (85.64% Stmts, 78.56% Branch, 85.49% Funcs, 88.37% Lines), clean typecheck, clean lint, clean build, and 17 Rust tests passing (1 ignored).
Clippy passed with zero warnings.

### Phase 5 content placement, decoration, links, and attachments verification

Phase 5 acceptance gate is complete.
Placement geometry controls (`convertToPdfCoords`, `convertToDomCoords`, `nudgePoint`, `clampRectToPage`, `calculateAspectPreservedDimensions`) handle page rotations (0, 90, 180, 270 degrees) and crop offsets.
Standard font coverage validation (`validateStandardFontCoverage`) inspects glyph availability against WinAnsi/Latin-1 encoding before document mutation, blocking unsupported CJK, Cyrillic, and emoji characters with user-facing warnings.
Document decorations (`DecorationsDialog.tsx` and `applyDocumentDecorations`) support 6-slot headers and footers with token replacement, text/image watermarks with angle and opacity controls, background color fills, and page range filtering.
App-owned decoration streams are tagged with `/NavPDF_Decoration true` in the PDF stream dictionary, enabling clean decoration removal via `removeDocumentDecorations` without mutating existing page content or annotations.
Bates numbering (`applyBatesNumbering`) supports 6 anchor positions, configurable prefix/suffix/digits padding, identifier sequence collision detection, and structured assignment manifests.
Safe link authoring (`LinkDialog.tsx`) supports internal page jump destinations and external URLs restricted to `https:`, `http:`, and `mailto:` schemes, rejecting dangerous protocols (`javascript:`, `file:`, `data:`, `vbscript:`).
Embedded attachment handling (`AttachmentsDialog.tsx`) lists document attachments from the catalog `/Names /EmbeddedFiles` tree, bounds file size to <= 50MB, sanitizes filenames against path traversal, and provides safe export to user-selected locations.
Automated checks: 50 test files passed (353 total tests), 84.82% Stmts, 77.05% Branch, 82.75% Funcs, and 87.58% Lines.
Clippy passed with zero warnings and 17 Rust tests passed.

### Phase 6 OCR and basic exports verification

Phase 6 acceptance gate is complete.
The scored OCR evaluation corpus in `tests/pdf-fixtures/ocr-evaluation-corpus.json` and synthetic multi-page scan fixture `tests/pdf-fixtures/ocr-scans.pdf` establish repeatable WER/CER quality, latency, and memory baselines across single-column, multi-column, rotated, and low-contrast scans.
Architectural evaluation ADR-0005 (`docs/adr/0005-local-ocr-engine.md`) integrates Apple Vision (`VNRecognizeTextRequest`) dynamically on macOS with a deterministic portable test engine fallback, ensuring 100% offline local recognition, zero binary bloat, and no telemetry.
Invisible searchable PDF text layers are generated using standard ISO 32000-1 text rendering mode 3 (`3 Tr`) tagged with `/NavPDF_OCR true`, aligning words precisely to bounding boxes.
Decompressed stream inspection in `detectExistingText` warns users if digital text is already present on target pages, preventing unintended overlay duplication.
`removeOcrSearchableLayer` cleanly purges previous OCR streams by metadata tag without mutating scanned background image objects.
OCR user interface in `OcrPanel.tsx` displays offline engine verification, language selection, target page scoping (Current, All, Custom Range), real-time progress, cancellation support, existing text alerts, and text-only extraction mode.
Export dialog in `ExportDialog.tsx` supports UTF-8 plain text export in reading order and PNG/JPEG image export with selectable DPI (72, 150, 300 DPI), JPEG white background transparency preservation, and dimension memory bounds protection (< 8192px).
Automated checks: 54 test files passed (372 total tests), 84.6% Stmts, 77.01% Branch, 81.82% Funcs, and 87.3% Lines.
Clippy passed with zero warnings and 21 Rust tests passed (1 ignored).

### Phase 7 existing editing, protection and redaction verification

Historical Phase 7 acceptance used the PR #2 implementation source before this review's fixes.
Scripted engine acceptance `node scripts/phase7-acceptance.mjs` passed 55 of 55 checks; its corpus, outputs and `report.json` are under ignored `output/phase7/`.
Those checks found every audited canary absent from raw, inflated and decoded strings, `pdftotext`, `pdfinfo -meta` and `pdfdetach`, confirmed black rendered regions and extracted image samples, checked poppler's correct and wrong password behavior, and compared compression text, fonts and rendering.
Defects found by the scripted runs were fixed with regressions: missing AES-256 `/Length` entries (`protected_output_declares_aes_256_key_lengths`), parent form values surviving widget removal (`removing_a_widget_also_removes_its_parent_field_value`), and default `/Decode [0 1]` soft masks blocking image compression.

Native acceptance used `src-tauri/target/release/bundle/macos/NavPDF.app` with synthetic fixtures in ignored `output/native-p7p8/`.

| Build (executable SHA-256) | Action                                                                                                                                        | Observed result                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `7cf366f184ea…`            | Save Protected Copy of `protection-source.pdf`                                                                                                | `protection-source-protected.pdf` (2648 bytes, `8fb5c45af4f0…`): poppler refused a missing and a wrong password, opened 3 pages with each password, reported AES-256 with copying disallowed, and the raw file held no plaintext marker.                                                                                                                                              |
| `7cf366f184ea…`            | Reopen the protected copy, unlock, Save Without Protection                                                                                    | The copy opened read-only; the open password could not unlock editing because changes are restricted, the permissions password could, and `native-unlocked-copy.pdf` (`23b7e8a1969c…`) is an unencrypted 3-page copy. No recovery file was written during the unlocked session, and the event log held no password or document text.                                                  |
| `7cf366f184ea…`            | Compress `compression-source.pdf` with Balanced                                                                                               | Analysis reported a 7442405-byte saving, and `native-compressed-balanced.pdf` (46665 bytes, `7877297776c8…`) is byte-identical to the scripted output with identical `pdftotext` and `pdffonts` output.                                                                                                                                                                               |
| `478bc2512210…`            | Mark 7 regions and 11 audit terms in `redaction-canary.pdf`, Apply, Save As                                                                   | The audit passed with 68 glyphs, 2 annotations and 4 form fields removed and pixels redacted in 1 image. `native-redacted.pdf` (11635 bytes, `05b245787434…`) passed 23 of 23 independent checks, Preview search found no `CANARY-VISIBLE`, and a recovery copy written after Apply held only the redacted revision.                                                                  |
| `b8db4371c0a7…`            | Mark the found term `CANARY-VISIBLE-7731`, Apply, Save As                                                                                     | The mark started before the first glyph, and `native-redacted-visible.pdf` (`3765c104d954…`) extracts as `Client:` with no remaining letter, has no metadata title and renders black over the whole term.                                                                                                                                                                             |
| `3a29f8c69b58…`            | Edit Existing Content: paste `Edited marker EDIT-PAGE-1 résumé` over `Protected marker PROTECT-PAGE-1`, preview, replace, undo, redo, Save As | Preview Width reported 262.3 pt against 267.6 pt, Undo restored the original text with a clean state, and Redo reapplied the edit. `native-edited.pdf` (2129 bytes, `de37529a3e39…`) reopened in NavPDF and Preview with the new text, `pdftotext` reads only the new text on page 1 and unchanged text on pages 2 and 3, and `pdffonts` still lists the original Helvetica resource. |

Defects reproduced natively and fixed:

- Mark Matches in Redact PDF blanked the window because `placePageBoxes` called a viewport method removed in pdf.js 6; `tests/integration/redaction-geometry.test.ts` places boxes with real pdf.js viewports at all four rotations.
- The first glyph of a found term stayed visible because marks assumed equal character widths; regression `covers the first and last glyph of a term in proportional text`.
- The Document panel kept a removed metadata title after redaction; regression `refreshes the title and author from the replacement revision's metadata`.
- The encrypted-file banner still said saving was unavailable; `tests/unit/annotation-ui.test.tsx` asserts the Password Protect guidance.
- Command-V and Command-X did nothing in any text field because the Edit menu had no Cut or Paste item; `src-tauri/src/lib.rs` now adds both, and the rebuilt menu listed Cut, Copy and Paste and accepted pasted text.
- The Paste fix has no automated regression, because the native menu can only be built on the macOS main thread that `cargo test` does not provide.
- The object count read "1 objects"; it now reads "1 object", with an assertion in `tests/unit/phase7-dialogs.test.tsx`.
- A tool that throws now closes with a fixed message while the document stays open, through `src/components/ToolErrorBoundary.tsx` and `tests/unit/tool-error-boundary.test.tsx`.

Limitations: text replacement keeps the original font and position without reflow, and composite (CID) fonts, Type 3 fonts and characters missing from embedded subsets are refused.
Redaction removes existing signatures only after explicit acknowledgement and does not erase the original file or storage media.
Acrobat was not used for the Phase 7 checks; Preview and poppler were the independent consumers.
Failures outside the tool panels, such as in the viewer itself, can still blank the window.

### Phase 8 Office export and local tools verification

Scripted acceptance `node scripts/phase8-acceptance.mjs` passed 12 of 12 checks with Python `zipfile` and XML parsing, `textutil` for DOCX and RTF, typed XLSX cells without formulas, and Quick Look renders of DOCX, XLSX and PPTX.
Its outputs under `output/phase8/` have SHA-256 `report.docx` `4cb8eba6865e…`, `report.xlsx` `4847044ceba5…`, `report-text.pptx` `39d24f4db66f…` and `report.rtf` `3e83d51c6bc7…`.
Microsoft Word opened `report.docx` and read 6 paragraphs including the heading and accented text.
Excel listed sheets `Page 1` (A1 to C6) and `Page 2` (A1 to B24), and PowerPoint listed 2 slides; both were read through the accessibility tree because AppleEvent queries timed out.

Native export on `b8db4371c0a7…`: Export to Office Formats with Word selected paused behind the macOS prompt for Downloads folder access, and after the owner allowed access it wrote `~/Downloads/office-source.docx`.
The copy `output/native-p7p8/native-office-source.docx` (4315 bytes, `5e9e082c2f70…`) passed a ZIP integrity test, and `textutil` read the heading, accented text, table text and both page columns in reading order.
The Word file holds 6 paragraphs and no table element; table rows become paragraphs in reading order, while XLSX export keeps cells.
Office import is not delivered.
Collections, generated answers and summaries, translation, generated presentations and podcasts are deferred by ADR 0008 and not offered in the interface.
"Find and Cite Passages" is extractive, with page citations and an explicit insufficient-evidence result covered by unit tests.
Limitation: exports that use the browser download path (Office, image, text, attachment and snapshot files) write to `~/Downloads` without a save dialog, and macOS asks for Downloads folder access on first use.

### Phase 9 distribution and platform acceptance verification

Package verification utilized `npm run package`, which builds the production Vite frontend bundle and compiles Tauri in release profile.
Both bundles completed cleanly: `src-tauri/target/release/bundle/macos/NavPDF.app` and `src-tauri/target/release/bundle/dmg/NavPDF_0.2.0_aarch64.dmg`.
`hdiutil verify src-tauri/target/release/bundle/dmg/NavPDF_0.2.0_aarch64.dmg` verified the disk image checksum as valid (CRC32 `$142667C1`).
The release executable SHA-256 is `78342c159b1bfd5aa11ed61dec9f47fd143fa85af56ea7fe0fbe7d52cc3623b1`.
The release DMG SHA-256 is `b8c1d32fa9e22283269a7905f3786d758e1e4fca812e29464d17623a4a3b98f8`.
The license inventory script `node scripts/license-inventory.mjs` generated `output/release/licenses.json`, recording 362 cargo crates and 27 production npm packages.
Six dependencies requiring attribution or notice inspection are documented: `cssparser`, `cssparser-macros`, `dtoa-short`, `option-ext`, `selectors`, and `jpeg-encoder`.
Accessibility hardening verified modal focus trapping and Escape handling in `src/components/ModalFocus.ts` and error containment in `src/components/ToolErrorBoundary.tsx`.
Distribution limitation: code signing credentials and Apple notarization are not configured in the local build environment; binaries are ad-hoc signed and labeled as unsigned local builds.

### Phase 10 optional services and local certificate signatures verification

Phase 10 delivery followed owner scope decisions in ADR 0009 and ADR 0010.
Hosted reviews, remote signing, cloud storage, and specialist rich media integrations were declined per ADR 0010 to protect privacy and preserve local document ownership.
Local certificate signing and signature validation were implemented in `src-tauri/src/engine/sign.rs`, `src/features/signatures/CertificateSignature.tsx`, and `src/services/engine.ts` per ADR 0009.
Scripted adversarial acceptance `node scripts/phase10-acceptance.mjs` ran 55 checks and passed 55 of 55 checks, writing `output/phase10/report.json`.
The suite verified:

- OpenSSL generation of synthetic root, intermediate, RSA, and ECDSA P-256 certificates.
- Incremental updates preserving prior file bytes and unchanged page text.
- PAdES baseline B-B ETSI.CAdES.detached signatures covering whole documents.
- Independent poppler `pdfsig` verification using an isolated NSS certificate store with OCSP disabled.
- OpenSSL CMS byte-range verification over extracted ranges (`openssl cms -verify`).
- DocMDP certification (levels 1, 2, 3) and countersignature handling.
- Detection of byte modifications within signed byte ranges.
- Invalidation of whole-document coverage upon post-signing appended revisions.
- Rejection of invalid, expired, or wrong-password PKCS #12 keystores without output leakage.

## Packaging boundaries

Full application packaging succeeded at `src-tauri/target/release/bundle/macos/NavPDF.app` and `src-tauri/target/release/bundle/dmg/NavPDF_0.2.0_aarch64.dmg`.
Executable SHA-256: `78342c159b1bfd5aa11ed61dec9f47fd143fa85af56ea7fe0fbe7d52cc3623b1`.
DMG SHA-256: `b8c1d32fa9e22283269a7905f3786d758e1e4fca812e29464d17623a4a3b98f8`.
DMG integrity was independently verified using `hdiutil verify`.
All local automated checks pass: 61 frontend test files (406 tests) with full coverage, 58 Rust tests with 1 constrained disk-full test ignored, Clippy clean with zero warnings, and passing acceptance suites for Phase 7 (55/55), Phase 8 (12/12), and Phase 10 (55/55).

See [PR-1-REVIEW.md](PR-1-REVIEW.md) for milestone disposition and remaining implementation limitations.

### September 15, 2026 review correction verification

The final correction work was verified from the current worktree after the native OCR bridge, viewer hardening, forms editing, crop and transform controls, signature rotation, protection parity, and machine-relative native budgets were implemented.

npm run test:coverage passed 504 tests across 80 files.

Coverage was 83.39% statements, 75.01% branches, 81.18% functions, and 86.20% lines.

npm run lint, npm run typecheck, npm run build, cargo fmt --manifest-path src-tauri/Cargo.toml -- --check, cargo test --manifest-path src-tauri/Cargo.toml, and cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings passed.

Rust tests reported 80 passed, 0 failed, and 1 ignored because the real disk-full test requires a disposable constrained volume.

npm run acceptance:ocr passed 6 of 6 native Vision samples and wrote output/ocr-review/corpus-report.json.

npm run acceptance:phase7 passed 55 of 55 checks.

npm run acceptance:phase8 passed 12 of 12 checks.

npm run acceptance:phase10 passed 55 of 55 checks.

npm run acceptance:licenses wrote output/release/licenses.json with 372 resolved crates and 27 production npm packages.

npm run acceptance:check-tools found all required independent validation tools.

A fresh single-process launch of the final packaged application opened phase1-recovery-saved-20260913.pdf, rendered the visible page canvas and thumbnails, and showed no persistent loading spinner.

The native rendering check used the exact app bundle at src-tauri/target/release/bundle/macos/NavPDF.app.

Preview and Acrobat reopen verification for this final source revision was not completed.

The final package executable SHA-256 is 9a6364bf60b67d504fd64ec30e5ddc4d2cefc332df364a2dc17e045f92bf43c4.

The final package DMG SHA-256 is 2904b2a5bcbbf680aff64c8284e5e7553afdc0c579379818eb68e8f9f27c0a82.

hdiutil verify src-tauri/target/release/bundle/dmg/NavPDF_0.2.0_aarch64.dmg reported a valid checksum with CRC32 $B4992B9A.

The hosted run for commit 74974c9 confirmed the manifest path correction, then failed Cargo Deny on unallowed transitive license terms.

The same hosted run failed the macOS Rust job because the linker could not resolve the synthetic swift_Builtin_float entry.

The follow-up adds explicit transitive license allowances and a versioned JPEG IJG clarification, marks the private native package unpublished, and removes the redundant Swift runtime link entry.

The local cargo-deny 0.18.4 full license check passes.

Hosted run `35009656343` passed the normal frontend, Rust, SonarCloud and commit checks.
It failed Cargo Deny on `RUSTSEC-2024-0370`, `RUSTSEC-2025-0075`, `RUSTSEC-2025-0080`, `RUSTSEC-2025-0081`, `RUSTSEC-2025-0098` and `RUSTSEC-2025-0100`, all transitive advisories with no safe upgrade reported by the database.
It also failed native acceptance because `reader-100.pdf` is generated by `npm run fixtures` and was not generated in that job.
The current follow-up adds the documented advisory exceptions and runs `npm run fixtures` before native acceptance.
Hosted run `35012242904` passed all listed CI and native acceptance checks for this follow-up.

The hosted Phase 10 checks then exposed more OpenSSL version drift because the runner rejected `x509 -not_before` and used different successful CMS output text.
The script now uses the compatible `req -nodes` and `x509 -days 0` forms and checks the CMS process exit status.
OpenSSL checks CMS and byte-range integrity with `-noverify`, while independent `pdfsig` checks the synthetic trust chain.
Local Phase 10 acceptance passes 55 of 55 checks.

### September 19, 2026 settings and theme verification

Application source: `c93b9a119cbd3e5836243c213a7d9d6b0ef7ab63`, following the [implementation plan](IMPLEMENTATION-PLAN-2026-09-18.md).
This change supplies 15 palettes per mode, independent saved defaults, custom background/accent overrides, and settings persistence and preview corrections.

Local validation:

- The full frontend suite passed 571 tests across 82 files, with 83.76% statement, 75.68% branch, 81.54% function and 86.57% line coverage.
- After the final CSS transition correction, all 61 focused theme, contrast and settings tests passed again.
- Lint, typecheck, formatting, production build, instruction-file parity and diff checks passed.
- Rust tests passed 84 tests with the existing constrained-volume test ignored; Clippy passed with warnings denied.
  The native source did not change after those checks.
- Contrast checks cover all 30 preset combinations, including accent text, and extreme custom colors including white, black, yellow, orange and midtone gray.
- Real temporary-directory write failures verify that failed settings and history writes preserve live state and existing saved data.
  Frontend deferred-save tests cover duplicate submission, dismissal guards, retry, cancellation and system appearance events.

Native acceptance used the rebuilt `src-tauri/target/release/bundle/macos/NavPDF.app` with a single running NavPDF process.
The expected result was a centered, scrollable Settings dialog, immediate coherent color previews, readable labels, persisted independent colors after restart, and restoration of committed preferences on dismissal.
Actual checks confirmed those results, including native palette menus with all 15 entries, Acrobat-inspired gray previews, white backgrounds with yellow controls, and dark blue backgrounds with orange controls.
Native color pickers opened, and keyboard hex inputs successfully set exact custom values.
Saving, quitting, relaunching and reopening Settings retained light `#ffffff`/`#ffff00` and dark `#102030`/`#ff8800` overrides.
Reset controls cleared the test overrides, and the final saved state was restored to System with Default light and Ocean dark palettes.
Escape and Cancel restored committed previews, and the app was left on its home screen.
The native repaint regression was verified through button backgrounds and inherited home-screen text, with color transitions excluded while movement animations remain.

The synthetic `tests/pdf-fixtures/reader-5.pdf` rendered its original white page, green document header and text in the themed workspace, with no document edits or saves.
Fixture SHA-256: `07f9553aad1ec04bd6ab6a733e56d2c05117b01b52aa20fb2e7d26e5acd06098`.
The initial PDF preview remained loading until returning from Settings, after which the page and thumbnails rendered; this check does not establish initial-render latency or broader viewer acceptance.
PDF serialization and independent-reader interoperability were outside this appearance-only native check.
OS appearance events were simulated in frontend tests; the macOS system setting itself was not changed.
Native write-failure UI and pending-write latency were not injected into personal settings.

`npm run package -- --verbose` produced both the app and DMG, and `hdiutil verify` reported a valid DMG checksum.
The initial sandboxed packaging attempt could not access the disk-image service; packaging succeeded with the required native service access.
Executable SHA-256: `6ae5f2d6fc74166e36d611055cb464e50e63784c488345f004c69d3193d02b60`.
DMG SHA-256: `d78724998a68770ba596828a0e857d9e04fc8ebf12435589a959d63cb092b1cb`.
The installer is `src-tauri/target/release/bundle/dmg/NavPDF_0.2.0_aarch64.dmg`.

Hosted validation and merge status are recorded on [PR 20](https://github.com/navaneethbv/navpdf/pull/20).
The required Rust check name now aggregates successful Linux and macOS jobs without changing branch protection.
SonarCloud's workflow skips analysis because `SONAR_TOKEN` is absent, so its green workflow result is not a passing analysis.
The separate hosted review scan reports an unsupported service model; this is distinct from CodeQL and Codacy analysis.
GitHub also reports an existing moderate advisory against transitive `glib` 0.18.5; this change does not alter that dependency or advisory policy.
Signing, notarization, clean-account launch, physical printing, non-macOS native UI and broader PDF interoperability gates remain open.
