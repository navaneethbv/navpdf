# ADR 0021: Present mode, pinned tools, 3D models and an installed OCR engine

Date: November 8, 2026.
Status: accepted for PDFCraft gap batch 17; native, independent-reader and packaging acceptance remain open.

## Context

The November gap programme compared PDFCraft at `5644d56` and listed four capabilities that change NavPDF's scope rather than adding a tool inside it.
On November 8 the user asked for every missing capability, which is the owner decision these items needed.
Present mode and pinned tools change only the interface.
3D models reverse part of [ADR 0010](0010-optional-services-declined.md), which declined 3D authoring and playback for the release.
An installed OCR engine is the first time NavPDF starts another program, which needs its own safety rules.

## Decision

Present mode shows one page at a time on black in a full-window overlay, using the Fullscreen API where the window allows it.
Click, Space, Page Down and the right arrow go forward; Shift-click, Backspace, Page Up and the left arrow go back; Escape ends it.
Pages can advance every 3 to 60 seconds and loop after the last page.
Page transitions stored in the PDF are not animated, and nothing in the document is run.

Tools can be pinned from All Tools to the toolbar, up to 12, in the order pinned; Alt-Left and Alt-Right reorder them.
The list is kept with the other settings and validated natively.

3D authoring is now in scope, narrowly.
A U3D or PRC file, recognised from its contents and up to 100 MB, is stored unchanged as a 3D annotation with a poster from a chosen picture or a labelled frame.
NavPDF never adds 3D JavaScript, views or render modes, and never displays, rotates or runs a model.
The 3D Models tool lists a document's 3D annotations, flags models that ask readers to run JavaScript, and saves a model as a file that NavPDF never opens.
ADR 0010's decline of video, audio, playback, hosted services and the remaining 3D features is unchanged.

An installed Tesseract is an optional OCR engine, off by default, chosen in Settings.
NavPDF downloads neither the program nor its language data.
The program is the full path the user gives, or `tesseract` on the search path; relative paths are refused.
It runs with fixed arguments (`<image> stdout -l <languages> --psm 3 tsv`), language codes allow-listed as up to five three-letter codes with an optional script, a page image in a private temporary folder, no input, an empty environment except `TESSDATA_PREFIX`, a two-minute limit after which it is killed, and a 16 MB cap on its output.
Its TSV output is parsed into the same word, line and confidence structures as the built-in engine, with boxes measured from the bottom of the image.
A page image is the only document data the program receives, and the program's own network behaviour is outside NavPDF's control; the setting says so.

## Alternatives

Rendering 3D models would need a U3D and PRC parser, a WebGL scene and sandboxing for untrusted geometry; it is not provided, and the poster shows where a model is.
Bundling Tesseract or downloading its models would add licensing, packaging and network obligations; the user installs it instead.
Running Tesseract through a shell would allow argument injection; the program is started directly with an argument list.

## Consequences

The 3D Models tool, the Tesseract setting and Present mode need native acceptance on the packaged app, and saved 3D annotations need checking in a 3D-capable reader such as Acrobat.
Tesseract makes OCR possible on platforms without Apple Vision, which Windows and Linux acceptance must cover.
The [November gap programme](../PDFCRAFT-NOVEMBER-GAPS.md) records each item's scope and limits.
