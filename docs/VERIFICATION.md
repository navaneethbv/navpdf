# Verification

Validated locally on macOS with the packaged Apple Silicon application and Chrome.

## Functional evidence

- The production TypeScript/Vite build succeeds and ESLint reports no errors.
- The 23 Python engine tests pass and cover saved PDF contents and transaction rollback.
- The five transport tests start a separate local server and validate real requests, PDF rendering, encrypted export/reopening, history and cross-origin rejection.
- Browser testing used the CUA browser connection in Chrome, without a headless-browser fallback.
- Browser text replacement initially removed an adjacent line; the selected area was corrected and the interaction was repeated successfully with both the replacement and neighboring text present.
- Search found both matching occurrences in the welcome document and displayed their page numbers.
- Browser export created an actual three-page PDF in Downloads, which was reopened with PyMuPDF and checked for its heading.
- The packaged app launched from `release/mac-arm64/NavPDF.app` and rendered the welcome PDF with its local Python engine.
- Native rotation changed the displayed orientation, enabled undo and marked the document as unexported.
- Native Export PDF opened macOS Save As and wrote a PDF with the expected three pages, 90-degree rotation and intact text.
- Native Open PDF loaded a separate form fixture; Fill forms saved a field value and the PDF canvas displayed the entered text.
- Packaged OCR data is present, and a drawing command succeeded using the packaged Python environment.

The generated fixtures and downloaded QA exports were removed after inspection.
The screenshots below remain as intentional design-review artifacts.

## Visual verification

The starting reference is [editor-concept.png](design/editor-concept.png).
It was generated using the built-in image-generation tool from a brief for a white and forest-green, three-panel local PDF editor with a real document canvas, toolbar, thumbnails and document-tool inspector.
The implementation was compared directly using `view_image` against that concept and the final [desktop](design/editor-desktop.png) and [mobile](design/editor-mobile.png) captures.

The desktop viewport was explicitly checked at 1536 × 1024 CSS pixels, matching the concept dimensions.
Mobile was checked at 390 × 844, including the Fit control and the scrollable document-tool panel.
The temporary viewport override was reset after testing.

| Comparison | Result |
| --- | --- |
| Layout | Three-panel editor, thumbnail rail, document canvas, inspector, bottom zoom/navigation and status bar are implemented. |
| Palette | White chrome, cool gray canvas, restrained gray borders and forest-green actions match the chosen direction. |
| Typography | Explicit control sizes, heading hierarchy and PDF typography were checked independently. |
| Icons and controls | Consistent outline icons and green active-tool treatment are implemented with real controls. |
| Document scale | Default zoom was corrected from 90% to 100%; Fit supports smaller windows. |
| Responsive layout | Page rail becomes a drawer and document tools move below the canvas on narrow screens. |
| Accessibility | Labeled tools and fields, keyboard focus, native modal focus handling, disabled states and reduced-motion styling are present. |

The above-the-fold copy review retains NavPDF, the welcome document name, Open PDF, Export PDF, Pages and the principal tool names.
Intentional changes are a comments tool and annotation inspector required by the feature list, more precise OCR and password descriptions, a Fit button, simplified editable welcome-document illustrations, and a single-document tab without nonfunctional tab controls.
The browser omits native window chrome; Electron supplies it in the desktop app.

The implementation was visually verified against the chosen design direction with these documented deviations.
This is not a claim of literal pixel identity to generated artwork or user approval of an intermediate concept.
No clipped primary controls or unresolved application console errors were observed in the tested viewports.

## Scope boundaries

The package is a local build for this Mac, using its Python installation, and is not a notarized portable distribution.
Existing-text editing supports fitted, single-line Latin text using standard fonts, rather than arbitrary paragraph reflow or embedded-font fidelity.
OCR is English-only and rasterizes the selected page.
Signatures are visual ink, not certificate signatures.
See [README.md](../README.md) for the complete feature behavior, persistence model and limitations.
