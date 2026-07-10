# Security requirements

Security is part of each implementing slice, not a later hardening phase.

## Trust boundaries

The threat model covers at least:

- request URLs, headers, bodies, cookies, and uploaded files;
- action identifiers, fields, redirects, and repeated submissions;
- generated and raw HTML;
- patch and live-update messages;
- resource cache keys and cross-request values;
- generated manifests and build inputs;
- adapter headers, proxy metadata, and disconnect signals;
- logs, diagnostics, traces, and development overlays.

## Required controls

1. Dynamic HTML and attributes are contextually escaped by default.
2. Raw HTML is explicit, typed as unsafe input, and auditable at review.
3. State-changing requests enforce an accepted same-origin and CSRF policy.
4. Actions define authorization, replay, duplicate-submission, body-size,
   field-count, and file-size behavior.
5. Redirect destinations are validated against an explicit policy.
6. Cookies define integrity, confidentiality where required, scope, expiry,
   rotation, and secure defaults.
7. Shared caches partition by every authorization- and representation-relevant
   input and never share private values accidentally.
8. Protocol decoders limit depth, count, size, time, and unsupported versions.
9. Streams handle authentication expiry, cancellation, reconnect pressure, and
   backpressure.
10. Logs and diagnostics redact secrets, credentials, cookies, and sensitive
    field values.
11. Compiler and scaffold output cannot write outside declared roots through
    untrusted names or paths.
12. Dependencies, release artifacts, and build provenance are verified before
    public publication.

## Evidence gate

A vertical slice that introduces a trust boundary includes:

- a threat-model update;
- abuse and malformed-input cases;
- negative authorization and cross-user isolation cases;
- resource limits and failure behavior;
- safe logging assertions;
- rollback behavior.

The first public alpha requires a complete threat-model review and fuzzing of
all external decoders. Stable release additionally requires an independent
security review and remediation of all known critical and high-severity issues.
