# Settings reliability implementation plan

Baseline: `7074cc5` on `origin/main`.
Requested order: review, plan, implementation, validation, PR and merge.

## Review and scope

The current settings path publishes native preferences and clears recent history before persisting `settings.json`.
A failed write can therefore leave the running application using settings that were reported as unsaved.
The dialog also permits repeated submissions and dismissal while saving.
App and Settings independently apply the theme, and only App subscribes to system appearance changes, so an open preview can be replaced by the persisted theme.

These concrete defects take priority over the conditional request for additional palettes.
The existing System, Light and Dark choices remain the supported themes for this change.
Broader missing capabilities and distribution gates remain in `docs/DELIVERY-PHASES.md`.
Existing untracked files are outside this change.

## Implementation sequence

1. Reproduce the closest available native settings workflow and add regressions for theme ownership, repeated submissions and real filesystem persistence failure.
   Native development launched, but computer automation cannot select its bare executable and reports multiple installed apps for its bundle identifier.
   Build and select the exact packaged app for UI checks; use isolated Rust temporary directories for write-failure verification without touching personal settings.
2. Stage a cloned local settings value, persist it atomically, then publish it in memory.
   Apply the same transaction boundary to explicit recent-history clearing.
3. Guard settings submission synchronously, disable editing and dismissal while the write is pending, retain the draft on errors, and publish the committed preferences without a second fallible state read.
4. Give Settings ownership of theme preview while open, subscribe its draft to system appearance changes, and restore the saved preference when it closes.
5. Run focused regressions, lint, typecheck, coverage, build, Rust tests, Clippy, formatting, instruction parity and diff checks.
   Inspect native dialog rendering, keyboard dismissal, save and reopen using the rebuilt package.
   Native baseline inspection also reproduced upper-left dialog positioning after the stylesheet reset; restore automatic margins and bounded scrolling.
6. Record evidence and limits in the delivery tracker and verification ledger, publish a focused PR, inspect exact-head hosted checks and merge when required checks pass.
   GitHub protection requires the obsolete `Rust (test + clippy)` name; add an aggregate job under that name which requires successful Linux and macOS checks, preserving branch protection.

## Acceptance criteria

- Failed native persistence preserves both preferences and recent history in memory and preserves an existing settings file.
- Successful saves deserialize to the committed values, enforce offline policy and clear history only when requested.
- Repeated submit attempts produce one write; Escape, close and Cancel cannot dismiss an in-flight save.
- A save error leaves an editable draft and allows retry.
- A system appearance change respects the current preview; Cancel restores the saved theme using the current system appearance.
- Saving preferences updates workspace defaults while retaining current recovery and recent-document state, except an explicitly disabled recent history.
- The final report distinguishes local checks, native UI evidence, hosted checks, merge status and outstanding release gates.
