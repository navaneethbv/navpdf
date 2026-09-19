# NavPDF handoff

## September 19 workspace delivery

Source `6b7fd37` implements the approved single-PDF reference layout, PNG/JPEG import, discoverable conversion/compression and native export saving.
The tour, tips and native-open delivery merged in PR 21; themes and custom overrides were delivered earlier.
The verification ledger records local checks, exact artifacts, native menu/navigation/rendering checks, Word/PowerPoint interoperability and compressed/imported PDF reopen evidence.
Compact native resizing remains unverified because the automation could not resize the window reliably.
The advanced capability and distribution gates remain separate from this layout delivery.
Preserved user edits are in `output/reader-5-preserved-20260919.pdf`.
The three untracked root planning documents are pre-existing and must not be reset, cleaned, stashed or swept into this PR.
Older checkpoints below are historical and do not override this entry.

## PR #4 follow-up to `3d2f611`

Image transform coordinates, XFDF markup geometry, and empty choice-field updates are corrected with saved-output regressions.
All required local automated checks pass, including 510 frontend tests and 80 Rust tests with the existing constrained-volume test ignored.
See `docs/VERIFICATION.md` for the follow-up evidence and limits.
Packaged UI and Preview/Acrobat acceptance remain open, and existing package hashes predate these fixes.
The three untracked root planning documents remain untouched.

## Current September 15 worktree

The active worktree is `fix/september-14-review-corrections` at `d83f6d8271dd77c973df799f63dfecff14152128`.
Only the three untracked root planning files remain outside the pushed tree.
Tranches 0 through 3 are implemented in source and Tranche 4 is in progress.
Tranche 5 is in progress, Tranche 6 is pending, and Tranches 7 and 8 are partial.

Current checks are 504 frontend unit tests passed across 80 files with 83.39% statement, 75.01% branch, 81.18% function and 86.20% line coverage, TypeScript passed, ESLint passed, formatting checks passed, 80 Rust tests passed with one constrained-volume test ignored, and Clippy passed with warnings denied.
The current worktree also adds metadata editing, preferences, menus and shortcuts, page operations, tokenized OS open-with and drag-drop, XFDF exchange, comment threads, stamps, context-menu redaction, corpus-driven OCR WER/CER reporting, explicit fixture guards, acceptance command aliases, independent-tool discovery and a macOS acceptance workflow.
Hosted run `35012242904` passed every listed CI and native acceptance check, including Cargo Deny, Rust MSRV, both Rust test and Clippy jobs, Phase 7, Phase 8, Phase 10 and OCR.
Native dialog, save/recovery, Preview and Acrobat checks for this source revision remain open.
The current packaged app renders the visible page and thumbnails without the previous persistent spinner.
The current package contains both the app and DMG, and `hdiutil verify` passed.
The rebuilt executable SHA-256 is `9a6364bf60b67d504fd64ec30e5ddc4d2cefc332df364a2dc17e045f92bf43c4`.
The DMG SHA-256 is `2904b2a5bcbbf680aff64ec8284e5e7553afdc0c579379818eb68e8f9f27c0a82`.
The DMG verification CRC32 is `$B4992B9A`.
The remainder of this file is historical evidence from earlier builds and does not override the current checkpoint above.

Current corrective review: see [PR-2-REVIEW.md](PR-2-REVIEW.md).
The completion statements and hashes below predate corrections to signature storage, native revisions and real OCR.
Phases 3, 4 and 6 are reopened in the delivery tracker; Phase 9 remains partial.
Native UI acceptance is blocked by unreliable computer-use input after a service restart; the rebuilt app launches, but file selection and clipboard input do not reliably complete.
The corrected app and DMG both built, and `hdiutil verify` passed.
Current executable SHA-256: `c57407acafaf6bc29628ace8c0a8a63cdd0b7ed5dbcc984069da3f46c76c504b`.
Current DMG SHA-256: `bc20c3648f1b59713553655afe98530c9502ae4b7c5570b6294fb462cb06d27a`.
The corrections are prepared on `fix/native-ocr-signature-revisions`, based on merged PR #2 at `f229114`.

Historical checkpoint: September 14, 2026, PR #2 phase alignment review, before the corrective follow-up.
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

## Current September 15 handoff

The active branch is fix/september-14-review-corrections.

The current implementation includes the review hardening, native OCR bridge, image and signature transforms, forms editing, crop positioning, protection parity, viewer rendering hardening, and machine-relative native budgets.

Native OCR acceptance is 6 of 6 samples.

Native rendering was verified from one fresh packaged process with the 500-page fixture, and the page canvas and thumbnails were visible without the previous persistent spinner.

The final local app executable is src-tauri/target/release/bundle/macos/NavPDF.app.

The final local DMG is src-tauri/target/release/bundle/dmg/NavPDF_0.2.0_aarch64.dmg.

The executable SHA-256 is 9a6364bf60b67d504fd64ec30e5ddc4d2cefc332df364a2dc17e045f92bf43c4.

The DMG SHA-256 is 2904b2a5bcbbf680aff64c8284e5e7553afdc0c579379818eb68e8f9f27c0a82.

The DMG passed hdiutil verify with CRC32 $B4992B9A.

Local tests and acceptance suites pass as recorded in docs/VERIFICATION.md.

Preview and Acrobat reopen checks for the final source revision remain unverified.

Full Tranche 6 structural refactors, most Tranche 7 Acrobat parity, clean-account and notarized distribution, and the remaining native revision recycling and performance gates remain open.

The hosted run for commit 74974c9 confirmed the Cargo Deny manifest path correction, then exposed unallowed transitive license terms and a redundant Swift runtime link entry on macOS.

The follow-up adds explicit license allowances and a versioned JPEG IJG clarification, marks the private native package unpublished, and removes the redundant Swift runtime link entry.

The local cargo-deny 0.18.4 full license check passes.

Hosted run `35009656343` passed the normal frontend, Rust, SonarCloud and commit checks.
It failed Cargo Deny on six transitive unmaintained advisories with no safe upgrade reported by the advisory database.
It also failed native acceptance because the job did not generate the ignored `reader-100.pdf` fixture before Phase 7.
The current follow-up adds the documented advisory exceptions and runs `npm run fixtures` before native acceptance.
Hosted run `35012242904` passed all listed CI and native acceptance checks for this follow-up.

The hosted Phase 10 checks then exposed more OpenSSL version drift because the runner rejected `x509 -not_before` and used different successful CMS output text.
The script now uses the compatible `req -nodes` and `x509 -days 0` forms and checks the CMS process exit status.
OpenSSL checks CMS and byte-range integrity with `-noverify`, while independent `pdfsig` checks the synthetic trust chain.
Local Phase 10 acceptance passes 55 of 55 checks.

The root planning files DELIVERY-PHASES.md, IMPLEMENTATION-PLAN-2026-09-14.md, and REVIEW-2026-09-14.md remain untracked source material and must not be included in the commit.
