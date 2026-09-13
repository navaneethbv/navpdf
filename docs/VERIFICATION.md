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

## Packaging boundaries

The final `npm run package -- --bundles app` succeeded at `src-tauri/target/release/bundle/macos/NavPDF.app`.
Its executable SHA-256 is `30e80740cc004f6fec33bf369a3e1b0730d254cd607028d3a1fb6a3c21bdc8a8`.
All required hosted checks passed on code-fix commit `0f6ae15`; the subsequent CSS and documentation commit must pass the same checks before merge.
The subsequent standard DMG customization step failed in `bundle_dmg.sh` during this review.
An older DMG or its checksum does not establish the current app's installer acceptance.

See [PR-1-REVIEW.md](PR-1-REVIEW.md) for milestone disposition and remaining implementation limitations.
