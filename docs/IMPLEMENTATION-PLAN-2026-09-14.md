# NavPDF corrective and feature implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the data-safety, correctness, accessibility, test and documentation defects recorded in the September 14 review, then close the product-specification gaps and reach Acrobat Reader parity in user-visible order.

**Architecture:** Corrections stay inside the existing boundaries: pdf-lib writers in `src/services/document-commands.ts` (to be split by domain), PDF.js viewer wiring in `src/features/viewer/controller.ts` (to gain a mutation queue), native ownership behind typed IPC in `src-tauri/src/commands/`, and the lopdf engine in `src-tauri/src/engine/`.
Every persisted change gains a regression that inspects saved bytes independently, and every reopened phase gate is re-recorded with fixture, action, result and hash.

**Tech Stack:** Tauri 2, Rust 1.89, React 19, TypeScript 6, Zustand 5, pdfjs-dist 6.3.289, pdf-lib 1.17.1, lopdf 0.45, Vitest 5, happy-dom.

**Spec:** [REVIEW-2026-09-14.md](REVIEW-2026-09-14.md) (finding IDs referenced below), [PRODUCT-SPEC.txt](PRODUCT-SPEC.txt), [DELIVERY-PHASES.md](DELIVERY-PHASES.md).

## Global constraints

Copied from `CLAUDE.md` and the review; every task inherits them.

- Node 24 and an installed Rust toolchain compatible with `rust-version = "1.89"`; use `npm ci`.
- Run before every handoff: `npm run lint`, `npm run typecheck`, `npm run test:coverage`, `npm run build`, `cargo test --manifest-path src-tauri/Cargo.toml`, `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`, `git diff --check`.
- Coverage thresholds stay at lines 80, functions 80, branches 75, statements 80 (`vite.config.ts:16-31`).
- Keep `AGENTS.md` and `CLAUDE.md` byte-identical; verify with `cmp AGENTS.md CLAUDE.md`.
- Never use the em dash character in authored text; put each sentence on its own line in long Markdown edits.
- Do not commit, push or open PRs unless the owner authorizes; never add automated co-author attribution or name tools in git metadata.
- Reproduce lifecycle, dialog, printing and saving bugs natively with `npm run desktop` or the packaged bundle before changing application code; record any blocker exactly.
- Treat PDFs as untrusted; never execute embedded scripts; keep passwords, document text, form values and paths out of logs.
- Retain the document, dirty state and recovery data until a replacement or save commits; failures must not discard edits.
- Encrypted input stays read-only until encryption-preserving save is verified; never leave decrypted recovery copies.
- Use synthetic fixtures under `tests/pdf-fixtures/` for destructive tests; manual artifacts go under ignored `output/`.
- Do not advertise placeholders or disabled controls as completed features.
- Each task ends with an independently testable deliverable; each task's checks pass before the next task starts.

## Current implementation status

This status is for the uncommitted September 14 worktree and is based on current source inspection.

| Scope | Status | Evidence or open gate |
| --- | --- | --- |
| Tranche 0 | Complete | Guardrails and CI configuration are implemented; hosted rerun is pending. |
| Tranche 1 | Complete | Data-safety corrections and focused regressions are implemented; native workflows remain open. |
| Tranche 2 | Complete | Tasks 2.1 through 2.7 are implemented; packaged placement and redaction checks remain open. |
| Tranche 3 | Complete in source | Tasks 3.1 through 3.8 are implemented; native dialogs and keyboard walkthrough remain open. |
| Tranche 4 | In progress | Fixture guards, the PDF artifact inspection helper, corpus-driven OCR metrics, acceptance aliases, tool discovery and macOS CI are implemented; hosted checks and the remaining artifact audit are open. |
| Tranche 5 | In progress | Metadata editing, preferences, menus and shortcuts, page operations, tokenized OS open-with and drag-drop, XFDF exchange, comment threads, stamps and context-menu redaction are implemented; forms editing, crop and transform controls, image replacement, signature placement rotation, protection parity and native checks remain open. |
| Tranche 6 | Pending | Structural refactors have not been completed. |
| Tranche 7 | Partial | View modes, navigation, page labels and the external-link trust prompt are implemented; sidebar parity, advanced forms, measurement, print options, reflow, read-aloud, high contrast and independent Acrobat checks remain open. |
| Tranche 8 | Partial | Revision-history byte bounds, PDF.js scripting restrictions and reproducible memory probe and driver scripts are implemented; native memory budgets, renderer revision ownership, range recycling, canvas eviction and hardened entitlements remain open. |

The current local baseline is 498 frontend tests passing across 79 files with 83.42% statement, 75.03% branch, 81.24% function and 86.26% line coverage.
The 78 Rust tests pass with one constrained-volume test ignored, TypeScript passes, ESLint passes, formatting checks pass and Clippy passes with warnings denied.
Phase 7 and Phase 10 acceptance each pass 55 of 55 checks.
Phase 8 passes 11 of 12 checks because Quick Look produces no rendered output in this noninteractive environment.
The current handoff still requires native rendering, independent-reader, hosted CI and the remaining documentation integrity checks from the current source revision.

## File structure decisions

New files this plan creates, with their single responsibility:

| Path | Responsibility |
| --- | --- |
| `src/services/pdf/page-box.ts` | `visibleBox(page)`, `clampToBox`, rotation-aware point mapping shared by every writer |
| `src/services/pdf/content-streams.ts` | `appendTaggedStream(doc, page, tag, operators)` and `removeTaggedStreams(doc, page, tag)` |
| `src/services/pdf/name-tree.ts` | `walkEmbeddedFiles(doc)` name-tree walker used by list, extract and delete |
| `src/services/pdf/link-targets.ts` | `stripExternalPageLinks(doc, keptPageIndices)` before `copyPages` |
| `src/services/pdf/annotations.ts`, `pages.ts`, `forms.ts`, `content.ts`, `decorations.ts`, `attachments.ts`, `ocr-layer.ts` | Domain splits of `document-commands.ts` (Task 6.1); `document-commands.ts` re-exports until callers migrate |
| `src/services/mutation-queue.ts` | `MutationQueue.run(label, fn)` promise queue used by the controller |
| `src/services/document-identity.ts` | `contentIdentity(pdf)` from trailer `/ID` and page count for comment exchange |
| `src/components/FeatureDialog.tsx` | Shared modal wrapper: Escape, initial focus, `aria-busy`, labelled title, footer slot |
| `src/components/SegmentedControl.tsx` | Button group with `aria-pressed` for the tab-like rows |
| `src/components/PageNumberInput.tsx` | Clamped page input that never yields `NaN` |
| `src/components/RootErrorBoundary.tsx` | Root boundary with a "Save a copy" escape hatch |
| `src/features/pages/page-range.ts` | Moves `parsePageRange` from `print-range.ts` for reuse by Decorations, Bates, Split, Office export |
| `src/features/document/PropertiesDialog.tsx` | Metadata editing (spec §24) |
| `src-tauri/src/commands/recovery.rs` | Per-document recovery files and manifest |
| `src-tauri/src/engine/prune.rs` | lopdf reachability prune and renumber for delete operations |
| `.github/workflows/ci.yml` additions, `.nvmrc`, `rust-toolchain.toml`, `deny.toml`, `.prettierrc` | Tooling |

---

## Tranche 0: environment and guardrails

### Task 0.1: Pin Node and Rust versions

**Files:**
- Create: `.nvmrc`, `rust-toolchain.toml`
- Modify: `package.json`, `README.md:42`

- [ ] **Step 1:** Establish the true minimum Rust version: the lockfile's `aes 0.9.3` needs rustc 1.89 (CI-08), so run `cargo build --manifest-path src-tauri/Cargo.toml` on 1.89, then raise `rust-version` in `Cargo.toml` to the first version that builds and update `README.md:42` and `CLAUDE.md:101` (and `AGENTS.md`) to match.
  Create `.nvmrc` containing `24` and `rust-toolchain.toml` containing:

```toml
[toolchain]
channel = "1.89"
components = ["clippy", "rustfmt"]
```

  Use the version chosen above if it differs.

- [ ] **Step 2:** Add to `package.json`: `"engines": { "node": ">=24 <25" }`, `"license": "UNLICENSED"` (or the owner's chosen license), and scripts `"format:check": "prettier --check src scripts tests/unit tests/integration vite.config.ts eslint.config.js"` and `"pretest:integration": "npm run fixtures"`.
- [ ] **Step 3:** Change README line 42 to "Node.js 24 and Rust 1.88 or newer".
- [ ] **Step 4:** Run `npm ci && npm run lint && npm run typecheck`; expected pass.

### Task 0.2: CI runs every required check on Linux and macOS

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `deny.toml`, `.prettierrc`

- [ ] **Step 1:** Add jobs `format` (`npm run format:check`, `git diff --check`), `rust-fmt` (`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`), `rust-deny` (`EmbarkStudios/cargo-deny-action@v2` with `deny.toml` ignoring `RUSTSEC-2023-0071` with the ADR 0009 rationale in a comment), and `npm-audit` (`npm audit --audit-level=high`).
- [ ] **Step 2:** Add a `rust-macos` job on `macos-14` running `cargo test` and `cargo clippy -D warnings` so the `cfg(target_os = "macos")` print, OCR, Keychain and PDFKit code compiles in CI, and an `rust-msrv` job that runs `cargo build` on the toolchain declared in `rust-toolchain.toml` so CI-08 cannot recur.
- [ ] **Step 3:** Add `dependabot.yml` for npm, cargo and github-actions weekly.
- [ ] **Step 4:** Add `.prettierrc` with `{ "printWidth": 100, "singleQuote": false, "trailingComma": "all" }` matching the existing code, run `npm run format:check`, and fix or accept the diff in a formatting-only change.
- [ ] **Step 5:** Verify with `act` or by pushing a branch when authorized; record the run URL in `VERIFICATION.md`.

---

## Tranche 1: data-safety corrections

### Task 1.1: Decorations and Bates tag only their own streams (DS-01)

**Files:**
- Create: `src/services/pdf/content-streams.ts`
- Modify: `src/services/document-commands.ts:1047-1090`, `:1093-1250`, `:1286-1387`
- Test: `tests/unit/decorations-content-safety.test.ts`

**Interfaces:**
- Produces: `appendTaggedStream(doc: PDFDocument, page: PDFPage, tag: string, operators: PDFOperator[]): PDFRef` and `removeTaggedStreams(doc: PDFDocument, page: PDFPage, tag: string): number`.

- [ ] **Step 1: Write the failing test**

```ts
import { PDFDocument, StandardFonts, PDFArray, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { applyDocumentDecorations, removeDocumentDecorations, applyBatesNumbering } from "../../src/services/document-commands";

async function streamsOfFirstPage(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPage(0).node.Contents();
  const refs = contents instanceof PDFArray ? Array.from({ length: contents.size() }, (_, i) => contents.get(i)) : [contents];
  return refs.map((ref) => new TextDecoder("latin1").decode(decodePDFRawStream(doc.context.lookup(ref) as PDFRawStream).decode()));
}

async function pageWithBody(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("ORIGINAL BODY", { x: 72, y: 700, size: 24, font });
  return doc.save();
}

it("keeps original content across repeated decoration apply and removal", async () => {
  const base = await pageWithBody();
  const once = await applyDocumentDecorations(base, { footer: { center: "Page {page}" } });
  const twice = await applyDocumentDecorations(once, { footer: { center: "Changed {page}" } });
  const removed = await removeDocumentDecorations(twice);
  for (const bytes of [once, twice, removed]) {
    const streams = await streamsOfFirstPage(bytes);
    expect(streams.some((s) => s.includes("72 700"))).toBe(true);
  }
  expect((await streamsOfFirstPage(twice)).filter((s) => s.includes("Changed")).length).toBe(1);
  expect((await streamsOfFirstPage(removed)).some((s) => s.includes("Changed"))).toBe(false);
});

it("keeps original content across Bates apply and removal", async () => {
  const base = await pageWithBody();
  const result = await applyBatesNumbering(base, { prefix: "ABC", start: 1, digits: 6, position: "bottom-right" });
  const removed = await removeDocumentDecorations(result.bytes);
  expect((await streamsOfFirstPage(removed)).some((s) => s.includes("72 700"))).toBe(true);
});
```

Adjust the `applyBatesNumbering` option names to the existing `BatesNumberingOptions` interface at `document-commands.ts:1252`.

- [ ] **Step 2:** Run `npx vitest run tests/unit/decorations-content-safety.test.ts`; expected FAIL on the `twice` and `removed` assertions (this reproduces the executed probe).
- [ ] **Step 3: Implement the helper**

```ts
import { PDFArray, PDFDocument, PDFName, PDFOperator, PDFPage, PDFRawStream, PDFRef, PDFStream } from "pdf-lib";

export function appendTaggedStream(doc: PDFDocument, page: PDFPage, tag: string, operators: PDFOperator[]): PDFRef {
  const body = operators.map((op) => op.toString()).join("\n");
  const stream = doc.context.flateStream(body, { [tag]: true } as never);
  const ref = doc.context.register(stream);
  page.node.normalize();
  page.node.addContentStream(ref);
  return ref;
}

export function removeTaggedStreams(doc: PDFDocument, page: PDFPage, tag: string): number {
  const contents = page.node.Contents();
  if (!(contents instanceof PDFArray)) return 0;
  const keep: PDFRef[] = [];
  let removed = 0;
  for (let i = 0; i < contents.size(); i++) {
    const ref = contents.get(i) as PDFRef;
    const stream = doc.context.lookup(ref) as PDFStream | PDFRawStream | undefined;
    if (stream?.dict.get(PDFName.of(tag))) removed++;
    else keep.push(ref);
  }
  if (removed) page.node.set(PDFName.of("Contents"), doc.context.obj(keep));
  return removed;
}
```

If `flateStream` does not accept a dictionary argument in pdf-lib 1.17.1, create the stream with `doc.context.flateStream(body)` and then `stream.dict.set(PDFName.of(tag), doc.context.obj(true))` before registering.

- [ ] **Step 4:** In `applyDocumentDecorations` and `applyBatesNumbering`, replace every `page.drawText`/`page.drawRectangle` with operator construction (`pdf-lib` exports `drawText`, `drawRectangle`, `setFillingColor`, `pushGraphicsState`, `popGraphicsState`, `rotateRadians`, `translate` operator helpers) collected into one array per page, wrapped in `pushGraphicsState()` and `popGraphicsState()`, and appended through `appendTaggedStream(doc, page, "NavPDF_Decoration", ops)`.
  Register fonts on the page with `page.node.setFontDictionary(fontKey, font.ref)` and reference them by key in the operators.
  Delete the `beforeSize`/`afterSize` tagging blocks at `:1126-1127`, `:1236-1246`, `:1351-1352`, `:1362-1372`.
- [ ] **Step 5:** Rewrite `removeDocumentDecorations` to call `removeTaggedStreams(doc, page, "NavPDF_Decoration")` per page.
- [ ] **Step 6:** Run the new test and `tests/unit/decorations.test.tsx`, `tests/unit/bates-numbering.test.ts`; expected PASS.
- [ ] **Step 7:** Native check: open `reader-5.pdf` in `npm run desktop`, apply a footer, apply a different footer, remove decorations, save a copy, reopen in NavPDF and Preview; the body text must be present at every step.
  Record fixture, action, result and output hash in `VERIFICATION.md`.

### Task 1.2: Dirty state survives editor mode switches (DS-02)

**Files:**
- Modify: `src/features/viewer/controller.ts:147-175`, `:221-233`, `attach()`, `markSaved()`
- Test: `tests/unit/viewer-controller-dirty.test.ts`

**Interfaces:**
- Produces: private `storageModified: boolean` on `ViewerController`; `isDirty(): boolean` returning `this.storageModified || !this.history.isAtSavedRevision() || this.nativeCanUndo || this.nativeCanRedo`.

- [ ] **Step 1: Write the failing test** using the existing controller test harness in `tests/unit/viewer-controller.test.ts` (mocked `PDFViewer` and event bus):

```ts
it("keeps dirty after a mode switch when annotation storage was modified", async () => {
  const { controller, bus, pdf } = await attachController();
  (pdf.annotationStorage as { onSetModified: () => void }).onSetModified();
  expect(useWorkspace.getState().dirty).toBe(true);
  bus.dispatch("editingstateschanged", { details: { hasSomethingToUndo: false, hasSomethingToRedo: false, hasSelectedEditor: false } });
  expect(useWorkspace.getState().dirty).toBe(true);
  expect(markDirtyMock).not.toHaveBeenCalledWith(false);
});

it("clears dirty only after markSaved", async () => {
  const { controller, pdf } = await attachController();
  (pdf.annotationStorage as { onSetModified: () => void }).onSetModified();
  controller.markSaved();
  expect(useWorkspace.getState().dirty).toBe(false);
});
```

- [ ] **Step 2:** Run it; expected FAIL on the first assertion after dispatch.
- [ ] **Step 3:** Implement: set `this.storageModified = true` in the `onSetModified` callback; reset it to `false` in `attach()` and `markSaved()`; in the `editingstateschanged` handler replace the `dirty: false` block with `if (!this.isDirty()) { state.set({ dirty: false, status: "Ready" }); void markDirty(false).catch(() => {}); }`.
- [ ] **Step 4:** Run the full controller suite; expected PASS.
- [ ] **Step 5:** Native check: type into a field of `mixed-forms-annotations.pdf`, click Highlight, press Cmd+W; the unsaved-changes prompt must appear.

### Task 1.3: Encrypted sources are never overwritten with plaintext (DS-04, DS-05, TEST-02)

**Files:**
- Modify: `src-tauri/src/commands/mod.rs:328-450` (`save_document`), `src-tauri/src/commands/engine.rs:285-305` (`engine_save_protected`), `:321-340` (`engine_unlock`), `src-tauri/src/filesystem/mod.rs:100-106`, `:395-405`
- Test: `src-tauri/src/commands/mod.rs` tests, `src-tauri/src/filesystem/mod.rs` tests

**Interfaces:**
- Produces: `Opened.source_encrypted: Mutex<bool>` set at open when the snapshot has `/Encrypt`; `fn refuse_plaintext_overwrite(doc: &Opened, target: &Path) -> Result<(), String>`.

- [ ] **Step 1: Write the failing Rust tests**

```rust
#[test]
fn validate_pdf_rejects_real_encrypted_output() {
    let plain = minimal_pdf_bytes(1);
    let encrypted = crate::engine::protect::protect(&plain, &ProtectionRequest::user_only("pw")).unwrap();
    let err = validate_pdf(&encrypted, 1).unwrap_err();
    assert!(err.contains("encrypted"), "{err}");
}

#[tokio::test]
async fn save_refuses_plaintext_over_encrypted_source() {
    let (state, id, source_path) = open_encrypted_fixture().await;
    let doc = document(&state, &id).unwrap();
    let err = refuse_plaintext_overwrite(&doc, &source_path).unwrap_err();
    assert!(err.contains("unencrypted copy"), "{err}");
    let after = std::fs::read(&source_path).unwrap();
    assert!(lopdf::Document::load_mem(&after).unwrap().is_encrypted());
}

#[test]
fn protecting_in_place_marks_sensitive_and_removes_recovery() {
    // arrange an Opened with a recovery.pdf and working file, call the replaced_source branch, assert sensitive == true,
    // recovery.pdf and recovery.json absent, working_file None
}
```

Use the existing `minimal_pdf_bytes` helper style from `filesystem/mod.rs` tests and the existing `ProtectionRequest` constructor from `protect.rs`.

- [ ] **Step 2:** Run `cargo test --manifest-path src-tauri/Cargo.toml`; expected FAIL (functions absent).
- [ ] **Step 3:** Implement: at open, detect `/Encrypt` through `lopdf::Document::load_mem(...).is_encrypted()` on the snapshot and store `source_encrypted`.
  In `save_document`, after resolving `target`, canonicalize both paths with `std::fs::canonicalize` (fall back to the raw path when the target does not exist), and when `target == source` and (`sensitive` or `source_encrypted`) return `Err("This document was opened from an encrypted file. Choose a different name to save an unencrypted copy.")`.
  Set the picker's suggested name to `<stem>-unlocked.pdf` when `sensitive` is set.
  In `engine_save_protected`'s `replaced_source` branch set `sensitive = true`, remove `recovery.pdf` and `recovery.json`, and set `working_file = None`.
  Replace the fake `b"%PDF-1.7 encrypted"` test with the real one above.
- [ ] **Step 4:** Give `validate_pdf` an enum `ValidationError { Unparseable, Encrypted, PageCount { expected, actual } }` and map to messages at each call site (`save_document`, `commit_revision`, `print_document`) so printing never says "could not be saved" (NAT-08).
- [ ] **Step 5:** `cargo test` and `cargo clippy -D warnings`; expected PASS.
- [ ] **Step 6:** Native check with `encrypted.pdf`: unlock, choose Save unprotected copy, pick the original name, confirm Replace; NavPDF must refuse and the original must still require a password in Preview.

### Task 1.4: Deleted objects leave the file; extraction does not leak other pages (DS-03)

**Files:**
- Create: `src-tauri/src/engine/prune.rs`, `src/services/pdf/link-targets.ts`
- Modify: `src-tauri/src/commands/engine.rs` (new `engine_prune` command), `src-tauri/src/lib.rs` (register), `src/services/engine.ts` (`pruneDocument(bytes)`), `src/services/document-commands.ts:374-392`, `:344-354`, `:426-443`, `:497-571`, `:1699-1753`, `src/features/viewer/controller.ts` (call prune after delete mutations when `isNative()`), `src/features/pages/PageWorkspace.tsx`, `src/features/attachments/AttachmentsDialog.tsx` (browser-preview warning text)
- Test: `src-tauri/src/engine/prune.rs` tests, `tests/unit/link-targets.test.ts`, `tests/integration/pdf-roundtrip.test.ts`

**Interfaces:**
- Produces: Rust `pub fn prune(bytes: &[u8]) -> Result<Vec<u8>, String>` (load, `prune_objects()`, `renumber_objects()`, `compress()`, save); TS `pruneDocument(bytes: Uint8Array): Promise<Uint8Array>` via staging; TS `stripExternalPageLinks(doc: PDFDocument, keptPages: Set<number>): number` returning the count of removed or rewritten link annotations.

- [ ] **Step 1: Failing tests**

Rust:
```rust
#[test]
fn prune_drops_unreferenced_page_objects() {
    let mut doc = lopdf::Document::load_mem(&two_page_pdf()).unwrap();
    // detach page 2 from the page tree without deleting the object, mirroring pdf-lib deletePages
    detach_second_page(&mut doc);
    let mut bytes = Vec::new(); doc.save_to(&mut bytes).unwrap();
    let pruned = prune(&bytes).unwrap();
    let count = |b: &[u8]| lopdf::Document::load_mem(b).unwrap().objects.values().filter(|o| o.type_name().ok() == Some(b"Page")).count();
    assert_eq!(count(&bytes), 2);
    assert_eq!(count(&pruned), 1);
}
```

TS (`tests/unit/link-targets.test.ts`): build a two-page document where page 1 has a `/Link` with `/Dest [page2Ref /XYZ 0 0 0]` and another with an `/A << /S /GoTo /D [page2Ref /Fit] >>`; call `stripExternalPageLinks(doc, new Set([0]))`; assert both link annotations are removed from page 1 `/Annots` and that a link to page 1 itself is kept.
Integration (`pdf-roundtrip.test.ts`): extract page 1 of that document and assert the saved bytes contain exactly one `/Type /Page` dictionary.

- [ ] **Step 2:** Run both suites; expected FAIL.
- [ ] **Step 3:** Implement `prune.rs` and the `engine_prune` command using the existing staging pattern in `commands/engine.rs` (stage in, `spawn_blocking`, stage out).
  Implement `stripExternalPageLinks`: for each kept page, iterate `/Annots`, resolve `/Dest` (array, name into `/Dests` or `/Names` tree, or `/A` GoTo `/D`), map the target page ref to its index through `doc.getPages()`, and remove the annotation when the index is not in `keptPages`.
  Call it in `extractPages`, `splitDocumentWithManifest` and `mergeDocuments` before `copyPages`.
- [ ] **Step 4:** In the controller's delete paths (`deleteSelectedAnnotation`, page deletion, attachment deletion, layer removal), after the pdf-lib bytes are produced and when native is available, pass them through `pruneDocument` before `replaceWithBytes`.
  In browser preview, show the status "Deleted objects remain in the file until saved from the desktop app."
- [ ] **Step 5:** Run all suites; expected PASS.
- [ ] **Step 6:** Native check: delete page 2 of `reader-5.pdf`, save a copy, run `strings copy.pdf | grep -c "/Type /Page"` and confirm 4; extract page 1 of a fixture with a cross-page link and confirm one page object.

### Task 1.5: Layer-hidden annotations are removed with hidden content (NAT-01)

**Files:**
- Modify: `src-tauri/src/engine/redact.rs:818-885`, `:1080-1091`
- Test: `src-tauri/src/engine/redact.rs` tests

- [ ] **Step 1: Failing test:** build a document with `/OCProperties` defining group G with `/OFF [G]`, a FreeText annotation with `/OC G` and another annotation without `/OC`; run redaction with `remove_hidden_content: true`; assert the output page `/Annots` no longer contains the `/OC G` annotation, still contains the other, and the report's `hidden_annotations_removed` equals 1.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement `annotation_hidden_by_layers(doc, annot, hidden_groups) -> bool` resolving `/OC` directly or through OCMD `/OCGs` (single ref or array) and honoring `/P /AnyOn`, `/AllOn`, `/AnyOff`, `/AllOff` with `/AnyOn` default.
  Call it in `filter_annotations` before `/OCProperties` is deleted, and add `hidden_annotations_removed: usize` to the report struct and the TS `RedactionReport` type in `src/types/engine.ts`.
- [ ] **Step 4:** `cargo test`; expected PASS.
  Add the new counter to the RedactionTool result summary text.

### Task 1.6: Attachments handle indirect and nested name trees (VIEW-03)

**Files:**
- Create: `src/services/pdf/name-tree.ts`
- Modify: `src/services/document-commands.ts:1573-1631`, `:1653-1697`, `:1699-1753`
- Test: `tests/unit/attachments-name-tree.test.ts`

**Interfaces:**
- Produces: `walkEmbeddedFiles(doc: PDFDocument): Array<{ name: string; spec: PDFDict; parentNames: PDFArray; index: number }>`.

- [ ] **Step 1: Failing test:** create a document with `doc.attach(...)`, then make `/Names` indirect by `catalog.set(PDFName.of("Names"), doc.context.register(catalog.lookup(PDFName.of("Names"))))`, save, and assert `listEmbeddedAttachments` returns one entry, `extractEmbeddedAttachment` returns the bytes, and `deleteEmbeddedAttachment` returns bytes whose listing is empty.
  Add a second case with an `/EmbeddedFiles` tree using `/Kids` and assert listing finds both leaves.
  Add a third case asserting `deleteEmbeddedAttachment` rejects with "Attachment not found" for an unknown name.
- [ ] **Step 2:** Run; expected FAIL (empty list for the indirect case).
- [ ] **Step 3:** Implement the walker with `doc.context.lookup` at every hop and recursion over `/Kids`; make the three commands use it; throw on delete when nothing matched.
- [ ] **Step 4:** Run; expected PASS.
  Also add `MAX_ATTACHMENT_SIZE_BYTES` enforcement to `extractEmbeddedAttachment` and strip Unicode bidi controls (U+202A to U+202E, U+2066 to U+2069) in `sanitizeAttachmentFilename` (VIEW-17).

### Task 1.7: Signature library tolerates bad assets and labels storage honestly (NAT-02, DLG-04)

**Files:**
- Modify: `src-tauri/src/signatures/mod.rs:61-67`, `:72-99`, `:179-182`; `src/services/signature-store.ts`; `src/types/operations.ts` (`SavedSignature`); `src/features/signatures/FillAndSign.tsx:462-493`; `src/services/native.ts` (browser fallback)
- Test: `src-tauri/src/signatures/mod.rs` tests, `tests/unit/signature-store.test.ts`, `tests/unit/fill-and-sign.test.tsx`

- [ ] **Step 1: Failing tests:** Rust: write one valid v2 asset and one file of random bytes into the signature directory; assert `list()` returns the valid asset and a `warnings` vector with one entry.
  Rust: `save()` with `asset_type: "bogus"` returns an error.
  TS: `fetchSignatureLibrary()` returns `storage: "legacy"` for localStorage items and `storage: "secure"` for native items; the FillAndSign card for a legacy item renders text "Unprotected" and no lock badge.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement: change `list()` to return `LibraryListing { assets: Vec<SavedSignature>, warnings: Vec<String> }` collecting per-file errors as "One saved signature could not be read." without the path; when a legacy upgrade rewrite fails, return the decrypted asset and add a warning.
  Add `storage: "session" | "secure" | "legacy"` to `SavedSignature` and set it in `signature-store.ts` and `native.ts`.
  Render the badge from `storage`.
- [ ] **Step 4:** Run; expected PASS.
  Show `warnings` in the library panel as a non-blocking notice.

### Task 1.8: Session flags, autosave, statusbar and save-and-continue (DS-06, DS-07, DS-10, DS-11, DS-14)

**Files:**
- Modify: `src/app/useDocumentSession.ts:88-136`, `:170-232`, `:310-338`, `:382-388`; `src/app/App.tsx:68-72`, `:201`; `src/app/Toolbar.tsx:348`; `src/stores/workspace.ts`
- Test: `tests/unit/document-session-flows.test.ts`, `tests/unit/app-shell.test.tsx`

- [ ] **Step 1: Failing tests:**
  - `session.load` on a document whose mocked `attach` sets `hasDigitalSignature: true`, `formNotice: "XFA"`, `comments: [c]`: after load the store still has all three.
  - Autosave tick while `busy` is already true: `writeRecovery` is not called and `busy` stays true.
  - Autosave tick on an idle dirty document: `busy` remains false throughout and `status` returns to its previous value, not the literal "Unsaved changes".
  - Statusbar renders the text of `s.status` when `dirty` is true and `busy` is false.
  - `saveAndContinue` with `info.protectedSource`: the confirm dialog is closed (`confirm === null`) and `activeModal === "protect"`.
  - A failed Save on a clean document leaves `dirty` false.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement: capture `{ hasDigitalSignature, formNotice, comments }` from `useWorkspace.getState()` before `reset()` and pass them into the post-reset `set`; render `formNotice` as a dismissible banner next to the existing error banner in `App.tsx`.
  In the autosave interval, return early when `state.busy || lock.current`, do not set `busy`, set `status: "Saving recovery copy..."` and restore the previous status in `finally`.
  Change the statusbar expression to `s.status` and keep the dirty indicator in the title bar.
  In `saveAndContinue`, call `setConfirm(null)` before invoking `save()`.
  In `save()`'s failure branch restore the captured `dirty`.
- [ ] **Step 4:** Run; expected PASS.
- [ ] **Step 5:** Native check: open a signed fixture and confirm the redaction acknowledgement shows; type in a FreeText note for 30 seconds and confirm no focus loss.

### Task 1.9: Recovery keyed by document (DS-08, DS-09)

**Files:**
- Create: `src-tauri/src/commands/recovery.rs`
- Modify: `src-tauri/src/commands/mod.rs:424-425`, `:622-655`; `src/services/native.ts` (`RecoveryEntry[]`); `src/app/Home.tsx`; `src/app/useDocumentSession.ts:128`
- Test: `src-tauri/src/commands/recovery.rs` tests, `tests/unit/document-session-flows.test.ts`

**Interfaces:**
- Produces: `recovery/<document_id>.pdf` plus `recovery/manifest.json` (`[{ id, display_name, pages, saved_at }]`); commands `list_recovery() -> Vec<RecoveryEntry>`, `open_recovery(id)`, `discard_recovery(id)`; `write_recovery` writes only its own id; a successful save removes only its own entry.

- [ ] **Step 1: Failing Rust tests:** two documents write recovery; saving A leaves B's entry; `discard_recovery(A)` leaves B; `list_recovery` orders by `saved_at` descending; a sensitive document never creates an entry.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement the module, migrate the legacy single `recovery.pdf` into the manifest on first read, update the frontend to list entries on Home, and remove the unconditional `discardRecovery()` at `useDocumentSession.ts:128`.
- [ ] **Step 4:** Run Rust and frontend suites; expected PASS.
- [ ] **Step 5:** Native check: force-quit with unsaved A, open B from recents, confirm Home still offers A.

**Tranche 1 checkpoint:** run the full command list from Global constraints; rebuild the bundle; record the executable hash and the native checks in `VERIFICATION.md`; commit only when authorized.

---

## Tranche 2: mutation correctness and geometry

### Task 2.1: Serialize mutations and commit property edits per gesture (VIEW-01, VIEW-09)

**Files:**
- Create: `src/services/mutation-queue.ts`
- Modify: `src/features/viewer/controller.ts:331-416`, `:744-767`, all `readComments()` callers listed in VIEW-09; `src/features/annotations/Properties.tsx:42-136`
- Test: `tests/unit/mutation-queue.test.ts`, `tests/unit/annotation-ui.test.tsx`

**Interfaces:**
- Produces: `class MutationQueue { run<T>(label: string, fn: () => Promise<T>): Promise<T>; get pending(): number }` executing strictly in order; `ViewerController.mutate(label, fn)` wraps `run` and sets `busy` once for the whole queue.

- [ ] **Step 1: Failing tests:** queue runs three async functions sequentially (record start/end order); `updateSelectedAnnotation` called twice concurrently results in two sequential `saveDocument` calls with the second starting after the first `replaceWithBytes` resolves; the Properties opacity slider fires `updateSelectedAnnotation` once on `pointerup` after five `input` events; the note textarea keeps typed characters while a mutation is pending.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement the queue; route `applyAnnotationEdit`, `moveSelectedAnnotation`, `resizeSelectedAnnotation`, `deleteSelectedAnnotation`, `addStickyNote`, `addShape`, `addTextMarkup` and page operations through it; remove redundant `readComments()` calls and pass pre-mutation bytes into `replaceWithBytes` for history adoption; convert Properties inputs to local state committed on `pointerup`, `change` or `blur`.
- [ ] **Step 4:** Run; expected PASS.

### Task 2.2: Rotation and box-aware placement everywhere (VIEW-04, DLG-05, DLG-06)

**Files:**
- Create: `src/services/pdf/page-box.ts`
- Modify: `src/services/document-commands.ts:69-83`, `:148-151`, `:193-211`, `:281-318`, `:480-495`, `:723-726`, `:883-948`, `:965-1016`; `src/features/viewer/controller.ts:540-552`; `src/features/signatures/FillAndSign.tsx:205-240`; `src/features/forms/FormManager.tsx:59-60`; `src/features/editor/LinkDialog.tsx:40-45`; `src/features/editor/ContentEditor.tsx:51-52`; `src/features/pages/PageWorkspace.tsx:225-230`
- Test: `tests/unit/page-box.test.ts`, `tests/integration/pdf-roundtrip.test.ts`
- Fixture: add `rotated-offset.pdf` to `scripts/create-fixtures.mjs` with pages `[/Rotate 0, MediaBox [0 0 612 792]]`, `[/Rotate 90]`, `[/Rotate 270, MediaBox [100 100 712 892]]`, `[/Rotate 180, CropBox [50 50 562 742]]`.

**Interfaces:**
- Produces: `visibleBox(page: PDFPage): { x: number; y: number; width: number; height: number; rotation: 0|90|180|270 }` (CropBox intersected with MediaBox), `clampRectToBox(rect, box)`, `fromTopLeftVisual(page, xVisual, yVisual, w, h): { x, y, width, height }` mapping a rectangle expressed in the displayed (rotated) orientation with y measured from the top into user-space coordinates.

- [ ] **Step 1: Failing tests:** for each of the four fixture pages, `fromTopLeftVisual(page, 10, 10, 100, 20)` returns a rectangle fully inside `visibleBox`, and mapping the visual corners for 90 and 270 swaps width and height; `addStickyNote` default position on the 270 page lands inside the visible box; `cropPages` on the offset page keeps the requested visual area; `insertTextContent` at `y: 700` on a 612 pt tall page clamps inside the box; `addFormField`, `addLinkAnnotation` and FillAndSign placement on the 90 page produce `/Rect` inside the visible box (inspect saved bytes with pdf-lib).
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement `page-box.ts`; replace every `page.getSize()`-based clamp with `visibleBox`; compute the sticky-note default with `viewport.convertToPdfPoint(48, 48)`; expose X and Y position inputs (visual, from top-left) in ContentEditor, FormManager and LinkDialog using the same mapping.
- [ ] **Step 4:** Run; expected PASS.
- [ ] **Step 5:** Native check with `rotated-offset.pdf`: place a signature, a field, a link and a note on each page, save, and confirm positions match in Preview.

### Task 2.3: Annotation fidelity: arrows, line rects, popups, identity, metadata (VIEW-05, VIEW-06, VIEW-08, VIEW-11, VIEW-17)

**Files:**
- Modify: `src/services/document-commands.ts:105-116`, `:153-164`, `:207-231`, `:246-271`, `:294-318`, `:344-354`; `src/features/viewer/controller.ts:699-720`, `:778-819`, `:1009-1032`; `src/types/document.ts:57-67`; `src/services/comment-exchange.ts:3-11`
- Test: `tests/unit/document-commands.test.ts`, `tests/unit/comment-exchange.test.ts`

- [ ] **Step 1: Failing tests:** an arrow drawn right-to-left keeps `/LE [/None /OpenArrow]` order and `/L` endpoints after `updateAnnotation({ dx: 10 })`; a 12 pt line's `/Rect` after move has margin `>= 6 + arrowheadSize`; deleting a Text annotation that has `/Popup` removes the popup and any annotation whose `/IRT` points to it; `annotationIdentifier("12R1")` resolves object 12 generation 1 and `annot_7` resolves the seventh direct annotation on the page; duplicate `/NM` values on two pages resolve on the comment's page only; new annotations carry `/P`, `/M`, `/CreationDate` and Text notes carry `/Popup`; exchange JSON carries `kind: "Arrow"`, `lineEndings` and `quads` for highlights (VIEW-14 in the review, `quads` in the model).
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement each behavior; extend `Comment` with `lineEndings?: [string, string]`, `line?: [number, number, number, number]`, `quads?: number[][]`; import rebuilds highlights from quads.
- [ ] **Step 4:** Run; expected PASS.
  Native check: nudge an arrow twice and confirm the head stays put in Preview.

### Task 2.4: Comment exchange keyed by content identity (VIEW-02)

**Files:**
- Create: `src/services/document-identity.ts`
- Modify: `src/features/viewer/controller.ts:650-651`; `src/services/comment-exchange.ts`
- Test: `tests/unit/comment-exchange.test.ts`

- [ ] **Step 1: Failing test:** export comments from a loaded fixture, reload the same bytes under a new `document.id`, import; expected success and the same comment count; import into a different fixture fails with the existing message.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement `contentIdentity(pdf)` as `sha256(firstTrailerId ?? "") + ":" + numPages` using `pdf.getMetadata()`'s `info.ID` when present, else the native snapshot hash exposed through `DocumentInfo`; write `identity` into the exchange schema (version 2) and accept version 1 files only when the page count matches, with a warning.
- [ ] **Step 4:** Run; expected PASS.

### Task 2.5: Editor state correctness (VIEW-07, VIEW-10, VIEW-12, VIEW-13)

**Files:**
- Modify: `src/features/viewer/controller.ts:93`, `:391-400`, `:527-533`, `attach()`; `src/features/viewer/Thumbnails.tsx:45`, `:73-75`; `src/features/annotations/AnnotationToolbar.tsx:37-40`; `src/stores/workspace.ts` (`revision: number`, `editingAllowed: boolean`)
- Test: `tests/unit/viewer-controller-extra.test.ts`, `tests/unit/thumbnails.test.tsx`, `tests/unit/annotation-ui.test.tsx`

- [ ] **Step 1: Failing tests:** `attach()` resets `nativeCanUndo`/`nativeCanRedo`; `replaceWithBytes` increments `revision` and Thumbnails re-render with the new proxy; a worker-destroyed error during thumbnail render leaves no "Preview unavailable" text; when `getPermissions()` lacks `MODIFY_CONTENTS`, `editingAllowed` is false, the toolbar buttons are disabled with a notice and `setTool("highlight")` does not throw; `setColor("#ff0000")` while `tool === "draw"` dispatches `INK_COLOR`, and width and opacity changes dispatch `INK_THICKNESS` and `INK_OPACITY`.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement; read `pdf.getPermissions()` in `attach()`; map the store `inkWidth`/`inkOpacity` to editor params.
- [ ] **Step 4:** Run; expected PASS.
  Native check with an owner-restricted fixture generated by `protect.rs` (add `restricted.pdf` to the special fixtures).

### Task 2.6: Text safety in decorations, tokens and OCR layer (VIEW-14, VIEW-15, VIEW-16)

**Files:**
- Modify: `src/services/document-commands.ts:1101-1119`, `:1150-1231`, `:1306`, `:1323`, `:1762-1810`, `:1866-1939`; `src/features/design/DesignTools.tsx:44-132`; `src/features/decorations/DecorationsDialog.tsx:118-142`; `src/features/ocr/OcrPanel.tsx`
- Test: `tests/unit/decorations.test.tsx`, `tests/unit/ocr-searchable-layer.test.ts`, `tests/unit/design-tools.test.tsx`

- [ ] **Step 1: Failing tests:** a title `"$& $1 $$"` appears literally in the footer stream; a footer containing `"日本"` rejects with the coverage message before any pdf-lib call; a cover title with an unsupported glyph shows the same message; the OCR layer stream begins with `q 1 0 0 1 0 0 cm` and ends with `Q`; `detectExistingText` returns true for a page whose only text lives in a Form XObject; `OcrPanel` renders a disabled state with "Unlock the document before adding OCR text" when `info.encrypted`.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement with replacer functions, shared `validateStandardFontCoverage` calls, `q`/`cm`/`Q` wrapping through `appendTaggedStream` from Task 1.1 with tag `NavPDF_OCR`, XObject recursion in `detectExistingText`, and the encrypted guard.
- [ ] **Step 4:** Run; expected PASS.

### Task 2.7: Engine hardening (NAT-03, NAT-04, NAT-05, NAT-15, DS-12)

**Files:**
- Modify: `src-tauri/src/engine/redact.rs:1113-1259`; `src-tauri/src/engine/images.rs:37-47`; `src-tauri/src/engine/content.rs:436-483`; `src-tauri/src/engine/sign.rs:253`; `src-tauri/src/commands/mod.rs` (`Opened.pending_audit: Mutex<Option<AuditSpec>>`), `src-tauri/src/commands/engine.rs:198-205`
- Test: `src-tauri/src/engine/redact.rs`, `images.rs`, `compress.rs`, `sign.rs`, `commands/mod.rs` tests

- [ ] **Step 1: Failing tests:** peak allocation in the term audit stays under 2x the largest stream for a document with 50 streams of 4 MB (measure with a counting allocator in the test or assert the audit function signature streams via an iterator); an image with `/Mask [0 0 0 0 0 0]` is refused for re-encoding with the message "color-key masked images are not re-encoded"; a page whose font has `code_length: None` within a region returns a `Rejected` audit rather than an estimate; signing a document whose `startxref` does not match the actual xref offset returns an error; `save_document` re-runs the audit when `pending_audit` is set and refuses when a term reappears.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement streaming term checks, the mask refusal, the rejection path, the xref check, and the save-time re-audit (cleared after a successful save).
- [ ] **Step 4:** `cargo test`, `cargo clippy -D warnings`; expected PASS.
  Re-run `node scripts/phase7-acceptance.mjs`; expected 55 of 55 plus the new checks.

**Tranche 2 checkpoint:** full check list, rebuild, native placement and redaction checks recorded, commit when authorized.

---

## Tranche 3: dialog robustness and accessibility

### Task 3.1: Shared FeatureDialog with Escape, initial focus and busy state (DLG-01, DLG-08)

**Files:**
- Create: `src/components/FeatureDialog.tsx`
- Modify: all 18 dialogs listed in DLG-01 to render through it (one dialog per step, each step runs the suite)
- Test: `tests/unit/feature-dialog.test.tsx`, plus one Escape assertion added to each existing dialog test

**Interfaces:**
- Produces: `<FeatureDialog title onClose busy={boolean} initialFocusRef? footer={ReactNode}>{children}</FeatureDialog>` rendering `role="dialog" aria-modal="true" aria-labelledby aria-busy`, calling `onClose` on Escape unless `busy`, focusing `initialFocusRef` or the first focusable element on mount, and restoring focus on unmount.

- [ ] **Step 1: Failing tests:** Escape calls `onClose`; Escape while `busy` does not; focus lands on the initial ref on mount and returns to the opener on unmount; `aria-busy` reflects `busy`.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement using `installModalFocus` internally so the trap logic stays in one place.
- [ ] **Step 4:** Migrate dialogs in this order, running the suite after each: FormManager, FillAndSign, CertificateSignature, CreatePdfDialog, PrintDialog, ContentEditor, ObjectEditor, LinkDialog, DecorationsDialog, OcrPanel, ExportDialog, OfficeExport, ProtectDialog, CompressDialog, AssistantPanel, AttachmentsDialog, DesignTools, then RedactionTool's side panel receives focus on open.
- [ ] **Step 5:** Add `useId`-based `htmlFor` to every `<label className="setting-title">` touched during migration.

### Task 3.2: One page-range parser and safe numeric inputs (DLG-03, DLG-07)

**Files:**
- Create: `src/features/pages/page-range.ts` (move from `print-range.ts`, keep a re-export), `src/components/PageNumberInput.tsx`
- Modify: `src/features/decorations/DecorationsDialog.tsx:59-79`, `:502`; `src/features/pages/PageWorkspace.tsx:236-256`; `src/features/pages/CreatePdfDialog.tsx:186-188`; `src/features/forms/FormManager.tsx:41`; `src/features/editor/ContentEditor.tsx:122`; `src/features/editor/LinkDialog.tsx:110`, `:154`; `src/features/signatures/FillAndSign.tsx:674`; `src/features/convert/OfficeExport.tsx` (add range control)
- Test: `tests/unit/page-range.test.ts`, `tests/unit/decorations.test.tsx`, `tests/unit/page-workspace-extra.test.tsx`

- [ ] **Step 1: Failing tests:** `parsePageRange("99", 10)` throws "No pages match"; Decorations with custom range "99" shows that message inline and never calls `replaceWithBytes`; the Apply button reads "Apply to 3 Pages" for a custom range of three pages; Split with `"3-"` throws "Incomplete range"; Split sets `busy` and the button is disabled while running; CreatePdf with 0 or 51 pages disables Create; clearing a `PageNumberInput` yields the current page, never `NaN`.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement and wire.
- [ ] **Step 4:** Run; expected PASS.

### Task 3.3: Busy guards, cancellation and bounds (DLG-07, DLG-10)

**Files:**
- Modify: `src/features/compress/CompressDialog.tsx:91-104`, `:210`; `src/features/convert/ExportDialog.tsx:99-186`, `:340-349`; `src/features/signatures/FillAndSign.tsx:157-185`; `src/features/attachments/AttachmentsDialog.tsx:34-40`, `:158`; `src/features/editor/ObjectEditor.tsx:52-92`
- Test: `tests/unit/phase7-dialogs.test.tsx`, `tests/unit/export-hardening.test.tsx`, `tests/unit/fill-and-sign.test.tsx`, `tests/unit/safe-links-attachments.test.tsx`

- [ ] **Step 1: Failing tests:** double-clicking Apply Compressed Version calls `replaceWithBytes` once; Export exposes an enabled Cancel during a run and stops after the current page; an export page whose pixel area exceeds 32 megapixels is refused with a message instead of allocating; a `toDataURL` failure surfaces an error and downloads nothing; importing a corrupt image in Fill & Sign shows "The image could not be read"; an image larger than 4096 px is scaled through the shared `decodeImageFile`; an attachments listing failure renders "Attachments could not be read"; `inspectPage` is called once per edit in ObjectEditor.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement with `applying` flags, a `cancelled` ref, `MAX_EXPORT_PIXELS = 32 * 1024 * 1024`, `img.onerror`, error state, and a revision-keyed scan effect.
- [ ] **Step 4:** Run; expected PASS.

### Task 3.4: Fill & Sign styling, keyboard operation and toolbar semantics (DLG-02, DLG-08, APP-05)

**Files:**
- Create: `src/components/SegmentedControl.tsx`
- Modify: `src/styles.css` (new `.sig-*` rules), `src/features/signatures/FillAndSign.tsx:389-425`, `:453-457`; tab rows in FormManager, OcrPanel, ExportDialog, LinkDialog, DecorationsDialog, DesignTools, CreatePdfDialog; `src/app/Toolbar.tsx:58-89`, `:214-226`, `:363`; `src/app/App.tsx:217-222`
- Test: `tests/unit/fill-and-sign.test.tsx`, `tests/unit/segmented-control.test.tsx`, `tests/unit/app-shell.test.tsx`

- [ ] **Step 1: Failing tests:** signature cards are `<button aria-pressed>` and Space selects one, after which "Place Signature" is in the document; `SegmentedControl` renders `aria-pressed` on the active option and moves with arrow keys; toolbar mode buttons use `aria-pressed` and no `role="tablist"`; the page input keeps a partially typed value when `page` changes and commits on Enter; only one live region announces status.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement; write CSS for `.signature-library`, `.sig-list`, `.sig-card`, `.sig-card[aria-pressed="true"]`, `.sig-canvas`, `.signature-draw-pad`, `.pad-toolbar`, `.type-preview`, `.quick-marks-grid`, `.mark-card`, `.empty-message-box` using the existing design tokens in `styles.css`; set `tool: "signature"` when opening Fill & Sign and call `controller.setTool("snapshot")` for Snapshot.
- [ ] **Step 4:** Run; expected PASS.
  Native check: operate Fill & Sign entirely with the keyboard and inspect the rendered library visually.

### Task 3.5: Honest copy (DLG-09, DOC-05 wording)

**Files:**
- Modify: `src/features/tools/ToolPanel.tsx:65`, `:92`, `:110`, `:128`, `:137`, `:164`, `:285`, `:354-361`; `src/features/design/DesignTools.tsx:138`, `:149`, `:154`; `src/features/ocr/OcrPanel.tsx:235`, `:316-320`; `src/app/Settings.tsx:111-114`
- Test: `tests/unit/tool-panel.test.tsx`, `tests/unit/ocr-ui.test.tsx`

- [ ] **Step 1: Failing tests:** ToolPanel text does not contain "or images" for Combine, "image watermark", "resize and position controls" or "Generate"; the OCR badge renders "Offline" only when `engineInfo.isOffline` is true; language options render display names through `Intl.DisplayNames` with the code as a fallback; the network setting renders as plain text "Network access is disabled by the application policy."
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Rewrite copy to match capability; rename the panel id `ai-summary` to `find-passages`.
- [ ] **Step 4:** Run; expected PASS.

### Task 3.6: Office export data typing and range (DLG-07 ooxml, OfficeExport)

**Files:**
- Modify: `src/features/convert/ooxml.ts:308-318`; `src/features/convert/OfficeExport.tsx:142-143`, `:197-247`
- Test: `tests/unit/office-export.test.ts`

- [ ] **Step 1: Failing tests:** `cellValue("2024-13-01")` is a string cell; `cellValue("007")` and `cellValue("0123456789")` are string cells; `cellValue("0")` and `cellValue("0.5")` are numeric; OfficeExport renders a page-range control and passes the parsed range to the exporter.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement month range check and a leading-zero guard; add the range control using `parsePageRange`.
- [ ] **Step 4:** Run; expected PASS.
  Re-run `node scripts/phase8-acceptance.mjs`.

### Task 3.7: Native IPC and command hygiene (NAT-06, NAT-07, NAT-08, NAT-11, NAT-12, NAT-14, DS-13)

**Files:**
- Modify: `src-tauri/src/commands/mod.rs:482-539`, `:705-732`, `:890-897`; `src-tauri/src/commands/engine.rs:2`, `:321-340`, `:346-380`, `:427`; `src-tauri/src/engine/edit.rs:380-383`; `src-tauri/src/engine/protect.rs:97-111`; `src-tauri/src/signatures/mod.rs:72-99`; `src-tauri/Cargo.toml` (add `zeroize`); `src/services/native.ts:241-252`
- Test: Rust unit tests per change; `tests/unit/native-tauri.test.ts`

- [ ] **Step 1: Failing tests:** `ocr_recognize_page` accepts a raw body and `x-ocr-options` header (TS test asserts `invoke` receives a `Uint8Array` body); `get_revision` and the signature commands are `async` (compile-time; add a test that `commit_revision` validation happens before the lock by asserting lock hold time under a mocked slow validator, or restructure so the lock scope is a separate function with its own test); a `"` operator with one operand returns `Err`, not a panic; `save("bogus", ...)` errors; canonicalized same-path comparison treats a symlink to the source as the source.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement; wrap passwords in `Zeroizing<String>`; correct the header comment in `commands/engine.rs:2`.
- [ ] **Step 4:** `cargo test`, `cargo clippy -D warnings`; expected PASS.

### Task 3.8: Shell robustness (APP-01, APP-02, APP-03, APP-06)

**Files:**
- Create: `src/components/RootErrorBoundary.tsx`
- Modify: `src/main.tsx:8`; `src/app/App.tsx:65-177`; `src/app/useDocumentSession.ts:45-65`, `:154`, `:245-256`, `:302`, `:360-389`; `src/components/Dialog.tsx:15-19`; `src/services/native.ts:77-83`; `src/services/signature-store.ts:119-125`
- Test: `tests/unit/app-shell.test.tsx`, `tests/unit/document-session.test.ts`, `tests/unit/root-error-boundary.test.tsx`

- [ ] **Step 1: Failing tests:** `listen` is called once across ten store updates; a second `open()` while the picker is pending returns without a second `openDocument` call and reports "Open is already in progress"; `load()` hitting the lock branch reports a message; a thrown render error inside the workspace renders the boundary with a "Save a copy" button that calls `saveDocument` on the current proxy; a range-read failure reports exactly once; corrupt preferences JSON falls back to defaults; the password dialog focuses the password input after `showModal`.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement with refs for controller and session, a `pendingOpen` ref, `useMemo` for the session object, a `failedDuringLoad` flag, guarded `JSON.parse`, and stable ids for legacy signatures (derive from a hash of the image data).
- [ ] **Step 4:** Run; expected PASS.

**Tranche 3 checkpoint:** full check list, rebuild, keyboard-only walkthrough of every dialog recorded, commit when authorized.

---

## Tranche 4: tests, CI and documentation integrity

### Task 4.1: Remove hollow tests and assert on artifacts (TEST-01, TEST-03)

**Files:**
- Modify: `tests/unit/app-extra.test.tsx:189-232`; `tests/unit/dialogs-extra.test.tsx:232-425`; `tests/unit/viewer-host.test.tsx:68-72`; `tests/unit/viewing.test.ts:78-93`; the mock-only tests listed in TEST-03
- Create: `tests/helpers/inspect-pdf.ts`

**Interfaces:**
- Produces: `lastReplacedBytes(mock): Uint8Array`, `loadWithPdfLib(bytes)`, `loadWithPdfJs(bytes)`, `pageTextItems(pdf, pageIndex)`, `annotationsOfPage(doc, pageIndex)`.

- [ ] **Step 1:** For each zero-assertion test add the assertion the test name implies (for example the Print test asserts `printDocument` received the current document id and the parsed range), or delete the test if the behavior is covered elsewhere.
  Delete the tautological outline test at `viewing.test.ts:78-93`.
- [ ] **Step 2:** For each mock-only mutation test, load the bytes passed to `replaceWithBytes` and assert the artifact: footer text tokens substituted with the page number, watermark text present with the requested opacity `gs`, page order after drag equals the expected sequence of original page indices (mark pages with distinct text), signature XObject placed inside the target rectangle, export text in reading order, PNG dimensions equal DPI scaling.
- [ ] **Step 3:** Run `npm run test:coverage`; thresholds must still pass; if a file's coverage drops because a hollow test was removed, add a real test for that path rather than lowering thresholds.

### Task 4.2: Fixture hooks and test hygiene (TEST-04, TEST-07)

**Files:**
- Modify: `package.json` (done in 0.1), `tests/setup.ts`, `tests/unit/annotation-ui.test.tsx:290-357`, `tests/unit/export-convert.test.tsx:146-173`, `tests/unit/viewer-controller-extra.test.ts:127-221`, `tests/unit/viewer-ui.test.tsx:183-191`, `tests/unit/native-tauri.test.ts:60-98`, `tests/integration/*.test.ts`

- [ ] **Step 1:** Add a `tests/helpers/fixtures.ts` `requireFixture(name)` that throws "Run `npm run fixtures` first" when the file is missing; use it in every integration test and `pdf-transport.test.ts`.
- [ ] **Step 2:** Move every `global.fetch`, `navigator.clipboard`, `URL.createObjectURL` reassignment into `beforeEach` with `vi.stubGlobal` and rely on `vi.unstubAllGlobals` in `afterEach`; move `vi.useFakeTimers()` into `beforeEach` and `vi.useRealTimers()` into `afterEach`.
- [ ] **Step 3:** Extend the save IPC test to assert `x-page-count` and `x-document-id` headers.
  Add `test: { testTimeout: 20000 }` for `tests/integration/**` through a Vitest workspace or a per-file `vi.setConfig({ testTimeout: 20000 })` so the PDF.js decrypt test (TEST-08) is not load-sensitive.
- [ ] **Step 4:** Run the suite three times with `--sequence.shuffle`; expected PASS each time.

### Task 4.3: Rust lifecycle tests and honest OCR corpus (TEST-05, TEST-06)

**Files:**
- Modify: `src-tauri/src/commands/mod.rs` tests, `src-tauri/src/engine/redact.rs` tests, `src-tauri/src/engine/compress.rs` tests, `src-tauri/src/filesystem/mod.rs` tests; `scripts/ocr-native-acceptance.mjs`; `tests/pdf-fixtures/ocr-evaluation-corpus.json`; `scripts/create-fixtures.mjs:150-155`; `tests/unit/ocr-corpus.test.ts`

- [ ] **Step 1:** Add Rust tests: `save_document` Save versus Save As decision (existing different target takes the fingerprint branch, new target takes no-clobber), recents and dirty updates after save, `write_recovery` content and page count, `open_recovery` and `discard_recovery`, `read_range` rejects `end > length` and `end - begin > 4 MB`, `remove_comments: true` removes `/Annots` markup, `remove_bookmarks: true` removes `/Outlines`, compress discards output when a fidelity check fails, and the mid-save external change at `filesystem/mod.rs:158-162` aborts and leaves no temp file.
- [ ] **Step 2:** Make the corpus real: regenerate `expectedBoxes` from the actual draw positions in `create-fixtures.mjs`, add true multi-column and table samples, and have `ocr-native-acceptance.mjs` compute WER and CER against the corpus and compare with `acceptanceThresholds`, writing `output/ocr-review/corpus-report.json`.
  Update `ocr-corpus.test.ts` to validate the corpus schema and box geometry against the generator.
- [ ] **Step 3:** Run `cargo test` and the acceptance script on macOS; record WER and CER in `VERIFICATION.md`.

### Task 4.4: Acceptance scripts and hosted analysis (CI-03, CI-05, CI-06, CI-07)

**Files:**
- Modify: `package.json` (scripts `acceptance:phase7`, `acceptance:phase8`, `acceptance:phase10`, `acceptance:ocr`, `acceptance:licenses`, `acceptance:check-tools`), `scripts/check-tools.mjs` (new), `.github/workflows/ci.yml`, `sonar-project.properties`, `tsconfig.json` (add `tsconfig.test.json` and `"references"`), `eslint.config.js`

- [ ] **Step 1:** Write `scripts/check-tools.mjs` that reports presence and version of `pdftotext`, `pdftoppm`, `pdfimages`, `pdfsig`, `openssl`, `certutil`, `textutil`, `python3` and exits non-zero listing what is missing.
- [ ] **Step 2:** Run `acceptance:phase8` in the Linux CI job (pure Node) and `acceptance:phase7` and `acceptance:phase10` in the macOS job after `brew install poppler nss`.
- [ ] **Step 3:** Either fill `sonar.projectKey`/`sonar.organization` and add the token as a repository secret, or delete `sonar.yml` and `sonar-project.properties`; record the decision in `DELIVERY-PHASES.md` Phase 9.
- [ ] **Step 4:** Add `tsconfig.test.json` covering `tests/**` and include it in `npm run typecheck`; switch ESLint to `typescript-eslint` `recommendedTypeChecked` for `src/` and fix resulting findings.

### Task 4.5: Documentation reconciliation (DOC-01 through DOC-05, CI-04, DS-15, NAT-14, NAT-15)

**Files:**
- Modify: `docs/DELIVERY-PHASES.md`, `docs/VERIFICATION.md`, `docs/HANDOFF.md`, `docs/phases/03-forms-fill-sign.md`, `04-pages-mutations.md`, `06-ocr-exports.md`, `README.md`, `ARCHITECTURE.md`, `CLAUDE.md` and `AGENTS.md` (identically), `docs/adr/0005-local-ocr-engine.md`, `docs/adr/0004-page-mutation-engine.md`, `docs/adr/README.md`, `tests/pdf-fixtures/README.md`
- Create: `docs/adr/0011-pdf-lib-maintenance-and-exit.md`

- [ ] **Step 1:** In every reopened phase section replace "Phase N is complete" with "Phase N is reopened; see PR-2-REVIEW.md" and uncheck the gates that PR-2 reopened (P3.2, P3.4, P3.6, P4.1, P4.6, P6.1 through P6.6) and the scanner acquisition checkbox.
- [ ] **Step 2:** Delete or mark withdrawn the "AES/CTR + HMAC", "deterministic Portable OCR engine", "portable fallback" and "scored OCR evaluation corpus" sentences and replace with the current mechanism in one sentence each.
- [ ] **Step 3:** Rewrite `ARCHITECTURE.md` sections "PDF editing strategy", "Undo and redo", "OCR strategy", "Security and privacy", "Library decisions" and "Known milestone limitations" to describe the current engine set (lopdf engine modules, Apple Vision, Keychain AES-GCM, PAdES B-B signing, pdf-lib writers) with the adopted crates in the table; move the Phase 1 text into a dated "History" section.
- [ ] **Step 4:** Update `HANDOFF.md` to the merged state at `4f667c1`, one current executable hash, and "Next task: Tranche 1 of IMPLEMENTATION-PLAN-2026-09-14.md".
  Reconcile the 410 versus 406 counts to the current run.
  Replace missing `tests/pdf-fixtures/phase*` artifact references with "artifact not retained; hash recorded" wording.
- [ ] **Step 5:** Update the CLAUDE.md repository map to include `src/components/`, `src/types/`, `src/utils/`, `src-tauri/src/engine/`, `src-tauri/src/ocr/`, `src-tauri/src/signatures/`, `src-tauri/src/logging/`, cite `PR-2-REVIEW.md` and `REVIEW-2026-09-14.md` in "Start here", copy to AGENTS.md, run `cmp AGENTS.md CLAUDE.md`.
- [ ] **Step 6:** Write ADR 0011 recording pdf-lib's status, the defects attributable to it (DS-01, DS-03), and the decision: keep pdf-lib for annotation and form writers behind the new `src/services/pdf/` helpers, route deletions through the native prune, and evaluate moving decorations and OCR layers to the Rust engine in Tranche 6.
  Bring ADR 0005 to the template, fix the `AppleVisionEngine` reference, and annotate ADR 0004's PDFium deferral as superseded by ADR 0006.
- [ ] **Step 7:** Record the 0600 new-file mode decision, the Keychain ad-hoc signing limitation and the signing-time-before-picker note in `VERIFICATION.md` limitations.
- [ ] **Step 8:** Run `git diff --check` and `cmp AGENTS.md CLAUDE.md`; grep authored docs for the em dash character and expect zero hits outside `PRODUCT-SPEC.txt`.

**Tranche 4 checkpoint:** full check list, CI green on a branch when authorized, docs cross-checked line by line against `PR-2-REVIEW.md`.

---

## Tranche 5: specification gaps

Each task below is scoped to one user-visible capability with its own regression and native acceptance row.

### Task 5.1: Document properties and metadata editing (spec §1.37, §24)

**Files:**
- Create: `src/features/document/PropertiesDialog.tsx`, `src/services/pdf/metadata.ts`
- Modify: `src/features/tools/ToolPanel.tsx`, `src-tauri/src/lib.rs` (File menu item "Properties..."), `src/app/App.tsx` (menu routing)
- Test: `tests/unit/properties-dialog.test.tsx`, `tests/integration/pdf-roundtrip.test.ts`

**Interfaces:**
- Produces: `readMetadata(bytes): Promise<DocumentMetadata>` and `writeMetadata(bytes, meta): Promise<Uint8Array>` where `DocumentMetadata = { title, author, subject, keywords: string[], creator, producer, created?: Date, modified?: Date }`; writes both the Info dictionary and, when present, the XMP `dc:title`, `dc:creator`, `dc:description`, `pdf:Keywords` fields so readers that prefer XMP agree.

- [ ] **Step 1: Failing tests:** dialog shows current values from `readMetadata`; saving writes Info and XMP and marks dirty; the round-trip test reopens with PDF.js `getMetadata()` and asserts both `info.Title` and `metadata.get("dc:title")`.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement; XMP update uses a minimal XML rewrite of the existing packet or creates one when absent.
- [ ] **Step 4:** Run; expected PASS; native check in Preview's Inspector.

### Task 5.2: Menus, accelerators and shortcuts (spec §5, §28; APP-05, NAT-13)

**Files:**
- Modify: `src-tauri/src/lib.rs:38-118`; `src/app/App.tsx:65-119`; `README.md` shortcuts table
- Test: `tests/unit/app-shell.test.tsx`

- [ ] **Step 1: Failing tests:** `menu-action` payloads `undo`, `redo`, `print`, `close-document`, `settings`, `organize`, `tools:<id>` route to the controller and store; keydown Cmd+Z calls `controller.undo()`, Cmd+Shift+Z `redo()`, Cmd+P opens the print dialog, Cmd+W closes through `guard`, Cmd+, opens Settings; arrow keys with a selected annotation call `moveSelectedAnnotation` by 1 pt (10 with Shift).
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement: add `Organize` and `Tools` menus, `.accelerator()` on every item (`CmdOrCtrl+O`, `+S`, `+Shift+S`, `+P`, `+W`, `+Z`, `+Shift+Z`, `+F`, `+0`, `+=`, `+-`, `+,`), add toolbar buttons for Edit PDF, Add image, Comment and Redact, and a native close fallback: when `CloseRequested` arrives and `dirty == false` and the renderer does not answer within 5 seconds, allow the close.
- [ ] **Step 4:** Run; expected PASS; native check that menu items show shortcut hints and work without webview focus.

### Task 5.3: Drag-and-drop and open-with (spec §43)

**Files:**
- Modify: `src-tauri/src/lib.rs` (`RunEvent::Opened`, `open_path` command restricted to paths delivered by the OS event), `src-tauri/src/commands/mod.rs` (`open_document_from_path(path)` internal), `src/app/App.tsx` (`getCurrentWebview().onDragDropEvent`), `src/app/useDocumentSession.ts` (`openPath(path)`)
- Test: `tests/unit/app-shell.test.tsx`, Rust test for path acceptance

- [ ] **Step 1: Failing tests:** a `drop` event with one `.pdf` path routes to `guard` then `openPath`; a drop with a non-PDF shows "Only PDF files can be opened"; the Rust command rejects a path that was not registered by an OS open event (tokens issued by `RunEvent::Opened` and drag-drop, single use).
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement with a native `pending_open_tokens: Mutex<HashMap<String, PathBuf>>` so the renderer never passes a raw path, preserving the "no path-taking IPC" property.
- [ ] **Step 4:** Run; expected PASS; native check by dropping a file and by `open -a NavPDF file.pdf`.

### Task 5.4: Page operations: duplicate, insert PDF, replace, thumbnails (spec §8)

**Files:**
- Modify: `src/services/document-commands.ts` (`duplicatePages`, `insertDocumentPages`, `replacePage`), `src/features/pages/PageWorkspace.tsx`, `src/features/pages/CreatePdfDialog.tsx`
- Test: `tests/unit/document-commands.test.ts`, `tests/unit/mutation-dialogs.test.tsx`

- [ ] **Step 1: Failing tests:** `duplicatePages([1])` yields page 2 with identical content stream bytes and its own annotation copies; `insertDocumentPages(bytes, other, 2, [0,1])` inserts two pages at index 2 with `stripExternalPageLinks` applied; `replacePage(bytes, 0, other, 3)` keeps the page count; PageWorkspace renders PDF.js thumbnails (bounded 160 px) in its grid with `role="row"` wrappers; CreatePdf merge list supports drag reorder and shows first-page thumbnails.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement using `copyPages` plus the Task 1.4 link stripping and the Task 2.5 revision key for thumbnails.
- [ ] **Step 4:** Run; expected PASS; native check with `mixed-dimensions.pdf`.

### Task 5.5: Form field editing (spec §16; PR-2 gap)

**Files:**
- Modify: `src/services/document-commands.ts` (`updateFormField`, `deleteFormField`, `addSignatureField`), `src/features/forms/FormManager.tsx`, `src/features/annotations/AnnotationSelectionLayer.tsx` (widget selection boxes), `src/features/annotations/Properties.tsx` (field properties: name, tooltip `/TU`, required, read-only, default value)
- Test: `tests/unit/interactive-forms.test.tsx`, `tests/integration/pdf-roundtrip.test.ts`

- [ ] **Step 1: Failing tests:** selecting a widget on the page shows field properties; moving it updates `/Rect` and keeps the value; deleting removes the field from `/AcroForm /Fields` and the widget from `/Annots`; `addSignatureField` creates `/FT /Sig` with an empty appearance; round-trip in PDF.js reports the new tooltip.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement with pdf-lib `PDFForm` APIs and the Task 2.2 geometry helpers.
- [ ] **Step 4:** Run; expected PASS; native check in Preview and Acrobat.

### Task 5.6: Placement controls: interactive crop, decoration typography, image watermark, text style (spec §10, §21, §22, §23)

**Files:**
- Modify: `src/features/pages/PageWorkspace.tsx:437-458` (crop overlay on the current page with drag handles, offset inputs, reset), `src/features/decorations/DecorationsDialog.tsx` (font family, size, margin inputs; image watermark tab with scale and position), `src/services/document-commands.ts` (`DocumentDecorationsOptions.font`, `.margins`, `.watermark.image`), `src/features/editor/ContentEditor.tsx` (opacity, rotation, italic through Helvetica-Oblique and Times-Italic)
- Test: `tests/unit/decorations.test.tsx`, `tests/unit/page-workspace-extra.test.tsx`, `tests/unit/content-editor.test.tsx`

- [ ] **Step 1: Failing tests:** crop with offset `[50, 50]` produces `/CropBox [50 50 ...]` and reset restores the MediaBox; a decoration with `font: "Times-Roman", size: 8, margins: { top: 36 }` writes `Tf 8` and places the header at `height - 36`; an image watermark draws an XObject centered with the requested scale and `gs` opacity; text with `rotation: 45` writes a `cm` rotation and `italic: true` selects `Helvetica-Oblique`.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement on top of `appendTaggedStream` and `page-box.ts`.
- [ ] **Step 4:** Run; expected PASS; native check in Preview.

### Task 5.7: Existing image transforms in the native engine (spec §12)

**Files:**
- Modify: `src-tauri/src/engine/edit.rs` (`EditKind::TransformImage { object_id, cm: [f64; 6] }` rewriting the `cm` preceding the `Do`), `src-tauri/src/engine/content.rs` (record the `cm` operand span per image placement), `src/types/engine.ts`, `src/features/editor/ObjectEditor.tsx` (move, resize, rotate controls with aspect lock)
- Test: `src-tauri/src/engine/edit.rs` tests, `tests/unit/phase7-dialogs.test.tsx`

- [ ] **Step 1: Failing tests:** Rust: a page with `q 200 0 0 100 50 50 cm /Im1 Do Q` transformed by translation `(10, 20)` yields `cm` operands `200 0 0 100 60 70`; a rotation by 90 degrees yields the expected matrix; an image drawn inside a Form XObject is refused with "images inside shared forms cannot be moved"; the ObjectEditor exposes X, Y, width, height, rotation and lock-aspect controls and submits one `TransformImage` edit.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `cargo test`, frontend suite; expected PASS; native check with an image-bearing fixture.

### Task 5.8: Redact from text selection and context menus (spec §15, §43)

**Files:**
- Modify: `src/features/redact/RedactionTool.tsx` (accept regions from `readTextSelectionGeometry`), `src/features/viewer/ViewerHost.tsx` (`onContextMenu` with Copy, Highlight, Underline, Strike through, Add note, Redact selection, Search for selection), `src/components/ContextMenu.tsx` (new, keyboard operable)
- Test: `tests/unit/redaction-tool.test.tsx`, `tests/unit/context-menu.test.tsx`

- [ ] **Step 1: Failing tests:** with an active text selection, "Redact selection" adds one region per selection quad to the pending marks; the context menu opens at the pointer, is `role="menu"` with `menuitem` children, closes on Escape and invokes the chosen action.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement reusing `selection-geometry.ts`.
- [ ] **Step 4:** Run; expected PASS; native check: select a sentence, redact, apply, verify absence with `pdftotext`.

### Task 5.9: Home quick actions, settings sections, frontend logging (spec §27, §31, §33)

**Files:**
- Modify: `src/app/Home.tsx` (Merge, OCR, Compress, Edit actions opening the picker then the tool), `src/app/Settings.tsx` (General: default save behavior and confirm-on-delete; Editing: default annotation colors and stroke width; OCR: default language and page scope; Advanced: hardware acceleration toggle wired to `maxCanvasPixels`, clear caches), `src/stores/workspace.ts` (preferences), `src-tauri/src/logging/mod.rs` (`record_component(component, operation, error)`), `src/services/native.ts` (`logEvent(component, operation, error)`)
- Test: `tests/unit/home.test.tsx`, `tests/unit/settings.test.tsx`, Rust logging test

- [ ] **Step 1: Failing tests:** each quick action opens the picker and then the named tool; each new preference persists through `savePreferences` and is read by its consumer (OcrPanel default language, AnnotationToolbar default color); `logEvent` writes a JSON line with the component and operation and never the arguments.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run; expected PASS.

### Task 5.10: On-page placement and signature rotation (spec §17; DLG-06)

**Files:**
- Modify: `src/features/signatures/FillAndSign.tsx`, `src/features/editor/ContentEditor.tsx`, `src/features/editor/LinkDialog.tsx`, `src/features/forms/FormManager.tsx` (a "Place on page" mode using a shared `PlacementOverlay`), `src/features/annotations/PlacementOverlay.tsx` (new: click or drag a rectangle on the current page, returns visual coordinates), `src/services/document-commands.ts` (signature `rotation` option)
- Test: `tests/unit/placement-overlay.test.tsx`, `tests/unit/fill-and-sign.test.tsx`

- [ ] **Step 1: Failing tests:** dragging on the overlay returns a rectangle in visual page coordinates; FillAndSign "Place on page" uses it and the placed XObject `/Rect` matches through `fromTopLeftVisual`; `rotation: 90` writes a rotated `cm`.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run; expected PASS; native check on `rotated-offset.pdf`.

### Task 5.11: Comment replies and status, stamps, FDF and XFDF (spec §9, §16)

**Files:**
- Modify: `src/services/document-commands.ts` (`addReply` with `/IRT` and `/RT /R`, `setReviewState` with `/State`, `addStampAnnotation` with a standard `/Name` or an image appearance), `src/features/viewer/controller.ts` (comment threads in the model), `src/features/viewer/Sidebar.tsx` (threaded list, status control), `src/features/annotations/AnnotationToolbar.tsx` (Stamp tool)
- Create: `src/services/xfdf.ts` (`exportXfdf(bytes)`, `importXfdf(bytes, xml)` covering markup, notes, shapes, replies and form values)
- Test: `tests/unit/comment-threads.test.ts`, `tests/unit/xfdf.test.ts`, `tests/integration/pdf-roundtrip.test.ts`

- [ ] **Step 1: Failing tests:** a reply appears under its parent and has `/IRT`; setting Accepted writes a `/Text` state annotation with `/State Accepted` and `/StateModel Review`; a stamp round-trips in PDF.js as `Stamp`; XFDF export of a highlight and a form value re-imports to the same objects and Acrobat-compatible field names.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement; keep the JSON exchange for backward compatibility and prefer XFDF in the UI.
- [ ] **Step 4:** Run; expected PASS; native check in Acrobat's comment list.

### Task 5.12: Protection and signing completeness (NAT-09, NAT-10; spec §18, §19, §20)

**Files:**
- Modify: `src-tauri/src/engine/protect.rs:92`, `:184-186` (owner-only mode with empty user password; re-encrypt already encrypted input after unlock; change owner password), `src-tauri/src/engine/compress.rs` (font subset pruning of unused glyph outlines is out of scope; add an "Advanced" preset exposing DPI target and JPEG quality), `src-tauri/src/engine/sign.rs` (visible appearance stream with signer name and date, `/DigestMethod` on SigRef, ESS certificate hash and content-type checks in verify, chain validation against a user-supplied trust anchor, SHA-384/512 ECDSA), `src/features/protect/ProtectDialog.tsx`, `src/features/compress/CompressDialog.tsx`, `src/features/signatures/CertificateSignature.tsx`
- Test: Rust tests per module; `node scripts/phase10-acceptance.mjs`

- [ ] **Step 1: Failing tests:** `protect` with an empty user password and a non-empty owner password opens without a password in lopdf and reports restricted permissions; verify rejects a CMS whose ESS certificate hash does not match; a signature with an appearance renders a non-empty `/AP /N` stream; `pdfsig` in the acceptance script shows the signer name.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement.
  Timestamping and revocation require network access; write ADR 0012 proposing an explicit opt-in per signature with a user-entered TSA URL, and do not implement until the owner accepts it.
- [ ] **Step 4:** Run; expected PASS.

### Task 5.13: Long-term platform items (spec §13, §38, §45)

Each item is a separate ADR plus plan before code; list here for sequencing only.

- [ ] Tabs or multiple windows: requires per-document `AppState` (`dirty`, recovery, handles are already per id after Task 1.9), a window-per-document Tauri model, and menu state per focused window.
- [ ] Batch processing: a queue over the existing engine commands with a manifest; reuse `splitDocumentWithManifest` output shape.
- [ ] Windows and Linux backends: Tesseract behind the `ocr` module boundary, platform print through the webview print or a native dialog, credential storage through `keyring`; needs CI runners and separate acceptance.
- [ ] Document comparison: text diff per page through PDF.js text items plus a pixel diff on rendered pages.
- [ ] PDF/A validation and conversion: evaluate `verapdf` as an external validator only; conversion is out of scope without a new engine decision.
- [ ] Accessibility checker and tagging: read-only report of `/MarkInfo`, `/StructTreeRoot`, alt text and language first.
- [ ] Scan-to-PDF and image enhancement: ImageCaptureCore on macOS; deskew and contrast as preprocessing on a recognition copy per `ARCHITECTURE.md`.
- [ ] Bundled CLI: promote `engine_cli.rs` to a shipped binary once command surfaces stabilize.

---

## Tranche 7: Acrobat Reader parity

Source: the "Acrobat Reader parity gaps" table in the review.
Order follows the "Must have" rows; each task is one capability with a regression and a native check.
Tranche 7 may start after Tranches 1 and 8 land; it does not depend on Tranches 5 or 6 except where a task says so.

### Task 7.1: View modes: rotate view, read mode, full screen, even spreads, fit visible, night mode

**Files:**
- Modify: `src/features/viewer/controller.ts:506-512` (`setLayout`, new `rotateView(delta)`, `setSpread("none"|"odd"|"even")`, `zoom("fit-visible")` computed from the page CropBox minus margins), `src/stores/workspace.ts` (`viewRotation: 0|90|180|270`, `readMode: boolean`, `nightMode: boolean`, `spread`), `src/app/Toolbar.tsx` (View controls), `src/app/App.tsx` (hide chrome in read mode, Escape exits, `document.documentElement.requestFullscreen` toggle), `src/styles.css` (`.night-mode .pdfViewer canvas { filter: invert(1) hue-rotate(180deg) }` limited to the canvas layer so annotations and UI keep their colors), `src-tauri/src/lib.rs` (View menu items with accelerators `Cmd+Shift+R`, `Cmd+R`, `Cmd+H` read mode, `Cmd+Ctrl+F` full screen)
- Test: `tests/unit/viewer-controller-extra.test.ts`, `tests/unit/app-shell.test.tsx`

- [ ] **Step 1: Failing tests:** `rotateView(90)` sets `viewer.pagesRotation` to 90 and does not mark dirty or call any pdf-lib writer; a second call yields 180 and `rotateView(-90)` returns to 90; `setSpread("even")` sets `SpreadMode.EVEN`; `zoom("fit-visible")` produces a scale larger than `page-fit` for a page with wide margins; read mode hides the toolbar and sidebar and Escape restores them; night mode adds the class to the viewer container only.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement; persist `viewRotation` per document in recents alongside the remembered page.
- [ ] **Step 4:** Run; expected PASS; native check that rotate view leaves the saved file's `/Rotate` unchanged.

### Task 7.2: Navigation: first and last page, go to page, back and forward, page labels

**Files:**
- Modify: `src/features/viewer/controller.ts` (`goToFirst`, `goToLast`, `goToPage(labelOrNumber)`, `back()`, `forward()` using PDF.js `PDFHistory` with `updateUrl: false`; `pageLabels: string[] | null` from `pdf.getPageLabels()` read in `attach()`), `src/app/Toolbar.tsx:338-390` (page box accepts labels and shows `label (n of total)`), `src/features/viewer/Thumbnails.tsx` (label captions), `src/app/App.tsx` (`Cmd+G` opens the page box focused, `Home`, `End`, `Cmd+Left`/`Cmd+Right` back and forward), `src-tauri/src/lib.rs` (View menu items)
- Test: `tests/unit/viewer-controller-extra.test.ts`, `tests/unit/viewer-ui.test.tsx`

- [ ] **Step 1: Failing tests:** with labels `["i","ii","1","2"]`, `goToPage("ii")` navigates to page 2 and `goToPage("2")` to page 4; the page box renders `ii (2 of 4)`; after `goToPage(4)` then `back()` the current page is the previous one and `forward()` returns; `Home` and `End` keys call `goToFirst`/`goToLast`; thumbnails show label captions.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement; internal link clicks push history through `PDFLinkService` so back works after following a link.
- [ ] **Step 4:** Run; expected PASS; native check with a fixture that has roman-numeral labels (add `page-labels.pdf` to `scripts/create-fixtures.mjs` with a `/PageLabels` number tree).

### Task 7.3: Sidebar panels: attachments, layers, signatures, editable bookmarks

**Files:**
- Modify: `src/features/viewer/Sidebar.tsx:17-20` (tabs `attachments`, `layers`, `signatures`), `src/features/viewer/controller.ts` (`readLayers()` from `pdf.getOptionalContentConfig()`, `setLayerVisible(id, visible)` re-rendering with the updated config; `readSignatures()` mapping `/Sig` fields to `{ name, page, rect, status }` through the existing native `engine_verify`), `src/features/attachments/AttachmentsDialog.tsx` (extract the list into `AttachmentsPanel.tsx` reused by the dialog), `src/features/viewer/BookmarksPanel.tsx` (add, rename, delete, nest under the selected item), `src/services/document-commands.ts` (`setOutline(bytes, OutlineNode[])` writing `/Outlines` with `/Dest` arrays, `/Count`, `/First`, `/Last`, `/Parent`)
- Test: `tests/unit/sidebar-panels.test.tsx`, `tests/unit/document-commands.test.ts`

- [ ] **Step 1: Failing tests:** a fixture with two optional content groups lists both with checkboxes and unchecking one calls `setLayerVisible(id, false)` and triggers a re-render without marking dirty; the attachments tab lists embedded files using the Task 1.6 walker and Save writes through the native picker; the signatures tab lists each signature with page and validity and clicking scrolls to its rect; adding a bookmark writes an `/Outlines` tree that PDF.js `getOutline()` reads back with the new title and destination page; deleting the last child updates `/Count`.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement; layer visibility is view state only and is not persisted (Reader behavior), while the outline edits are document mutations through the Task 2.1 queue.
- [ ] **Step 4:** Run; expected PASS; native check in Preview for the outline and in Acrobat for layers.

### Task 7.4: Comment tool parity: stamps, callouts, polygons, clouds, text corrections, eraser, list sorting and summary

**Files:**
- Modify: `src/services/document-commands.ts` (`addStampAnnotation({ page, rect, name?: StandardStampName, image?: Uint8Array })` writing `/Stamp` with `/Name` or an image `/AP`; `addCalloutAnnotation` as `/FreeText` with `/IT /FreeTextCallout`, `/CL` line points and `/LE`; `addPolygonAnnotation` and `addPolyLineAnnotation` with `/Vertices` and optional `/IT /PolygonCloud` plus `/BE << /S /C /I 1 >>`; `addCaretAnnotation({ page, quad, text, kind: "insert"|"replace" })` writing `/Caret` and, for replace, a paired `/StrikeOut` linked with `/IRT` and `/RT /Group`; `addSquiggly` as a fourth text markup kind), `src/features/annotations/ShapeTool.tsx` (polygon and polyline drawing by click sequence, double-click to close), `src/features/annotations/AnnotationToolbar.tsx` (Stamp, Callout, Insert text, Replace text tools), `src/features/annotations/StampPicker.tsx` (new: Approved, Draft, Final, Confidential, Reviewed, Received, and a custom image with the same size bounds as Fill & Sign), `src/features/viewer/controller.ts` (`eraseInkNear(point, radius)` splitting or deleting PDF.js ink paths; comment list `sortBy: "page"|"author"|"date"|"type"` and `filter` state), `src/features/viewer/Sidebar.tsx` (sort and filter controls; "Summarize comments" writing a text or PDF summary through the existing export path)
- Test: `tests/unit/document-commands.test.ts`, `tests/unit/annotation-ui.test.tsx`, `tests/integration/pdf-roundtrip.test.ts`

- [ ] **Step 1: Failing tests:** each new subtype round-trips through PDF.js `getAnnotations()` with the expected `subtype`, and a saved stamp with `/Name /Approved` renders in the PDF.js annotation layer; a replace-text correction produces a `/Caret` and a `/StrikeOut` that reference each other; a cloud polygon has `/BE /S /C`; erasing at a point removes the ink segment within the radius and leaves the rest; the comment list sorted by author groups entries and the filter hides other types; the summary contains every comment with page and author.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement on top of the Task 2.2 geometry helpers and the Task 2.3 metadata fields; extend `Comment` with `vertices`, `callout`, `stampName`.
- [ ] **Step 4:** Run; expected PASS; native check in Acrobat's comment list for every subtype (Acrobat is the interoperability reference here).

### Task 7.5: Measurement tools

**Files:**
- Create: `src/features/measure/MeasureTool.tsx` (distance, perimeter, area over the page with snapping to text-layer edges and a scale ratio input such as `1 in = 1 ft`), `src/features/measure/measure-geometry.ts` (pure functions: `distance`, `perimeter`, `polygonArea`, `applyScale`)
- Modify: `src/services/document-commands.ts` (`addMeasurementAnnotation` writing `/Line` or `/Polygon` with `/IT /LineDimension`, `/PolygonDimension`, `/Measure << /Type /Measure /R "1 in = 1 ft" /X [...] /D [...] /A [...] >>` and `/Contents` set to the formatted value), `src/features/annotations/AnnotationToolbar.tsx`, `src/features/tools/ToolPanel.tsx`
- Test: `tests/unit/measure-geometry.test.ts`, `tests/unit/measure-tool.test.tsx`

- [ ] **Step 1: Failing tests:** `distance([0,0],[3,4])` is 5; `polygonArea` of a 3x4 rectangle is 12; `applyScale(72, "1 in = 2 ft")` yields 2 ft for 72 points; drawing two points shows the formatted distance and persists a `/Line` with `/IT /LineDimension` and a `/Measure` dictionary that PDF.js reads back.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement; results are optional annotations, and a "measure without saving" mode leaves the document clean.
- [ ] **Step 4:** Run; expected PASS; native check in Acrobat that the dimension value displays.

### Task 7.6: Forms UX: field highlighting, required outline, tab order, reset, auto-complete

**Files:**
- Modify: `src/features/viewer/controller.ts` (`setFieldHighlight(boolean)` toggling a class on `.annotationLayer .widget`; `resetForm()` applying `/DV` defaults through `annotationStorage`; `focusNextField()` following `/Tabs` order or geometric order), `src/styles.css` (`.highlight-fields .annotationLayer .widget { background: rgba(...) }`, `.required { outline: ... }`), `src/features/forms/FormBar.tsx` (new: shown when the document has fields with "Highlight fields", "Reset", "Next field", field count), `src/stores/workspace.ts` (`formAutoComplete: boolean`, default off, in Settings)
- Test: `tests/unit/interactive-forms.test.tsx`

- [ ] **Step 1: Failing tests:** opening `mixed-forms-annotations.pdf` shows the form bar with the field count; toggling highlight adds the class; `resetForm()` restores default values and marks dirty when values changed; a `/ResetForm` button action in the fixture triggers `resetForm()` without executing any script; Tab from the last field wraps to the first.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement; auto-complete is a local per-document suggestion list only, never persisted across documents unless enabled in Settings, and never written to logs.
- [ ] **Step 4:** Run; expected PASS.

### Task 7.7: Print options

**Files:**
- Modify: `src/features/pages/PrintDialog.tsx` (scaling: fit, actual size, shrink oversized; pages per sheet 1, 2, 4, 6, 9 with order; booklet; copies; content: document, document and markups, form fields only; print as image; orientation auto, portrait, landscape), `src/services/document-commands.ts` (`imposePages(bytes, { perSheet, order, sheetSize })` building n-up sheets with `copyPages` as Form XObjects, `flattenForPrint(bytes, { markups: boolean })` removing or keeping annotations), `src-tauri/src/commands/mod.rs:847-887` (`print_document` accepts `copies`, `orientation`, and `scaling` mapped to `NSPrintInfo` properties)
- Test: `tests/unit/native-print.test.tsx`, `tests/unit/document-commands.test.ts`, Rust test for `NSPrintInfo` mapping behind a trait

- [ ] **Step 1: Failing tests:** `imposePages` with `perSheet: 2` on a 5 page document yields 3 sheets each containing two page XObjects; "document only" strips markup annotations and keeps widgets; "print as image" rasterizes at the chosen DPI through the export path; the native call receives the copies and orientation headers.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement; printing never mutates the open document (operate on a copy of the saved bytes).
- [ ] **Step 4:** Run; expected PASS; native check to a PDF printer for each scaling mode.

### Task 7.8: External links with a trust prompt

**Files:**
- Modify: `src/features/viewer/controller.ts:79` (keep `externalLinkEnabled = false`; intercept clicks on `.annotationLayer a[href]` and `linkService.addLinkAttributes` to route through `confirmExternalLink(url)`), `src/components/ExternalLinkDialog.tsx` (new: shows the full destination, scheme, "Open", "Copy link", "Cancel", and a per-session "always allow this host" checkbox), `src-tauri/src/commands/mod.rs` (`open_external_url(url)` validating scheme against `https`, `http`, `mailto` with the same allow list as `validateSafeUrl` and calling the system opener; no other scheme ever opens), `src-tauri/capabilities/default.json` (no shell plugin; use `open::that` behind the typed command), `src/features/viewer/ViewerHost.tsx` (hover shows the destination in the statusbar)
- Test: `tests/unit/viewer-ui.test.tsx`, Rust test for scheme validation

- [ ] **Step 1: Failing tests:** clicking a link to `https://example.org` opens the dialog with the URL text and does not navigate; Open calls the native command once; a `file:` or `javascript:` link shows "This link type cannot be opened" and no command is called; hovering shows the URL in the statusbar; a `mailto:` link is allowed.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement; record the command in the capability list and keep the CSP unchanged.
- [ ] **Step 4:** Run; expected PASS; native check that the browser opens only after confirmation.

### Task 7.9: Accessibility: reflow, read aloud, high contrast, structure-based reading order

**Files:**
- Create: `src/features/accessibility/ReflowView.tsx` (renders the page text in reading order at the current zoom as HTML, using `pdf.getStructTree()` when present and text-layer order otherwise), `src/features/accessibility/read-aloud.ts` (`speak(text)`, `pause()`, `stop()` over `window.speechSynthesis`, which uses the macOS system voice offline; falls back to a disabled control with a notice when unavailable)
- Modify: `src/app/Toolbar.tsx` (View menu items Reflow, Read Out Loud, High contrast), `src/styles.css` (high-contrast theme tokens), `src/stores/workspace.ts`
- Test: `tests/unit/reflow-view.test.tsx`, `tests/unit/read-aloud.test.ts`

- [ ] **Step 1: Failing tests:** reflow renders paragraphs in struct-tree order for a tagged fixture and in text-layer order otherwise; `speak` queues one utterance per paragraph and `stop` cancels; high contrast switches the token set and keeps AA contrast for text on the toolbar (assert computed colors against a small contrast function).
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement; add `tagged.pdf` with a minimal `/StructTreeRoot` to the fixture generator.
- [ ] **Step 4:** Run; expected PASS; native check with VoiceOver reading the reflow view.

**Tranche 7 checkpoint:** full check list, rebuild, an Acrobat interoperability pass over every new annotation subtype, and a parity table refresh in the review.

---

## Tranche 8: memory and performance

Source: the "Memory, performance and security posture" section of the review (MEM-01 through MEM-08).
Budget to verify at the end of the tranche: idle under 120 MB footprint; a 363 MB scanned document open under 300 MB footprint across all four processes; no allocation proportional to file size on a timer; one annotation edit on that document under 2 seconds and under 2 file sizes of transient allocation.
Tranche 8 depends on Task 1.2 (dirty tracking) and Task 2.1 (mutation queue) and should run before Tranche 7.

### Task 8.1: Native-owned revisions; the renderer never keeps whole-document bytes (MEM-01, MEM-02, MEM-07)

**Files:**
- Modify: `src-tauri/src/commands/mod.rs:482-539` (`commit_working_revision` returns `{ revisionId, length }` and registers the working file as a range-readable source under the same document id; `get_revision` becomes `open_revision_range(id, revisionId)` so `read_range` can serve any retained revision; new `list_revisions(id)`, `drop_revision(id, revisionId)`; retained revisions bounded by `MAX_REVISION_BYTES` on disk, default 2 GB, oldest first), `src/services/native.ts`, `src/services/pdf.ts` (`loadRevision(descriptor, revisionId, length)` building a `LocalRangeTransport` for that revision), `src/services/revision-history.ts` (entries hold `{ revisionId, numPages, description, pageMapping, warnings }` and no bytes; `RevisionHistory` no longer copies anything), `src/features/viewer/controller.ts:331-416`, `:440-480` (`replaceWithBytes` sends the candidate once over IPC, then loads the committed revision through the range transport; `applyRevision` loads by id; `saveDocument()` for history adoption is replaced by committing the current PDF.js storage as a revision only when `storageModified` is true), `src/app/useDocumentSession.ts` (save reads the current revision natively: `save_document` takes `revisionId` instead of bytes when the renderer has no pending storage edits)
- Test: `tests/unit/revision-history.test.ts`, `tests/unit/viewer-controller.test.ts`, `src-tauri/src/commands/mod.rs` tests, `tests/integration/pdf-roundtrip.test.ts`

**Interfaces:**
- Produces: Rust `commit_working_revision(id, base_revision, bytes) -> RevisionDescriptor { revision_id, length, pages }`, `read_range(id, begin, end, revision_id?)`; TS `RevisionHistory` over `RevisionRef` objects; `ViewerController.replaceWithBytes(bytes, status, options)` keeps its signature but its post-condition is "the proxy reads through the range transport".

- [ ] **Step 1: Failing tests:** after `replaceWithBytes`, the loading task was created with a `range` transport and not `data`; `RevisionHistory` at 20 entries holds no `Uint8Array`; undo loads `revisionId` of the previous entry through `loadRevision`; the native test retains at most `MAX_REVISION_BYTES` of working files and deletes the oldest; `read_range` with a `revision_id` serves bytes from that file; saving with a `revisionId` produces the same output hash as saving the bytes.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement natively first (files and range reads), then the TS transport, then switch `replaceWithBytes` and `applyRevision`; keep `loadPdfFromBytes` only for the browser preview.
- [ ] **Step 4:** Run; expected PASS.
- [ ] **Step 5:** Re-run `node scripts/memory-probe.mjs` (Task 8.6) and record the "after first edit" delta; expected under 2 file sizes transient and no file-sized steady-state growth.

### Task 8.2: Autosave writes only what changed and never re-serializes an unchanged document (MEM-03)

**Files:**
- Modify: `src/app/useDocumentSession.ts:310-338` (tick every 10 s but act only when `mutationCounter` or `storageModified` changed since the last recovery write; when only a native revision changed, call `write_recovery_from_revision(id, revisionId)`; when PDF.js storage changed, debounce 5 s after the last edit, then `saveDocument()` once), `src-tauri/src/commands/mod.rs:622-655` (`write_recovery_from_revision` copies the working file with `fs::copy` into the recovery slot and skips `validate_pdf` because the revision was validated at commit; `write_recovery` skips the write when the incoming bytes hash equals the stored recovery hash), `src/features/viewer/controller.ts` (`mutationCounter` incremented per committed revision)
- Test: `tests/unit/document-session-flows.test.ts`, Rust tests

- [ ] **Step 1: Failing tests:** three ticks on a dirty document with no new edits call `saveDocument` zero times and `write_recovery*` once; a native mutation followed by a tick calls `write_recovery_from_revision` and not `saveDocument`; a form edit followed by ticks at 2 s and 7 s serializes once at the 7 s tick; Rust: `write_recovery_from_revision` produces a byte-identical copy without parsing, and `write_recovery` with identical bytes performs no write (mtime unchanged).
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run; expected PASS; native check: open the 363 MB probe file, add a sticky note, watch Activity Monitor for 60 s; expected no periodic multi-hundred-megabyte spikes.

### Task 8.3: Bound PDF.js retained ranges by recycling the proxy (MEM-04)

**Files:**
- Modify: `src/services/pdf.ts` (`LocalRangeTransport` counts bytes delivered), `src/features/viewer/controller.ts` (`retainedBytes` getter; `recycleProxy()` that records page, zoom, rotation, scroll offset and selection, destroys the task, reloads the same revision through a fresh transport, restores state, and re-runs the active search; triggered when `retainedBytes > max(64 MB, 25 percent of the file)` and the viewer is idle for 2 s), `src/stores/workspace.ts` (`memoryBudgetMB` preference, Settings Advanced)
- Test: `tests/unit/viewer-controller-extra.test.ts`

- [ ] **Step 1: Failing tests:** a transport that has delivered more than the budget triggers `recycleProxy` once idle; after recycling, `page`, `zoom` and `layout` are unchanged and the search results list is rebuilt; recycling never happens while `busy` or with a pending mutation; a document smaller than 64 MB is never recycled.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement; expose the retained size in the Advanced settings panel for diagnosis.
- [ ] **Step 4:** Run; expected PASS; probe check: after indexing the 363 MB file, retained bytes return under the budget within 5 s.

### Task 8.4: Canvas and thumbnail budgets scale with the display and document (MEM-05)

**Files:**
- Modify: `src/features/viewer/controller.ts:89` (`maxCanvasPixels` = min(8,000,000, 4,000,000 times devicePixelRatio squared divided by 4) so Retina caps near 16 MB per canvas; pass `PDFPageViewBuffer` size 6 for documents whose average page stream exceeds 1 MB, otherwise 10), `src/features/viewer/Thumbnails.tsx` (LRU of 40 rendered thumbnails, release `ImageBitmap` or canvas on eviction)
- Test: `tests/unit/thumbnails.test.tsx`, `tests/unit/viewer-controller.test.ts`

- [ ] **Step 1: Failing tests:** the computed `maxCanvasPixels` for `devicePixelRatio` 2 is 4,000,000; the view buffer size for an image-heavy document is 6; scrolling 100 thumbnails leaves at most 40 canvases mounted with content.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run; expected PASS; native check at 500 percent zoom on the 363 MB file: WebContent footprint stays under 400 MB.

### Task 8.5: Native budgets relative to the machine and streaming where possible (MEM-06)

**Files:**
- Modify: `src-tauri/src/commands/engine.rs:18-21` (`MAX_STAGED_BYTES` = min(1.25 GB, 25 percent of physical memory via `sysinfo` or `sysctl hw.memsize`), a clear message when an operation would exceed it), `src-tauri/src/filesystem/mod.rs:9` (keep `MAX_FILE_BYTES` for opening, add `MAX_ENGINE_INPUT_BYTES` = min(1 GB, 20 percent of physical memory) checked before protect, compress, redact and sign with the message "This document is too large for the local engine on this machine"), `src-tauri/src/commands/mod.rs:482-513` (`commit_revision` writes the invoke body to the temp file in 4 MB chunks before validation and validates from the file so only lopdf's copy is resident), `src-tauri/src/engine/redact.rs:1243-1259` (streaming term audit from T2.7)
- Test: Rust tests with an injected memory size

- [ ] **Step 1: Failing tests:** with an injected 8 GB machine, `MAX_STAGED_BYTES` is 2 GB and `MAX_ENGINE_INPUT_BYTES` is 1.6 GB; with 8 GB injected and a 1 GB input, compress is refused with the size message before any allocation; `commit_revision` peak allocation (counting allocator in test) stays under 3 file sizes.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `cargo test`, `cargo clippy -D warnings`; expected PASS; re-run `/usr/bin/time -l engine_cli compress` on the 73 MB probe file and record the peak.

### Task 8.6: Reproducible memory measurement scripts

**Files:**
- Create: `scripts/memory-probe.mjs` (the Node probe used in this review: range open, comments pass, text pass, serialize, edit copies, history at limit; prints a table), `scripts/make-heavy-fixture.mjs` (image-heavy PDF generator with page count argument), `scripts/memory-drive.sh` (the release-app driver: launch, open through the dialog with Cmd+Shift+G, page through, search, measure `footprint` per process; prints the exact Accessibility blocker when keystrokes are refused)
- Modify: `package.json` (`"perf:probe"`, `"perf:fixture"`, `"perf:drive"`), `docs/VERIFICATION.md` (a "Memory" table with the numbers before and after Tranche 8)

- [ ] **Step 1:** Port the scratch scripts from this review into `scripts/` with argument parsing and a `--json` output.
- [ ] **Step 2:** Run `npm run perf:fixture -- output/perf/heavy-40.pdf 40` and `npm run perf:probe -- output/perf/heavy-40.pdf`; commit the table to `VERIFICATION.md` as the pre-Tranche-8 baseline (73 MB: history 1380 MB, serialize 146 MB, index 91 MB).
- [ ] **Step 3:** Grant Accessibility permission to the terminal (System Settings, Privacy and Security, Accessibility) and run `npm run perf:drive`; record per-process footprints with a document open, after paging, and after search.

### Task 8.7: Hardening the bundle and the PDF.js boundary

**Files:**
- Create: `src-tauri/Entitlements.plist` (hardened runtime with `com.apple.security.cs.allow-jit` only if WebKit requires it, no `allow-unsigned-executable-memory`, no `disable-library-validation`; evaluate `com.apple.security.app-sandbox` with `com.apple.security.files.user-selected.read-write` and security-scoped bookmarks for recents in a follow-up ADR)
- Modify: `src-tauri/tauri.conf.json` (`bundle.macOS.entitlements`, `hardenedRuntime: true`, `signingIdentity` from the environment), `src/services/pdf.ts:66-85` (`isEvalSupported: false`, `enableScripting: false` explicitly on both loaders), `docs/adr/0012-macos-sandbox-and-hardening.md`
- Test: `tests/unit/pdf-transport.test.ts` asserts both flags; `codesign -dv` and `spctl --assess` recorded in `VERIFICATION.md`

- [ ] **Step 1:** Add the explicit PDF.js flags with a test; run the suite.
- [ ] **Step 2:** Build with hardened runtime and an ad-hoc identity; verify `codesign -dv` reports `runtime` in flags and the app still opens, saves, prints and runs OCR (Vision) and Keychain access natively.
- [ ] **Step 3:** Write ADR 0012 covering App Sandbox feasibility (recents via bookmarks, Keychain access groups, print and Vision inside the sandbox) with the measured results; notarization stays the Phase 9 gate.

**Tranche 8 checkpoint:** re-run the probe and driver, record before and after numbers in `VERIFICATION.md`, and confirm the budget at the top of this tranche.

---

## Tranche 6: structural refactors

Perform only after Tranches 1 through 4 so the new regressions protect behavior; Tranche 7 and 8 tasks that touch `document-commands.ts` or `controller.ts` should land before or after the split, not during it.

### Task 6.1: Split `document-commands.ts` by domain

**Files:**
- Create: `src/services/pdf/annotations.ts`, `pages.ts`, `forms.ts`, `content.ts`, `decorations.ts`, `attachments.ts`, `ocr-layer.ts`
- Modify: `src/services/document-commands.ts` becomes a re-export barrel; update imports in `src/features/**` file by file

- [ ] **Step 1:** Move functions in dependency order (annotations, pages, forms, content, decorations, attachments, OCR), running `npm run typecheck && npx vitest run tests/unit/document-commands.test.ts` after each move.
- [ ] **Step 2:** Replace the four hex-to-rgb copies with `src/utils/color.ts`, the two layer removers with `removeTaggedStreams`, and the three Names-tree walks with `walkEmbeddedFiles`.
- [ ] **Step 3:** Delete dead exports `deleteLinkAnnotation`, `createDocumentFromImage`, identity `computeReorderMapping`, `getRevision`, `DEFAULT_SANITIZE_OPTIONS`, `record()`, and the duplicate `"ink"` tool id after confirming zero callers with `grep -rn`.
- [ ] **Step 4:** Full check list; expected PASS with unchanged coverage or better.

### Task 6.2: Split the controller and bound revision memory (APP-04)

**Files:**
- Create: `src/features/viewer/revision-coordinator.ts`, `comments-model.ts`, `search-coordinator.ts`
- Modify: `src/features/viewer/controller.ts`, `src/services/revision-history.ts`

- [ ] **Step 1: Failing test:** `RevisionHistory` with `maxBytes: 100 MB` evicts oldest revisions when cumulative size exceeds the bound and never copies on `getCurrent()` (assert the same `Uint8Array` identity is returned twice).
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement the byte bound and copy-on-write; extract the three coordinators keeping the `ViewerController` public API unchanged so existing tests pass without edits.
- [ ] **Step 4:** Full check list; expected PASS.

### Task 6.3: Code splitting for the App chunk

**Files:**
- Modify: `src/app/App.tsx` (lazy `import()` for every feature dialog and `ooxml.ts`), `vite.config.ts` (`build.chunkSizeWarningLimit` unchanged)

- [ ] **Step 1:** Wrap each dialog in `React.lazy` with a `Suspense` fallback inside `ToolErrorBoundary`.
- [ ] **Step 2:** `npm run build`; expected `App` chunk under 600 kB minified and no new warnings.
- [ ] **Step 3:** Native check: open every tool once; no visible delay beyond the fallback.

---

## Tracking and evidence

- Add a "September 14 review" section to `DELIVERY-PHASES.md` pointing at this plan; update it at every tranche checkpoint with completed task ids, test counts, executable hash and remaining items.
- Record every native check in `VERIFICATION.md` with source revision, executable hash, fixture, action, expected, actual and limitations.
- Phases 3, 4 and 6 may be re-marked complete only after Tranches 1 and 2 land and their native acceptance rows exist.
- Report local checks, hosted checks, quality analysis, merge status and distribution status separately in every handoff.

## Self-review against the review document

- Every Critical and High finding maps to a Tranche 1, 2 or 3 task; every Medium and Low maps to a task in Tranches 1 through 6.
- Every Partial or Missing spec row maps to a Tranche 5 task, except the plugin system and the declined ADR 0008 and ADR 0010 items, which are intentionally unplanned.
- Every MEM finding maps to a Tranche 8 task, and the security posture gaps map to Tasks 1.3, 1.5, 3.7, 7.8, 8.7 and the Phase 9 gate.
- Every "Must have" and "Should have" row of the Acrobat Reader parity table maps to a Tranche 7 task or to Tasks 5.1, 5.9, 5.11 or 5.13; "Later" rows (auto-scroll, split view, attach file as comment, advanced multi-file search, spell check) are listed but not scheduled.
- Names used across tasks: `appendTaggedStream`, `removeTaggedStreams` (1.1, 2.6, 5.6), `visibleBox`, `fromTopLeftVisual` (2.2, 5.5, 5.10), `stripExternalPageLinks` (1.4, 5.4), `walkEmbeddedFiles` (1.6, 6.1), `MutationQueue` (2.1), `parsePageRange` (3.2, 3.6), `FeatureDialog` (3.1), `pruneDocument` (1.4), `contentIdentity` (2.4), `ValidationError` (1.3).
