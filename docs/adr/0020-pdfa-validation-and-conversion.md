# ADR 0020: PDF/A checks, conversion and output intents

Date: October 25, 2026.
Status: accepted for PDFCraft gap batch 10; Preview and Acrobat acceptance remain open.

## Context

PDFCraft offers PDF/A validation and conversion, output intents and a standards panel.
NavPDF had none of these, and it must not download colour profiles or send documents to a validation service.
A PDF/A claim that the file does not meet is worse than no claim, because archives and recipients trust the identification.

## Decision

The native lopdf engine checks PDF/A-2 and PDF/A-3 at levels b, u and a against rules that can be read from the file.
It reads the version, file identifier, XMP identification and its agreement with the document information, encryption, actions and additional actions, document JavaScript, XFA and NeedAppearances, layer configurations, annotation types, flags and appearances, LZW streams, image interpolation and alternates, PostScript, device colour against output intents, embedding of fonts that draw visible text, Unicode mapping for levels u and a, tagging and language for level a, and attachments.
The report lists what it does not read, and the dialog says that it is not a certified validator.

Conversion first refuses when any problem it cannot fix is present: unembedded fonts, missing Unicode mapping, untagged content or missing language for level a, annotations without appearances, forbidden annotation types, PostScript, non-PDF/A attachments in PDF/A-2, and device CMYK without a CMYK output intent.
Otherwise it sets the version to 1.7, adds a file identifier, removes forbidden actions, additional actions, document JavaScript, XFA and NeedAppearances, makes annotations printable and visible with only normal appearances, removes interpolation and alternates, recompresses LZW streams with Flate, names layer configurations, completes PDF/A-3 attachment entries, adds an sRGB output intent when device colour needs one, and writes uncompressed XMP built from the document information.
It then checks again and keeps the result only when nothing remains; page content is not rewritten.

The sRGB ICC profile is generated in code from the published sRGB primaries, D50 white point and transfer curve, so no profile file is bundled or downloaded.
Removing standards identification deletes PDF/A and PDF/UA identification from XMP and PDF/X keys from the document information, keeping other metadata and output intents.

veraPDF 1.28.2 was fetched from Maven Central into a development scratch directory to validate sample conversions; it is not part of NavPDF and is not distributed.

## Alternatives

Writing the identification whenever conversion runs was rejected because it would mark non-conforming files as PDF/A.
Bundling a third-party ICC profile was rejected to avoid redistribution terms; a generated profile is enough for an sRGB output condition.
Embedding substitute fonts was rejected because NavPDF has no font files to embed without adding them to the package and checking their licences.

## Consequences

Documents made by NavPDF with the standard 14 fonts cannot be converted until they use embedded fonts.
CMYK documents need an output intent NavPDF cannot supply yet.
Later edits in NavPDF can break conformance, so the dialog asks users to check again before sharing.
A pass is evidence for the rules listed, not certification.
