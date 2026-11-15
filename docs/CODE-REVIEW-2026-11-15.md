# Code review, November 15, 2026

Reviewed at `82dbc1f` on `main`.
Scope: the native crate under `src-tauri/src/`, the frontend under `src/`, tests, scripts, CI configuration and documentation.
Method: reading source, running the standard checks, a script that compared class names used in TSX with rules in `src/styles.css`, and the browser preview driven with Chromium for interface findings.
Observations are things seen in source or in a run; hypotheses are marked as such.
Line references describe the reviewed revision.

## Summary

The code base is in good condition for its size.
Document ownership stays behind typed IPC and opaque handles, saves are validated and atomic, the content security policy is strict, and there is no `dangerouslySetInnerHTML`, `eval`, lint suppression or leftover to-do marker in application source.
Lint, typecheck and the frontend suite passed at the baseline with 84.47% statement coverage.
The native suite passed except two tests that cannot pass when run as root, which is how this container runs.

Four defects were fixed in this change and are listed first.
The open findings are mostly robustness and performance edges, plus one group of interface states with no styling.

## Fixed in this change

| Area | Finding | Fix |
| --- | --- | --- |
| Viewer links | Clicking a web link annotation did nothing. PDF.js blanks `href` when external links are disabled, and the click handler read `href`. Reproduced in the browser preview with Chromium on a synthetic file; native WebKit reproduction was not available on Linux. | `HistoryLinkService.addLinkAttributes` records the address on the element and the handler reads it. Regression test: `tests/unit/external-link-address.test.ts`. |
| Native commands | `close_document` built legacy `recovery-{id}` paths from an identifier supplied by the renderer without validating it, then removed those paths. The files are no longer written, so this was dead code with a path traversal risk. | Removed. |
| Attachments | A failure while pruning an attachment was swallowed, and the dialog's rows had no styles. | The dialog reports the failure and the rows are styled. |
| Bookmarks | A bookmark whose action is a web address was dropped from the panel. | It is listed and asks before opening. |
| Styles | The assistant search label (`visually-hidden`), the OCR progress icon (`spin`) and inline field errors (`field-error`) used class names with no rule, so the label was visible, the icon did not turn and errors looked like body text. | They use `sr-only`, `spinner` and a new `field-error` rule. |

## Open findings

### Higher priority

1. Raw path comparison before saving.
   `save_document`, `engine_save_signed` and `engine_save_protected` compare the target and source paths as given.
   A symlink, a different letter case on a case-insensitive volume or a relative segment makes the same file look different.
   The atomic save still detects external change, so this is a guard that can be bypassed, not a data-loss path seen in a run.
   Recommendation: compare canonical paths, falling back to the parent directory plus file name when the target does not exist.
2. Full parse to detect encryption.
   `opened()` parses the whole file with lopdf, up to 1 GB, only to learn whether it is encrypted.
   Hypothesis: on large files this dominates open time and peak memory; it was not measured.
   Recommendation: read the trailer's `/Encrypt` entry without loading every object.
3. Synchronous settings writes on the main thread.
   `remember_page` and `remember_view` are synchronous commands that flush settings to disk.
   A slow disk stalls the interface while scrolling.
   Recommendation: make them asynchronous and coalesce writes.
4. Unstyled interface states.
   About 40 class names used in TSX still have no rule, including `contrast-warning`, `setting-desc`, `checkbox-label`, `result-row`, `snapshot-*`, `sig-*`, `print-dialog` and `ocr-*`.
   Most render acceptably as plain blocks, but each needs a look in the native window.
   Recommendation: add a lint step that fails on an unknown class name.

### Medium priority

5. `payload()` clones the raw IPC body, doubling peak memory for large staged buffers.
6. `annotation_color` is validated only by its `#` prefix and `remember_page` stores the page without clamping it to at least 1.
7. Attachments are addressed by name; two attachments with the same name cannot be told apart for delete, save or description edits.
8. `strip_scripts` drops actions chained after a removed script instead of relinking the chain; the new action discards in `discard.rs` keep the rest of a chain and show the pattern to follow.
9. `color_components` treats Lab as three raw components, so Lab images are misread by image tools that rely on it.
10. In the Tesseract adapter, `png_size` returning a zero dimension leads to non-finite word boxes; reject zero before dividing.
11. `npm audit` reports nine moderate advisories through `minimatch` in lint tooling. Nothing ships in the application and CI gates only on high severity.

### Lower priority

12. `docs/README.md` and the tracker carry "Reviewed October 16" headers that no longer match their content.
13. `src/services/document-commands.ts` is close to 3,000 lines; splitting by feature would make review easier but is not urgent.
14. Two native tests assert that a read-only directory refuses writes and fail as root; they should skip with a message when the effective user can write anyway.

## Verified strengths

- lopdf drops objects nested about 120 levels deep, and a file nested 200,000 levels deep does not crash the engine, so recursive walkers are bounded.
- Range reads are bounded by `security::valid_range`, canvases are capped and pages are virtualised.
- Saves write a destination-local temporary file, flush it, check the page count and detect external change before replacing.
- External programs (Tesseract) run with fixed arguments, an empty environment, a private folder and time and output limits.
- Passwords, document text and paths are kept out of logs in the code read.

## Limits of this review

It was done on Linux.
macOS behaviour, WebKit rendering, printing, Keychain storage and packaging were not exercised.
Performance findings are from reading code, not from measurement.
