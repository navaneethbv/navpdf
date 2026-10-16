# Acceptance checklist

Use these criteria when implementing or revalidating a phase.
The [delivery tracker](../DELIVERY-PHASES.md) owns current status and next work; this checklist makes no completion claims.
Detailed historical step plans are available in Git history before the documentation cleanup.

## Shared contract

Work in delivery order and establish prerequisite acceptance before claiming a dependent phase complete.
Use the existing document identity, revision history, cancellation and PDF-point geometry boundaries.
Start fixes with an end-user reproduction on synthetic input; use native NavPDF for WebKit, dialogs, saving, recovery, printing and lifecycle defects.
Record an exact blocker when native reproduction is unavailable and distinguish browser/unit substitutes from native evidence.

For persisted changes, exercise edit, undo/redo where supported, Save As, close and reopen in NavPDF and an independent reader.
Use Preview on macOS and Acrobat for Acrobat-specific compatibility claims.
Inspect annotation/form objects and visible appearances, including rotated/cropped pages, mixed sizes, non-ASCII text and large documents as relevant.
Check failed writes, cancellation, stale results, collisions and recovery without personal documents or destructive tests on real data.
Keep artifacts under ignored `output/` and record source/build identity and output hashes in the [ledger](../VERIFICATION.md).

## Phase criteria

| Phase | Required behavior and independent checks |
| --- | --- |
| 1: Reader and safety | Open/search/highlight/save/reopen a 500-page file; check text-selection and freehand highlights separately. Dirty Open, cancel/discard, damaged replacement, close/quit, recovery, external modification, destination collision, read-only output and constrained-volume failures must retain the expected data. |
| 2: Annotations | Each declared annotation type preserves subtype, contents, geometry and appearance across repeated saves. Properties, selection, deletion, replies/status where supported, live comments, undo/redo and saved dirty state agree. Snapshot export leaves the document unchanged; repeated review import does not duplicate comments and validates identity. |
| 3: Forms and signatures | Supported text, checkbox, radio and choice widgets retain values, flags, appearances, tab order and names. Geometry and signature marks survive rotation/crop/zoom. Test duplicate names, read-only fields, unsupported XFA/scripts, existing signatures, failed saves and mixed edits. Persistent assets require authenticated encryption and OS-backed keys, recoverable migration and locked-store errors; session-only assets stay unpersisted. |
| 4: Pages and revisions | All operations preserve declared page boxes, rotations, labels, links, outlines, annotations and form references or explicitly warn/reject. Verify ordered inputs, duplicate field names, output manifests, bounded ZIPs, collisions and cancellation. Mixed edits, page mapping, stale revisions, undo/redo and failed attachment preserve ownership. Print the edited revision with the selected pages and declared options. |
| 5: Content and decoration | Saved text/images and app-owned decorations match supported previews. Repeated apply/update/remove preserves unrelated content. Verify transforms, font coverage, embedding rights, unsupported scripts, image transparency, Bates collisions/manifests, safe links and bounded inert attachment extraction. Cropping and drawing are never secure removal. |
| 6: OCR and basic exports | Run real recognition on labeled skewed, rotated, low-contrast, multi-column, table and mixed text/scan inputs. Record WER/CER, box alignment, language availability, latency, memory and target hardware. Independent text extraction and rendering verify searchable layers without changing scan pixels. Test existing-layer replacement, correction, cancellation and stale work. Exports honor ranges, dimensions, quality, names and resource bounds. Scanner acquisition needs separate device/permission/error evidence. |
| 7: Editing and protection | Confirm supported text/image replacement with unrelated resources preserved and unsupported fonts rejected. Independently reopen protected output with correct passwords and reject wrong passwords; check plaintext overwrite/recovery boundaries. Compression savings must match bytes and fidelity. Redaction requires fresh output, no prior revisions and independent text, object, image, metadata, attachment, hidden-content and render audits with canaries. Any surviving canary blocks that acceptance. |
| 8: Conversion | Validate actual DOCX/XLSX/PPTX/RTF and other declared formats with independent consumers. Separate editable text from page-picture slides and raster exports; check reading order, typed cells and spreadsheet formula neutralization. Extractive citations must reach the correct source and report insufficient evidence. Deferred models, Office import and generation remain unavailable until separately approved and measured. |
| 9: Distribution | Freeze the advertised OS/architecture/feature matrix and license inventory. Build the exact release app and installer, verify hashes/checksum, install/launch from a clean account without development tools, then verify signing/notarization. Exercise keyboard access, focus, VoiceOver, contrast, minimum window sizes, reduced motion, startup/search/memory budgets and physical printer output per claimed platform. |
| 10: Optional integrations | Local signatures require byte-range, incremental-update, certificate validity, DocMDP, countersignature and tamper tests against independent validators. Integrity is separate from trust, revocation and timestamps. Each newly approved remote/media package needs its own scope, privacy, licensing, credentials/retention and platform acceptance; declined packages are not completed features. |

## Validation commands

Use Node 24, `npm ci`, and Rust compatible with the native manifest, currently at least 1.90.
For application changes run:

```sh
npm run format:check
npm run lint
npm run typecheck
npm run test:coverage
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
git diff --check
cmp AGENTS.md CLAUDE.md
```

Preserve coverage gates and LCOV output.
Generate fixtures through their sources rather than manually editing them.
Use the relevant `acceptance:*` scripts in `package.json` for independent artifact checks; they do not replace native GUI journeys.
Documentation-only changes require link/content, instruction-parity and whitespace checks without new tests.

For native release acceptance:

```sh
npm run package
hdiutil verify src-tauri/target/release/bundle/dmg/NavPDF_0.2.0_aarch64.dmg
```

Use the actual versioned artifact name.
An app-only build uses `npm run package -- --bundles app` and does not verify the DMG.
Relaunch the exact rebuilt `src-tauri/target/release/bundle/macos/NavPDF.app` before testing.
Record unavailable credentials, hardware, readers or automation as open gates.
