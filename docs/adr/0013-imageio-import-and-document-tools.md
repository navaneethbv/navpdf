# ADR 0013: Local image import and document tool extensions

Status: accepted for the September 26 local implementation.

## Decision

Use the existing Swift bridge pattern and macOS ImageIO to decode HEIC/HEIF and multipage TIFF into bounded PNG frames.
The renderer passes raw bytes through a typed native command and never supplies filesystem paths.
No third-party codec, external service, model download or new package dependency is introduced.
ImageIO is an OS framework distributed with macOS; no separately licensed codec binary is bundled.
Other platforms report that these formats require macOS.

The input limit is 25 MiB, with 100 TIFF pages, 32 million pixels per frame, 64 million pixels per collection, 25 MiB per PNG and 100 MiB per response.
Check dimensions before pixel decoding.
Import the HEIF primary image rather than auxiliary depth or thumbnail images.
TIFF pages retain source order.
Apply source orientation through ImageIO's thumbnail transform at original maximum dimensions; do not copy EXIF or location metadata.
The binary response contains a big-endian frame count followed by length-prefixed PNG frames.
The renderer validates framing and reuses existing image-header checks before cropping or PDF creation.

Use one pdf-lib object copier per merge source to keep page references, widgets and field parents consistent.
Preserve supported AcroForms and local outlines, namespace colliding field roots and their default resources, and normalize local link destinations.
Reject XFA, calculated/scripted forms, signed fields and unsupported outline actions instead of claiming to preserve them.
No new general PDF engine is introduced.

Store editable OCR words and normalized geometry alongside each app-owned OCR stream.
The native redaction engine always removes this duplicate review data, even when other metadata is retained.
Existing searchable export font limitations still apply; unsupported glyphs produce a visible error.

Compression targets select from measured native presets using the original bytes for each attempt.
An original already below the target is only considered for lossless optimization.
Comparison aligns exact text/render fingerprints before pairing changed pages and uses bounded local canvases.
Visual comparison is an aid to review, not a proof of binary or semantic equivalence.

## Evidence and limits

The synthetic Swift acceptance program verifies HEIC and two-page TIFF decoding and orientation with an independent ImageIO PNG decode.
Rust tests cover invalid inputs, oversized dimensions, TIFF page count and orientation.
Saved PDF checks use PDF.js and Poppler, with native save/close/reopen results recorded in `docs/VERIFICATION.md`.
macOS Preview acceptance remains unavailable because Computer Use was not approved for Preview.
Windows/Linux codec support and installer acceptance are separate work.

## Primary references

- [ImageIO source creation and page enumeration](https://developer.apple.com/documentation/imageio/cgimagesource).
- [Orientation-aware thumbnail decoding](https://developer.apple.com/documentation/imageio/kcgimagesourcecreatethumbnailwithtransform).
- [Thumbnail creation and primary HEIF images](https://developer.apple.com/documentation/imageio/cgimagesourcecreatethumbnailatindex(_:_:_:)).
