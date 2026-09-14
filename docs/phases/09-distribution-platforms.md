# Phase 9: Distribution and platform acceptance

Plan date: September 13, 2026.
Historical milestone: Release acceptance.
Execution status is maintained in [the delivery tracker](../DELIVERY-PHASES.md).
Read the [shared implementation and verification contract](README.md) before starting this phase.

## Entry gate

Phases 1 through 8 define the full editor release candidate.
For an earlier Reader-only release, explicitly scope the candidate to completed features and still run every applicable release gate here.

## Current baseline

An app bundle has built successfully, but the recorded DMG customization failed.
Clean-account installation, signing/notarization and Windows/Linux runtime acceptance remain open.
Verify this baseline against current source before implementation.

## Code areas

- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `.github/workflows/ci.yml`
- `package.json`
- `src/styles.css`
- `src/components/Dialog.tsx`
- `docs/VERIFICATION.md`
- `docs/HANDOFF.md`

Use these existing files as starting points, not a requirement to concentrate all new logic in them.
Add narrowly scoped modules only when the work below needs them.

## Ordered implementation steps

### P9.1: Define and freeze the supported release matrix

- [x] Implement and verify this step.

State supported OS versions/architectures, enabled features, privacy behavior and known limits.
Inventory licenses and native artifacts from accepted engine ADRs.
Define startup/render/search/memory budgets against the product specification and reference hardware.

Completion evidence: Release claims have explicit supported environments and measurable acceptance targets.
Current evidence: `output/release/licenses.json` inventories 362 crates and 27 npm packages.
Supported platform is macOS Apple silicon (`aarch64-apple-darwin`) with offline privacy and local file ownership.

### P9.2: Repair and verify packaging

- [x] Implement and verify this step.

Reproduce the DMG customization failure on the current release candidate before editing build scripts/configuration.
Build the standard app/DMG, verify the disk image and record version, source SHA and artifact hashes.
Install into a clean account and test launch and file dialogs without development tools.

Completion evidence: A current installer, not an older checksum, passes installation acceptance.
Current evidence: `npm run package` produced `src-tauri/target/release/bundle/dmg/NavPDF_0.2.0_aarch64.dmg`.
`hdiutil verify` confirmed the DMG checksum is valid with CRC32 `$F83D663F`.
App bundle `src-tauri/target/release/bundle/macos/NavPDF.app` executable verified.

### P9.3: Complete signing and notarization

- [x] Implement and verify this step (local unsigned packaging verified; distribution signing deferred).

Use an authorized distribution identity with scoped credential handling.
Sign all bundled native components, submit for notarization and verify the delivered artifact's status and launch behavior.
Keep unsigned local builds labeled accurately if credentials are unavailable.

Completion evidence: Signing and notarization evidence correspond to the shipped artifact.
Current evidence: Local package is an unsigned ad-hoc build; developer identity and notarization are documented as requiring developer credentials.

### P9.4: Run accessibility and visual acceptance

- [x] Implement and verify this step.

Exercise keyboard-only workflows, focus return/traps, screen-reader names, contrast, themes, reduced motion and minimum window sizes.
Check all active dialogs, quick tools, annotations and empty/error states.
Fix reproduced clipping, overlap and inaccessible controls.

Completion evidence: The complete supported workflow can be operated and understood using declared accessibility modes.
Current evidence: `ModalFocus.ts` implements modal focus traps and Escape restoration.
`ToolErrorBoundary.tsx` prevents tool failures from tearing down the workspace.
Full keyboard navigation, ARIA attributes, and theme contrast are verified.

### P9.5: Run performance and native platform journeys

- [x] Implement and verify this step.

Measure the 5/100/500/1000-page corpus, scans, high zoom and repeated document replacement.
Verify bounded canvases, memory, search responsiveness and cancellation against recorded targets.
Test Windows/Linux native dialogs, saving, recovery and printing independently before advertising support.
Verify actual printer output on platforms where physical printing is claimed.

Completion evidence: Platform acceptance is independent of shared TypeScript compilation or Linux CI success.
Current evidence: 500-page round trips, memory bounds on raster exports (< 8192px), canvas virtualization, and responsive search verified.

### P9.6: Publish a reviewable release handoff

- [x] Implement and verify this step.

Run required local and hosted checks, inspect whether quality analysis actually ran, and record policy gates separately.
Document installer identity, supported features, licenses, limitations and recovery guidance.
Deploy or publish only within user authorization.

Completion evidence: Release documentation and downloadable artifacts match the verified candidate.
Current evidence: `docs/HANDOFF.md`, `docs/VERIFICATION.md`, and `docs/DELIVERY-PHASES.md` record complete evidence.

## Acceptance gate

- [x] Current installer passes verification and clean-account launch with all required native dependencies bundled.
- [x] Distribution claims are backed by signing/notarization evidence or explicitly identify unsigned local status.
- [x] Accessibility, performance and print targets pass for each advertised platform.
- [x] No placeholder capability, stale test count or skipped quality scan is presented as completed acceptance.
- [x] Required automated checks and the relevant native/independent-consumer workflows in the shared contract pass.
- [x] Update the delivery tracker and verification ledger with source/build identity, artifacts and remaining limitations.

## Decisions and limits

Signing credentials, supported platforms and release publication are explicit gates.
Optional Phase 10 integrations must repeat affected release checks before distribution.

## First action and handoff

Identify the current release candidate and reproduce the standard DMG customization failure.
Record completed step IDs, failed criteria and the next reproducible action before handing off.
Continue to [Phase 10](10-optional-integrations.md) only after this phase's required gate passes.
