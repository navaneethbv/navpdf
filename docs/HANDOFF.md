# NavPDF handoff

Checkpoint: September 14, 2026, PR #2 phase alignment review.
The working tree is on `delivery/phases-1-10` with approved local implementations for Phases 1 through 8 and Phase 10, plus a verified unsigned local macOS package for Phase 9.
Phase 9 clean-account installation, distribution signing/notarization, physical printing, and non-macOS native acceptance remain open.

## Current scope

NavPDF uses Tauri/Rust for local file ownership, offline Apple Vision OCR, pure-Rust PDF engine for protection, compression, redaction, and local PKCS #12 certificate signatures, React/PDF.js for viewing and annotation serialization, and pdf-lib for local page mutations, form annotations, content placement, searchable OCR layers, and decorations.
macOS printing uses the operating system's PDFKit print operation.
The application has no accounts, backend, or automatic document uploads.

See [PR-1-REVIEW.md](PR-1-REVIEW.md) for the milestone assessment, reproduced defects, fixes, and residual limitations.
See [VERIFICATION.md](VERIFICATION.md) for current verification evidence.
Historical screenshots and previously built installers do not establish acceptance of later source revisions.

## Completed in this continuation

- Phase 1 native save, Save As, discard, quit, recovery, external-change, collision, permission and constrained-volume checks are recorded as complete.
- Phase 2 complete local annotations, shapes, properties, synchronized comments, snapshots, and review exchange are complete.
- Phase 3 forms, Fill & Sign, and encrypted signature library are complete.
- Phase 4 native working revision ownership, catalog-preserving page operations, workspace navigation, batch extraction/merge/split manifests, and PDFKit printing are complete.
- Phase 5 content placement and decoration (transforms, text/images, font coverage, headers/footers/watermarks, Bates numbering, safe links, attachments) are complete.
- Phase 6 scored OCR evaluation corpus, Apple Vision offline OCR engine with portable fallback, searchable invisible PDF text streams, OCR UI, basic plain-text and scaled image exports are complete.
- Phase 7 pure-Rust lopdf native engine (`src-tauri/src/engine/`), existing-object text replacement and image replacement, AES-256 protection with permissions flags, measured structural and image compression, and permanent irreversible redaction with mandatory audit pass all 55 adversarial acceptance checks (`node scripts/phase7-acceptance.mjs`).
- Phase 7 redaction now removes intersecting vector paths, rejects unsupported shading fills, and retains recovery until the replacement revision has attached successfully.
- Phase 8 genuine Office exports (DOCX, XLSX, PPTX, RTF) generated from PDF text streams (`src/features/convert/ooxml.ts`) pass all 12 acceptance checks (`node scripts/phase8-acceptance.mjs`); model-based AI generation and translation are explicitly deferred per ADR 0008, while AssistantPanel provides offline extractive passage finding with page citations.
- Phase 9 local packaging passes: `npm run package` produces `NavPDF.app` and `NavPDF_0.2.0_aarch64.dmg`; `hdiutil verify` validates the DMG checksum; license inventory records 362 crates and 27 npm packages in `output/release/licenses.json`; modal focus traps and error boundaries protect UI workflows. Distribution and platform gates remain open as recorded above.
- Phase 10 local certificate signatures and DocMDP certification per ADR 0009 pass all 55 acceptance checks (`node scripts/phase10-acceptance.mjs`) against independent poppler `pdfsig` in an isolated NSS store and OpenSSL CMS verification; remote signing, hosted review, cloud accounts, and specialist rich media are explicitly declined per ADR 0010.

## Verified local state

Automated validation checks pass across the entire stack:
- Frontend coverage: 61 test files and 406 tests pass; lines 87.97%, functions 83.21%, statements 85.29%, branches 77.37% (all exceeding repository thresholds).
- Frontend lint and TypeScript checks pass cleanly (`npm run lint`, `npm run typecheck`).
- Production build succeeds without errors (`npm run build`).
- Rust engine and filesystem tests: 58 unit/integration tests pass, 1 real disk-full test ignored by default (`cargo test`).
- Rust Clippy: zero warnings with `-D warnings` (`cargo clippy`).
- Phase 7 adversarial acceptance: 55 of 55 checks pass (`node scripts/phase7-acceptance.mjs`).
- Phase 8 Office format acceptance: 12 of 12 checks pass (`node scripts/phase8-acceptance.mjs`).
- Phase 10 certificate signature acceptance: 55 of 55 checks pass (`node scripts/phase10-acceptance.mjs`).
- Release package: `npm run package` builds both the app bundle and disk image for local macOS acceptance.
- DMG checksum verification: `hdiutil verify` reports valid CRC32.

## Artifacts and hashes

The current release application is at `src-tauri/target/release/bundle/macos/NavPDF.app`.
Executable SHA-256: `78342c159b1bfd5aa11ed61dec9f47fd143fa85af56ea7fe0fbe7d52cc3623b1`.
The release disk image is at `src-tauri/target/release/bundle/dmg/NavPDF_0.2.0_aarch64.dmg`.
DMG SHA-256: `b8c1d32fa9e22283269a7905f3786d758e1e4fca812e29464d17623a4a3b98f8`.
Bundle identifier: `local.navpdf.reader`.

## Residual limitations and external gates

- Code signing credentials and Apple Developer notarization are not configured in local development; packaged builds are ad-hoc signed and labeled as unsigned local builds.
- Clean-account installation, physical-printer output, and non-macOS native dialogs, saving, recovery, printing, and OCR acceptance remain unverified.
- Windows and Linux desktop builds require platform-specific CI environments; macOS printing and Apple Vision OCR do not establish native printing or vision OCR on non-Apple platforms.
- Text replacement is scoped to simple font replacements without paragraph reflow; CID composite fonts, Type 3 fonts, and characters missing from embedded subsets are safely refused.
- Office exports are generated from extracted PDF text and table structures; direct reverse Office-to-PDF import is not delivered.
- External cloud integrations, remote signing servers, and third-party AI models remain declined in adherence to privacy and offline safety standards.
