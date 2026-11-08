# PDFCraft November gap programme

Reviewed November 8, 2026.
Previous reference: `storytold/pdfcraft` at `416495145354828a9efefc39df381ba3ee8f864f`, inspected October 21, 2026.
New reference: `storytold/pdfcraft` at `5644d56c64af1529b0f9012874886fcad855c257`, committed November 7, 2026.
NavPDF baseline: `1cbacab` on `main`.

## How the gaps were found

Upstream made 3,022 commits between the two references.
Its `parity/acrobat-features.toml` checklist went from 438 shipped, 94 partial, 283 planned and 23 not-applicable entries to 457 shipped, 118 partial, 257 planned and 23 not-applicable entries.
No entry was removed.
Seventeen entries are new and 28 existing entries changed status.
Each of those 45 entries was compared with NavPDF source by name, service and user interface.
Upstream classifications describe upstream claims; they do not establish NavPDF gaps or successful interoperability.
The [capability comparison](PDFCRAFT-COMPARISON.md) holds the earlier batches; the [delivery tracker](DELIVERY-PHASES.md) owns progress.

On November 8 the user asked for every missing capability, delivered one by one.
This document is the plan and the per-feature record.
Each row's status changes from Planned to Implemented when its code and tests land, and limits are recorded with it.

## Entries NavPDF already covers

| Upstream entry | NavPDF implementation |
| --- | --- |
| `organize.attachments-add`, `organize.attachments-delete` | Attachments dialog; `addEmbeddedAttachment` and `deleteEmbeddedAttachment` in `src/services/document-commands.ts`. |
| `organize.page-tab-order` | Field tab order in `src/services/pdf/form-authoring.ts` writes page `/Tabs` (batch 4). |
| `organize.bookmark-appearance` | Bookmark colour and `/F` style flags in `src/services/pdf/bookmarks.ts` and the bookmark editor. |
| `optimize.remove-standards-id` | PDF/A and Standards, Remove Standards Identification (batch 10). |
| `misc.action-wizard-run`, `optimize.batch-optimize` | Guided Actions on several files (batch 10). Upstream lowered its own entry to partial for a failing step reported as success; NavPDF stops a file at the failing step and names it. |
| `optimize.compress-structure` | Native saves already write object streams through the compression path; the new compatibility choice in batch 16 adds the explicit switch. |

## Batch 12: quick wins

| Upstream entry | Planned NavPDF behaviour | Status |
| --- | --- | --- |
| `create.export-markdown` | Export to Office and Other Formats, Markdown (.md): CommonMark headings and paragraphs from the existing text reconstruction, a rule between pages, and backslash escapes for markup characters and line-start markers. | Implemented. Images, tables, lists and bold or italic runs are not carried over; the text reconstruction has no style information. |
| `misc.prefs-documents` | Settings, Recent files to keep, 0 to 50, default 15 (the previous fixed count); the native store trims to the limit. | Implemented. The autosave interval is not a setting. |
| `view.layers-reset` | Layers panel, Reset to initial visibility, applying a fresh PDF.js configuration built from the document's default `/D` settings. | Implemented. Listing only the current page's layers is not provided, as upstream. |
| `core.restore-last-view` | Settings, Restore each file's last page, zoom and layout, on by default. The native store keeps the last 100 files by path, written 0.8 seconds after a change and when a tab is parked or closed; opening applies layout, zoom and page. Turning the setting off deletes the records. | Implemented. Imported documents without a file and recovery copies are not recorded; view rotation and the scroll offset within a page are not kept. |
| `misc.compare-filters` | Compare dialog, Show Text changes and Visual changes. A changed pair whose text is identical counts as visual; hiding a kind removes those pairs from the list and hides the text span or the highlight picture. | Implemented. Added and removed pages are always listed. |
| `edit.header-footer-shrink` | Header and footer, Shrink page content to avoid overwriting it: the page's existing content is wrapped in tagged `q cm ... Q` streams that scale it evenly into the band between footer and header, centred across. Remove Decorations removes the scaling with the header and footer. | Implemented. Annotations, links and fields are not moved; the band uses the MediaBox, as the existing header placement does. |

## Batch 13: comment interaction

| Upstream entry | Planned NavPDF behaviour | Status |
| --- | --- | --- |
| `comment.multi-select` | Command-click or Shift-click adds or removes comments from the selection on the page and in the comments list; delete and move apply to all selected as one undo step. | Planned |
| `comment.copy-paste` | Copy places the selected comments with their replies on an in-app clipboard (shared across tabs) and as text on the system clipboard; Paste adds them to the current page or the same page, offset, as one undo step. | Planned |
| `comment.keyboard-nudge` | Arrow keys move the selected comments by one point; Shift or Command moves ten. Each press is one undo step. | Planned |
| `comment.draw-ortho` | Holding Shift while drawing lines, arrows, connected lines, polygons and clouds keeps the segment level or plumb. | Planned |
| `comment.reshape` | A selected line, arrow, connected line or polygon shows a handle on each end or corner; dragging one changes that point as one undo step. | Planned |
| `comment.move-preview` | Dragging a selected comment shows its outline and a translucent copy at the destination before the move is applied. | Planned |
| `comment.part-opacity` | Properties gains separate stroke and fill opacity for shapes, written as an appearance stream with separate graphics states. `/CA` keeps the stroke value for readers that ignore appearances. | Planned |
| `comment.text-border-shape` | Text box border shape: rectangle, oval or circle, drawn by NavPDF's appearance generator around the text box. | Planned |
| `comment.keep-tool-selected` | Settings and toolbar pin: keep the annotation tool active after each use; remembered across restarts. | Planned |

## Batch 14: bookmarks and comment exchange

| Upstream entry | Planned NavPDF behaviour | Status |
| --- | --- | --- |
| `organize.bookmark-clipboard` | Bookmark editor Cut, Copy and Paste of a bookmark with its subtree, within a document or into another tab; destinations are page numbers, and a page the target lacks leaves the bookmark without a destination. | Planned |
| `organize.bookmarks-from-text-styles` | New bookmarks from text styles: lists the document's font and size combinations with samples; choosing up to four styles for levels 1 to 4 creates nested bookmarks from matching lines. | Planned |
| `organize.bookmarks-import-export` | Export the outline as JSON (titles, nesting, open state, colour, style, page and view) and import it in place of or under the current outline as one undo step. | Planned |
| `comment.import-from-pdf` | Import comments accepts a PDF: each markup annotation, with its pop-up and replies, is copied to the same page number; pages past the end are skipped; redaction marks and password-protected sources are refused. | Planned |
| `comment.export-selected` | Export selected comments as NavPDF comment JSON or XFDF. | Planned |

## Batch 15: editing

| Upstream entry | Planned NavPDF behaviour | Status |
| --- | --- | --- |
| `edit.text-super-subscript` | Text placement and edit gains superscript and subscript using text rise and a reduced size, so extracted text stays the original characters. | Planned |
| `edit.arrange-objects` | Object editor Bring to Front, Send to Back, Bring Forward and Send Backward for image XObject draws, moving the balanced `q ... Q` block in the content stream; unbalanced or marked-content-crossing blocks are refused. | Planned |
| `edit.cut-copy-paste-objects` | Object editor Copy, Cut and Paste for images placed on a page, pasting onto the current page offset by 18 points, within or across tabs. | Planned |
| `edit.image-rotate-free` | Object editor Rotate by any angle with a numeric field, applied as an extra `cm` about the image centre. | Planned |
| `form.multiple-copies` | Form tools, Create field grid: rows, columns, spacing and a name pattern produce a table of text fields from one field's size, refusing name clashes. | Planned |
| `edit.bates-multi-file` | Bates numbering on several files: consecutive ranges in file order, saved as copies in a ZIP with a per-file result. | Planned |

## Batch 16: optimizer, OCR and copying

| Upstream entry | Planned NavPDF behaviour | Status |
| --- | --- | --- |
| `optimize.compatibility-level` | Compress dialog, Make compatible with PDF 1.4 to 2.0: writes the header version, clears the catalog `/Version`, unpacks object streams for 1.4, refuses encryption needing a newer version. Newer features are not converted. | Planned |
| `optimize.compress-structure` | Explicit Compress document structure switch tied to object streams. | Planned |
| `optimize.mono-compression` | Native CCITT Group 4 re-encoding of 1-bit images, kept only when smaller; JBIG2 is not provided. | Planned |
| `ocr.deskew` | OCR image cleanup Straighten: skew within plus or minus 5 degrees estimated by projection profiles, corrected before recognition with boxes mapped back. | Planned |
| `ocr.rotation-detection` | OCR image cleanup Detect page rotation: 0, 90, 180 or 270 degrees chosen by recognition confidence over a downscaled image; the page `/Rotate` is corrected. | Planned |
| `ocr.correct-recognized-text` | OCR review lists low-confidence words first with next and previous suspect navigation and a per-page reviewed mark. | Planned |
| `view.copy-with-layout` | Copying page text also places HTML with paragraphs, bold, italic, size and colour on the clipboard. | Planned |

## Batch 17: decision items

Each item needs an ADR before implementation and stays off by default where it changes the safety boundary.

| Upstream entry | Planned NavPDF behaviour | Status |
| --- | --- | --- |
| `view.full-screen-presentation` | Present mode: full screen, one page at a time, click or arrow to advance, optional auto-advance every N seconds and looping. Page transitions are not animated. | Planned |
| `view.customize-quick-tools` | Pin tools from the Tools catalog to the toolbar and Home, with order kept in settings. | Planned |
| `misc.3d-add` | Add a 3D model: a U3D or PRC file detected from its header embedded as a 3D annotation with a poster from an image or a labelled frame. Supersedes the 3D authoring part of ADR 0010. | Planned |
| `misc.3d-view` | 3D content list: each 3D annotation's format, size and poster, with extraction of the model file. Interactive 3D rendering is not provided. | Planned |
| `ocr.ocr-engines` | Optional Tesseract engine: an installed `tesseract` binary chosen by the user, run with fixed arguments, allow-listed languages, a private temporary folder, a timeout and an output limit. Off by default; no model downloads. | Planned |

## Robustness review

Upstream fixed crashes from deep nesting and large inputs in the same period, including a CMap `<<` run overflowing the stack and XFDF export of a field name made of periods.
NavPDF's equivalents were reviewed in batch 12.
Form XFDF export writes flat field names and never nests, and XFDF import, outline reading and writing, page labels and form merging all stop at 32 levels.
CMaps are parsed by PDF.js and lopdf, not by NavPDF code.
No change was needed.

## Acceptance boundary

These are independent implementations within NavPDF's existing services and boundaries; no upstream source is copied.
Automated tests cover each contract; native open, edit, save, close and reopen in NavPDF and an independent reader remain separate gates recorded in the [verification ledger](VERIFICATION.md).
