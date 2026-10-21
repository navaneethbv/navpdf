# Delivery tracker

Reviewed October 16, 2026 against `c09576f` on `main`.
This is the single current-status and handoff document.
The [acceptance checklist](phases/README.md) defines phase gates; the [verification ledger](VERIFICATION.md) records dated evidence.
The [product specification](PRODUCT-SPEC.txt) describes the original goals, with subsequent scope decisions in [ADRs](adr/README.md).
Implemented controls and passing automated tests do not establish complete native acceptance or Acrobat/PDFCraft parity.

## Current delivery

PR [66](https://github.com/navaneethbv/navpdf/pull/66) merged twenty local workflow additions and quality corrections as `d396345`.
PR [68](https://github.com/navaneethbv/navpdf/pull/68) merged two PDFCraft-compatible tool batches as `c09576f` on October 16.
GitHub records successful CI, native acceptance scripts, CodeQL, Codacy and SonarCloud Code Analysis for PR 68's final head.
The optional SonarCloud CI analysis job was skipped; it is separate from the successful automatic analysis.
These results do not close the outstanding native UI, parity or distribution gates.

The latest additions are tool search, poster tiling, saved initial-view preferences, bookmark/size splitting, form XFDF, expanded accessibility checks and HTML reports, link cleanup and creation, heading-based bookmarks, form-field arrangement, measurement CSV, redaction word lists, space auditing, merged form CSV and comparison reports.
[PDFCraft comparison](PDFCRAFT-COMPARISON.md) records their scope and remaining gaps.
The upstream checklist's 530 shipped or partial entries have not all received an individual NavPDF assessment.
On October 21 the user asked for every remaining PDFCraft gap, including items that need safety-rule decisions, on one draft PR in batches.
The [remaining gap programme](PDFCRAFT-COMPARISON.md#remaining-gap-programme) lists the batches and their status.
Batch 3 adds page clipboard operations, thumbnail sizing, print boxes, page transitions, custom properties, a fonts list and six comment types.
Batch 4 adds list box, date and image fields, a script-free date picker, field properties, duplication across pages, tab order, field detection, label-based naming and form preview.

## Phase status and remaining gates

Phase numbers preserve the original delivery order.
Historical acceptance applies only to the source and artifacts recorded in the ledger.
Reopened phases stay open until their remaining native and independent-reader gates are recorded.

| Phase | Implemented scope | Acceptance status and remaining work |
| --- | --- | --- |
| 1: Reader and file safety | Viewing, search, immutable range snapshots, validated atomic saves, recovery and replacement guards. | Historical native safety and 500-page round trips exist; renew changed lifecycle paths on the release candidate. |
| 2: Local annotations | Text markup, notes, ink, shapes, properties, comments, snapshots and local review exchange. | Historical native/reader evidence exists; broader rotated/cropped, non-ASCII and repeated-edit acceptance remains relevant after changes. |
| 3: Forms and Fill & Sign | Supported widgets, field creation/editing, numeric geometry and arrangement, form-data exchange, signature appearances and Keychain-backed storage. | Reopened: locked-Keychain/migration and combined native form/signature acceptance remain open; on-page field dragging and additional authoring/formatting are incomplete. |
| 4: Page operations | Create/import, reorder, rotate, crop, insert, extract, merge, split, native revisions and macOS printing. | Reopened: combined revision, undo/redo, save/reopen and preservation acceptance remains open; later merge evidence covers only the recorded subset. |
| 5: Content and decoration | Scoped text/image placement, transforms, headers/footers, watermarks, Bates numbering, links and attachments. | Historical evidence exists; verify repeated updates preserve source content and declared font/geometry support on changed paths. |
| 6: OCR and basic export | Real local Apple Vision recognition, searchable layers, review/correction, text and image exports. | Reopened: six native corpus samples and later saved-output checks exist; representative scan quality, latency, memory and full native acceptance remain open. |
| 7: Existing edits, protection and redaction | Simple-font text/image edits, AES-256 protected copies, measured compression and audited redaction. | Dedicated adversarial and historical native checks exist; keep per-operation independent audits and explicit rejection limits. |
| 8: Conversion and local tools | Genuine text-based Office and other exports; extractive passage retrieval. | Approved export subset has independent evidence; Office import and higher-fidelity conversion are absent, model generation/translation deferred by ADR 0008. |
| 9: Distribution and platforms | Historical unsigned Apple silicon app and DMG builds. | Open: current release packaging, clean-account installation, signing/notarization, physical printing, native accessibility/performance and Windows/Linux acceptance. |
| 10: Optional integrations | Local PKCS #12 signatures and DocMDP certification with independent integrity checks. | Approved signing subset has evidence; trust/revocation/timestamps remain outside it, remote services and specialist media declined by ADR 0010. |

## Next acceptance work

1. Resolve the release-only Rust E0463 macro-loading failure, rebuild the exact current app and DMG, and verify the disk image.
   Debug builds and earlier packages do not establish a current release package.
2. Complete native save, close and reopen in NavPDF and Preview for both PR 68 batches.
   Only tool-search interaction and the initial-view workflow have native development-build evidence; initial view has independent Preview inspection.
   Poster output has independent service-level checks, while XFDF, ZIP splits, accessibility reports and all second-batch native workflows remain open.
3. Finish the per-entry PDFCraft comparison, map source/tests and deliberate exclusions, then scope remaining compatible implementations in delivery order.
4. Renew combined form, signature-storage, revision, OCR and save/recovery workflows on the current native build.
   Include rotated/cropped pages, mixed sizes, non-ASCII text, long-lived sessions and independent appearance checks.
5. Complete Phase 9 release gates against that candidate without treating automated acceptance scripts as GUI or distribution acceptance.

## Known limitations and follow-up

- Release packaging failed while loading `cssparser_macros` and, in fresh release targets, `time_macros`.
  The root cause remains unresolved; logs and toolchains are recorded in the ledger.
- A native comparison once stalled at Reading original page 1 and succeeded after relaunch.
  Its cause remains unresolved; retest repeated comparisons and sleep/wake in a long-lived session.
- Preview opens the PR 68 initial-view artifact on page 1 despite the saved page-2 destination.
  The preference is saved correctly, but readers can override it.
- Preview replaced sole top-level outline labels with the filename and showed inconsistent OCR search-result status in September 26 checks.
  PDFKit confirmed stored hierarchy and text matches; separately labeled Reviewed scan navigation remains unverified in Preview.
- Native compact layout, focus appearance and contrast acceptance is incomplete for recent tools.
  The October 16 capture did not reliably reflect the modal accessibility tree.
- Scanner acquisition, automatic document-edge/perspective correction, arbitrary text reflow, PDF/A conversion/validation, accessibility remediation and additional annotation/form tools remain broader capability gaps.
  OCR correction edits app-owned layers; Office exports reconstruct text and do not preserve general source layout.
- Signature trust stores, revocation, timestamps and long-term validation, automation interfaces, localization and docking remain outside the delivered PDFCraft subset.
  Embedded-script execution and automatic external actions remain excluded.
- Large-document native revision recycling, timer/serialization cost and process memory still need measurement.
  Use `npm run perf:fixture`, `npm run perf:probe` and `npm run perf:drive`; earlier measurements are not current performance results.
  Domain/controller refactors and the production chunk-size advisory remain maintenance follow-up, not prerequisites to invent a new engine.
- Existing-file replacement has a fingerprint-to-rename race and is not a cross-process compare-and-swap.
  POSIX modes do not establish ACL, ownership or extended-attribute preservation.
  The real constrained-volume disk-full test remains ignored unless its disposable environment is available.

## Evidence rules

For each persisted tool change, record source revision, executable hash, synthetic fixture, actions, expected/actual result, saved output/hash and independent-reader results.
Retain source data, dirty state and recovery until a replacement or save commits.
Use the repository's required checks for application changes; documentation-only changes need content, link, instruction-parity and whitespace checks.
Report local checks, hosted checks, quality analysis, review policy, merge and distribution separately.
A skipped scan or a successful app-only build does not satisfy its separate analysis or DMG gate.
