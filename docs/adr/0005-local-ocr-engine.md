# ADR 0005: Local OCR Engine and Searchable Layer Integration

## Status

Accepted.

Corrected September 14 after source review found that the earlier implementation returned fixed sample text and never performed recognition.
The earlier performance, accuracy and hardware-acceleration claims were not supported by measured evidence.
The current recognition path invokes Vision through the compiled `vision_helper.swift` bridge; Rust queries supported languages through `objc2-vision` and reads normalized line rectangles and confidence.
The Swift bridge replaced the direct recognition path after a native autorelease-pool failure.
It makes no claim that a particular GPU or Neural Engine path is used.
The initial corrective smoke check recognized two clean raster sentences exactly and returned no text for a blank image.
The September 15 native corpus then passed six samples; see the [verification ledger](../VERIFICATION.md).
Full corpus quality, latency, memory and packaged native save/reopen acceptance remain open.

## Context

Phase 6 (M5) introduces optical character recognition (OCR) for scanned, image-only PDF pages and image imports.
NavPDF is a local, privacy-first PDF reader and editor with zero network dependencies, accounts, or telemetry.
Scanned PDFs require two primary capabilities:
1. Recognizing text characters, words, lines, bounding boxes, and confidence scores from scanned page images.
2. Generating an invisible searchable text layer in the PDF that aligns recognized text with the underlying scan imagery, enabling search, text selection, and copy-paste without altering visual appearance.

Two primary local OCR engine candidates were evaluated:
- **Candidate A: Apple Vision Framework (`VNRecognizeTextRequest`)**
  Built directly into macOS (macOS 10.15+).
  Uses the operating system's recognition implementation; actual hardware execution requires measurement.
  Provides word and line bounding boxes, normalized coordinates (origin bottom-left, matching PDF coordinate space), and confidence scores.
  Supports English and major European and Asian languages offline without separate downloads.
  Does not require NavPDF to bundle a separate OCR model.
- **Candidate B: Tesseract OCR (`libtesseract` / `tesseract-rs`)**
  Open-source (Apache 2.0).
  Cross-platform (Linux, Windows, macOS).
  Requires separately distributed native libraries and language data; packaging size depends on the chosen models.
  A comparative CPU and latency trial remains pending.

## Decision

We adopt Apple Vision through a native Tauri command on macOS.
Unsupported platforms and browser preview return an unavailable-engine error; deterministic test data must never substitute for production recognition.

Key architectural choices:
1. **Engine Abstraction**:
   Use typed inputs (`image_bytes`, `options`) and outputs (`OcrPageResult` containing lines, normalized bounding boxes, confidence, and language).
2. **Apple Vision Implementation**:
   On macOS, Rust calls the compiled Swift Vision bridge for recognition without a bundled C++ OCR runtime or model.
3. **Unavailable platforms**:
   Return an error when real recognition is unavailable.
   Frontend unit tests inject an explicit test adapter and establish UI behavior only.
4. **Searchable PDF Layer Architecture**:
   In `src/services/document-commands.ts`, `applyOcrSearchableLayer` injects an invisible text layer using standard fonts positioned at exact bounding box coordinates.
   The injected content stream is tagged with `/NavPDF_OCR true` in the stream dictionary.
   Consecutive OCR executions strip prior tagged streams before appending new ones, preventing duplicate text accumulation.
5. **Existing Text Protection**:
   Pages with pre-existing digital text are detected prior to mutation, surfacing an explicit confirmation prompt to replace or skip.
6. **Privacy & Offline Guarantee**:
   All recognition executes entirely on the local device with no network calls, telemetry, or cloud processing.

## Consequences

- No separately downloaded language models are bundled by NavPDF.
- Recognition performance and the full quality corpus require measured acceptance.
- Saved searchable output has independent Poppler and later native/Preview evidence for the specific artifacts in the ledger; broader corpus and current packaged acceptance remain open.
- Clean separation between OCR recognition results and document stream manipulation.
