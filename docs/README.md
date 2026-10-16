# Documentation

Current source baseline: `c09576f`, reviewed October 16, 2026.
Use the delivery tracker for current work and the verification ledger for dated evidence.
A historical passing check does not establish acceptance of a later build.

| Document | Purpose |
| --- | --- |
| [Project README](../README.md) | Features, limitations, setup and commands. |
| [Architecture](../ARCHITECTURE.md) | Current runtime, document ownership and security boundaries. |
| [Delivery tracker](DELIVERY-PHASES.md) | Phase status, unresolved work and the next acceptance tasks. |
| [Acceptance checklist](phases/README.md) | Reusable phase criteria and native verification requirements. |
| [Verification ledger](VERIFICATION.md) | Dated checks, artifact identity, reader results and blockers. |
| [Product specification](PRODUCT-SPEC.txt) | Original requirements; later scope decisions are recorded in ADRs. |
| [Architecture decisions](adr/README.md) | Accepted engines, dependency rationale and deferred capabilities. |
| [PDFCraft comparison](PDFCRAFT-COMPARISON.md) | Pinned upstream inventory, implemented subsets and remaining comparisons. |
| [Security policy](../SECURITY.md) | Vulnerability reporting and document-safety boundaries. |
| [Fixture corpus](../tests/pdf-fixtures/README.md) | Synthetic inputs and regeneration. |
| [Vendored GLib](../src-tauri/vendor/README.md) | Security patch provenance and removal criteria. |

`AGENTS.md` and `CLAUDE.md` contain identical repository working instructions.
The vendored GLib README describes the upstream crate, not NavPDF's supported toolchain.

## Maintenance

Keep changing status in the delivery tracker and measured results in the verification ledger.
ADRs record decisions and may describe their dated context; link to a later decision when it supersedes that context.
Keep product documentation aligned with current source and distinguish implementation from native, independent-reader and distribution acceptance.
Use synthetic documents and keep manual artifacts under ignored `output/`.

Superseded implementation plans, review snapshots and handoffs were removed after consolidating their unresolved work and acceptance criteria.
Their original contents remain available in Git history, for example:

```sh
git show c09576f:docs/REVIEW-2026-09-14.md
git show c09576f:docs/IMPLEMENTATION-PLAN-2026-09-14.md
git show c09576f:docs/HANDOFF.md
```

Local session history, generated output and dependency documentation are not maintained product documentation.
