# Phase implementation plans

Created: September 13, 2026.
These plans expand the ordered phases in [the active delivery tracker](../DELIVERY-PHASES.md).
They describe remaining implementation work; writing a plan does not complete a feature.
The Current baseline section in each plan records the entry state when the plan was written and is not a substitute for current-source status.
The tracker owns current phase status and the [verification ledger](../VERIFICATION.md) records acceptance evidence.
The [original roadmap](../IMPLEMENTATION-ROADMAP-2026-09-12.md) retains the broader screenshot inventory and engine rationale.

## Plans

| Phase | Implementation plan | Original milestone |
| --- | --- | --- |
| 1 | [Reader reliability and file safety](01-reader-reliability.md) | M0 |
| 2 | [Complete local annotations](02-local-annotations.md) | M2 |
| 3 | [Forms and local Fill & Sign](03-forms-fill-sign.md) | M4 |
| 4 | [Page operations and mutation foundation](04-pages-mutations.md) | M1 |
| 5 | [Content placement and decoration](05-content-decoration.md) | M3 |
| 6 | [OCR and basic exports](06-ocr-exports.md) | M5 |
| 7 | [Existing editing, protection and redaction](07-editing-protection-redaction.md) | M6 |
| 8 | [Office conversion and local intelligent tools](08-conversion-intelligent-tools.md) | M7 |
| 9 | [Distribution and platform acceptance](09-distribution-platforms.md) | Release acceptance |
| 10 | [Optional services and specialist compatibility](10-optional-integrations.md) | M8 |

## Sequence and shared prerequisites

Execute phases in the tracker order; the tracker records which approved scopes are complete and which release gates remain open.
The delivery-phase numbers intentionally differ from the historical M0-M8 numbers.
Phase 2 introduces the minimum revision guards, bounded annotation history and coordinate transforms required for safe annotation extensions.
Phase 3 extends those same foundations for form and signature placement.
Phase 4 completes native job ownership, general history and structural preservation; it must extend the earlier contract rather than replace it with a competing implementation.
Phase 5 completes broader content ergonomics.
Later phases reuse the same document identity, revision, cancellation, persistence and capability boundaries.

Finish prerequisite acceptance before dependent implementation.
If a trial fails, keep the dependent feature unavailable, record the failed criterion and revise the plan.
Do not skip an acceptance gate or silently substitute a weaker capability.
Future module paths named in a plan are proposed additions, not claims that those modules already exist.
Refresh the listed source areas before coding because later changes can move ownership.

## Working and verification contract

Start each fix with an end-user reproduction using synthetic data and an output copy.
Preserve unrelated work and avoid modifying generated fixtures manually.
Use existing fixture generators, extending their sources when new cases are needed.
Keep manual acceptance artifacts under ignored `output/`; retain existing evidence at its recorded path.

For each persisted feature, test edit, undo/redo where promised, save a copy, close and reopen in NavPDF and an independent consumer.
For annotation/form compatibility, include Preview and Acrobat where the plan claims compatibility.
A missing reader or device is a recorded verification gap, not a passing check.
Validate structure, extracted content and visible appearance independently when relevant.
Preserve encrypted-input restrictions, source data, dirty state and recovery on failure.
Test cancellation, stale results, output collision and unavailable capabilities through their actual user flows.
Use one document revision/history model and serializable UI stores.
Do not ship controls that imply unsupported behavior.

For application changes, run the repository's required checks:

```sh
npm run lint
npm run typecheck
npm run test:coverage
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
git diff --check
```

Use Node 24 and the repository lockfiles.
Run focused regressions during implementation and the required suite before sign-off.
Keep existing coverage thresholds and LCOV output.
Planning-only changes require link, content and whitespace checks, not application test reruns.

Rebuild and relaunch the native app after application changes:

```sh
npm run package -- --bundles app
```

When the phase includes installer acceptance, run the full package command and verify the actual versioned DMG:

```sh
npm run package
hdiutil verify src-tauri/target/release/bundle/dmg/NavPDF_0.2.0_aarch64.dmg
```

Adapt the artifact filename to the version actually built.
App build, DMG creation, clean-account installation, signing, notarization and physical printing are separate evidence categories.

## Evidence and phase completion

Record source revision plus relevant local changes, app executable hash, fixture, action, expected result, actual result and output/screenshot paths.
Record independent-reader versions and target hardware where results depend on them.
Use a phase-specific section in `docs/VERIFICATION.md` and update the delivery tracker at each completed step.
Do not replace newer evidence with a historical baseline or count an unchecked item as completed.

| Field | Required record |
| --- | --- |
| Identity | Source revision, local-change description, app/engine version and artifact hash. |
| Reproduction | Synthetic input, user actions, expected behavior and observed failure. |
| Validation | Regression command/results, native workflow, independent consumer and saved-output inspection. |
| Boundaries | Unsupported cases, failed gates, environment blockers and residual risks. |
| Handoff | Completed step IDs, remaining step IDs and next concrete action. |

Each phase completes only after all required implementation steps and acceptance criteria pass.
Unresolved engine choices, untested platforms or unavailable credentials remain visible gates.
Local checks, hosted checks, quality analysis, review approval and publication must be reported separately.
Do not commit, push, send documents or publish merely because this implementation plan exists.
