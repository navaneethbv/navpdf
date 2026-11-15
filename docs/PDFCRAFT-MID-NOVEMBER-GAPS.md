# PDFCraft mid-November gap programme

Reviewed November 15, 2026.
Previous reference: `storytold/pdfcraft` at `5644d56c64af1529b0f9012874886fcad855c257`, committed November 7, 2026.
New reference: `storytold/pdfcraft` at `a11ea7ad8570871bac9e57cff62b0348a0b077f7`, committed November 15, 2026.
NavPDF baseline: `82dbc1f` on `main`.

## How the gaps were found

Upstream made 2,014 commits between the two references.
Its `parity/acrobat-features.toml` checklist went from 457 shipped, 118 partial, 257 planned and 23 not-applicable entries to 473 shipped, 126 partial, 237 planned and 23 not-applicable entries.
No entry was removed.
Four entries are new and 21 existing entries changed status.
Each of those 25 entries was compared with NavPDF source by name, service and user interface.
Upstream classifications describe upstream claims; they do not establish NavPDF gaps or successful interoperability.
The [November gap programme](PDFCRAFT-NOVEMBER-GAPS.md) holds batches 12 to 17; the [delivery tracker](DELIVERY-PHASES.md) owns progress.

On November 15 the user asked for the latest upstream features to be brought in.
Thirteen entries are implemented in batches 18 to 20, nine are deferred with the reason recorded, and three are declined under the safety rules.

## Batch 18: optimizer, attachments, forms and links

| Upstream entry | NavPDF behaviour | Status |
| --- | --- | --- |
| `optimize.discard-search-index` | Compress, Discard, Embedded search index: removes catalog `/PieceInfo` entries whose name contains "index". Remove Hidden Information also removes them. | Implemented in `src-tauri/src/engine/discard.rs`. Indexes stored under other private keys are not recognised. |
| `optimize.discard-form-actions` | Compress, Discard, Form submit, import and reset actions: removes `/SubmitForm`, `/ImportData` and `/ResetForm` actions wherever an action can be stored, keeps the other actions in a chain, and leaves fields and their values alone. | Implemented. A push button whose only action was removed stays visible and does nothing. |
| `optimize.discard-external-refs` | Compress, Discard, Links and actions that open other files: removes `/GoToR`, `/GoToE` and `/Launch` actions and deletes a link annotation left with no action or destination. Web links stay. | Implemented. Reference XObjects and external streams are not removed. |
| `organize.attachments-description` | File Attachments shows each description and edits it in place, up to 1,000 characters; an empty description removes the entry. | Implemented in `setEmbeddedAttachmentDescription`. Attachments are addressed by name, so two with the same name share the edit. |
| `form.show-tab-numbers` | Form tools, Show tab numbers on the page: a numbered badge on each form field in the order the page presents them. | Implemented as a view preference. Numbers restart on each page and follow the rendered order, not a recomputed `/Tabs` order. |
| `protect.redact-filename-suffix` | Saving after applying redactions proposes `name_Redacted.pdf`, so the original is not replaced by accident. | Implemented in `redacted_name`. The user can still choose any name. |
| `view.text-links` | Web addresses written as plain text are clickable and ask before opening, exactly as link annotations do. | Implemented with the PDF.js auto-link layer. An address starting with `www.` opens as `http`; nothing is written to the file. |
| `organize.bookmark-actions` | A bookmark whose action is a web address is listed and asks before opening. | Implemented for web addresses. Bookmarks that open another file, change layers or run other actions are not followed. |

## Batch 19: redaction by regular expression

| Upstream entry | NavPDF behaviour | Status |
| --- | --- | --- |
| `protect.redact-regex` | Redact, Find by regular expression: marks each match in the text layer, with an ignore-case option and an optional Luhn or IBAN checksum filter. Marks are reviewed before Apply, as with the built-in patterns. | Implemented under [ADR 0022](adr/0022-regular-expressions-text-links-and-print-production.md). Matching runs in the native engine with the linear-time `regex` crate; look-around and back-references are not supported, a match cannot span pages, and an expression that can match nothing is refused. |

## Batch 20: print production

| Upstream entry | NavPDF behaviour | Status |
| --- | --- | --- |
| `print.printer-marks` | Print Production, Printer marks: trim marks, bleed marks, registration targets, a colour bar and page information drawn outside the trim box in the registration colour. A page without 36 points of room grows and keeps its trim box. Remove Marks restores the saved boxes. | Implemented in `src-tauri/src/engine/prepress.rs`. Marks are page content, not a printer mark annotation, and the colour bar uses device CMYK and grey. |
| `print.fix-hairlines` | Print Production, Fix hairlines: strokes thinner than a threshold are widened to a chosen width, measured with the scale in effect at each stroke, in page content and form XObjects. | Implemented. Type 3 glyphs, patterns and annotation appearances are left alone, and a non-uniform scale is measured by its geometric mean. |
| `print.convert-colors` | Print Production, Convert colours: device grey, RGB and CMYK operators in page content and forms, and optionally images NavPDF can decode, convert to grey, RGB or CMYK. | Implemented with device formulas only. ICC-based, calibrated, Lab, indexed, separation and pattern colours, shadings, soft masks and annotation appearances are counted and left alone; this is not colour-managed conversion. |

## Deferred entries

| Upstream entry | Reason |
| --- | --- |
| `print.selected-area` | The Snapshot tool copies an area as an image; printing it alone needs native print acceptance that this environment cannot run. |
| `print.page-setup`, `print.color-handling` | Custom paper sizes, driver page setup and printer profiles depend on the native print path and physical or virtual printers. |
| `comment.popups`, `comment.connector-lines` | On-page pop-up windows that drag, thread and persist `/Popup` geometry are a new interaction surface; the comment panel covers reading and replying today. |
| `edit.find-replace` | Replacing text in place needs the text editing engine to keep fonts and layout; NavPDF's limited text editing cannot promise that. |
| `view.split-window` | The viewer is a single PDF.js instance per document; two panes on one document need a second view sharing one edit history. |
| `organize.portfolio-view` | Attachments are listed and saved; opening an embedded PDF as its own tab and honouring `/Collection` views is not built. |
| `create.from-office` | Running an installed office suite is a second external program and needs its own decision record and packaging evidence. |
| `core.attachment-only-encryption` | Encrypted input stays read-only; opening documents that encrypt only attachments needs crypt filter handling that lopdf and the current open path do not verify. |

## Declined entries

| Upstream entry | Reason |
| --- | --- |
| `organize.page-actions`, `form.document-actions` | These attach JavaScript to pages and documents; NavPDF never executes embedded scripts and does not author them. |
| `ocr.ocr-web` | It downloads recognition models; NavPDF adds no model downloads without a separate decision. |

## Acceptance boundary

These are independent implementations within NavPDF's existing services and boundaries; no upstream source is copied.
Automated tests cover each contract.
Native open, edit, save, close and reopen in NavPDF and an independent reader on macOS remain separate gates recorded in the [verification ledger](VERIFICATION.md).
