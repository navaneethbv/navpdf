# Verification ledger

This ledger contains dated observations, not a claim that every historical gate passes on current source.
Use the [delivery tracker](DELIVERY-PHASES.md) for current status and the [acceptance checklist](phases/README.md) for required workflows.
Paths under ignored `output/` identify local artifacts and may not exist in another checkout.
Older source and executable hashes identify only the build tested in their entry.

## October 24 PDFCraft gap batch 7, editing

The [seventh batch mapping](PDFCRAFT-COMPARISON.md#seventh-batch-mapping) lists the editing additions and their limits.
With Node 24.22.0, lint, typecheck, formatting, the production build and `git diff --check` pass.
The frontend suite passes 1,114 tests across 148 files, with 85.7% statements, 77.88% branches, 84.52% functions and 88.8% lines; the coverage gates pass.
`cargo fmt --check` and Clippy with `-D warnings` pass, and every Rust test passes except the 2 root-only permission tests; a new Rust test checks that saved shape styles accept only known kinds, six-digit colours, widths from 0.5 to 20 and opacities from 0.1 to 1.

Integration tests read the output with PDF.js.
A picture watermark covers half the page width at the page centre after the page text, a background is drawn before it from a first content stream, Remove Decorations leaves the text, a page of another PDF draws as a form, and the placement matrix keeps a picture upright on a page turned 90 degrees.
A sign-here stamp is a filled tag without a detail line, and picture and PDF-page stamps keep their shape, centred, and are turned with a rotated page.
Every line ending style draws, a diamond and a reversed closed arrow are filled, a dashed line sets a dash pattern, the rectangle grows to hold the endings, and a later colour change redraws the appearance in the new colour; a cloudy line and an unknown ending are refused, and a rectangle's cloudy border and a connected line's endings read back.
The eraser cuts a stroke between stored points, keeps untouched strokes, redraws the remaining three strokes and deletes a wholly erased drawing with its pop-up.
Layer, show or hide and reset links read back through PDF.js with their states, a dashed border and an outline highlight, the show or hide action reads back for NavPDF, and unknown layers or fields are refused.
Writing these found that a parent field name such as "contact" was refused although Hide covers the fields below it, which is fixed.
Dialog and controller tests cover choosing pictures and refusing other files, the sign-here and picture stamp names, picture watermark and missing background files, a show or hide field link, line ending and border choices, saving a shape style, the eraser's path and page-unit radius, and running a show or hide link on screen.

In the Chromium browser preview, a Sign Here tag, a picture stamp and a picture watermark drew on the reader fixture, as `output/batch-seven/15-stamps-watermark.png` shows.
Native WebKit, Preview and Acrobat comparison of the new appearances and actions were not run.

## October 24 PDFCraft gap batch 7, document lifecycle

The [seventh batch mapping](PDFCRAFT-COMPARISON.md#seventh-batch-mapping) lists tabs, Revert, reloading changed files and session reopening with their limits.
With Node 24.22.0, lint, typecheck, formatting, the production build and `git diff --check` pass.
The frontend suite passes 1,094 tests across 146 files, with 85.52% statements, 77.7% branches, 84.46% functions and 88.59% lines; the coverage gates pass.
`cargo fmt --check` and Clippy with `-D warnings` pass, and every Rust test passes except the 2 root-only permission tests that fail in this container.

Rust tests check that a rewritten file with identical bytes counts as unchanged while edited content counts as changed and a deleted file as missing, that Revert reopens the saved file with its page and refuses an unsaved import, and that sessions are recorded only while the preference is on, in opening order with pages, and restored once while skipping a missing file.
Session tests check that Revert asks first, keeps the document when there is no saved file, reloads an unchanged document automatically, asks before replacing unsaved edits and reports each change once, warns once about a missing file and opens a restored session in tabs.
Tab tests check that each tab keeps its own unsaved state and page, writes a recovery copy and keeps quitting guarded while a background tab has unsaved changes, closes clean background tabs, shows an edited one before closing it, shows the neighbour after closing the shown tab and lists unsaved tabs before closing the window.
Controller tests check that parking keeps the undo and view histories and that resuming returns to the same PDF point, rotation and layer visibility.

Opening another document now adds a tab instead of asking to discard unsaved edits, so six earlier session tests that expected that prompt were rewritten to assert that the edited document stays open in a background tab with its recovery copy, and that a document that fails to open shows the edited one again.
Writing them found that loading reset the tab list and that a document PDF.js could not start loading was never released when no other document was shown; both are fixed.
In the Chromium browser preview, two documents opened in tabs, switching back returned to scroll offset 3000 and Control-Tab and closing a tab worked.
That check found that the viewer restored the previous document's offset when a hidden viewer reappeared, so parking now clears it and a new tab starts at the top, and that resuming while the viewer was hidden lost the zoom, so switching keeps the viewer shown.
Native file watching, Revert from the macOS menu, quitting with unsaved background tabs and session reopening at launch were not exercised natively.

## October 24 PDFCraft gap batch 7, viewer

The [seventh batch mapping](PDFCRAFT-COMPARISON.md#seventh-batch-mapping) lists each addition and its limits.
With Node 24.22.0, lint, typecheck, formatting, the production build and `git diff --check` pass.
The frontend suite passes 1,075 tests across 143 files, with 85.5% statements, 77.71% branches, 84.55% functions and 88.55% lines; the coverage gates pass.
`cargo fmt --check` and Clippy with `-D warnings` pass, and every Rust test passes except the 2 root-only permission tests that fail in this container.
A Rust test checks that page colour preferences default to off, accept custom six-digit colours and reject unknown schemes or malformed colours without changing saved settings.

Controller tests check that hiding comments shows a copy filtered to fields and links at the same page, rotation and layer visibility, that showing them again restores the document and releases the copy, and that a drawing tool or an attached revision shows comments again.
They also check that a read-only encrypted document refuses hiding, that page colours redraw only on change, and that unsaved page-view edits are committed as a revision instead of being drawn over.
Marquee zoom tests cover a click keeping the page point under the pointer, a drag filling the window and Option-click zooming out.
An integration test reads a pdf-lib document through PDF.js and finds two drawn images at their page bounds, the topmost first, and decodes the first one's pixels.
It found that PDF.js can deliver decoded image data after the operator list, so image lookup now waits for the image instead of failing.
Other tests cover inked bounds, column text, page size labels, image data expansion, the page colour settings and contrast warning, the About dialog, column copying, the image context menu and the page size label.

In the Chromium browser preview, hiding comments removed the sticky note and kept the form field at the same scroll position, Fit Visible zoomed to 228%, a marquee drag zoomed to 219%, yellow-on-black page colours drew the reader fixture, Alt-drag selected a column and the page size label read 8.5 × 11 in.
Screenshots are in `output/batch-seven/`.
The check found unreadable text on pressed rail buttons under the pointer, because the hover background replaced the pressed background; pressed buttons now keep their colours.
Native WebKit rendering, clipboard image writing in WebKit, Preview and Acrobat comparison were not run.

## October 24 PR 71 conflict and quality review

Merged the current main dependency update into the PDFCraft branch, retaining SHA-2 0.11.1 and the branch's stringprep test dependency in Cargo.lock.
The eight hosted Sonar findings were five ambiguous form-label text nodes and three functions over the cognitive-complexity limit.
Label text now has explicit spans, and image reading, OCR page selection and password-format validation have cohesive helpers with the existing check order and document-ownership guards preserved.

Codacy's generic-header-injection finding on the page transition duration is a false positive.
The target is pdf-lib's PDFPageLeaf dictionary, not an HTTP response, and validateTransition rejects nonnumeric, nonfinite and out-of-range advance times before serialization.
Codacy did not honor the inline annotation, so the individual finding was reviewed as False positive in its UI with the numeric PDF boundary and regression evidence.
The generic security rule remains enabled for the file and project.
Ten integration cases reject CRLF strings, numeric strings, objects, NaN, infinity and out-of-range values, and round-trip zero, 3600 and null while preserving an unselected page.

Local Node 24 verification passes lint, typecheck, formatting, the production build and the frontend coverage gates.
The transition integration file passes 19 tests.
The first fresh hosted run found GHSA-834v-8h66-3h79 in test-only happy-dom 21.0.3; the follow-up requires and locks patched 21.0.4, and npm audit reports zero vulnerabilities.
The full frontend suite passes 1,054 tests across 140 files.

Cargo Deny also identified RUSTSEC-2026-0385 and RUSTSEC-2026-0387.
The final patch updates P-256 to stable 0.14, crypto-bigint to 0.7.7 and ctutils to 0.4.5, removing both vulnerable versions.
The temporary advisory exception from the concurrent branch update is superseded by this dependency fix and removed.
The encoded-key and signature adapter retains stable CMS, X.509 and RSA dependencies without changing the application MSRV of 1.90; ADR 0009 records the boundary.
An isolated harness compiling the actual signing engine passes eight signing tests and Clippy with warnings denied.
A fixed-output regression preserves the prior DER signature and SPKI encodings and checks algorithm identifiers and PKCS #8 import.
An OpenSSL-generated P-256 PKCS #12 identity signs a PDF through the actual engine; OpenSSL CMS integrity verification accepts the extracted byte ranges and returns identical content.
This independent check does not claim certificate trust.

Cargo metadata with --locked and cargo fmt --check pass after conflict resolution.
Rust tests and Clippy cannot compile locally because pkg-config and the Linux GTK/WebKit development libraries are unavailable; Linux, macOS, MSRV and native acceptance must be verified on the pushed commit in hosted CI.
Native NavPDF, Preview, Acrobat, physical printing and release packaging were not exercised in this Linux workspace.
Hosted analysis and merge results must be checked on the final pushed head; earlier passing runs are not evidence for this follow-up.

## October 22 PDFCraft gap quality follow-up

SonarCloud reported a C reliability rating on new code and CodeQL reported 8 hard-coded password alerts on PR 71.
SonarCloud and Codacy issue lists cannot be read from the development container because its network policy blocks both hosts.
The Sonar JavaScript and TypeScript rules were therefore run locally with `eslint-plugin-sonarjs` 3, plus the typescript-eslint, React, jsx-a11y and unicorn rules SonarCloud applies, limited to lines this PR adds.
That run found 88 findings, including loops awaiting one operation at a time, nested ternaries, functions over the cognitive-complexity limit, array-index React keys, a backtracking regular expression and optional-chain candidates; after the follow-up it reports none.
Sequential work now uses the existing in-order helper, numbered output names share one `uniqueName` helper, and long functions are split into named steps.
CSS checks for duplicate properties, unknown properties and selectors, and empty blocks report no new findings.
The CodeQL alerts came from literal test passwords and the literal first character of the wrong-password probe used to validate protected output; tests now derive passwords at run time and the probe uses a random prefix.
With Node 24.22.0, lint, typecheck, formatting, the production build and `git diff --check` pass, and 1,044 frontend tests pass across 140 files with the coverage gates; `cargo fmt --check`, Clippy with `-D warnings` and every Rust test except the 2 root-only permission tests pass.
Hosted SonarCloud, CodeQL and Codacy results must be read on the pushed commit; this local run is not a substitute for them.
On `8ef7a93` the SonarCloud gate passed with 8 new issues and Codacy reported 5 critical security findings, still without readable details.
Codacy's JavaScript security profile was reproduced with `eslint-plugin-security` 3 under ESLint 9: its function-call and variable-assignment object-injection findings and two timing-attack matches on a variable named `token` tracked Codacy's critical counts across the PR's commits.
These now use `Map` lookups, `.at()`, destructured regular-expression groups in one shared `parseHexColor` helper, and a renamed date-format field.
The Sonar rule set was also run on the PR's test files; awaits inside loops, helpers nested in `describe` blocks, `charCodeAt` and an `Array` constructor there are replaced.
Semgrep's public JavaScript, TypeScript and Rust rules report no error-severity findings on the changed files.
On `2f5ceb6` Codacy fell from 5 to 2 critical findings; Semgrep's dynamic-method rule matched the page clipboard shortcut handler, which now uses a `switch`.
CodeQL's remaining alerts were empty owner passwords in the legacy-encryption test, which now uses a generated owner password.
SonarCloud still reported 8 issues after the test-file changes, so the new Rust was checked against Sonar's cognitive-complexity limit of 15 with a local estimate: the faux-redaction scan (about 38) is split into per-page helpers, and the optimizer discards (about 18) run from a table.

## October 21 PDFCraft gap batch 6, creation and OCR

The [sixth batch mapping](PDFCRAFT-COMPARISON.md#sixth-batch-mapping) lists each addition and its limits.
With Node 24.22.0, lint, typecheck, formatting, production build and `git diff --check` pass.
The frontend suite passes 1,044 tests across 140 files, with 85.83% statements, 77.85% branches, 84.77% functions and 88.90% lines; the coverage gates pass.
No Rust source changed; the only native change adds JPEG 2000 to the Swift ImageIO import list, which cannot be compiled or run in this Linux container.

Integration tests read text-created PDFs with PDF.js across page continuation and form feeds, check word and character wrapping, font-coverage rejection, image routing between the web view and the native decoder, Otsu thresholding, contrast stretching and speck removal.
Testing found that a word's trailing space counted toward the line width, so a word that fitted exactly wrapped early; the width check now ignores trailing spaces.
Dialog tests cover text creation, coverage errors, clipboard reading and its failure message, separate-file ZIP conversion with numbered duplicate names, multi-file OCR that skips a page with text and reports an unreadable file, and the OCR panel skipping text pages with black-and-white cleanup.
The existing OCR warning test now selects its checkbox by name because the panel has more checkboxes.

In the Chromium browser preview, generated GIF, BMP and WebP samples in `output/batch-six/` imported as a three-page PDF, typed text with accented and curly-quote characters opened as a PDF, and the multi-file OCR dialog showed its desktop-only notice.
The Create PDF tabs wrapped onto two rows with the first label, so the new tab is named Text & Paste.
Native OCR, clipboard permission prompts in WebKit, JPEG 2000 decoding and Preview acceptance were not run.

## October 21 PDFCraft gap batch 6, printing and optimizer

The [sixth batch mapping](PDFCRAFT-COMPARISON.md#sixth-batch-mapping) lists each addition and its limits.
With Node 24.22.0, lint, typecheck, formatting, production build and `git diff --check` pass.
The frontend suite passes 1,030 tests across 138 files, with 86.00% statements, 78.07% branches, 85.00% functions and 89.11% lines; the coverage gates pass.
`cargo fmt --check` and Clippy with `-D warnings` pass; `cargo test --locked` passes 105 and fails the same 2 root-only permission tests recorded for batch 5.
Logs are under ignored `output/batch-six/`.

Engine tests show that nothing is discarded by default, that each discard removes only its own structures (a URI link keeps its action but loses a chained script), that comment discards keep links and multimedia, and that a discard is kept even when compression saves no space.
Integration tests read prepared print copies with PDF.js to check parity selection and order, the annotations kept for each content choice, the empty page content for form fields only, grayscale conversion, raster bounds and full-page image rebuilding, plus the optimizer's handling of form flattening.
Dialog tests cover odd pages in reverse order through the native print call, the grayscale preview and its reset when an option changes, and the discard request.

Poppler `pdfinfo` reports the synthetic `output/batch-six/discard-source.pdf` (SHA-256 `735b566d549ce378cc8a412de228129c5311b6f89df2712766b1d2d2b366b4dc`) as tagged with a title, and `discard-output.pdf` (SHA-256 `0845036ec804900b6cd4dc7ef1ec58f4c36dcf0f98bd6d17702e0db61a1159b1`), made with every discard, as untagged without a title; `pdftotext` still extracts the body text.
In the Chromium browser preview, a grayscale, form-fields-only preview of `output/batch-six/form-fixture.pdf` showed only the field on a white page; the two print selects were misaligned by a shared spacing rule, which now exempts two-column rows.
Native printing, Preview and Acrobat acceptance were not run, and no physical printer was used.

## October 21 PDFCraft gap batch 5

The [fifth batch mapping](PDFCRAFT-COMPARISON.md#fifth-batch-mapping) lists each addition and its limits.
With Node 24.22.0, lint, typecheck, formatting, production build and `git diff --check` pass.
The frontend suite passes 1,019 tests across 136 files, with 86.15% statements, 78.11% branches, 85.11% functions and 89.28% lines; the coverage gates pass.
`cargo fmt --check` and Clippy with `-D warnings` pass.
`cargo test --locked` passes 101 library tests and fails 2: `unwritable_destination_directory_keeps_the_original` and `legacy_assets_stay_listed_when_the_upgrade_cannot_be_written`.
Both depend on a directory being unwritable, which does not hold when the container runs as root; neither touches batch 5 code, and they are expected to pass on hosted CI.
Logs are under ignored `output/batch-five/`.

Engine tests open every encryption level only with its password, keep metadata readable only for AES, reject legacy passwords that would be truncated, show labels in the chosen colour while passing the audit, fail the audit for label text in another font or a changed label, and find covered text, unapplied Redact annotations and filled covering annotations.
Testing found that legacy security handlers truncate passwords to 32 bytes and lopdf drops control characters, which made the wrong-password check accept some wrong passwords; legacy passwords are now limited and the check uses a printable prefix.
Dialog tests cover the encryption request, the legacy password limit, strength labels, labelled regions and fill colours, whole-page marks and marking findings for redaction.

Poppler 24 `pdfinfo` and `pdftotext` open each sample in `output/batch-five/` with the user password and refuse a wrong one.
They report AES-256 (V5 R6, `/EncryptMetadata false`), AES (V4 R4), RC4 128-bit (V2 R3) and RC4 40-bit (V1 R2).
The labelled redaction sample extracts only `(b)(6)`, and its Poppler raster shows white label text on the chosen blue fill.

| Sample | SHA-256 |
| --- | --- |
| `aes256.pdf` | `10c4dc743ea71a7126abcdb35cfb3bc76416791bf59228ad104d788aeea69741` |
| `aes128.pdf` | `3e10fbd425ffbab6b168f9057d9f084f515ba1b2729e69c88e7564f90ad39814` |
| `rc4128.pdf` | `bb71b5904fa13fd57a0f7a922234ad6439d0ed4d6ac4661e91df8bba910890f6` |
| `rc440.pdf` | `997ae818be4c80269d3e5d1d7fcc62482d889bcac2370f3dba0f53631422a673` |
| `labelled.pdf` | `0a95a90e3ee9bd92273524a2a570d216990cafd0f1815cbd79d91cd559b7a746` |

The Chromium browser preview shows the new protection, redaction and Find Fake Redactions controls with the desktop-only notice; the engine does not run there.
Native NavPDF, Preview and Acrobat acceptance were not run.

## October 21 PDFCraft gap batch 4

The [fourth batch mapping](PDFCRAFT-COMPARISON.md#fourth-batch-mapping) lists each addition and its limits.
With Node 24.22.0, lint, typecheck, formatting, production build and `git diff --check` pass.
The frontend suite passes 1,012 tests across 135 files, with 86.14% statements, 78.07% branches, 85.16% functions and 89.27% lines; the coverage gates pass.
No Rust source changed.
Logs are under ignored `output/batch-four/`.

Integration tests read saved output with PDF.js: list box multiple selection, the date format PDF.js derives from the saved actions, push-button image fields, tooltips, comb and maximum length, shared values across duplicated widgets, tab order, atomic renaming, detection of labelled underscore lines that skips covered areas, label-based name suggestions, and date formatting and parsing for every offered format.
Testing found that PDF.js reads a field's tooltip only from its widget, so tooltips are now written to the field and each widget.
Dialog tests cover property saving, duplication, tab-order changes, invalid ranges, detected-field creation, new field types and the preview action; a DOM test covers the date input swap and preserved non-date text.
Date parsing no longer builds a regular expression from the document's format string; a token walker treats every non-token character literally, with a regression test using regular-expression syntax in the format.

In the Chromium browser preview with `output/batch-four/form-fixture.pdf`, the date field became a native date input on focus and wrote `25/12/2026` in its `dd/mm/yyyy` format on blur; Detect & Name Fields found and created the labelled "Full name" field; Preview focused the first field.
Native NavPDF, Preview and Acrobat acceptance were not run; Acrobat is the relevant reader for the saved date-format actions.

## October 21 PDFCraft gap batch 3

Source baseline: `8e9b310` on `main`, with the batch on `feat/pdfcraft-remaining-gaps`.
The [third batch mapping](PDFCRAFT-COMPARISON.md#third-batch-mapping) lists each addition and its limits.

### Local checks

Node 24.22.0 and `npm ci` were used.
Lint, typecheck, formatting, production build and `git diff --check` pass.
The frontend suite passes 990 tests across 133 files, with 86.41% statements, 78.43% branches, 85.59% functions and 89.49% lines; the coverage gates pass and LCOV is retained.
No Rust source changed, so the Rust suite and Clippy were not rerun locally.
Logs are under ignored `output/batch-three/`.

Integration tests read saved output with PDF.js and pdf-lib: pasted page order, displayed-margin mapping for every rotation, trim and bleed preservation, transition dictionaries, custom-property round trips and validation, font listing, polygon, connected-line, cloud and callout annotations with appearances, grouped replacement proposals, and embedded attachment content.
Dialog tests cover keyboard and button page clipboard use, thumbnail scaling, page-property application and range errors, custom-property editing, proposal submission and attachment placement.
Testing found that PDF.js 5 no longer returns attachment content with annotation data; the test reads it through `getAttachmentContent` instead.

### Independent-reader and browser-preview evidence

Poppler `pdfinfo -box` reads the trim and bleed boxes, `pdfdetach -list` finds the comment attachment, and a Poppler raster shows the polygon, cloud, callout, replacement strikeout with caret, and attachment icon in `output/batch-three/batch-three-evidence.pdf`, SHA-256 `8c8b8cad2f06dd99185d118b26f57e880d6f06290fb76c4bc3bdabb6dee26aea`.
In the Chromium browser preview, drawing a cloud and a polygon from the annotation toolbar saved both with visible appearances.
The preview showed enlarged thumbnails not scaling their page image, uneven margin fields, and the point-tool status hidden behind the annotation toolbar; all three were fixed and recaptured.
Native NavPDF and Preview acceptance were not run because the work was done in a Linux container.

## October 16 documentation review and merged baseline

Reviewed source: `c09576f7d96de04ba30b20a9a5737d4d42ae3010` on clean `main`.
GitHub confirms PR 68 merged on October 16 at 20:05 UTC and PR 66 is represented by `d396345`.
PR 68's final-head CI, native acceptance scripts, CodeQL, Codacy and automatic SonarCloud Code Analysis checks succeeded.
The optional SonarCloud CI analysis job was skipped and is not counted as a scan.
This is hosted check-status evidence, not a fresh direct issue-count audit or new native GUI acceptance.
The release E0463 blocker and outstanding native workflows below remain open.

The Markdown review consolidated current status and phase criteria, removed superseded plans/reviews/handoffs and repaired their references.
The original requirements, ADRs, fixture/dependency provenance and distinct native/independent-reader evidence are retained.
The removed September 14 review and plan remain available through `git show c09576f:docs/REVIEW-2026-09-14.md` and `git show c09576f:docs/IMPLEMENTATION-PLAN-2026-09-14.md`.
All 53 repository-tracked Markdown files were reviewed, including upstream/vendor documentation retained for provenance.
The cleanup leaves 31 Markdown files, including the new index, and removes 23 superseded documents.
Local checks pass for 72 repository-local links/anchors, fenced-block balance, Markdown-only scope, instruction-file byte parity and `git diff --check`.
Application suites and native packaging were not rerun locally for this documentation-only change; the PR still runs the repository hosted gates.

## Corrections to early evidence

The initial Phase 6 implementation returned fixed sample text and its tests compared identical hard-coded strings.
Those earlier accuracy, portable-fallback and completion claims are withdrawn and are omitted from this ledger.
Real macOS Apple Vision recognition replaced that path; unsupported platforms report unavailable OCR.
The September 14 correction and September 15 six-sample run below establish their recorded scope only.

The original reusable-signature cipher derived a key from public path/user data and did not meet the protected-storage requirement.
AES-256-GCM and a random Keychain-protected key replaced it.
Native locked-Keychain and migration acceptance remain open, as do combined revision and current-release OCR acceptance.
Historical phase completion text does not override those reopened gates.

## October 16 second-batch quality follow-up

Starting revision: `2a836fcfa5d454c40b340be98d324b669e46fb11` on PR 68.
Sonar reported 11 new issues while Codacy and CodeQL reported no findings.
The follow-up separates report writing, heading merging, link removal and space categorization into focused helpers, preserves sequential widget appearance updates, and explicitly associates each link-action radio with its visible label.
The radio label retains the existing stacked title and hint layout.
Node 24.18.1 local validation passes all 975 frontend tests across 131 files and the existing coverage gates, plus 95 Rust tests with one existing ignored test and Clippy with warnings denied.
Lint, typecheck, formatting and production build pass; logs are under ignored `output/pr68-quality-round2/`.
The final label adjustment is also checked by the focused dialog suite and a fresh lint and build run.
These are automated regression checks, not new native visual or save/reopen acceptance.
The initial green gate did not establish zero Sonar issues; the merged-baseline entry above records the later hosted check status.

## October 16 PDFCraft-compatible tools, second batch

Source baseline: `6f575fe6f7df3db2f8b61a689980492d16a83fb2` on `feat/pdfcraft-compatible-tools`.
The [comparison](PDFCRAFT-COMPARISON.md#second-batch-mapping) maps each addition to its upstream entry and limits.
Full parity is not complete.

### Local checks

Node 24.22.0 from the checksum-verified official Linux archive and `npm ci` were used, because the container provides Node 22.
Lint, typecheck, formatting, production build, `git diff --check` and instruction-file comparison pass.
The frontend suite passes 975 tests across 131 files, with 86.49% statements, 78.71% branches, 85.88% functions and 89.53% lines; the coverage gates pass and LCOV is retained.
No Rust source changed in this batch, so the Rust suite and Clippy were not rerun.
Logs are under ignored `output/pdfcraft-batch-two/`.

Integration tests read saved output with PDF.js: created URI links and their rectangles, broken-link and bookmark cleanup, nested heading bookmarks and fit views on rotated pages, field arrangement on real widgets, measurement CSV cell neutralisation, space-usage totals, form merging and report text.
Dialog tests cover source-revision edits, stale-document rejection for detected headings, disabled arrangement, empty measurement exports and leaving the open document unchanged when merging forms.
Review of the first draft found a wrapped heading taking its bookmark position from its last line, and word lists searching the document once per entry; both were corrected before testing.

### Independent-reader and browser-preview evidence

Poppler `pdftohtml` independently reads the nested outline (Introduction with Scope, Methods with Data) and the created `https://example.com/docs` link on both pages of `output/pdfcraft-batch-two/links-and-bookmarks.pdf`, SHA-256 `4d21f36d3f4e927808d2b9260aa6118601e0ce090cdb1ab1d1c9a3248a1f57f1`.
Poppler `pdftotext` reads the counts and changed-text excerpts of `output/pdfcraft-batch-two/compare-report.pdf`, SHA-256 `f7b0d07485beb99420c5b08f78aa3e6abac8e7374299a4f56c49f23dd179907e`.
In the Chromium browser preview, Link Tools, Bookmarks from Headings, Space Usage and the field arrangement controls rendered without overlap or clipping, and applying link creation to `visual-fixture.pdf` (SHA-256 `b8934b7031ee4818b05a58293cdadfff20781ca4e03da1210d522f2075818c57`) created 12 links, marked the document changed and reported 12 web links on reopening the tool.
The browser preview does not establish native save, recovery or packaging acceptance.

### Native and hosted gates

This batch was implemented in a Linux container without macOS, so native NavPDF and Preview acceptance were not run.
Native save, close and reopen in NavPDF and Preview remain open for every second-batch tool.
The release E0463 packaging blocker recorded below is unchanged.
Later hosted check status is recorded in the merged-baseline entry above.

## October 16 PDFCraft-compatible tools

Source baseline: `d3963457a3bfbe0d85555c0f0e2657e4333e295e`, with the changes on `feat/pdfcraft-compatible-tools`.
The pinned reference, implemented subset and unresolved comparison are in [PDFCRAFT-COMPARISON.md](PDFCRAFT-COMPARISON.md).
Full parity is not complete.

### Local checks

Node 24.18.1 and `npm ci` were used.
Lint, typecheck, formatting, production build, `git diff --check` and instruction-file comparison pass.
The frontend suite passes 955 tests across 129 files, with 86.64% statements, 79.07% branches, 85.72% functions and 89.64% lines; LCOV is retained.
The Rust suite passes 95 tests with the pre-existing constrained-volume test ignored, and Clippy passes with warnings denied.
The existing production chunk-size advisory remains.
Logs are under ignored `output/pdfcraft-*.log`.

The locked Tauri and muda dependencies require Rust 1.90, so the declared minimum and CI MSRV job now use 1.90 instead of 1.89.
A fresh-target `cargo +1.90.0 check --locked --manifest-path src-tauri/Cargo.toml` passes.
The quality follow-up adds pinned `@xmldom/xmldom` 0.9.12 for strict XML parsing outside the browser DOM; ADR 0016 records the dependency decision.
`npm ci` and the production dependency audit pass with zero vulnerabilities.
The license inventory includes the new MIT dependency and retains the existing Rust license review entries.
Quality-refactor logs are under ignored `output/pr68-quality/`.
Sequential PDF extraction and embedding, cancellation and output limits are preserved.
Keyboard handlers are attached to command buttons, and complex branching is split into focused helpers.
The XFDF regression verifies escaped script text remains literal and rejects nested markup, foreign elements and unknown entities.

Regressions cover rotated/cropped poster output and tile limits; initial-view destinations and preserved preferences with independent PDF.js inspection; actual serialized split sizes; bookmark boundaries; strict XFDF parsing and custom checkbox states; malformed structure, role mapping and report escaping; and dialog cancellation, validation, disabled actions and keyboard navigation.
Review reproduced a malformed structure child being silently skipped and reported as passed; it now reports incomplete inspection while allowing legitimate marked-content references.

### Native and independent-reader evidence

The current debug executable built successfully and ran in an isolated development bundle with identifier `local.navpdf.integration-check`, serving the current frontend from localhost.
Its SHA-256 is `35303f6fda8c1d06cd62671ada816f95ecca6cf7319f22d00c16460d1b413d52`.
This is development-mode evidence, not a successful release package.
Native accessibility-tree interaction confirmed Cmd+K search, disabled-action descriptions, Enter opening the native file picker, loading the synthetic source, editing initial view, Save As, closing and reopening the saved document.

The synthetic source has four cropped pages rotated 0, 90, 180 and 270 degrees.
The initial-view edit selects opening page 2 and document-title display.
The saved result is `output/pdfcraft-acceptance/native-initial-view.pdf`, SHA-256 `6ab85c22036da8db1b49461e340a8e2eb5123079cb6962578172dde543d6a591`.
Independent PDF.js inspection confirms four pages, the saved destination and title preference, and the source canary text.
Preview reopens all four pages and exposes the four text canaries; it opens on page 1 rather than honoring the saved page preference.
Reader preference overrides are explicitly disclosed in the dialog.

A separate service-generated poster at `output/pdfcraft-acceptance/poster.pdf` has eight letter-size sheets, SHA-256 `e2fcdec55249dc7f8def1a62b60e30265bab0af1759c1e10b2e8f313f6722ef1`.
Poppler `pdfinfo`, `pdftotext` and raster output independently confirm readable pages and rotated canary content.
This does not establish native poster-export acceptance or annotation/form preservation; the tool explicitly exports page content only.
Native end-to-end XFDF, bookmark/size ZIP splitting, accessibility reporting, compact layout and all poster workflow gates remain open.
The screenshot capture did not reflect the current modal accessibility tree reliably, so visual rendering, focus appearance and contrast are not accepted from that run.
Coverage generation reloads the Vite development page; native checks must run after automated coverage finishes.

### Packaging and hosted gates

`npm run package` fails with Rust E0463 loading `cssparser_macros`.
Fresh release targets on Rust 1.96 and 1.95 also fail loading `time_macros`; the debug build and tests succeed.
Logs: `output/pdfcraft-package.log`, `output/pdfcraft-package-fresh.log` and `output/pdfcraft-package-195.log`.
No current DMG was produced or verified; an older installed app was not treated as current-source acceptance.
The root cause of the release-only macro-loading failure remains unresolved.
Later hosted check and merge status are recorded above; they do not close native or distribution gates.
At that checkpoint no merge or distribution was claimed; PR 68 subsequently merged as recorded above, while distribution acceptance remains open.

## October 14 PR 66 quality corrections

The PR analysis reported 31 unresolved issues on `584a3ff`, and the main-branch analysis listed 49 older unresolved findings.
The follow-up uses semantic status outputs, explicit control labels, simpler validation and review helpers, and smaller PDF date expressions.
Archive extraction, document inspection, exports, comparison, OCR and composition use lazy asynchronous sequences so only one PDF operation runs at a time and cancellation prevents later work.
Native request draining and range reads retain ordering and disposal checks; adapters retain promise-based rejection contracts.
Reduced-motion rules now use the application root and cascade order instead of important declarations, including pseudo-elements.
Regression tests cover early termination and rejection without starting the next operation, aborted in-flight range reads and unmount during a pending native-open snapshot.
Node 24.18.1 and `npm ci` were used on macOS.
Lint, typecheck, formatting, production build, Rust tests and Clippy with warnings denied pass locally.
The frontend suite passes 929 tests across 125 files with 86.60% statements, 78.84% branches, 85.92% functions and 89.60% lines.
The Rust suite has 95 passing tests and the existing constrained-volume test ignored.
Hosted OCR acceptance exposed missing `.ts` import extensions in the new shared sequence imports; direct Node loading reproduced the error and passes after correction.
Local native acceptance passes Phase 7 (55/55), Phase 8 (12/12) and Phase 10 (55/55), including independent Poppler, OpenSSL and Quick Look checks.
The local OCR probe had not returned its first recognition result at this checkpoint; the later hosted native acceptance job passed on the merged PR.
Browser security denied access to the localhost preview after permission was declined, so visual acceptance was not performed.
Native workflow acceptance and distribution gates remain open.
PR 66 later merged as `d396345`; this entry retains its local verification limits and does not assert a current project-wide issue count.

## October 13 twenty local workflow features

Source base: `9236011`, plus the changes in this delivery.
The [project README](../README.md#local-workflow-additions) lists the page, form, review and reader capabilities; the acceptance checklist retains their safety gates.

### Automated gates

Node `24.19.0` and `npm ci` were used, with no dependency or lockfile changes.
Formatting, lint, typecheck, production build, `git diff --check`, `cmp AGENTS.md CLAUDE.md` and `npm audit --audit-level=high` pass.
The frontend suite passes 925 tests across 124 files.
Coverage is 86.61% statements, 78.83% branches, 85.87% functions and 89.60% lines, with existing thresholds unchanged and LCOV retained.
The production build retains its large-chunk advisory; no performance improvement is claimed.
Logs and independent-reader artifacts are under ignored `output/local-workflows-20261013/`.

Saved-output tests cover page ordering, ZIP membership, form import/clear behavior, editable dropdown custom values and preservation of unsupported form fields.
Real PDF.js integration tests cover text counts and mixed page dimensions, CropBox, rotation and UserUnit.
Dialog tests cover invalid input, cancellation, save failure, stale document replacement, confirmation, keyboard guards and bounded result tables.

### Review corrections

Actual PDF.js event timing reproduced previous matches remaining available during a new query's debounce and after closing the search panel during that debounce.
Search exports now require results produced for the current query and options, and closing search invalidates pending results.
The same real-controller probe verifies that reopening leaves export disabled until fresh matching rows publish.
Regressions also cover shortcut-modal isolation, keyboard access to the page-export stop button, review status ordered by valid saved dates and editable dropdown JSON round trips.
These checks do not establish native keyboard or rendering acceptance.

### Independent-reader checks

Poppler `pdftotext` reads a reversed synthetic four-page PDF in order 4, 3, 2, 1, including a rotated page.
It reads the imported form value from the saved appearance and no longer reads that value after clearing the field.
Python `zipfile` verifies both fixed-size split entries, and Poppler reads the expected page markers in each extracted PDF.
These four checks pass against the actual document-command, form-data and page-archive services.

### Remaining limits

Both Cargo test and Clippy were attempted and failed to start because `cargo` is not installed in this Linux container.
No Rust, native IPC or CSP source changed.
Browser visual acceptance could not run because no browser executable was installed and the attempted browser download returned an invalid archive.
Native macOS, WebKit, Save dialog, save/close/reopen, Preview and Acrobat acceptance remain open.
Hosted CI and quality analysis are separate from the passing local frontend checks and must be evaluated on the published commit.
No historical delivery phase, native acceptance or distribution gate is closed by this delivery.

## October 6 document review and preparation tools

Source base: the October 6 export formats branch, plus the changes in this delivery.
[ADR 0015](adr/0015-document-review-tools.md) records the ten tools and their limits.

### Automated gates

The Linux container provided Node `22.22.0` rather than the CI Node 24; `npm ci` was used.
Formatting, lint, typecheck, production build, `git diff --check`, `cmp AGENTS.md CLAUDE.md` and `npm audit --audit-level=high` pass.
The frontend suite passes 789 tests across 109 files.
Coverage is 85.76% statements, 77.44% branches, 84.82% functions and 88.78% lines, with the existing thresholds unchanged and LCOV retained.
No Rust source changed in this delivery.

### Reproduced defects

In the Chromium browser preview with pages 1 and 2 visible and page 1 current, a rectangle drawn on page 2 was listed as `Square · Page 1`; after the fix the same run lists `Square · Page 2`.
A booklet built from blank pages without a content stream failed with `Can't embed page with missing Contents` in a component test; pages without contents now embed.
A form field whose position was fractional could not be moved because the number inputs used whole-number steps, which blocked form submission silently; the inputs now accept any number.
Each regression failed before its fix and passes afterward.

### Independent-reader checks

`npm run acceptance:document-tools` passes 9 of 9 checks and writes its files and `results.json` under ignored `output/document-tools/`.
pypdf reads stamp names and appearances, and Ghostscript draws both stamps in place, upright on a page rotated 90 degrees.
pypdf finds no annotations or form after flattening, and Poppler's `pdftotext` still reads the flattened field value and stamp text.
pypdf reads the page labels `i, ii, A-1, A-2`.
Poppler reads a two-sheet landscape booklet with page 4 beside page 1 on the first side.
Python's csv and HTML parsers read the comment summary with its reply and escaped text.
pypdf reads the moved field rectangle and the fixed title, language, title display and tab order.
Pillow decodes an exported embedded image pixel-exactly.
pypdf reads the area measurement's Polygon subtype, PolygonDimension intent, `16.00 sq m` value and `1 in = 2 m` scale, and Ghostscript draws it.

Chromium browser preview measured 30.00 ft between two points 3 inches apart on page 2 at 1 in = 10 ft, and the comment list showed `Line · Page 2`.
Screenshots of every new dialog at 1280x860 showed no clipping after the accessibility check list and field inputs were adjusted.

### Remaining limits

Native macOS, WebKit, Preview and Acrobat acceptance of these tools were not available in this environment and remain open.
Sensitive-data marks use average glyph widths when no canvas is available; the matched text is still audited after redaction.
Rotated form widgets that are resized keep their existing appearance and rely on readers honoring NeedAppearances.
No feature-parity, native acceptance or distribution gate is closed by this delivery.

## October 6 export formats and export review

Source base: `779bb98`, plus the uncommitted source changes in this delivery.
[ADR 0014](adr/0014-additional-export-formats.md) records the format selection and exclusions.

### Automated gates

The Linux container provided Node `22.22.0` rather than the CI Node 24; `npm ci` was used.
Formatting, lint, typecheck, production build, `git diff --check` and `cmp AGENTS.md CLAUDE.md` pass.
The frontend suite passes 733 tests across 105 files.
Coverage is 85.37% statements, 77.44% branches, 84.03% functions and 88.39% lines, with the existing thresholds unchanged and LCOV retained.
`npm audit --audit-level=high` initially reported the new `source-map-js` 1.2.1 advisory GHSA-68fv-2mgg-jv7q in a transitive development dependency already on `main`; the lockfile now resolves the patched 1.2.2 and the audit reports zero vulnerabilities.
`cargo fmt --check` passes.
Clippy passes with warnings denied.
Rust passes 95 tests with the existing constrained-volume test ignored when run without the root `CAP_DAC_OVERRIDE` capability.
Run directly as root, two existing permission tests fail because root ignores the read-only directory modes they depend on; neither test touches export code.

### Reproduced defects

Real PDF.js text from a synthetic three-line PDF exported by the previous plain-text algorithm produced `Quarterly Report First paragraph line. Second paragraph line.` on one line.
The previous sheet-name loop did not terminate within 100,000 iterations for two sheets named with 28 characters plus ` 2`; NavPDF's own sheet names are `Page N`, so the hang was latent.
The per-page native destination prompt for multipage PNG and JPEG exports and the uncancelled editable export after closing its dialog were identified from source and covered by new component regressions, not reproduced in native NavPDF.

### Independent-reader checks

`npm run acceptance:export-formats` passes 13 of 13 checks and writes its files and `results.json` under ignored `output/export-formats/`.
Python's csv module reads the CSV with quoted commas intact and formula-like cells prefixed by an apostrophe.
LibreOffice 24 converts the XML Spreadsheet 2003 file to XLSX, and openpyxl reads one sheet per page, typed numbers and dates, and formula-like text as text with no formulas.
Python's HTML parser and LibreOffice Writer read the HTML page; it contains no script element, escapes PDF text and declares the restrictive policy.
Python's XML parser reads the XML 1.0 document's pages, headings and paragraphs.
Pillow decodes both TIFF pages pixel-exactly with PackBits compression and the recorded resolution, and ImageMagick identifies both pages.
Ghostscript 10.02.1 renders every PostScript page at its page size within a mean channel difference of 1 from the JPEG source, and renders the EPS cropped to its bounding box.

Chromium browser preview exported `mixed-forms-annotations.pdf` as PostScript, HTML and TIFF through the real dialogs.
Ghostscript rendered all four mixed-size PostScript pages, including the rotated page and the visible form value.
Pillow and ImageMagick read four TIFF frames at 150 DPI with sizes 1275x1651, 1240x1755, 834x834 and 625x2084 pixels.
The SHA-256 values were `80d77f07fac2973afd49258e04518ea30a9b2dcb75d2fe0479aa06e33b0ae81e` for PostScript, `dfb5cbb476de514be465cb5b6a5e57e2a45eeaa1b0653d2c369537cfad7480d2` for HTML and `1596fc69e9aef57ae52c80c3f11b0f07588155d2e401dd3826a77bc3e4605b10` for TIFF.
Screenshots showed both export dialogs without clipping at 1280x860.

### Remaining limits

This delivery was produced in a Linux container without macOS, so native NavPDF packaging, WebKit rendering, the native Save dialog and Preview inspection were not exercised.
Microsoft Excel, Word and Adobe Acrobat were unavailable, so XML Spreadsheet 2003, CSV and HTML acceptance in those applications remains open.
No feature-parity, native acceptance or distribution gate is closed by this delivery.

## October 4 feature-review corrections

Source base: `4902cfc`, plus the source changes in this PR.
The October 4 review found the import/comparison defects recorded below; its unresolved comparison stall is retained in the [delivery tracker](DELIVERY-PHASES.md).

### Automated gates

Node `24.18.1` and `npm ci` were used.
Formatting, lint, typecheck, production build, `git diff --check` and `cmp AGENTS.md CLAUDE.md` pass.
The frontend suite passes 716 tests across 104 files.
Coverage is 84.80% statements, 76.98% branches, 83.37% functions and 87.94% lines, with the existing thresholds unchanged and LCOV retained.
Rust passes 95 tests; the existing constrained-volume test remains ignored.
Clippy passes with warnings denied.
Both new workflow regressions failed before their respective fixes and passed afterward.
The production build retains its existing large-chunk advisory; no performance improvement is claimed.

PR 50's first hosted run failed the npm audit and Sonar maintainability gate.
The audit identified the transitive development dependency `brace-expansion` 5.0.9; the lockfile now resolves the compatible patched version 5.0.12, and a fresh `npm ci` followed by `npm audit --audit-level=high` reports zero vulnerabilities.
The comparison empty-state message now uses native `output` semantics, with its existing regression asserting the accessible status role.
All automated gates above pass again after these corrections.
Sonar also reports eight existing sequential-await warnings in import and comparison operations; ordered input processing, cumulative text limits and bounded canvas memory still require sequential work.
Hosted results must be checked against the corrected commit.
The native package evidence below predates this markup-only correction and development dependency update; it does not establish a rebuilt package for this follow-up.

### Native and independent-reader checks

The baseline executable SHA-256 was `c77ea169f719214567947a1c573519b9c74cf285aaaa2e23a906b800b9438bb7`.
Create > Import / Combine Files with `reader-5.pdf` and range `99` reproduced an error behind the dimmed dialog.
With the import correction, range `99` displayed a readable error inside the modal while preserving the selected input.
Changing the range to `2` and retrying imported exactly the second source page, containing `NEEDLE-0002`.
This retry/save journey used intermediate executable `a07b5ff063e1e883d88fb0bd8d5d71fe88015844919900cfad152cfb4ccd4040`; the later application change only adds comparison empty-state feedback.
The output was saved as `output/review-20261004/retry-page-2.pdf`, closed with the app, and reopened in the final NavPDF package.
Preview independently opened the saved PDF as one page and visibly displayed the expected page-2 text and marker.

The final package compared `retry-page-2.pdf` with itself and reported one unchanged page.
Only changes displayed the explicit no-changes message and disabled the empty page selector.
Pressing Space to clear the checkbox restored both labelled previews; Tab moved focus to the enabled page selector.
The dialog text and controls were visually inspected at the current native window size.
No compact-window or full assistive-technology acceptance is claimed.

An earlier baseline comparison stayed at Reading original page 1 of 2 for several minutes.
It did not recur after a fresh launch or a subsequent create/save/compare journey.
The cause remains unresolved; progress-stage wording is an observability improvement, not a claimed stall fix.

### Package and artifact identity

`npm run package` produced the app and DMG, and `hdiutil verify` validated the DMG checksum (`B9DAAE1F`).

| Artifact | SHA-256 |
| --- | --- |
| Final `src-tauri/target/release/bundle/macos/NavPDF.app/Contents/MacOS/navpdf` | `0dc0d84bd230ce3491235d782963979d7a4f6e2fc39f2c96f10e368cb0fca039` |
| Final `src-tauri/target/release/bundle/dmg/NavPDF_0.2.0_aarch64.dmg` | `3aa0ef47be6c7a5f706678ca839ea40c601c9b2f37c1d685d6486f5869e1c396` |
| `output/review-20261004/baseline-combined.pdf` | `fe5a96e4a234fdc3efdb42f122cddc1ea07628c2a77fda89708e6144fe5650d7` |
| `output/review-20261004/retry-page-2.pdf` | `b20015ecfea8af4951d6e46e392dc441c91e1f082a7235c1e29863af1e311462` |

Hosted CI and quality analysis are separate from these local results.
Signing, notarization, clean-account installation, physical printing, other platforms and full product parity remain open.

## September 26 PR 42 quality remediation

The published head `5a3e1815ab4838e3e8cf2c825d6ec9d883b92582` had 51 unresolved Sonar findings despite a green quality gate, with zero new duplicated lines or blocks.
The follow-up simplifies bounded bookmark, merge, OCR, comparison and image-processing routines without changing their persisted formats.
It also removes duplicate CSS selectors, gives OCR review items stable session IDs, corrects label spacing and uses native image/output semantics for previews and status.
Image previews accept only browser-owned blob URLs and release them when replaced or closed.
CodeQL's reported path runs from a selected File through URL.createObjectURL into an image source; no executable HTML interpretation was reproduced.
The explicit blob scheme boundary and URI encoding are covered by malicious-scheme rejection and markup-character encoding tests.

The native ImageIO bridge now owns its returned allocation through a drop guard, including invalid-length and early-return paths.
Each unavoidable unsafe block documents the input lifetime, initialized output bounds and matching Swift allocator/deallocator contract.
The informational Semgrep unsafe-usage audit rule is acknowledged only at these three reviewed blocks; no project-wide scanner exclusion or security policy was changed.

Node 24 lint, typecheck, production build and all 712 frontend tests pass.
Coverage remains above the unchanged gates: 84.74% statements, 76.98% branches, 83.18% functions and 87.91% lines.
The independent PDF round-trip tests cover bookmarks, form/link-preserving merge and OCR review data.
New preview tests cover labelled rendering, stale-page clearing, cancellation, URL cleanup and rejected nonlocal schemes.
Rust passes 95 tests with the existing constrained-volume test ignored; Clippy passes with warnings denied.
Local logs are under ignored `output/pr42-remediation/`.
Hosted checks, direct Sonar issue and duplication queries, and merge eligibility must be verified again on the new published head.


Packaging and DMG checksum verification pass for the final URI-encoding follow-up on `5d6665a`.
The executable SHA-256 is `c77ea169f719214567947a1c573519b9c74cf285aaaa2e23a906b800b9438bb7` and the DMG SHA-256 is `08d9084ae21da6155218aadd6cb2a38f0cf327a81a34959a2f45eeaf0894617f`.
The bundle was relaunched and `bordered.png` displayed legible Before crop and After crop previews, preserving CROP TEST 123 and all colored borders at the expected 240 by 160 crop size.

Before the final URL-only adjustment, the rebuilt `5d6665a` bundle rendered Original and Compressed previews of `compression-source.pdf`, then replaced both with the correct COMPRESS-PAGE-3 images when the preview page changed.
Native TIFF import decoded both pages; page 1 accepted 2 pixels of padding and 2 degrees of straightening with before, after and unmodified-original views available.
The saved `output/image-crop-20260926/pr42-native-tiff.pdf` reopened in NavPDF and Preview with two blue pages, the first retaining its accepted rotation and padding.
Its SHA-256 is `8f83a2a1f953a2af627cc9b7b5803b3adf772f1858c6a28f29ea29caebe7bc88`.
The other persisted tool workflows retain the earlier native/Preview evidence and current independent automated round-trip coverage; they were not all repeated manually for this refactor.


## September 26 Preview acceptance and delivery follow-up

Implementation source: `1b0f1713a08241a46bf98295e458397e335e3830`, rebased onto `d21db38`.
The working tree was clean before this documentation-only follow-up.
Preview access was available in the desktop session; the earlier denied session was not bypassed.
All six handoff PDFs were opened as disposable copies under ignored `output/preview-20260926/`.
Original evidence files under `output/image-crop-20260926/` retain the hashes recorded below.
The packaged executable and DMG still match `b28e85443f47299178944be9ea830251caff84f1159737844a52415067b649c6` and `b67ef312c37893e522c493a4a33ce5588de25d9ba615dca0533d62b348184954` respectively.

| Saved PDF                      | Expected and observed Preview result                                                                                                                                                                                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `native-manual-crop.pdf`       | The full CROP TEST 123 label and colored border render without clipping intended content. The retained left margin is visible.                                                                                                                                                                                                   |
| `native-roadmap-reviewed.pdf`  | The visible scan still reads CROP TEST 123. Select All exposes CROP TEST 456. Searches for the full corrected phrase and 456 return the page, but the result row also says Not found; this inconsistent Preview status is retained as a UI limitation. PDFKit independently returns one match for each query.                    |
| `native-adjusted-tiff.pdf`     | Both blue TIFF-derived pages render in order. Page 1 visibly retains the slight accepted rotation and white padding; page 2 remains rectangular.                                                                                                                                                                                 |
| `native-preserved-merge.pdf`   | Three pages render, including the HEIC-derived image on page 3. Alice and Bob remain editable. Alice section and Bob section navigate to pages 1 and 2. On the disposable copy, Alice Preview and Bob Preview survive Save, Close and Reopen in Preview, and independent PDF.js widget readback confirms both saved text values. |
| `native-target-compressed.pdf` | All three pages render their legible COMPRESS-PAGE-1 through COMPRESS-PAGE-3 markers and image content. Searching COMPRESS-PAGE reports one match on each of three pages. The original saved output remains 46,665 bytes.                                                                                                        |
| `native-bookmark-depth.pdf`    | Preserved draft selects page 1. Expanding the outline exposes the original chain through Level 32. The single-root label limitation below applies to Level 1.                                                                                                                                                                    |

Preview displays the filename instead of a sole top-level outline title in these fixtures.
Consequently, Reviewed scan is not exposed as a separately labeled row, and Level 1 is represented by the document row above Preserved draft and Level 2.
This is an observed reader UI limitation, not evidence of a missing saved outline.
Independent Apple PDFKit inspection confirms Reviewed scan targets page 1, Preserved draft is a child of Level 1 targeting page 1, and every original level through Level 32 survives.
The exact requested separately labeled Reviewed scan navigation check therefore remains unverified in Preview.
No application defect was established by these checks and no application source was changed.

Evidence: `output/preview-20260926/evidence.json` records original hashes and independent PDF.js text-field readback; `pdfkit-outlines.txt` records Apple PDFKit outline and search results.
The edited disposable merged copy has SHA-256 `813620390f4807b53557a946396d0f6a94e6ef4e4855f33f73082ff858b0bf14`.
Earlier local logs were inspected and confirm 705 frontend tests, unchanged coverage gates, 95 Rust tests with one existing constrained-volume test ignored, Clippy and packaging success.
Those suites were not rerun for this documentation-only follow-up; formatting, diff checking and instruction-file parity were checked again.
Hosted checks and quality analysis remain separate from these local and reader results and must be assessed on the published PR head.
Signing, notarization, clean-account installation, physical printing, Acrobat-specific compatibility and Windows/Linux UI acceptance remain open.
This entry records the documentation follow-up only; merge history is independent of these reader observations.

## September 26 bookmark follow-up: local verification

Baseline remains `0dcb810` plus the preserved uncommitted twelve-feature implementation and this follow-up.
Native NavPDF reproduced an editor failure using `output/image-crop-20260926/bookmark-depth.pdf`: rename the top-level bookmark, then select Level 32 as its parent.
The earlier build closed the tool unexpectedly because the proposed 33-level tree threw during rendering.
Parent changes now validate the whole moved subtree before publishing draft state.
The rebuilt app displays `Bookmark nesting exceeds 32 levels.`, retains the edited title and original parent, and permits a valid retry under Level 1.

The regression failed before the correction and passes afterward, including a saved-outline check after retry.
All 705 frontend tests across 102 files pass with unchanged coverage gates: 84.65% statements, 76.77% branches, 83.07% functions and 87.83% lines.
Node 24 lint, typecheck, format checking and production build pass.
Rust passes 95 tests with the existing constrained-volume test ignored; Clippy passes with warnings denied.
Packaging produces the app and DMG, and `hdiutil verify` passes.
`git diff --check` and instruction-file parity pass.
Logs and artifact hashes are retained under ignored `output/bookmark-followup-20260926/`.

The rebuilt bundle was relaunched before repeating the native workflow.
Native save, close and reopen of `native-bookmark-depth.pdf` retain Preserved draft beneath Level 1.
Independent PDF.js readback confirms that title, its destination at page 1, its parent and every original level through Level 32.

| Artifact                                             | SHA-256                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| NavPDF.app/Contents/MacOS/navpdf                     | b28e85443f47299178944be9ea830251caff84f1159737844a52415067b649c6 |
| NavPDF_0.2.0_aarch64.dmg                             | b67ef312c37893e522c493a4a33ce5588de25d9ba615dca0533d62b348184954 |
| output/image-crop-20260926/native-bookmark-depth.pdf | ee5710c3ce241ecfc5b5e450e8e49c269a2ee1fceae715cac4e357cd4e9f5c39 |

Earlier feature acceptance below remains evidence for those workflows; only the bookmark follow-up was repeated in this latest bundle.
The previously blocked Preview gate and the other distribution/platform limits below remain open.
No commit, push, pull request or publication was performed.

## September 26 prioritized tools: implementation verification

Baseline source revision: `0dcb810`, plus preserved uncommitted crop work and this uncommitted implementation.
All twelve prioritized scopes have local implementations; [ADR 0013](adr/0013-imageio-import-and-document-tools.md) records the boundaries.
No commit, push, pull request or publication was performed.

### Automated checks

Node 24 format checking, lint, typecheck, production build and all 704 tests across 102 files pass.
Coverage gates remain unchanged: 84.63% statements, 76.75% branches, 83.05% functions and 87.82% lines.
Rust passes 95 tests, with the existing constrained-volume filesystem test ignored.
Clippy passes with warnings denied.
`npm run package` builds the macOS app and DMG; `hdiutil verify` reports a valid DMG checksum.
Logs and artifact hashes are retained under ignored `output/roadmap-20260926/`.

Regressions cover preserved field values, widget page references, internal links, local outline destinations and unsupported merge rejection; bookmark editing and independent PDF.js readback; saved OCR correction and redaction removal of OCR review data; crop geometry, pixel cleanup, batch failures, keyboard adjustment and preview controls; target selection, original-byte reuse, cancellation and already-under-target behavior; extended image framing and native TIFF orientation; and comparison alignment, text differences, cancellation and dialogs.
Synthetic ImageIO acceptance additionally creates and decodes one HEIC primary image and a two-page TIFF, checking 80 × 120 oriented PNG frames.
Run it with `swiftc -parse-as-library src-tauri/src/ocr/image_import.swift scripts/image-import-acceptance.swift -o /private/tmp/navpdf-image-import-acceptance`, then pass an ignored output directory to the executable.

### Native and saved-output acceptance

Native actions used the rebuilt app at `src-tauri/target/release/bundle/macos/NavPDF.app` and synthetic fixtures under `output/image-crop-20260926/`.
The final bundle was relaunched after application changes, and saved OCR review loaded CROP TEST 456 successfully.
The final cancellation regression verifies that a cancelled saved-review load can be retried and applied.
Its executable SHA-256 is `4f0e17c5266e9f295c4d54037ce81f22ef0c534d22e611d4cde10925efdaee63`.
The DMG SHA-256 is `6b14e1e579974b37e5aa4d7dbc49383c27a579420c06213714e9069108fe2291`.

| Workflow                        | Expected and observed result                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rendering                       | The original crop PDF stalled until resize in the earlier native build. CPU-backed canvases render it on fresh launch and repeated open without resizing. Experimental native redraw code was removed before acceptance.                                                                                                                                                                                  |
| Manual crop                     | The 320 × 240 fixture detected bounds x=33, y=21, width=240, height=160. Dragging the left handle set x=22, width=251; Right Arrow then set x=23, width=250. Before/after previews and bounded inputs updated. Save, close and reopen succeeded. Poppler's extracted 250 × 160 raster is pixel-identical to the corresponding source rectangle.                                                           |
| Batch trim and scan preparation | Native TIFF import expanded two pages in order. Batch trim reported 2/2 completed and no failures, producing 60 × 96 crops. The first page accepted 2 degrees of straightening and 2 pixels of padding, producing 67 × 103. Saved and reopened page sizes are 50.25 × 77.25 and 45 × 72 points, independently confirmed by Poppler. Cleanup behavior is additionally covered by pixel and UI regressions. |
| OCR correction                  | Apple Vision recognized CROP TEST 123. The native review field was changed to CROP TEST 456, then applied and saved. After close/reopen, Review saved OCR text showed 456. Poppler extracts 456, while independently extracted scan pixels still exactly match the original image containing 123.                                                                                                         |
| Bookmark editing                | Created Reviewed scan through the native editor, saved with the OCR result, and reopened it. Separate independent PDF.js round trips verify Unicode titles, nested destinations, rename, reorder and deletion.                                                                                                                                                                                            |
| Preserved merge and HEIC        | Combined merge-a.pdf, merge-b.pdf and the HEIC fixture. Saved/reopened Alice and Bob fields remain editable, four form field roots have unique names, and both bookmarks survive. Bob section navigates to page 2. Independent PDF.js validates destinations 0 and 1; Poppler reports the HEIC image on page 3 as 80 × 120 pixels.                                                                        |
| Compression target              | The 7,489,069-byte synthetic source was reduced to 46,665 bytes under a 2,000,000-byte target using Balanced. Both previews rendered, apply/save/close/reopen succeeded, and Poppler extracts all three original page markers. A 1,500-byte target on the small TIFF PDF reported failure and retained the original.                                                                                      |
| Comparison                      | Native comparison of the two-page TIFF output against the one-page OCR result reported one changed page and one removed page, showed both page previews, displayed the added text and highlighted visual changes. The active document was not modified.                                                                                                                                                   |

Saved output SHA-256 values:

| File in output/image-crop-20260926 | SHA-256                                                          |
| ---------------------------------- | ---------------------------------------------------------------- |
| native-manual-crop.pdf             | 3b03389bebcc40720ddc3de2816e02fd7dd2f9e1aff8d707974672d5483cebe7 |
| native-roadmap-reviewed.pdf        | dab25c9b24410c7b51dfe417bd8bc493fd89ff3e36196159699a7f642b2d59a5 |
| native-adjusted-tiff.pdf           | 6ffc62767cc0f6c69519b9c5f06a562e6b4318fdad8beb8a2e6939ebccf309f8 |
| native-target-compressed.pdf       | 086b090df4dfe6fcd4b5aa876e66fc27c9e4ccfdf09b4a271a916bc474ea5642 |
| native-preserved-merge.pdf         | d9fe50f85a15a478a2b936b91fe0b77d52572fd891449ead5e65639920228eb3 |

### Remaining limits

Computer Use returned `Computer Use was not approved to use Preview` earlier in this session; that reader gate was not bypassed.
Independent checks here use PDF.js and Poppler, not Preview or Acrobat.
The transient native pipe closure was resolved by reconnecting; native testing resumed successfully.
Signing, notarization, clean-account installation, physical printing, hosted checks, quality analysis and Windows/Linux acceptance were not performed.
HEIC/TIFF decoding requires macOS.
Straightening is a manual adjustment for imported images; automatic deskew and perspective correction are outside this implementation.
OCR searchable export retains its existing supported-font boundary, and third-party/older OCR layers must be recognized again before using saved-review editing.
Comparison is limited to 500 pages and 100 MiB per document, bounded text extraction and reduced-resolution visual detection; it does not certify equivalence.
These additions do not close historical delivery phases or establish complete Acrobat parity.

## September 26 image margin trimming

Baseline: `0dcb810`, initially clean working tree; the feature remains an uncommitted local change.
Create PDF > Import / Combine Files exposes a per-image trim action, cropped preview, dimensions and Reset crop.
Detection compares displayed RGBA pixels against a consistent corner background with a 24/255 channel tolerance, retaining all pixels outside that tolerance.
It supports uniform white, colored and transparent margins; faint content close to the border color can be indistinguishable from the margin, so the preview must be reviewed before import.
It does not deskew photos or infer paper quadrilaterals.
Image header, byte, dimension and pixel limits remain enforced before decoding; crop errors retain the original input and release temporary canvases and object URLs.
Import, removal and dismissal are blocked while detection runs.

Node 24 verification passes lint, typecheck, production build and 671 tests across 94 files.
Coverage is 85.60% statements, 77.49% branches, 83.19% functions and 88.68% lines, with existing thresholds unchanged.
The 18 added regressions cover asymmetric borders, white/black/colored/transparent margins, JPEG noise, isolated edge marks, blank/no-margin inputs, invalid pixel buffers, importing cropped dimensions, reset, busy-state dismissal and failure retention.
Rust passes 92 tests with the existing constrained-volume test ignored; Clippy passes with warnings denied.
Swift compiler-cache access required an approved build outside the filesystem sandbox.

Native acceptance used synthetic files under `output/image-crop-20260926/`.
The 320 × 240 PNG has margins of 33 pixels left, 47 right, 21 top and 59 bottom around a known 240 × 160 image.
The actual WebKit trim returned 240 × 160, displayed the expected preview, reset to the original on request, and re-applied successfully.
Native Combine & Open and Save As produced `native-cropped.pdf`, which was closed and reopened in NavPDF.
Poppler `pdfinfo` reports one 180 × 120 point page; `pdfimages` extracts a 240 × 160 RGB image that matches `expected.png` pixel for pixel.
Poppler also rendered the saved PDF correctly to `poppler-render.png`.
The JPEG fixture returned 241 × 160, conservatively preserving one additional compression-noise column.

Initial native repaint stalled after reopening, and screenshots subsequently disagreed with the updated accessibility tree.
Resizing through the native window zoom action refreshed the display and showed both the reopened cropped PDF and the final JPEG preview correctly.
The import list height was increased to show the preview and dimensions together at the tested window size.
Reliable initial native repaint remains an open viewer acceptance limitation; the crop output itself passed independent pixel verification.
Preview could not be tested because computer-use access to Preview was not approved.
No Preview or Acrobat acceptance is claimed.

The final app and DMG were rebuilt after the preview CSS adjustment; `hdiutil verify` passes with CRC32 `$19CEAB70`.
Final executable SHA-256: `32ecc019e12fff56e08fc339a26f0b45cb20e16eaf1be277e76e0b0d83e298a6`.
Saved acceptance PDF SHA-256: `ad05a191a4ee048b03f6535dafb87abff76f2db5b0a52d90b03ef7f187ab120c`.
The PDF was saved with the first feature build (`430d2c13bb822b85fe1fa73a92a38e63bc211c8a5a4d3dcfc51e827385e1a614`); the final build changes only the preview list height and reopened that saved output.
Hosted checks, commits, push, PR publication and distribution were not requested or performed.

## September 23 session and shortcut review

Review baseline: `397f04d`, with a clean working tree.
Source review covered the document session lifecycle, native IPC adapters, recovery storage, atomic persistence, keyboard shortcuts, native menu routing and search.
The environment was a Linux container without a native macOS build, so no native WebKit or packaged-app reproduction is claimed.
Each defect below was reproduced through the session hook or the rendered application shell with only the native IPC boundary mocked.

Autosave held the session lock, so Save, Save As, Close Window, Home, Open and Recent requests made during a recovery write were silently dropped.
A close request that won the race could also discard the recovery copy before the in-flight write recreated it.
The two new session regressions fail on the baseline and pass after the correction.
Autosave now tracks its own write; those requests wait for it and discard recovery only after it finishes.

Menu Undo and Redo reverted document changes while a text field such as the search box had focus.
They now leave the document unchanged while any text field, including one inside a dialog, has focus.
An earlier revision of this branch routed them to the field through the deprecated `execCommand` API; that was removed to keep static analysis clean, so menu-driven text-field undo is not provided.
This menu-routing hypothesis follows from the custom native menu items and is not yet observed in native WebKit.

Browser-preview saves appended a second `-edited` suffix on each repeated save and dropped the extension for names without `.pdf`.
Handled shortcuts no longer fall through to annotation nudging or page navigation.

Added Ctrl+Y redo, Cmd/Ctrl+G and Shift+Cmd/Ctrl+G to repeat the current search, and a repeated Find that refocuses and selects the search field.

Reader parity additions follow Acrobat Reader's View menu.
Previous View and Next View record page jumps from links, bookmarks, thumbnails, search results and page commands, but not ordinary scrolling.
Pages removed by an edit are skipped, and each opened document starts with empty view history.
The Layers panel lists optional content groups in the document's order and changes their visibility in the view only; it never marks the document dirty.
Read Out Loud passes text-layer content to the WebKit speech synthesizer in sentence-aligned chunks, advancing and showing each page as it reads.
Whether a system voice synthesizes locally is determined by the operating system; no text is sent by NavPDF itself.
Automatic scrolling advances single-page layouts at the page end and stops at the document end or on Escape.
Controller, module and application-shell tests cover these behaviors with PDF.js and speech mocked.
No native WebKit speech, optional-content rendering, or Preview/Acrobat comparison is claimed for these additions.

The interface review rendered the browser preview in headless Chromium at 1440 by 900 in light and dark appearance, before and after each correction.
Screenshots are kept under the ignored `output/ui-review-20260923/` directory and are browser evidence only, not native WebKit acceptance.
The existing 15-palette light and dark system, its contrast checks and the document-first layout were retained; no palette colors changed.
Fit page overflowed the viewport by about 9 pixels because the first page's top offset exceeded the 5 pixels PDF.js reserves; the page now fits without a scrollbar.
The print range radio group had no styles, so its three options ran together on one line.
Fill & Sign and Create PDF tab bars sat flush against the dialog edge, and the Fill & Sign tabs were unstyled.
The Create PDF page size and OCR language selects rendered without borders.
Organize Pages covered only its content size because an open dialog defaults to fit-content, leaving the workspace visible beside and below it, and the selected page card stretched to the full window height.
The page workspace grid also referenced an undefined background token.
Form field X and Y position labels sat inline with their inputs.
Shared radius and elevation tokens replace nine ad hoc corner radii and single-layer shadows; the two button styles now share height, radius, weight and hover color.
Text below 11 pixels was raised to 11 pixels, dialog form values are 13 pixels and regular weight, and hint text no longer inherits label weight.
Pages gain a hairline edge so white pages stay distinct on light canvases, and checkboxes and radios use the palette accent.
Theme colors still change without transitions, preserving the earlier native WebKit correction.

Local checks pass ESLint, TypeScript, Prettier on changed files, production build and 632 frontend tests across 90 files.
Coverage is 85.57% statements, 77.18% branches, 82.73% functions and 88.74% lines.
The only Rust change adds native menu items.
Clippy with warnings denied and rustfmt pass on Linux.
The Rust suite passes 90 tests with one ignored; two permission-denial tests fail because the container runs as root, which bypasses the read-only permissions they set, and are not claimed as passing.
SonarCloud could not be queried from the review environment, so its rule families were reproduced locally on the lines this branch adds: `eslint-plugin-sonarjs` recommended rules, the typescript-eslint and unicorn rules SonarCloud imports, and stylelint's CSS correctness rules.
Those runs report no findings on added lines after the corrections; hosted SonarCloud remains the authoritative gate.
Native macOS acceptance of save during autosave, close during autosave, menu Undo in a focused field, the Reader parity additions and the interface corrections remains open.

## September 20 repository safety review

Review baseline: `2726e03`, with a clean working tree.
Source review covered shared page selection and its print/export/OCR/split consumers, PDF helper boundaries, mutation queue/history, and the Linux GLib dependency chain.
This is a focused safety review, not a claim that every feature or remaining phase has been accepted.

The original native print dialog traversed `1000000000-2000000000` on a five-page document before reporting no matching pages.
A separate real-parser worker running `9007199254740992` did not terminate within a 1000 ms deadline and was terminated without blocking the native app.
The correction clips the iteration bounds to document pages and rejects unsafe integer endpoints before iteration.
The rebuilt native app rejected the unsafe singleton, rejected the wholly out-of-range span, and opened the macOS system print preview with all five pages for `1-9007199254740991`.
The system print operation was cancelled; no physical print or saved PDF mutation is claimed.
Native retry testing also exposed a stale range error after valid input; the print path now clears it after successful range validation.

The GLib source archive hash matches the registry lockfile checksum.
Only the two upstream pointer-mutability lines differ in the vendored crate; license and generated manifest are retained.
`cargo tree --locked --target x86_64-unknown-linux-gnu -i glib` resolves the full GTK/Tauri consumer chain to the patched local copy.
The local macOS run cannot execute the Linux-only regression; optimized Linux execution, Cargo Deny, Sonar and all hosted checks must pass before merge.
The prior advisory ignore was removed rather than expanded.
Local checks pass ESLint, TypeScript, Prettier, production build and 610 frontend tests across 88 files.
Coverage is 85.51% statements, 77.01% branches, 83.10% functions and 88.75% lines.
The native suite passes 92 tests with the existing constrained-volume test ignored, and Clippy passes with warnings denied.
Rustfmt, instruction-file parity and diff whitespace checks pass.
The Linux-only regression has zero applicable cases on macOS and is not claimed as locally executed.
The final package includes source `4f62766` plus the `TypeError` correction in this PR.
After relaunching that exact bundle, the unsafe singleton produced the expected validation message, the huge valid range opened all five pages in system print preview, and cancelling returned with no stale error banner.
`npm run package` produced the app and DMG; `hdiutil verify` passed with CRC32 `$8FA067B9`.
Executable SHA-256: `eedd8f0e88a703b849f02e769fd1211fa8ed791204965ce0afef4d65f1e3d9b9`.
DMG SHA-256: `9c8f3f8e12a1f7e82df2e669e8c84e9c274ea02b2290493fdb25f13f31cc8fd5`.
Final fixture `tests/pdf-fixtures/reader-5.pdf` SHA-256: `6c973cd5e55fec849c5ea8e3cff26526be2daf4e28abdd4e0c8d9514284dc84a`.
The app and DMG remain unsigned local distribution artifacts; no signing, notarization, clean-account installation or physical-printer acceptance is claimed.

CI run `35550010967` at `4f62766` passed Linux/macOS Rust, MSRV, Cargo Deny, frontend and native acceptance checks.
The Linux log confirms `variant_string_iteration_preserves_values_in_both_directions` ran and passed with GLib configured at optimization level 3.
The vendored dependency emits upstream lifetime-style warnings under the current Linux compiler; application Clippy passes with warnings denied.
Sonar's initial green check still reported one new `typescript:S7786` finding, corrected by using `TypeError` for the unsafe-integer rejection.
The final PR revision must have zero unresolved Sonar issues and passing hosted gates before merge; results are tracked on PR 28.

At `977c068`, Sonar confirmed zero unresolved issues and all CI jobs and individual CodeQL language analyses passed.
The aggregate CodeQL gate reported 13 findings in unchanged vendored GLib code; SARIF analysis `1808385631` was reviewed against the concrete source types and ownership rules.
Alerts 56 through 68 were dismissed as false positives with individual evidence comments.
Alert 56 models a UUID-validation boolean as secret text and routes it into an unrelated log-level conversion.
Alerts 57 through 61 conflate generic string/error conversions with GObject, GValue or test boxed types and omit FFI output writes or explicit non-null guards.
Alerts 62 through 67 conflate string arrays with GSList, GList, GPtrArray or Checksum conversions; concrete outputs are `Vec<GString>` or `Vec<OsString>`.
Alert 68 treats dropping a pointer-wrapper element as freeing its backing slot, which the slice still owns when writing the null terminator.
These are scoped triage decisions, not additional code fixes or evidence that every upstream unsafe function is defect-free.
CodeQL configuration and vendored-source analysis remain enabled; no query or path exclusion was added to CodeQL.
The actual GLib advisory is fixed by the separately reviewed mutable-output-pointer backport and optimized regression.
GitHub reports zero open CodeQL alerts for PR 28 after triage, but the aggregate gate must refresh on the final revision before merge.

## September 19 single-document workspace

Application source: `6b7fd37`, including the callback cleanup after `9a7fca2`.
Local checks pass lint, TypeScript, formatting, production build, 587 frontend tests across 85 files, 89 Rust tests, Clippy with warnings denied, Rustfmt, instruction parity and diff whitespace checks.
The existing constrained-volume Rust test remains ignored.
Coverage is 83.89% statements, 76.08% branches, 81.23% functions and 86.73% lines.
Both the application and DMG built; hdiutil verified CRC32 `$D7B69CB6`.
Final executable SHA-256: `cf52f95151810a1ed7d2457c98414aba9c5b4f1b645ed8ec9349cca2e5ec2cb3`.
Final DMG SHA-256: `7335fec58d53a4cbb12df1b23f63e1e0e9d08a6290eb3d427f150bb5a281c4b1`.

Native inspection covered the document and mode bars, left tool list, markup rail, right page controls, opening/closing the pages panel, page-entry keyboard navigation, visible focus, light appearance, gray dark appearance and restored System/Default-light/Ocean-dark preferences.
The default 1440 by 960 window was inspected; compact-window acceptance remains open because native edge drags did not resize the window and alternate edge coordinates returned windowNotFoundAtPosition.
No compact-layout success is inferred from CSS breakpoints or unit tests.
Opening the right panel initially clipped a fitted image page; the final bundle refits it correctly while retaining explicit numeric zoom behavior in the regression test.
The page-fit bundle reopens the saved image PDF with both page and thumbnail rendered.
The final callback-only cleanup bundle passed a fresh launch, startup-tip dismissal, expanded tool list and keyboard page-entry check.
Export cancellation retained the Office dialog and the original reader page.

Native Import selected a synthetic PNG, combined it into a PDF, saved a copy, closed and reopened it.
Preview displayed the saved yellow page, and Poppler independently reported one 240 by 120 point page.
Artifact: `output/workspace-native-import.pdf`, SHA-256 `ad195175fa4931b24c9748fa080b646320e689a933609ebfc5b4590bd3bda435`.
Integration coverage also composes PNG and JPEG pages and verifies dimensions and image operators through PDF.js after reload.
Malformed headers, excessive dimensions and oversized files are rejected before decoding.

The native Office export reproduction hung the main thread inside WebKit's download sandbox-extension issuance.
The process sample is `output/navpdf-export-sample.txt`; the clean synthetic reader session was force-quit through Activity Monitor.
The replacement native Save dialog successfully saved DOCX, PPTX and a 1274 by 1649 PNG without the freeze.
These export and compression workflows ran in executable `68542a2be310ed6dc80e65bfa67b4a0b0e5b0a82e059ddaef5a078fdbfd5c82a`, before the final page-fit-only correction.
Microsoft Word opened the DOCX and displayed its text, and Microsoft PowerPoint opened five slides without a repair prompt.
Independent ZIP integrity and XML parsing verified all five page markers in both Office outputs.
DOCX: `output/workspace-native-export.docx`, SHA-256 `1de65cd6bea53e3abd17f245d0b9fbff4210804fad2402dfdc5e6d34fa4554fb`.
PPTX: `output/workspace-native-export.pptx`, SHA-256 `f911159c32a39d3442bc68a2b827f5aa6d88c6a711b4f368d17b2f69391bf76d`.
The editable formats preserve reconstructed text, not original PDF drawings or exact Office formatting.

Balanced compression on the synthetic image-heavy fixture measured 7,489,070 bytes before and 46,665 bytes after, with three pages, three image placements and zero text differences.
The saved copy reopened in NavPDF and Preview, showing the expected text and image.
Artifact: `output/native-p7p8/workspace-compressed-20260919.pdf`, SHA-256 `7877297776c811cfa1053b574fb56846e297307af3368920cc5f242b8507440b`.
The 5,314-byte reader fixture would grow to 7,578 bytes, so the tool correctly retained the original.
These fixture measurements are not a general compression-ratio claim.

The user's preserved edited PDF remains unchanged at `output/reader-5-preserved-20260919.pdf`.
Signing, notarization, clean-account installation, physical printing, non-macOS UI and the separately tracked advanced capabilities remain open.
Hosted checks and merge status are recorded in PR 22; Sonar analysis requires a configured token and must not be inferred from a skipped workflow step.

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
PR 21 records hosted checks and merge status.
Codacy, CodeQL, frontend, Rust and native acceptance passed on the application commit.
NPM Audit passed after registry maintenance cleared, and PR 21 merged as `13109e3`; the optional CI Sonar analysis was skipped at that checkpoint.
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

## September 15 correction package

Source revision: `d83f6d8271dd77c973df799f63dfecff14152128` on the historical `fix/september-14-review-corrections` branch.
Local validation passed 504 frontend tests with coverage, lint, typecheck, build, formatting, 80 Rust tests and Clippy; one constrained-volume test was ignored.
Phase 7 passed 55/55, Phase 8 passed 12/12, Phase 10 passed 55/55 and the real native OCR corpus passed 6/6 samples.
The OCR report is `output/ocr-review/corpus-report.json`.
Hosted run `35012242904` passed the recorded CI and native acceptance jobs after manifest, license, Swift linkage and fixture-generation corrections.
A fresh packaged process rendered the 500-page fixture and thumbnails without the persistent spinner.
Preview and Acrobat reopen checks for that exact correction build were not completed.
The app executable SHA-256 was `9a6364bf60b67d504fd64ec30e5ddc4d2cefc332df364a2dc17e045f92bf43c4`.
The DMG SHA-256 was `2904b2a5bcbbf680aff64ec8284e5e7553afdc0c579379818eb68e8f9f27c0a82`, with `hdiutil verify` CRC32 `$B4992B9A`.
These hashes are historical and do not identify the current source.

The correction uses independent per-document recovery PDF/JSON pairs, not the proposed shared manifest.
The save-time redaction audit arms only when the committed revision matches the audited output; later page deletion/reordering can require redaction again before saving.
Composite-font geometry without reliable metrics and the ad-hoc-build Keychain prompt remain scoped limitations.

## September 14 corrective review of e00e46a

The local corrections replaced unsafe signature storage, corrected native revision ownership and introduced real OCR; see the correction notice above.
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

## September 13-14 native acceptance artifacts

These observations predate the corrective builds above and retain their original limitations.

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
Historical limitation: these exports used browser downloads to `~/Downloads`; the September 19 native export adapter later replaced this path with selected destinations.

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

## September 19-23 settings and styling acceptance

### September 19, 2026 settings and theme verification

Application source: `c93b9a119cbd3e5836243c213a7d9d6b0ef7ab63`, for the settings reliability and palette delivery.
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

Hosted validation and merge status are recorded on PR 20.
The required Rust check name now aggregates successful Linux and macOS jobs without changing branch protection.
SonarCloud's workflow skips analysis because `SONAR_TOKEN` is absent, so its green workflow result is not a passing analysis.
The separate hosted review scan reports an unsupported service model; this is distinct from CodeQL and Codacy analysis.
GitHub also reports an existing moderate advisory against transitive `glib` 0.18.5; this change does not alter that dependency or advisory policy.
Signing, notarization, clean-account launch, physical printing, non-macOS native UI and broader PDF interoperability gates remain open.

### September 23, 2026 dialog and theme styling verification

Every tool panel, dialog, the settings sheet, the viewer and home were captured in the browser preview at 1440x900 in light and dark schemes.
The captures found a Document Properties dialog with no dialog surface, native checkboxes, radios, sliders and color inputs outside the palette, group legends without spacing, doubled field spacing and unstyled engine warnings.
They also found a Redact panel covering the command bar, a right rail whose last control fell below 900 px, and a properties file size that read 0.00 MB for a 2.5 KB file.
Several dialogs referenced undefined color tokens and hardcoded colors, which ignored the palette and dark mode.
The corrected captures show each surface on the shared modal layout and palette tokens in both schemes.
`npm run lint`, `npm run typecheck`, `npm run test:coverage` (632 tests) and `npm run build` passed.
The browser preview does not establish native WebKit rendering; native macOS visual acceptance of these surfaces remains open.
Native modal dialogs (Settings, Export a PDF, Add Sticky Note, Open Recent, Unlock PDF, unsaved-changes and Help) now share the tool dialog shell: width, radius, elevation, icon header, label style and footer bar.
Their light and dark captures were compared with the Print dialog; `npm run lint`, `npm run test:coverage` (632 tests) and `npm run build` passed.

### September 23, 2026 Add Text styling and style matching verification

`tests/unit/text-formatting.test.tsx` reads saved output back through PDF.js and confirms the font name, size and fill color for regular, bold, italic and bold italic variants, including the legacy `fontFamily` values.
The same file confirms justified lines reach the wrap width while each paragraph's last line stays ragged, underline strokes one line per text line, and line spacing sets the baseline distance.
Its dialog tests pick an existing run's style, insert new text and confirm the new run is written in the matched font, size and color.
`tests/unit/text-styles.test.ts` confirms the reader reports real font names, sizes after graphics-state scaling and fill colors, and ignores invisible OCR text.
Browser preview captures of the dialog in light and dark schemes, and an insertion into `mixed-forms-annotations.pdf`, showed the matched Helvetica 15 pt text rendered like the page heading.
`npm run lint`, `npm run typecheck`, `npm run test:coverage` (653 tests) and `npm run build` passed.
Native WebKit rendering and Preview or Acrobat reopening of styled text were not exercised; those interoperability checks remain open.
