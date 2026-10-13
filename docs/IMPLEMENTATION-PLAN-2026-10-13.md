# Twenty local workflow features

## Goal and design

Extend the existing document workspace with twenty usable capabilities, using the current React dialogs, PDF command boundary and local export adapter.
Keep documents offline, avoid new dependencies, preserve undo and source identity, and retain all existing acceptance gates.
The user authorized implementation and a pull request.

## Feature scope

1. Select pages by typed range in Organize Pages.
2. Select odd/even pages or invert the current selection.
3. Reverse document page order.
4. Move selected pages before a chosen destination or to the end.
5. Split into fixed-size page groups in one ZIP download.
6. Export selected pages as individual PDFs in one ZIP download.
7. Export form values as versioned JSON.
8. Preview and import validated JSON form values.
9. Export a spreadsheet-safe CSV of form values.
10. Check missing required form fields.
11. Clear editable form values with explicit confirmation.
12. Search comment text and replies.
13. Filter comments by author.
14. Filter comments by annotation type and review status.
15. Sort comments by page, author or date.
16. Search bookmarks while retaining matching ancestor paths.
17. Inspect word/character counts and textless pages for a page range.
18. Inspect page dimensions, rotations and orientation in a page inventory.
19. Export the displayed search results as CSV with an explicit truncation notice.
20. Open a searchable keyboard shortcut guide.

## Implementation tasks

Use the parallel-work workflow for the independent page, form and review domains.
The coordinator owns shared dialog registration, tool entries, reader reports and documentation.

- [x] Page workflows: extend `src/features/pages/PageWorkspace.tsx`, keep ordering helpers in `page-selection.ts` and archive generation in `page-archives.ts`, and add real PDF round-trip and UI tests.
- [x] Form workflows: implement `src/features/forms/FormDataDialog.tsx` and `src/services/pdf/form-data.ts`, plus saved-output, validation and dialog tests.
- [x] Review workflows: extend `src/features/viewer/Sidebar.tsx` through focused comment and bookmark components/helpers and add filter/navigation tests.
- [x] Reader reports: add document statistics/page inventory dialogs under `src/features/document/`, search-result export under `src/features/search/`, and a shortcut guide under `src/features/help/`.
- [x] Integrate tools through `DOCUMENT_TOOL_DIALOGS` and `ToolPanel`, verify accessible labels and keyboard guards through component tests, document the exact features and validation limits.
- [x] Run lint, typecheck, coverage, build, formatting and diff checks, review the patch and fix the findings.

The authorized delivery step is to push the branch and open a PR after the local gates pass.
See the [verification ledger](VERIFICATION.md#october-13-twenty-local-workflow-features) for the completed checks and native/visual acceptance blockers.

## Contracts and safety

New modal components accept `{ controller: ViewerController | null; onClose: () => void }`.
Use `useDocumentEdit` for persisted edits and `downloadBlob` / `downloadBytes` for exports.
Page reordering must pass the existing page mapping to preserve navigation.
Form import validates the entire payload before editing, rejects unknown/incompatible/read-only fields, and never runs PDF actions.
Reset clears editable supported values after confirmation; it must preserve read-only, signature and unsupported fields.
CSV writers quote fields and neutralize spreadsheet formula prefixes.
New inspection jobs are bounded, yield between pages, expose progress and disregard stale results after close or document replacement.
Do not change native IPC, CSP, package dependencies or existing phase completion claims.

## Review focus and tests

- Invalid and huge page ranges, empty selections, move destinations inside a selected block and single-page documents must have deterministic validation.
- Reordered/exported PDFs retain correct visible page order, rotation and supported structures; existing structure-loss warnings remain visible.
- Imported form payloads containing duplicate names, invalid types/options, oversized values or unknown fields must fail atomically.
- CSV cells beginning with formula operators, quotes, delimiters or newlines must remain inert and correctly quoted.
- Async jobs, cancelled exports and document replacement must not mutate the replacement document or falsely report a successful save.

Tests should first fail for missing behavior, then pass against the implementation.
Native macOS rendering and Preview acceptance cannot be inferred from browser or unit tests.
This environment has Node 24 but initially no Cargo executable; record unavailable native checks separately and inspect hosted results after opening the PR.
