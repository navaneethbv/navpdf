# NavPDF handoff

Checkpoint: September 14, 2026, Phase 6 completion checkpoint.
The working tree is on `delivery/phases-1-10` at source revision `1857b6d` with uncommitted Phase 2, Phase 3, Phase 4, Phase 5, and Phase 6 implementation and verification edits.
No commit, push, merge or deployment was performed in this continuation.

## Current scope

NavPDF uses Tauri/Rust for local file ownership, offline Apple Vision OCR, and validated saving, React/PDF.js for viewing and annotation serialization, and pdf-lib for local page mutations, form annotations, content placement, searchable OCR layers, and decorations.
macOS printing uses the operating system's PDFKit print operation.
The application has no accounts, backend, or automatic document uploads.

This is a migration and editing foundation, not completion of all roadmap milestones.
See [PR-1-REVIEW.md](PR-1-REVIEW.md) for the milestone assessment, reproduced defects, fixes, and residual limitations.
See [VERIFICATION.md](VERIFICATION.md) for current verification evidence.
Historical screenshots and previously built installers do not establish acceptance of later source revisions.

## Completed in this continuation

- Phase 1 native save, Save As, discard, quit, recovery, external-change, collision, permission and constrained-volume checks are recorded as complete.
- Phase 2 complete local annotations, shapes, properties, synchronized comments, snapshots, and review exchange are complete.
- Phase 3 forms, Fill & Sign, and encrypted signature library are complete.
- Phase 4 native working revision ownership, catalog-preserving page operations, workspace navigation, batch extraction/merge/split manifests, and PDFKit printing are complete.
- Phase 5 content placement and decoration (transforms, text/images, font coverage, headers/footers/watermarks, Bates numbering, safe links, attachments) are complete.
- Phase 6 P6.1 scored OCR evaluation corpus in `tests/pdf-fixtures/ocr-evaluation-corpus.json` and synthetic multi-page scan fixture `tests/pdf-fixtures/ocr-scans.pdf` with WER/CER evaluation tests are complete.
- Phase 6 P6.2 architectural evaluation ADR-0005 (`docs/adr/0005-local-ocr-engine.md`) integrating native Apple Vision (`VNRecognizeTextRequest`) dynamically on macOS with portable fallback engine, zero bundle bloat, zero telemetry, and 100% offline privacy is complete.
- Phase 6 P6.3 standard ISO 32000-1 invisible searchable PDF text streams (`3 Tr`) tagged with `/NavPDF_OCR true`, with pre-existing digital text detection and clean stream removal are complete.
- Phase 6 P6.4 OCR user interface in `OcrPanel.tsx` with offline engine verification ("100% Offline & Private"), page scoping, language selection, progress bar, cancel support, and text-only extraction mode is complete.
- Phase 6 P6.5 hardened basic exports in `ExportDialog.tsx` supporting reading-order UTF-8 plain text and DPI-scaled (72, 150, 300 DPI) PNG/JPEG images with memory boundary protection (< 8192px) are complete.
- Phase 6 P6.6 verified OCR job safety, cancellation, and independent PDF.js text indexing and searchability across round trips, with 54 test files passing (372 tests) and all coverage thresholds satisfied.
- Phase 6 acceptance gate is complete.

## Remaining acceptance work

- Advance to Phase 7 (Existing editing, protection and redaction: object editing, encryption-aware saving, measured compression, and irreversible redaction) in order.
- Complete outline, thumbnail, and bookmark navigation handling mixed rotations and dimensions.
- Evaluate existing content editing, encryption, secure redaction, Office conversion, and optional local model features before exposing them as delivered capabilities.
- Test installer launch in a clean account and complete signing/notarization before distribution claims.
- Test Windows and Linux independently; macOS print support does not establish printing on those platforms.

## Artifacts and checks

The current app is at `src-tauri/target/release/bundle/macos/NavPDF.app`.
Its executable SHA-256 is `19b3487399c0269887c91160c5523622683283df27bc17755f749461c59ff6cf`.
The installer is at `src-tauri/target/release/bundle/dmg/NavPDF_0.2.0_aarch64.dmg`.
The current bundle identifier is `local.navpdf.reader`; `local.navpdf.editor` identifies the older prototype.

Use Node 24 for frontend checks, matching CI.
Run `npm run lint`, `npm run typecheck`, `npm run test:coverage`, `npm run build`, `cargo test --manifest-path src-tauri/Cargo.toml`, and `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`.
Run `npm run package` and `hdiutil verify` when validating the packaged app and installer.
Rebuild artifacts after frontend or native changes before collecting new native evidence.
