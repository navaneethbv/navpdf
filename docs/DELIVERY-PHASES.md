# NavPDF phased delivery

Created: September 13, 2026.
Baseline: `c0e3849`, merged PR 1.
This is the active delivery tracker and supersedes the historical roadmap's immediate checklist and foundation-only README status.
The [original roadmap](IMPLEMENTATION-ROADMAP-2026-09-12.md) remains the detailed capability and engine reference.
Each phase now has a separate [implementation plan](phases/README.md) with ordered steps, code areas, dependencies and acceptance criteria.
Existing controls or passing unit tests do not establish completed native workflows.

## Working agreement

Work through phases in order and record evidence before marking a phase complete.
Reproduce defects through the end-user workflow before changing application code.
Use synthetic PDFs and separate output copies for destructive and recovery checks.
For each persisted operation, save, close, reopen in NavPDF, and inspect in an independent reader.
Record the source revision, build identity, fixture, result, and any remaining limitations.
Keep encrypted inputs read-only until encryption-aware saving is delivered.
Optional remote services require a separate architecture decision; no uploads or accounts are implied by this plan.

## Sequence and completion gates

| Phase | Scope | Completion gate | Status |
| --- | --- | --- | --- |
| 1 | [Reader reliability and file safety (M0)](phases/01-reader-reliability.md) | Native save, Save As, discard/cancel, failed replacement, quit, recovery, external modification, destination collision, and filesystem failure matrix passes; current highlight toolbar and 500-page round trip verified. | In progress |
| 2 | [Complete local annotations (M2)](phases/02-local-annotations.md) | Underline, strike-through, sticky notes, ink, free text, shapes and arrows persist with properties, deletion, undo/redo and synchronized comments; keyboard and independent-reader checks pass. | Pending |
| 3 | [Forms and local Fill & Sign (M4)](phases/03-forms-fill-sign.md) | Existing forms are interactive; supported field types, appearances and tab order round-trip; signatures have OS-protected reusable storage and a session-only mode. | Pending |
| 4 | [Page operations and mutation foundation (M1)](phases/04-pages-mutations.md) | General mutation undo/redo, revision/job ownership and bounded engine trials complete; page operations and printing preserve supported forms, links, outlines and geometry. | Pending |
| 5 | [Content placement and decoration (M3)](phases/05-content-decoration.md) | Text/images, links, attachments, headers/footers, watermarks, backgrounds and Bates numbering have usable placement controls, Unicode/font handling and independently verified output. | Pending |
| 6 | [OCR and basic exports (M5)](phases/06-ocr-exports.md) | Measured local OCR engine produces aligned searchable scans; language availability, rotation, cancellation and export memory bounds verified. | Pending |
| 7 | [Existing editing, protection and redaction (M6)](phases/07-editing-protection-redaction.md) | Selected engines support scoped existing-object editing, encryption-aware validation, measured compression and independently audited irreversible redaction. | Pending |
| 8 | [Office conversion and local intelligent tools (M7)](phases/08-conversion-intelligent-tools.md) | Genuine Office output passes a fidelity corpus; supported local generation/translation produces valid artifacts with references, cancellation and explicit model availability. | Pending |
| 9 | [Distribution and platform acceptance](phases/09-distribution-platforms.md) | Current DMG builds and installs in a clean account; signing/notarization and supported-platform accessibility, performance, print and interoperability acceptance complete. | Pending |
| 10 | [Optional services and specialist compatibility (M8)](phases/10-optional-integrations.md) | Separately scoped collaboration, remote signing, certification and media integrations pass privacy, trust and interoperability gates. | Pending, architecture decisions required |

Phases 2 and 3 prioritize free Reader gaps over extending existing editor features.
Their required mutation and placement support must be implemented within those phases before claiming completion; the broader foundation audit remains Phase 4.
Reader parity requires Phases 1 through 3 plus the relevant print, accessibility and release checks from Phases 4 and 9.
The full editor roadmap requires later phases as well.

## Phase 1 execution checklist

- [x] Inspect current source and reconcile the active scope against the latest review.
- [x] Refresh frontend coverage, lint, typecheck, production build, Rust tests and Clippy.
- [x] Identify or rebuild the native application used for acceptance.
- [x] Verify the corrected annotation toolbar visually.
- [ ] Open the 500-page fixture, search the final-page marker, highlight, save a copy, close and reopen in NavPDF and Preview.
- [ ] Verify Save As cancellation and successful destination metadata/recents.
- [ ] Verify dirty-document Open/Discard followed by cancellation and invalid input.
- [ ] Verify quit/close cancellation, explicit discard and successful save.
- [ ] Verify recovery after interrupted editing, failed recovery load and successful recovery Save As.
- [ ] Verify external source changes, new-destination collisions and destination permission failures preserve the original and dirty/recovery state.
- [ ] Add bounded disk-full/write-failure injection and verify no partial replacement or temporary-file leakage.
- [ ] Record residual existing-file concurrent-writer and metadata-preservation limitations.

### Evidence

Execution started September 13, 2026.
The baseline review records 240 frontend tests and 10 Rust tests; those counts are historical until refreshed below.
The previous native highlight/save/reopen attempt was interrupted by the computer-use service.
The previous app bundle built successfully, but its DMG customization failed.
See [verification ledger](VERIFICATION.md) for those historical results.

### September 13 execution results

All checks below were refreshed against `c0e3849` with documentation-only changes.
Frontend coverage passed: 240 tests across 34 files, 91.87% lines and 82.30% branches.
ESLint, TypeScript and production build passed; the existing large-chunk advisory remains.
All 10 Rust tests and Clippy with `-D warnings` passed.
The identified native bundle is `src-tauri/target/release/bundle/macos/NavPDF.app`.
Its executable SHA-256 is `30e80740cc004f6fec33bf369a3e1b0730d254cd607028d3a1fb6a3c21bdc8a8`.
The initially running process predated the final toolbar rebuild; quitting and relaunching that bundle displayed the corrected horizontal toolbar above the status bar.

| Native action | Observed result |
| --- | --- |
| Open `reader-500.pdf` from recents | Page 500 rendered at positive 74% zoom. |
| Drag the highlight tool across the sample sentence | Dirty state and Undo became available. |
| Save As, then Cancel | The original document remained open with unsaved changes and its selected annotation. |
| Save As `phase1-highlight-20260913.pdf` | Save completed, title changed to the new filename, and the new recent entry appeared. |
| Close, reopen the new recent entry, search `NEEDLE-0500`, select result | Page 500 was remembered; one search result and a yellow highlight were visible in NavPDF. |
| Open that exact output in Preview and search the marker | Preview found page 500 and preserved the text, but rendered the highlight as an opaque bar over the sentence. This fails visual interoperability. |

The local output is `tests/pdf-fixtures/phase1-highlight-20260913.pdf` (460122 bytes).
Its SHA-256 is `59ba80cf86c81127979b1f592f608e7d9ffa63d1010d9c39fe062c6fbbf27754`.
This is a manual acceptance artifact, not an automatically generated corpus fixture.

### P1-01: Freehand highlight obscures text in Preview

Status: reproduced natively; fix pending.
Reproduction: open the 500-page fixture, activate Highlight, drag horizontally across the sample sentence, save a separate copy, then open page 500 in Preview.
Expected: the underlying sentence remains readable through the highlight in both readers.
Observed: NavPDF renders readable highlighted text; Preview displays an opaque yellow bar.
Independent inspection with pdf-lib found `/Subtype /Ink`, `/IT /InkHighlight`, `/CA 1`, and an appearance stream with `/BM /Multiply`.
This establishes that the tested path was freehand highlighting, not a text-selection `/Highlight` annotation.
The exact Preview appearance-handling cause is not yet established.
Next: compare text-selection highlights and freehand output, implement an interoperable appearance without rewriting unrelated annotations, add a saved-object regression, and repeat the native/Preview workflow.
Do not mark the 500-page interoperability checklist complete based on NavPDF rendering alone.

## Next-phase rule

Do not mark Phase 1 complete while native recovery or filesystem acceptance remains open.
If a required check is blocked by the local environment, record the exact blocker and continue independent work within the phase.
At each phase boundary, update this tracker with completed capabilities, verification evidence and the next concrete task.
