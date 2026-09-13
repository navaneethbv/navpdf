# NavPDF handoff

Checkpoint: September 13, 2026, PR 1 review follow-up.
The implementation is committed on `migration/tauri-desktop-app`; this is no longer the earlier untracked migration workspace.
Check GitHub and the current working tree for merge/publication status.

## Current scope

NavPDF uses Tauri/Rust for local file ownership and validated saving, React/PDF.js for viewing and annotation serialization, and pdf-lib for initial local editing operations.
macOS printing uses the operating system's PDFKit print operation.
The application has no accounts, backend, or automatic document uploads.

This is a migration and initial editing foundation, not completion of all roadmap milestones.
See [PR-1-REVIEW.md](PR-1-REVIEW.md) for the milestone assessment, reproduced defects, fixes, and residual limitations.
See [VERIFICATION.md](VERIFICATION.md) for current verification evidence.
Historical screenshots and previously built installers do not establish acceptance of later source revisions.

## Remaining acceptance work

- Complete the native save, Save As, discard, quit, recovery, and filesystem failure matrix.
- Verify every editing tool through save, close, reopen, and an independent reader, including rotated/cropped pages, forms, links, and non-ASCII content.
- Complete general mutation undo/redo, native revision/job ownership, and the engine trials required by the roadmap.
- Complete annotation families and interactive forms.
- Replace plaintext reusable signature storage with OS-protected storage and a session-only option.
- Complete keyboard focus management and accessibility across the newer tool dialogs.
- Evaluate OCR, existing content editing, encryption, secure redaction, Office conversion, and optional local model features before exposing them as delivered capabilities.
- Test installer launch in a clean account and complete signing/notarization before distribution claims.
- Test Windows and Linux independently; macOS print support does not establish printing on those platforms.

## Artifacts and checks

The app is at `src-tauri/target/release/bundle/macos/NavPDF.app`.
The installer is at `src-tauri/target/release/bundle/dmg/NavPDF_0.2.0_aarch64.dmg`.
The current bundle identifier is `local.navpdf.reader`; `local.navpdf.editor` identifies the older prototype.

Use Node 24 for frontend checks, matching CI.
Run `npm run lint`, `npm run typecheck`, `npm run test:coverage`, `npm run build`, `cargo test --manifest-path src-tauri/Cargo.toml`, and `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`.
Run `npm run package` and `hdiutil verify` when validating the packaged app and installer.
Rebuild artifacts after frontend or native changes before collecting new native evidence.
