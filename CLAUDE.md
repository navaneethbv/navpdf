# Repository instructions

## Scope and parity

These instructions apply throughout the NavPDF repository.
Keep `AGENTS.md` and `CLAUDE.md` byte-for-byte identical.
When changing either file, update the other in the same change and verify with `cmp AGENTS.md CLAUDE.md`.
Both files are maintained source documents, not generated files.

## Start here

Read `docs/DELIVERY-PHASES.md` for the active phase, acceptance gates, recorded defects and next task.
Read `docs/PRODUCT-SPEC.txt` for product requirements and `docs/IMPLEMENTATION-ROADMAP-2026-09-12.md` for detailed capability plans.
Use `docs/PR-1-REVIEW.md`, `docs/VERIFICATION.md` and `docs/HANDOFF.md` for dated evidence and limitations.
Check current source before relying on historical architecture or completion claims.
Inspect `git status --short` before editing and preserve all pre-existing work.
Do not reset, clean, stash or overwrite someone else's changes to simplify the task.

## Working rules

Ask before writing code when intent, requirements or a consequential architecture choice is unclear.
State uncertainty explicitly and distinguish observations from hypotheses.
Do not repeatedly request approval for work already authorized.
Prefer the simplest correct solution, with quality, robustness and maintainability taking priority over development cost.
Avoid speculative abstractions, unrelated refactors and unrequested flexibility.
Keep changes within the task, except that observed lint failures, failing or flaky tests and clearly broken UI should be fixed along the way.
Reproduce bugs through an end-user E2E workflow before changing application code.
Use native NavPDF for bugs involving WebKit, dialogs, printing, saving, recovery or desktop lifecycle.
If native reproduction is unavailable, record the exact blocker and limits of any browser or unit-test substitute.
Never claim a bug is reproduced solely because a mock was configured to fail.

Work through delivery phases in order.
Finish and record a phase's acceptance gates before marking it complete or claiming feature parity.
Keep progress and unresolved work in the active delivery tracker rather than duplicating changing status in these instruction files.
Near context limits, checkpoint files, commands, evidence, blockers and next steps in a handoff before continuing.

## Repository map and boundaries

- `src/app/`: application shell and document-session lifecycle.
- `src/stores/workspace.ts`: serializable UI state and preferences.
- `src/features/viewer/`: PDF.js viewer, annotations, navigation and rendering integration.
- `src/features/`: page tools, editing, forms, signatures, exports and other feature UI.
- `src/services/`: PDF loading, typed document commands and native IPC adapters.
- `src-tauri/src/commands/`: native document ownership and IPC commands.
- `src-tauri/src/filesystem/`: snapshots, validation and atomic persistence.
- `src-tauri/src/security/`: native input and range boundaries.
- `tests/unit/` and `tests/integration/`: frontend behavior, contracts and PDF round trips.
- `tests/pdf-fixtures/` and `scripts/`: synthetic corpus and fixture generators.

The product uses Tauri 2, Rust, React, TypeScript, Zustand and PDF.js.
pdf-lib currently supports limited editing and composition; lopdf validates native save output.
Do not assume any integrated library supports arbitrary text reflow, encryption or secure redaction.
Keep native filesystem ownership behind typed IPC and opaque document handles.
Keep PDF proxies, loading tasks and editor instances outside serializable UI state.
Preserve bounded range reads, canvas limits, virtualized pages/thumbnails and stale-job cancellation.
Document significant engine or dependency decisions in `docs/adr/`, including licensing, packaging and interoperability evidence.
Do not revive the historical Electron/Python prototype as the production architecture.

## PDF safety and privacy

Treat PDFs, attachments, metadata and extracted text as untrusted input.
Never execute embedded scripts or automatically launch attachments or external links.
Do not add document uploads, telemetry, remote fonts, cloud accounts, model downloads or external services without explicit scope and an architecture decision.
Preserve production CSP and native navigation restrictions.
Keep passwords, signature assets, document text, form values and sensitive paths out of logs.

Retain the active document, dirty state and recovery data until a replacement or save successfully commits.
Cancellation, failed loading and failed saving must not silently discard edits.
Keep source range snapshots immutable and separate their lengths from saved-output metadata.
Validate output and expected page count before replacing a destination.
Use a destination-local temporary file, flush it, detect external changes and persist atomically.
Preserve new-destination no-clobber behavior and existing destination permissions.
Do not claim existing-file replacement is a cross-process compare-and-swap or that POSIX mode preservation covers ACLs and extended attributes.
Keep encrypted input read-only until encryption-preserving saving and password reopen are verified.
Never leave decrypted recovery copies of encrypted documents.

Preserve supported forms, annotations, links, outlines, fonts, page boxes and rotations during mutations.
Warn or reject unsupported structures instead of silently losing them.
Do not equate cropping or painting over content with permanent removal.
Secure redaction requires independent text, object, image and hidden-data inspection of saved output.
Signature appearances are not certificate signatures or cryptographic certification.
Reusable signatures require OS-protected storage and a session-only option before claiming that delivery gate.

## UI and interoperability

Build a document-focused interface with NavPDF's own visual identity.
Do not advertise placeholders, disabled controls, text extraction or HTML outlines as completed OCR, protection, Office conversion or intelligent generation.
Keep focus management, keyboard navigation, accessible names, contrast and disabled/busy states correct.
Inspect actual native rendering for overlap, clipping, misplaced controls, unreadable annotations and incorrect zoom.
Do not treat a successful parse or NavPDF-only rendering as interoperability proof.

For every persisted tool change, exercise open, edit, save a copy, close and reopen in NavPDF and an independent reader.
Use Preview for macOS acceptance and Acrobat when testing Acrobat-specific compatibility.
Check both annotation objects and visible appearance where applicable.
Use rotated/cropped pages, mixed sizes, forms, links, non-ASCII text and large documents as relevant.
Keep text-selection highlights and freehand highlights separate in tests; they can serialize to different annotation types.
Never weaken a test or hide a failure to obtain passing checks.

## Commands and validation

Use Node 24 to match CI, the repository lockfiles, and an installed Rust toolchain compatible with the crate.
Use `npm ci` for a reproducible install.
Use `npm run desktop` for native development and `npm run dev` for the browser preview.
The browser preview does not establish native save, recovery, print or packaging acceptance.

For application changes, run the relevant checks below before handoff:

```sh
npm run lint
npm run typecheck
npm run test:coverage
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
git diff --check
```

Add focused regressions for reproduced defects, especially saved-output and lifecycle failures.
Prefer behavior and independent output assertions over tests that mirror implementation details.
Do not add tests solely for reversible documentation changes.
Keep coverage thresholds intact and preserve LCOV output for hosted analysis.
`npm test` and `npm run test:coverage` regenerate the standard synthetic corpus through their pretest hooks.
Use generators for generated fixtures; never manually edit generated outputs.
Use synthetic copies for failure injection, recovery and destructive tests, never personal documents.
Keep manual acceptance artifacts under ignored `output/` and record paths and hashes when needed.

For packaged native acceptance:

```sh
npm run package
hdiutil verify src-tauri/target/release/bundle/dmg/NavPDF_0.2.0_aarch64.dmg
```

Use the actual versioned artifact path if the application version changes.
The app bundle is `src-tauri/target/release/bundle/macos/NavPDF.app`.
Rebuild after application changes and relaunch the tested bundle; an already-running process may still contain older code.
Record source revision, executable hash, fixture, action, expected result, actual result and remaining limitations.
An app-only build does not establish DMG success.
Installer creation, clean-account launch, signing, notarization, physical printing and Windows/Linux acceptance are separate gates.
Report local checks, hosted checks, quality analysis, merge status and distribution status separately.
Skipped analysis is not a passing scan.

## Git and documentation

Do not commit, push, open a PR, merge or publish unless authorized by the user.
Never add automated co-author attribution.
Never name an LLM, agent or vendor in branch names, commit subjects/bodies/trailers, tags, or PR/issue titles and descriptions.
Names of actual project files, dependencies, environment variables or shipped features remain legitimate technical references.
Name the work, not the tool, and omit generated-by footers.
Never manually modify `CHANGELOG.md` or files marked auto-generated.
Update relevant delivery and verification documents when scope, capabilities or evidence change.
In long Markdown edits, put each full sentence on its own physical line while preserving normal lists, tables and code blocks.
Never use the em dash character in output or authored text.
Keep final handoffs concise: what changed, what passed, what remains and any exact blocker.

