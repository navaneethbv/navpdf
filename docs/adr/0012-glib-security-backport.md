# ADR 0012: Backport the GLib string iterator safety fix

Date: September 20, 2026.
Status: Accepted for the requested security remediation.

## Context

Tauri 2.11.5 resolves GTK 0.18.2 and GLib 0.18.5 on Linux.
RUSTSEC-2024-0429 affects string iteration because a C output argument writes through a pointer supplied as an immutable Rust reference.
Upstream fixed the reference mutability in PR 1343, but its 0.18 branch still contains the original code and the advisory lists 0.20.0 as the first fixed release.
Updating only GLib to 0.20 cannot satisfy the current GTK dependency contracts.

## Decision

Vendor the crates.io 0.18.5 archive and apply the upstream two-line correction, preserving the package version, generated manifest and MIT license.
Use Cargo's manifest patch to resolve every GLib consumer to this copy.
Remove the advisory ignore entry because the vulnerable implementation is replaced, while retaining unrelated documented exceptions.
Keep provenance and hashes in `src-tauri/vendor/README.md`.
Add an optimized Linux integration regression covering all affected iterator methods.
Treat vendored upstream files as third-party source in quality analysis; the application tests and patch remain reviewable in the PR.

## Consequences and validation

This introduces responsibility for maintaining one local dependency backport.
It does not upgrade GTK, change the application API, or make the upstream 0.18.5 registry release safe.
GitHub dependency-alert state must be checked after merge; scanner disappearance alone is not evidence of the code fix.
The local macOS application cannot validate execution of this Linux-only dependency, so Linux CI must compile the dependency chain and pass the optimized regression before merge.
Remove the patch and vendored copy when Tauri supports a compatible upstream fixed GLib release, regenerate the lockfile and rerun Linux build and iterator acceptance.
