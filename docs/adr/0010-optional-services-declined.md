# ADR-0010: Hosted and specialist integrations declined for this release

Date: 2026-09-14
Status: Accepted for Phase 10 (scope decision)

## Context

Phase 10 lists optional work packages: hosted review and sharing (P10.3), remote signature requests (P10.4), certificate signatures and certification (P10.5), specialist media and article threads (P10.6), and external design integrations (P10.7).
P10.1 requires an architecture decision for each package before any service code, and P10.2 applies only to approved providers.
The owner decision of 2026-09-13 approved only local certificate signing, recorded in ADR 0009, and declined hosted review, remote signing and media.
NavPDF has no accounts, backend or document uploads, and its production CSP restricts connections to the application itself.

## Decision

Hosted review and sharing, remote signature requests, video, audio and 3D authoring or playback, article-thread authoring and external design-tool integrations are not implemented in this release.
No provider is selected, no network service module is added, and the production CSP and navigation restrictions stay unchanged.
The application shows no controls for these packages.
Local comment exchange from Phase 2 remains the offline way to share review comments.
Ordinary exports keep their existing names and claim no integration with design tools.
Embedded media, 3D annotations and article threads in opened PDFs are neither played nor executed, and NavPDF makes no playback, authoring or preservation claim for them beyond its existing save behavior.

## Alternatives

A hosted review service would need an account model, storage retention and deletion, permissioned links, revocation, conflict handling and a privacy review; none has been approved.
Remote signing would need a chosen provider with scoped credentials, recipient previews, envelope status and retry-safe identifiers.
Media playback would need codec, container and sandbox decisions plus cross-reader testing, and scripted or rich-media content conflicts with the document-safety rules.

## Consequences

P10.2, P10.3, P10.4, P10.6 and P10.7 are recorded as declined, not complete.
Their acceptance criteria for revocation, deletion, retry behavior and recipient isolation do not apply until a package is approved.
Enabling any of them later requires a new owner decision, a provider-specific ADR, and repeated Phase 9 security, privacy and distribution checks.
