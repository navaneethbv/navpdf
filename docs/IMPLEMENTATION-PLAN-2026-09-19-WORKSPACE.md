# Single-document workspace implementation plan

The supplied Acrobat screenshots are the layout reference, with NavPDF branding and the existing selectable palettes.
This pass keeps one active PDF and excludes account and assistant controls, as requested.

1. Replace the header with a home button, one document tab and Create, then a separate All tools / Edit / Convert / E-Sign bar with search, save, export and print actions.
2. Dock the tool list on the left with colored icons, compact rows and View more / View less.
   Place the quick markup toolbar beside the page and navigation, page entry, rotation and zoom on the right rail.
   Open thumbnails, bookmarks, comments and search beside that rail only when requested.
3. Reorganize native File, Edit, View, Window and Help menus around implemented commands.
   Keep document replacement and saves behind the existing session guards.
4. Surface PDF import, image-to-PDF creation, Office exports, image/text exports and compression clearly.
   Reuse real DOCX/XLSX/PPTX/RTF exporters and native measured compression.
   Replace the reproduced WebKit download freeze with native destination selection and atomic export writes, retaining browser-preview downloads.
   Add PNG/JPEG import with ordered pages, bounded image size and explicit format validation.
5. Preserve keyboard shortcuts, focus, busy states, read mode, palettes and custom overrides.
   Add focused behavior and saved-output coverage, run repository gates, rebuild and inspect the native interface at normal and compact sizes.
6. Verify image import after saving/reopening with an independent reader, record conversion/compression evidence and limitations, then open and merge a PR after hosted checks pass.

Office-to-PDF import still requires a separately selected conversion engine.
Editable Office exports reconstruct PDF text; they do not promise exact original Office formatting.
Remote review requests, certificate trust management, rich media authoring, JavaScript authoring, print-production preflight, PDF standards conversion, accessibility remediation and comparison are separate capabilities, not placeholder entries in this layout pass.
Distribution signing, notarization and other platform acceptance remain separate gates.
