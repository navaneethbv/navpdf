# September 19 security and reliability review

The review starts from `87afe9a7d68837b268b3ab66b12150e82e389168`.
It covers PDF annotation serialization, attachment decoding, native redaction, document replacement, export cancellation and the SonarCloud backlog.
This is an in-progress delivery record; hosted analysis and packaged acceptance remain open until recorded below.

## Confirmed findings and changes

- Annotation literal strings accepted PDF delimiters without escaping.
  The shared text encoder now escapes literal delimiters and uses hexadecimal UTF-16 strings for non-ASCII text.
  Annotation identifiers, replies and XFDF exchange decode both representations.
  Three saved-output regressions failed before the fix and pass after it.
- Redacted images remained reachable through unused page or inherited resources.
  Resource cleanup now materializes inherited bindings, rebuilds retained Form resources, removes unused XObjects and graphics states, and removes alternate image references from redacted raster copies.
  Active soft-mask graphics states are rejected when their content cannot be safely redacted.
  Independent review identified the unused-soft-mask and alternate-image cases; saved-output tests cover both, including the reproduced two-image retention failure.
  Existing controls preserve originals used by unredacted pages.
- Embedded attachment decoding allocated expanded content before checking its size.
  The shared stream decoder now bounds every decoding stage, allocation and work deadline.
  OCR stream inspection uses the same boundary.
  Regressions cover all supported codecs, expansion bombs, intermediate expansion and exact-limit controls.
- A workspace reset discarded loaded page labels and editing permission state.
  These now survive publication of the loaded document.
  The Roman-label fixture reproduced the label reset in the prior packaged app.
- Cancelling image export released its running state before pending work stopped.
  Each run now owns its cancellation state and validates the source document before export.
  Deferred-page regression coverage reproduces the race; native timing did not reproduce it because the export completed before cancellation could be observed.
- Async editing tools could apply a result computed from an older document revision.
  Mutation callers now provide their expected source, and replacement checks source identity before and after asynchronous preparation.
  A stale candidate cannot overwrite or roll back a newly opened document.
- Viewer cleanup after a rendering error destroyed the document needed for recovery.
  View listeners now have a separate suspension lifecycle; the application owns final controller disposal.
  Component lifecycle coverage exercises the real controller, but a natural native rendering failure has not been reproduced.

## Quality and delivery gates

SonarCloud organization: `navaneethbv`.
SonarCloud project key: `navaneethbv_navpdf`.
The project uses automatic analysis; the optional CI scanner requires `SONAR_CI_ANALYSIS=true`, automatic analysis disabled and a configured `SONAR_TOKEN`.
A skipped optional CI job does not establish a passing Sonar scan.
The initial main-branch analysis reported 462 unresolved issues.
The requested zero-issue merge gate remains open.

Cleanup includes explicit form labels and dialog semantics, readonly component contracts, smaller comment-reading and view-rendering helpers, consolidated styles, pinned workflow actions and constrained acceptance-script paths.
No quality rule, coverage threshold or branch protection is lowered.
The final PR must have passing checks and verified zero unresolved Sonar issues before merge.

The scan did not establish a complete security proof for every PDF feature.
Signing, notarization, clean-account launch, physical printing and non-macOS native UI remain separate existing distribution gates.
