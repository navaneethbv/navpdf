# PDFCraft capability comparison

Reference: `storytold/pdfcraft` at `f0c9901c398372782a4eb001c95638289a5edab0`, inspected October 16, 2026.
Pre-integration NavPDF baseline: `d3963457a3bfbe0d85555c0f0e2657e4333e295e`.
The upstream `parity/acrobat-features.toml` contains 437 shipped and 93 partial entries.
Its other 308 entries are planned or not applicable, not implemented capabilities to port.
Upstream classifications describe upstream claims; they do not establish NavPDF gaps or successful interoperability.
This family-level comparison is a starting inventory, not a completed assessment of all 530 entries.

[ADR 0016](adr/0016-pdfcraft-capability-integration.md) records the architecture decision.
The two batches merged in PR 68 as `c09576f`; this comparison still describes a partial inventory.
The [delivery tracker](DELIVERY-PHASES.md) owns progress; the [verification ledger](VERIFICATION.md) owns acceptance evidence.

| Family | Shipped or partial upstream entries | Source comparison and remaining work |
| --- | ---: | --- |
| Core | 46 | Upstream `crates/cos`, `crypt` and `engine` versus NavPDF native commands, filesystem and security modules. NavPDF already has bounded opening, atomic saving, undo and recovery. Encrypted editing/recovery, revision browsing, repair reporting and session reopening need individual implementation and fidelity checks. |
| Viewing | 66 | Upstream renderer and `ui-egui` versus `src/features/viewer` and the app shell. Both have navigation, layers, search and layouts. The first batch adds shared-catalog command search. Tabs, column selection, fit-visible, deep-zoom behavior and rendering edge cases remain unassessed at behavior level. |
| Editing | 39 | Upstream `crates/edit` versus NavPDF editor and document tools. Existing text/image editing is limited. Paragraph reflow, spacing, image transforms, object operations and action editing require separate behavior comparisons. |
| Organization | 51 | Upstream `crates/organize` versus NavPDF page workspace and PDF command services. The first batch adds top-level bookmark and measured-size ZIP splitting plus saved initial-view settings. Page transitions and preservation of fields, layers, attachments and navigation through composition remain open comparisons. |
| Comments | 55 | Upstream `crates/annot`, `xfdf` and `measure` versus NavPDF annotation tools and comment summaries. Existing annotations are not a missing feature family. Callouts, clouds, insertion/replacement marks, attachment comments, annotation XFDF/FDF, measurement snapping and dynamic stamps require further work. Form XFDF in the first batch does not implement annotation exchange. |
| Forms | 67 | Upstream forms, XFA and script crates versus NavPDF form manager and form-data services. The first batch adds editable-field XFDF import/export using existing validation. The second batch adds field alignment/distribution; additional field types, formatting, detection and XFA remain open. Embedded scripts and script-backed calculations are excluded by the retained safety policy. |
| Protection | 26 | Upstream crypt/redact/audit versus native `engine/protect.rs` and `engine/redact.rs`. Password protection and secure-redaction paths already exist. Encryption-option differences, redaction codes and faux-redaction auditing require independent output checks before equivalence claims. |
| Signatures | 33 | Upstream `crates/sign` versus native `engine/sign.rs` and signature UI. NavPDF already signs using local PKCS #12 files. Local DocMDP certification already exists under ADR 0009. Platform certificate stores, timestamps, revocation, long-term validation and trust management are not supplied by these batches. Network services need a separately scoped architecture decision. |
| OCR | 12 | Upstream OCR crate versus NavPDF local Vision integration. Recognition already exists. Batch OCR, preprocessing, camera perspective and cross-platform language behavior require comparison and native acceptance. |
| Creation/export | 16 | Upstream create/export versus NavPDF creation and conversion modules. NavPDF already supports images, Office-style exports, HTML, text and raster formats. Clipboard/text creation, batch behavior and fidelity remain to compare; format names alone do not prove equivalence. |
| Optimization | 25 | Upstream optimize/preflight versus NavPDF compression and sanitization. The second batch adds estimated space auditing; PDF/A validation/conversion, output intents and selective cleanup remain open. No PDF/A conformance claim is made. |
| Printing | 17 | Upstream print crate versus NavPDF system printing and imposition. The first batch adds bounded poster tiles with overlap. Poster output includes page content only. Annotation/form inclusion, grayscale, print preview and platform printer controls still need native comparisons. |
| Accessibility | 49 | Upstream `crates/a11y` versus NavPDF accessibility services/dialog. The first batch adds heading/list/table/nested-alt/formula structure checks and escaped HTML reports. Tag remediation, reading order, autotagging and remaining checker rules are open. Neither checker alone certifies PDF/UA compliance. |
| Automation/platform | 28 | Upstream automation, command registry, CLI and UI versus NavPDF typed native adapters and React shell. CLI/MCP, batch action workflows, UI control, localization and installer differences are separate unimplemented interfaces or unverified capabilities. No remote service or control channel is introduced. |

## Second batch mapping

The second batch was compared against the upstream checklist at `9e5b70d1c231d7db558e278a2622b519ca063494`, inspected October 16, 2026.
Each row names the upstream entry, the NavPDF implementation and its scoped limits.

| Upstream entry | NavPDF implementation | Scope and limits |
| --- | --- | --- |
| `edit.links-from-urls` | Link Tools, `services/pdf/link-tools.ts` and `features/editor/url-links.ts` | http, https and www addresses within one text item; addresses split across items or lines are not linked; link areas are estimated from text positions. |
| `edit.remove-all-links` | Link Tools | Removes link annotations only; bookmarks are unchanged. |
| `optimize.remove-invalid-links` | Link Tools | Removes internal links whose destination reaches no page and clears dead bookmark destinations while keeping titles and children; unreferenced named destinations are not pruned. |
| `organize.bookmarks-from-structure` | Bookmarks from Headings | Font-size heuristic over the text layer with up to four levels, reviewed before saving; document tags are not read. |
| `form.align-distribute-fields` | Move & Resize Fields arrangement | Align, centre, distribute and match sizes for widgets on one page relative to an anchor field; dragging on the page remains open. |
| `comment.measure-export` | Measure dialog Export CSV | Lists saved Line, PolyLine and Polygon annotations with a /Measure dictionary using their recorded captions. |
| `protect.redact-word-lists` | Redact PDF word list | Plain-text list of up to 500 entries searched in one pass; every entry is also audited after redaction. Redaction codes are not implemented because overlay text requires native redaction changes. |
| `optimize.audit-space` | Space Usage | Estimated serialized object sizes by content category with CSV export; not exact byte ranges of the original file. |
| `form.merge-to-spreadsheet` | Form Data merge action | One CSV row per filled PDF form with the union of editable fields; FDF and XFDF inputs are not merged. |
| `misc.compare-report` | Compare PDF Versions report | Printable PDF of counts and changed-text excerpts; characters outside the built-in Latin font print as "?". |

Replacing page colours (`a11y.replace-page-colors`) was assessed and deferred because PDF.js accepts page colours only when the viewer is constructed, so it needs viewer lifecycle work with its own acceptance.

## Acceptance boundary

The additions are independent implementations using the established PDF engines and a dedicated XML parser, not copied upstream modules.
Tests cover their current contracts, including malformed input and stale results, but do not prove the entire upstream feature family.
Before full parity can be claimed, each shipped/partial upstream entry needs a NavPDF source/test mapping, a deliberate policy exclusion, or a completed implementation with native and independent-reader evidence.
The requested full outcome remains open.
