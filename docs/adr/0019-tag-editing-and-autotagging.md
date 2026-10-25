# ADR 0019: Tag editing, artifacts and automatic tagging

Date: October 25, 2026.
Status: accepted for PDFCraft gap batch 9; screen reader, Preview and Acrobat acceptance remain open.

## Context

NavPDF's accessibility check reports whether a document is tagged and fixes the title, language and tab order, but it cannot show, edit or create tags.
PDFCraft offers a Tags panel with tag properties, sibling reordering, marking a tag as an artifact, finding untagged content and automatic tagging of text-only documents.
Tags change what assistive technology reads, and a wrong tag can hide or misorder content without any visible change, so edits must be explicit and reversible.
Rewriting content streams is already done by the lopdf engine under ADR 0006.

## Decision

Tag work runs in the native lopdf engine on a staged copy of the working document, and each change returns a new revision with undo.
Only indirect structure elements reachable from the structure tree root are listed and edited, at most 20,000; inline elements are counted but not listed.
A tag's type, title, alternate text, actual text and language can be edited; types are names of letters, digits, `-` and `_`, and languages are checked as BCP 47 shapes.
A tag moves one place earlier or later within its parent's children, which changes reading order without changing the page.

Mark as Artifact is limited to a tag that directly owns marked content on its own page and has no child tags or annotations.
Each matching `BDC` with that MCID, inline or through a named property list, becomes `/Artifact BMC`, its parent-tree slots become null and the tag is removed from its parent.
Content inside form XObjects is refused because NavPDF does not rewrite shared forms.

Automatic tagging is offered only for documents without a structure tree or earlier MCIDs.
Each text object becomes a P tag, each image, inline image or form XObject a Figure tag, other path painting and shading an artifact, and fields, links and other annotations Form, Link and Annot tags with object references and StructParent keys.
Tags follow drawing order on each page, followed by that page's annotations, under one Document tag with a parent tree, MarkInfo and annotation tab order set to structure.
Text objects that already contain marked content are left untagged rather than split.
Headings, lists, tables, alternate text and reading order are left for review in the Tags dialog.

Find Untagged Content counts painting operations outside tagged content and artifacts, and annotations or fields without a StructParent, per page.

## Alternatives

Automatic headings by font size were rejected for now, because a wrong heading level is worse than a paragraph that the user promotes.
Refusing documents with images, as PDFCraft does, was rejected because a Figure without alternate text is reported by the check and is easier to fix than no tag at all.
Editing tags with pdf-lib in the renderer was rejected because content-stream rewriting and validation already live in the native engine.

## Consequences

Users can tag simple documents and correct tags without another application.
Automatic tags are a starting point; decorative text, multi-column order, tables and lists still need review, and a passing check is not PDF/UA conformance.
Content painted inside form XObjects cannot be retired individually, and inline structure elements cannot be edited.
