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
| `optimize.compress-structure` | Reduce File Size, Compress document structure (object streams), on by default and unavailable for PDF 1.4. | Implemented. |

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
| `comment.multi-select` | Command-click (Control-click) or Shift-click on the page adds or removes a comment; in the Comments list Command-click toggles and Shift-click selects the listed range. The one clicked last has the handles. Delete, Move, arrow keys and dragging act on every selected comment as one undo step. | Implemented. Text markup is selected from the list, not on the page, so it does not cover text selection. |
| `comment.copy-paste` | Edit, Copy (or the Comments list's Copy) copies the selected comments of one page with their pop-ups and replies as a small in-memory PDF shared by every tab, and their text with a count to the system clipboard. Paste adds them to the current page at the same place, 18 points further each time, with new names, as one undo step. | Implemented. A paste counts only while the system clipboard still holds the copied text. Comments from several pages are copied one page at a time. |
| `comment.keyboard-nudge` | Arrow keys already moved a selected comment by 1 point (Shift 10); they now follow the page's on-screen rotation, Command or Control also moves 10, and every selected comment moves. | Implemented. Moves are in points, not screen pixels. |
| `comment.draw-ortho` | Shift keeps new lines and arrows, each side of connected lines and polygons, and measurements level or plumb with the previous point, in the preview and the saved comment; Shift also applies when dragging a reshape handle. | Implemented. Clouds are dragged as boxes, so ortho does not apply to them. |
| `comment.reshape` | A single selected line, arrow, connected line or polygon (including clouds) shows a handle on each end or corner; dragging one shows the new outline and saves it as one undo step, refitting the rectangle and redrawing the appearance. | Implemented. Locked comments are refused. |
| `comment.move-preview` | Dragging a selected comment shows dashed outlines and the comments themselves, rendered alone from a one-page copy holding only them, at the destination. | Implemented. Comments on several pages show outlines only. |
| `comment.part-opacity` | Rectangles, ovals and polygons get a Fill colour and separate Line and Fill opacity, drawn with the stroking and non-stroking alpha of one graphics state; text boxes get Text, Border and Fill opacity. `/CA` holds the line or text value for readers that draw comments themselves. | Implemented. Other comments keep one opacity. |
| `comment.text-border-shape` | Text box properties, Border shape: Rectangle, Oval through the box's corners or Circle around them. The text keeps its place through `/RD`; NavPDF redraws the box, border and text in Helvetica. | Implemented. Callouts keep a rectangle; text Helvetica cannot show is refused. |
| `comment.keep-tool-selected` | Pin button in the annotation toolbar and a setting, kept across restarts: drawing tools stay selected after each shape instead of returning to Select. Polygon, connected-line and measurement tools already stayed active. | Implemented. |

## Batch 14: bookmarks and comment exchange

| Upstream entry | Planned NavPDF behaviour | Status |
| --- | --- | --- |
| `organize.bookmark-clipboard` | Edit Bookmarks, Cut, Copy, Paste inside and Paste bookmarks at top level carry a bookmark with its subtree, within a document or into another tab, saved with the other edits. | Implemented. A bookmark whose page the target lacks keeps its place without a destination, and the editor says how many. |
| `organize.bookmarks-from-text-styles` | Tools, Bookmarks from Text Styles: the document's font, size, bold and italic combinations, largest first, with line counts and a sample; one style per level for up to four levels. Every line in a chosen style becomes a bookmark nested under the nearest higher level, consecutive lines of one heading are joined, and the new bookmarks replace or follow the existing ones. | Implemented. Fonts are read from each page's operator list, so large documents take a while; colour is not part of a style. |
| `organize.bookmarks-import-export` | Edit Bookmarks, Export all as JSON or Export on one bookmark for its subtree, and Import JSON to add at top level or replace all: titles, nesting, open state, colour, bold and italic, and page with view. Imports are validated (2 MB, 10,000 bookmarks, 32 levels, views and colours) before any is added. | Implemented. Only NavPDF's own JSON format is read. |
| `comment.import-from-pdf` | Comments panel, Import accepts a PDF as well as comment JSON: each comment goes onto the page with the same number at the same place on the visible page, with its appearance, pop-up and replies; a same-named comment is replaced. | Implemented. Pages past the end, redaction marks, links, form fields and media are left out and counted; a password-protected PDF is refused. |
| `comment.export-selected` | Comments panel, Export selected writes the selected comments and their replies as NavPDF comment JSON; Copy puts them on the comment clipboard. | Implemented. Annotation XFDF export is not provided; form XFDF is separate. |

## Batch 15: editing

| Upstream entry | Planned NavPDF behaviour | Status |
| --- | --- | --- |
| `edit.text-super-subscript` | Add Text and Images, Superscript and Subscript buttons wrap the selection in `^{...}` or `_{...}`; those runs are drawn at 62% size, raised 36% or lowered 16% of the font size, so extracted text keeps the original characters. | Implemented for placed text. Existing page text is not restyled, and justified lines with script runs are drawn left-aligned. |
| `edit.arrange-objects` | Edit Existing Content, Bring to Front, Bring Forward, Send Backward and Send to Back for an image drawn in its own `q ... Q` group (or marked content holding only that group). The native engine moves the group past other drawing and stops before any top-level transform, clipping, graphics state or fill colour change. | Implemented. Images without their own group are refused (Apply Image Transform gives them one); vector paths and inline images are not arranged. |
| `edit.cut-copy-paste-objects` | Edit Existing Content, Copy Image and Cut Image copy an image placement as a one-page PDF holding only it (with its soft mask and colour space); Paste Image adds it to the current page of this or another tab at the same place, 18 points further each time on its own page. | Implemented for images. Inline images, text runs and vector drawings are not copied. |
| `edit.image-rotate-free` | Already provided: Edit Existing Content, Rotation (degrees) with Scale and Move applies any angle about the image's centre as one extra `cm`. | Already covered; no change. |
| `form.multiple-copies` | Field Properties, Copy into a grid: rows, columns, spacing and a name pattern with `{name}`, `{row}` and `{column}` copy a text field or check box into same-sized fields, the source being the top-left cell. Refused whole when a cell leaves the page or a name is empty, repeated, already used or contains a period. | Implemented. Other field types and dragging the grid on the page are not provided. |
| `edit.bates-multi-file` | Document Decorations, Bates Numbers, Several files: up to 50 PDFs of up to 200 MB numbered in the order chosen, each continuing where the last ended, saved as copies in a ZIP with a CSV of each file's first and last number. A file that fails keeps no numbers and is listed with its reason. | Implemented. Results go to a ZIP rather than a chosen folder. |

## Batch 16: optimizer, OCR and copying

| Upstream entry | Planned NavPDF behaviour | Status |
| --- | --- | --- |
| `optimize.compatibility-level` | Reduce File Size, Structure and compatibility, Make compatible with PDF 1.4, 1.5, 1.6, 1.7 or 2.0: writes that header, removes the catalog `/Version`, and for PDF 1.4 writes a classic cross-reference table without object streams (removing trailer keys left by cross-reference streams). A version change alone counts as a useful result. | Implemented. Content newer than the chosen version is neither detected nor converted; encrypted files are refused by the engine as before. |
| `optimize.compress-structure` | Reduce File Size, Compress document structure (object streams), on by default and unavailable for PDF 1.4. | Implemented. |
| `optimize.mono-compression` | Reduce File Size, Re-encode black-and-white images with lossless CCITT Group 4, on by default in every preset: 1-bit DeviceGray images and image masks stored uncompressed or with plain Flate are re-encoded with NavPDF's own T.6 encoder and kept only when at least 10% smaller. The encoder's output matches libtiff byte for byte on the pinned test images and decodes exactly in poppler. | Implemented. JBIG2 is not provided; images with predictors or other filters are left alone. |
| `ocr.deskew` | Scan & OCR and OCR Multiple Files, Straighten pages scanned askew: skew within 5 degrees is estimated from sheared projection profiles on a grayscale copy of at most 1,000 pixels, refined to 0.1 degrees, and the recognition image is rotated; word boxes map back exactly. | Implemented. Blank, tiny and nearly straight pages, and pages without a clear best angle, are left alone. |
| `ocr.rotation-detection` | Scan & OCR and OCR Multiple Files, Detect pages scanned sideways or upside down: row-versus-column banding chooses between upright and sideways, and the third moment of each text line's ink (capitals and ascenders above, few descenders below) chooses between the two remaining turns. Only the recognition image is turned; word boxes map back exactly. | Implemented. The page's own /Rotate is not changed, and the upright test assumes scripts with ascenders, such as Latin; unclear pages are left alone. |
| `ocr.correct-recognized-text` | OCR review: words below 80% confidence are marked, Next and Previous suspect (F8 and Shift-F8) move between them across pages, Show only low-confidence words filters the list, and each page has a Reviewed mark with a count. | Implemented. A user dictionary and spelling suggestions are not provided. |
| `view.copy-with-layout` | Copying page text also places HTML on the clipboard: paragraphs, line breaks, font sizes and font families from the text layer, with markup escaped. | Implemented. Bold, italic and colour are not in the text layer and are not copied. |

## Batch 17: decision items

[ADR 0021](adr/0021-presentation-pinned-tools-3d-and-external-ocr.md) records the decisions; the installed OCR engine is off by default.

| Upstream entry | Planned NavPDF behaviour | Status |
| --- | --- | --- |
| `view.full-screen-presentation` | View options and Tools, Present: one page at a time on black, full screen where allowed; click, Space, Page Down or the right arrow to advance, Shift-click, Backspace, Page Up or the left arrow to go back, Home and End, Escape to stop; advance every 3 to 60 seconds and loop. | Implemented under ADR 0021. Page transitions are not animated. |
| `view.customize-quick-tools` | All Tools, a pin on each tool card: up to 12 pinned tools appear first in All Tools and as toolbar buttons in the order pinned, reordered with Alt-Left and Alt-Right, kept in settings. | Implemented under ADR 0021. Button size and docking are not offered. |
| `misc.3d-add` | Tools, 3D Models: a U3D or PRC file (checked from its contents, up to 100 MB) is stored as a 3D annotation activated by a click or on page open, with a chosen PNG or JPEG poster fitted in the box or a labelled frame. No 3D JavaScript or views are added. | Implemented under ADR 0021. Posters are not rendered from the model and are not counter-rotated on turned pages. |
| `misc.3d-view` | Tools, 3D Models: the document's 3D annotations with page, format, stored size, named views and whether the model asks for JavaScript, and Save model to a file NavPDF never opens. | Implemented under ADR 0021. Models are not displayed or rotated; readers show the poster. |
| `ocr.ocr-engines` | Settings, Recognition engine: built in (Apple Vision) or a Tesseract installed by the user, run per page with fixed arguments, allow-listed languages, a private temporary folder, an empty environment, a two-minute limit and a 16 MB output cap; TSV words become the usual lines, words and confidences. Verified with Tesseract 5.3.4 on a rendered sample. | Implemented under ADR 0021. Nothing is downloaded; an ensemble of engines is not provided. |

## Robustness review

Upstream fixed crashes from deep nesting and large inputs in the same period, including a CMap `<<` run overflowing the stack and XFDF export of a field name made of periods.
NavPDF's equivalents were reviewed in batch 12.
Form XFDF export writes flat field names and never nests, and XFDF import, outline reading and writing, page labels and form merging all stop at 32 levels.
CMaps are parsed by PDF.js and lopdf, not by NavPDF code.
No change was needed.

## Acceptance boundary

These are independent implementations within NavPDF's existing services and boundaries; no upstream source is copied.
Automated tests cover each contract; native open, edit, save, close and reopen in NavPDF and an independent reader remain separate gates recorded in the [verification ledger](VERIFICATION.md).
