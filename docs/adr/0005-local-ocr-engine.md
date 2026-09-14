# ADR 0005: Local OCR Engine and Searchable Layer Integration

## Status

Accepted.

## Context

Phase 6 (M5) introduces optical character recognition (OCR) for scanned, image-only PDF pages and image imports.
NavPDF is a local, privacy-first PDF reader and editor with zero network dependencies, accounts, or telemetry.
Scanned PDFs require two primary capabilities:
1. Recognizing text characters, words, lines, bounding boxes, and confidence scores from scanned page images.
2. Generating an invisible searchable text layer in the PDF that aligns recognized text with the underlying scan imagery, enabling search, text selection, and copy-paste without altering visual appearance.

Two primary local OCR engine candidates were evaluated:
- **Candidate A: Apple Vision Framework (`VNRecognizeTextRequest`)**
  Built directly into macOS (macOS 10.15+).
  Utilizes the Apple Neural Engine (ANE) and GPU for hardware acceleration.
  Provides word and line bounding boxes, normalized coordinates (origin bottom-left, matching PDF coordinate space), and confidence scores.
  Supports English and major European and Asian languages offline without separate downloads.
  Adds 0 MB to application bundle distribution size.
- **Candidate B: Tesseract OCR (`libtesseract` / `tesseract-rs`)**
  Open-source (Apache 2.0).
  Cross-platform (Linux, Windows, macOS).
  Requires bundling dynamic C++ libraries and language training data (`eng.traineddata` ~25-40 MB per language).
  CPU-intensive on macOS compared to hardware-accelerated Apple Vision.
  Lacks native integration with macOS Neural Engine.

## Decision

We adopt **Apple Vision Framework** via a native Tauri command interface on macOS, abstracted behind a unified Rust `OcrEngine` trait with a **Deterministic Portable Engine** fallback for automated testing and non-macOS environments.

Key architectural choices:
1. **Engine Abstraction**:
   Define `OcrEngine` in `src-tauri/src/ocr/mod.rs` with typed inputs (`image_bytes`, `options`) and outputs (`OcrPageResult` containing lines, words, normalized bounding boxes, confidence, and language).
2. **Apple Vision Implementation**:
   On macOS, `AppleVisionEngine` uses Apple Vision framework through Objective-C runtime linkage without external C++ or third-party binary dependencies.
3. **Deterministic Portable Fallback**:
   `PortableOcrEngine` provides a deterministic fallback implementation for headless CI, unit tests, and cross-platform compilation where Vision framework is unavailable.
4. **Searchable PDF Layer Architecture**:
   In `src/services/document-commands.ts`, `applyOcrSearchableLayer` injects an invisible text layer using standard fonts positioned at exact bounding box coordinates.
   The injected content stream is tagged with `/NavPDF_OCR true` in the stream dictionary.
   Consecutive OCR executions strip prior tagged streams before appending new ones, preventing duplicate text accumulation.
5. **Existing Text Protection**:
   Pages with pre-existing digital text are detected prior to mutation, surfacing an explicit confirmation prompt to replace or skip.
6. **Privacy & Offline Guarantee**:
   All recognition executes entirely on the local device with no network calls, telemetry, or cloud processing.

## Consequences

- Zero bundle bloat on macOS: no 50+ MB language packages bundled in the release DMG.
- Fast, hardware-accelerated text recognition using Apple Neural Engine.
- Search and copy-paste work seamlessly in NavPDF, macOS Preview, Adobe Acrobat, and independent PDF viewers.
- Clean separation between OCR recognition results and document stream manipulation.
