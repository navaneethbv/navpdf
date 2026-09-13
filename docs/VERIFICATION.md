# Verification ledger

Checkpoint: September 13, 2026, PR 1 review follow-up.
Baseline revision: `64303bd32f07449c3f4fae7cc80915cfe8bb29e7`.
The commit containing this ledger identifies the reviewed follow-up source.
This ledger supersedes earlier contradictory native and packaging claims.

## Automated evidence

| Check | Result |
| --- | --- |
| Frontend tests and coverage | 240 passed across 34 files; 91.87% lines, 82.30% branches, 87.99% functions, 89.70% statements. |
| Coverage gate | Existing 80% line/function/statement and 75% branch gates retained; LCOV emitted. |
| ESLint and TypeScript | Passed after code fixes. |
| Production frontend build | Passed; existing large-chunk advisory remains. |
| Rust filesystem and IPC tests | 10 passed, including private byte import, new-destination collision, and permission preservation. |
| Rust Clippy | Passed in hosted CI on `0f6ae15`, including the final print correction. |
| GitHub baseline Test check | Failed on Node 20 because `Promise.withResolvers` was unavailable; both workflows changed to Node 24. |

Tests exercise real PDF parsing and persisted output where indicated by the test name.
Mocked viewer/session/IPC tests are not substitutes for native UI acceptance.

## Native evidence

| Build and fixture | Action | Observed result |
| --- | --- | --- |
| Baseline application source, freshly packaged | Create blank PDF | Reproduced the unexpected existing-file picker instead of opening generated output. |
| Baseline application source, mixed fixture | First open | Reproduced blank viewport with negative fit zoom. |
| Baseline application source, Create panel | Inspect settled panel | Reproduced translucent overlapping panel and joined title/description text. |
| Follow-up app before final print changes | Create blank PDF, Save | Generated page opened without a picker; unsaved state shown; first Save opened the destination picker and completed. |
| Follow-up app before final print changes | Inspect Create panel | Opaque panel, readable separated labels/descriptions, toolbar retained. |
| Follow-up app, embedded-font fixture | First open | Positive 70% fit and embedded text rendered. |
| Baseline print path | Print | Blank iframe, no system print panel. |
| Initial PDFKit print path | Print | Native print-panel initialization crashed; corrected to supply the shared system print information. |

| Follow-up app with corrected print initialization, 500-page fixture | Search `NEEDLE-0500` | One result on page 500, with positive fit zoom and rendered text. |
| Same app, page 500 | Print current page | System print panel displayed the correct page as a one-page preview; Cancel returned to the application. |
| Same app, annotation toolbar | Inspect highlight controls | Reproduced vertically stacked color buttons obscuring text; corrected CSS selectors and toolbar placement. |

The final native highlight/save/reopen attempt could not finish because the computer-use service failed and then timed out.
The annotation toolbar correction is included in the final successful app rebuild but has not received a final native visual confirmation.
No physical-printer, clean-account installation, signing, notarization, or complete native recovery/fault-injection acceptance is claimed.

## Phase 1 evidence

Checkpoint: September 13, 2026, branch `delivery/phases-1-10` based on `c0e38496099d32e93dd06798f6af36da050cda5c`.
The commit that adds this section identifies the P1.1 source change.
Environment: macOS 26.6.2 on Apple silicon, Preview 11.0, Adobe Acrobat 26.002.21869, pdfjs-dist 6.3.289.

### Automated checks after the P1.1 change

| Check | Result |
| --- | --- |
| Frontend tests and coverage | 246 passed across 35 files; 91.95% lines, 82.45% branches, 88.07% functions, 89.79% statements. |
| Freehand highlight regression | Passes with the fix; the same test without the storage transform fails with `expected 1 to be 0.5`. |
| ESLint and TypeScript | Passed. |
| Production frontend build | Passed during app packaging; the existing large-chunk advisory remains. |
| Rust tests | 10 passed. |
| Rust Clippy with `-D warnings` | Passed. |
| App bundle | `npm run package -- --bundles app` succeeded; executable SHA-256 `49743d4074f1664e25ec617c29b623e03bb58035d8498b183a625902749b9df8`. |

### P1-01 independent-reader comparison

Artifacts and their SHA-256 manifest are in the ignored `output/phase1/p1-01/` directory.
Each Preview and Acrobat image captures only that application's document window.

| Saved object | Preview 11.0 | Acrobat |
| --- | --- | --- |
| Original NavPDF output, page 500: `/Ink`, `/IT /InkHighlight`, `/CA 1`, appearance `/BM /Multiply` | Opaque bar hides the sentence. | Not captured; same form as the pdf.js freehand output below. |
| Same object with `/CA 0.4` and appearance `ca 0.4` | Readable. | Not captured. |
| Same rectangle as `/Highlight` with QuadPoints | Readable. | Not captured. |
| Same object without an appearance stream | Nothing drawn. | Not captured. |
| pdf.js text-selection highlight: `/Highlight`, `/CA 1`, Multiply appearance | Readable. | Readable. |
| pdf.js freehand highlight at opacity 1 | Opaque bar. | Readable. |
| pdf.js freehand highlight at opacity 0.5 with compensated color | Readable. | Readable. |
| Regression output from the fixed serialization | Readable. | Not captured. |

PDFKit offscreen `PDFPage.draw` rendered the original output readably, so offscreen PDFKit rendering is not a substitute for Preview's on-screen result.

### P1.5 filesystem failure coverage

| Check | Result |
| --- | --- |
| Injected `StorageFull` during write and flush, and `PermissionDenied` during persist | Existing destination bytes unchanged, no new destination created, no temporary file left in the destination directory. |
| Retry after an injected failure clears | Save succeeds and only the destination remains. |
| Read-only destination directory | Replacement and new-destination saves fail with the permissions message; the original is unchanged and no temporary file remains. |
| Real disk-full on a disposable 16 MB HFS+ disk image | Saving a 64 MB validated PDF over an existing file failed with "The original file is unchanged."; the original was byte-identical and no temporary file remained. The image was detached and deleted afterwards. |
| `cargo test` | 13 passed; the real disk-full test is ignored by default and passed when run with `NAVPDF_CONSTRAINED_DIR`. |
| Clippy with `-D warnings` | Passed. |

The failure hook compiles only in test builds; production saves run the unchanged write, flush and persist sequence.
These checks exercise `atomic_save` directly; NavPDF's Save and Save As error presentation on a full or read-only volume still needs native UI acceptance.

### Phase 1 native gaps

The rebuilt app has not yet been used to author highlights on the 500-page fixture and repeat Save As, close and reopen in NavPDF, Preview and Acrobat.
Synthetic mouse and keyboard input for driving NavPDF was not permitted in this session, so that workflow remains open.
P1.2 through P1.6 native acceptance has not been rerun.

## Packaging boundaries

The final `npm run package -- --bundles app` succeeded at `src-tauri/target/release/bundle/macos/NavPDF.app`.
Its executable SHA-256 is `30e80740cc004f6fec33bf369a3e1b0730d254cd607028d3a1fb6a3c21bdc8a8`.
All required hosted checks passed on code-fix commit `0f6ae15`; the subsequent CSS and documentation commit must pass the same checks before merge.
The subsequent standard DMG customization step failed in `bundle_dmg.sh` during this review.
An older DMG or its checksum does not establish the current app's installer acceptance.

See [PR-1-REVIEW.md](PR-1-REVIEW.md) for milestone disposition and remaining implementation limitations.
