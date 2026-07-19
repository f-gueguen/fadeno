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
   input and never share private values accidentally. ADR 0034 refuses all V1
   cross-request resource result caching; any later shared cache requires a new
   decision and isolation evidence rather than weakening this default.
8. Protocol decoders limit depth, count, size, time, and unsupported versions.
9. Streams handle authentication expiry, cancellation, reconnect pressure, and
   backpressure.
10. Logs and diagnostics redact secrets, credentials, cookies, and sensitive
    field values.
11. Compiler and scaffold output cannot write outside declared roots through
    untrusted names or paths.
12. Dependencies, release artifacts, and build provenance are verified before
    public publication.

ADR 0035 selects V1's exact-origin native action proof, bounded single-process
replay owner, same-origin 303 redirect, upload cleanup, encrypted host-only
session cookie, key rotation, absolute expiry, and privilege-change rotation.
The companion [action/session threat model](action-session-threat-model.md)
records residual bearer-cookie and unsupported multi-process risk. V1-13 must
preserve those controls in the exported action/session surface. The current
packed runtime integrates the exact-origin proof, replay, upload cleanup,
protected cookie, rotation, redirect, and complete-revalidation path while
retaining the explicit single-process limit.

ADR 0047 establishes the initial browser loading and private update byte
boundary. The generated same-origin external module uses the renderer's
request-owned nonce without broadening application script sinks. Raw bytes,
fatal UTF-8/JSON decoding, structural record count, depth, duration, cache,
origin, operation identity, cancellation, and generation isolation fail closed
before any later document mutation. Decoder results contain stable codes and
metrics rather than transported values. The companion
[browser update threat model](browser-update-threat-model.md) records native
fallback, cross-user isolation, safe logging, rollback, and later-slice risks.

ADR 0041 carries those controls into the first deployment boundary. The
immutable release contains no environment file or secret value, accepts only
process-injected `FADENO_ORIGIN` and `FADENO_SESSION_KEYS`, keeps the application
process on loopback behind an operator-owned same-host HTTPS terminator, and
retains the single-process replay/session owner. Packaging disables dependency
lifecycle scripts and verifies the complete production closure before accepting
the release. A configuration, integrity, startup, or health refusal restarts an
unchanged prior release rather than mutating it in place.

## Evidence gate

A vertical slice that introduces a trust boundary includes:

- a threat-model update;
- abuse and malformed-input cases;
- negative authorization and cross-user isolation cases;
- resource limits and failure behavior;
- safe logging assertions;
- rollback behavior.

The first public alpha requires a complete threat-model review and fuzzing of
all external decoders. A0-09 closes that requirement through the
[first-alpha threat review](alpha-threat-review.md) and the deterministic
`pnpm check:a0-decoder-fuzz` gate over the exact production decoder paths.
Stable release additionally requires an independent security review and
remediation of all known critical and high-severity issues.
