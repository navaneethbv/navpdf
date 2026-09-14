# PR 2 corrective review

Reviewed base: `e00e46aec46b16d1fd49b323fed144416108e1c7`.
Date: September 14, 2026.
The working tree was clean at review start.

## Confirmed findings and corrections

1. Phase 3 signature storage derived its key from public path and username values and used a custom SHA-256 construction, despite claiming OS-backed encryption.
   New writes use AES-256-GCM with random nonces and a random key in macOS Keychain.
   Keychain failure and unsupported platforms return an error for persistent storage; session-only use remains available.
   Legacy files upgrade through atomic replacement when read, and failed reads surface an error.
2. Phase 3 migration interpolated untrusted identifiers into file paths, allowing traversal outside the signature directory.
   The entire migration batch now validates identifiers and image bounds before writing.
3. Phase 4 passed a buffer already transferred to PDF.js into the native working-revision command, then swallowed commit errors.
   Native publication now receives an owned copy, and failures restore the previous viewer revision.
   Undo/redo also publishes the restored revision using the last committed native identity.
4. Phase 4 overwrote the source range file and length during working-revision publication and released the revision lock before publishing.
   Working files are now separate from immutable source transport, and the base check and publication share a lock.
5. Phase 6 returned fixed sample text for every image, including malformed image headers, both natively and in browser preview.
   macOS now performs a real Apple Vision request and queries supported languages.
   Browser and unsupported-platform calls report unavailable OCR.
6. Phase 6 substituted fake PNG headers on canvas failure, omitted resource bounds, and could apply the final result after cancellation.
   Rendering errors abort, canvases have dimension and pixel limits and are released, and cancellation/document identity are checked before attachment.
7. Phase 6 wrote raw text into a standard-font stream and ignored crop offsets and measured widths.
   Font encoding, crop-relative placement and width fitting now preserve supported accented text and geometry.
   Unsupported glyphs reject searchable export with an extract-text alternative.

## Phase disposition

| Phase | Review disposition |
| --- | --- |
| 1 | Historical native safety evidence exists; source transport correction requires renewed combined workflow acceptance. |
| 2 | Existing annotation implementation and historical reader checks remain; correction has not re-established every native annotation gate. |
| 3 | Reopened. Storage corrected; native Keychain migration acceptance remains. Field authoring still uses fixed placement and does not provide the planned existing-field move/resize workflow. |
| 4 | Reopened. Native revision ownership corrected; packaged mutation/save/reopen and undo/redo acceptance remains. |
| 5 | Existing placement/decorations implementation retained; historical acceptance is not a fresh full capability audit. |
| 6 | Reopened. Real recognition smoke checks pass on two different scans and a blank image. Full quality/latency/memory corpus, scanner acquisition and native saved-output acceptance remain. |
| 7 | Existing scoped editing, protection, compression and redaction have dedicated adversarial acceptance; full editor parity is not claimed. |
| 8 | Office export is scoped text/cell output, not full layout-preserving conversion. Model-based generation and translation remain deferred. |
| 9 | Partial. Clean-account install, distribution signing/notarization, physical printing and other platforms remain open. |
| 10 | Scoped local certificate features exist; remote services and specialist media remain excluded by recorded scope decisions. |

## Verification and limits

`scripts/ocr-native-acceptance.mjs` runs the actual native engine against two distinct raster sentences and a blank image.
Both sentences matched exactly and the blank image returned no text.
Each result was embedded into an image-only PDF using the application writer.
Poppler extracted the expected text, and independent before/after rendering was byte-identical for all three inputs.
Evidence is under `output/ocr-review/report.json`.
Apple Vision requires access to native services outside the command sandbox; the sandboxed attempt failed and the approved unsandboxed run passed.
This smoke check does not establish the declared multi-column, table, skew, low-contrast or memory corpus thresholds.
The old corpus unit tests did not measure OCR and have been replaced with honest unavailable-engine boundary tests.

Native UI reproduction was attempted using the packaged NavPDF app and synthetic `ocr-scans.pdf`.
The Open dialog did not reliably act on the selected item, and refreshing the app then failed with `Sky Computer Use service startup request failed`.
The service later reconnected and the rebuilt app was relaunched, but clipboard input timed out and selecting the OCR fixture selected a different row.
The file dialog was cancelled safely.
No new packaged GUI save/reopen or Keychain acceptance is claimed from these attempts.
Automated checks and package results are recorded in the verification ledger when complete.
The current local suite passes 410 frontend tests, all coverage gates, lint, TypeScript, production build, 58 Rust tests and Clippy.
One real disk-full Rust test remains ignored because it requires a disposable constrained volume.
Independent Phase 7, 8 and 10 suites passed 55/55, 12/12 and 55/55 respectively.
PR #2 was merged as `f229114` before these corrections were published.
The corrections are a separate follow-up on `fix/native-ocr-signature-revisions`, based on that merged revision.
The app and DMG built on the approved unsandboxed retry, and the DMG checksum passed verification.
Current artifact hashes are in [VERIFICATION.md](VERIFICATION.md).
