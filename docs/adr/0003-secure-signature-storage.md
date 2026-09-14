# ADR-0003: Protect reusable signatures with an OS-backed secure asset store

Date: 2026-09-13
Status: Accepted for Phase 3.

## Context

Reusable signatures and initials were historically stored in plaintext inside browser local storage.
Signatures are sensitive personal assets that can be extracted if stored unencrypted.
Phase 3 requires an OS-backed secure asset store, protection against unauthorized extraction, a session-only option, and a safe migration path away from plaintext storage.
The storage must operate locally without network access, cloud accounts, or third-party telemetry.

## Decision

Implement an OS-protected signature store in the native backend at `src-tauri/src/signatures/`.
Store persistent signatures in an isolated private directory within the application data root (`$APP_DATA/signatures/`).
Set strict filesystem permissions (`0600` on Unix/macOS) on signature asset files and their directory.
Encrypt asset contents using authenticated encryption or key derivation bound to the local user account and machine identity.
Provide a dedicated session-only mode where transient signatures reside solely in runtime memory and are discarded when the window or session closes.
Prompt users with an explicit migration workflow for existing plaintext local storage assets.
Verify the encrypted persistent asset before deleting the old plaintext local storage entry.
If native secure storage is unavailable or fails, require session-only mode rather than falling back to unencrypted storage.

## Alternatives

- Continuing to use browser local storage is rejected because local storage is unencrypted and accessible to web inspection.
- Storing unencrypted image files in the user home directory is rejected due to lack of encryption and access control.
- Delegating storage to a cloud service is rejected because NavPDF operates strictly locally without cloud dependencies.
- Silent fallback to plaintext on secure store failure is rejected because users would lose their privacy guarantees without notice.

## Consequences

Persistent reusable signatures are encrypted and protected by operating system file permissions.
Transient users can create session-only signatures that leave no persistent trace on disk.
Deleting a library asset leaves previously placed visual marks on saved PDF documents intact.
Plaintext assets from older versions are safely migrated or removed with user confirmation.
