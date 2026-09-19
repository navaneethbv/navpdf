# Reliable native PDF opening

## Review and scope

The current reader already implements search, page navigation, annotations, forms, OCR, protection and local recovery.
The essential gap selected for this change is operating-system file opening.
Finder's Open With menu does not list NavPDF, matching the missing bundle association.
Source inspection also finds that startup events can precede the renderer listener, busy handlers silently drop requests, and canceled requests retain native tokens.
The startup race is source-confirmed; native cold-start acceptance will establish the completed behavior.
Existing PDF interoperability and distribution gates remain separate.

## Implementation

1. Register PDF content types with an alternate editor role, preserving the user's current default PDF application.
2. Keep ordered, bounded, single-use native requests behind opaque tokens and expose list and dismissal commands without source paths.
3. Subscribe before reading pending requests, wait for preferences and the viewer, and serialize delivery across busy operations and unsaved-changes confirmation.
4. Release canceled requests, retain the current document on load or save failure, and explicitly reject multiple-file batches in the single-document workspace.
5. Add regressions for pre-listener requests, readiness, overlapping notifications, cancellation, queue capacity and token reuse.
6. Run the required frontend and Rust gates, rebuild the application and DMG, and check Finder opening in the rebuilt native app.
7. Record evidence, open a focused PR, wait for required checks and merge it.

## Added usability scope

The requested first-launch tour explains opening, navigation, editing, saving and appearance in five keyboard-accessible steps.
Help provides a way to reopen the tour or browse tips.
Subsequent launches show a tip when enabled; dismissing a tip with Don't show tips again checked saves the opt-out locally.
Settings can re-enable startup tips.
Completing or skipping the tour persists its completion, and failed preference writes keep the dialog and choice available for retry.
Native file requests wait while these dialogs are open.
Verification includes first-run defaults, old preference migration, tour navigation, relaunch persistence, tip opt-out, failed writes and native keyboard/layout checks.
