# ADR 0048: Server-owned update outcome projection

- Status: Accepted
- Date: 2026-07-20
- Owners: Fadeno maintainers
- Related specifications: [Navigation and patching](../spec/navigation-patching-preservation.md), [Progressive enhancement](../spec/progressive-enhancement.md), [Forms and actions](../spec/forms-actions-sessions.md), [Security requirements](../security/requirements.md)
- Supersedes: None

## Context

ADR 0045 fixes the private browser update envelope, and ADR 0047 implements its
bounded encoder and decoder. The server still needs one way to turn the outcome
already produced by routing, resources, actions, and rendering into that
envelope. A parallel update renderer or authorization path would make native and
enhanced behavior diverge.

V2-03 establishes only this server projection. Later slices still own request
transport, interception, document application, preservation, and enhanced form
submission.

## Decision drivers

- Reuse the native route, resource, action, session, and renderer authorities.
- Never execute application behavior again to explain or project an outcome.
- Prevent one authorization or representation context from projecting another.
- Attach provenance while the native outcome is constructed, before cleanup
  removes request-owned resource and action evidence.
- Keep transported bytes closed, bounded, exact-version, and private.
- Retain a redacted causal record for tests and later runtime explanation.

## Decision

The projector consumes exactly one native `Response` created by the existing
application handler. It may read that response once; it cannot call the route,
page, layout, resource, action, or authorization function again. Projection is
therefore an alternate serialization of the same server-owned outcome, not a
second render policy.

A private operation authority is created from trusted server inputs and bound
to the exact `Request` object by object identity. It contains the application
generation, document epoch, operation identity, normalized URL, result identity,
scroll classification, and an opaque authorization owner. The renderer records
the same authority on the resulting `Response`. The projector accepts only the
exact bound authority object; copied values, another user owner, another
generation, or an unattached response refuse before body publication. The
opaque owner is never serialized, logged, or compared by string value.

Construction-time evidence records the generated route identity, route outcome,
renderer phase, resource decisions, and action decision when one exists.
Request-owned resource evidence is snapshotted before renderer cleanup. Action
evidence is added by the action runtime before returning its final response.
The browser envelope contains only the closed ADR 0045 fields. A separate
private redacted projection record contains stable operation/result correlation,
module-owned causes, ownership, skipped work, outcome kind, completeness, and
redaction state. It contains no markup, submitted fields, credentials, session
identity, opaque authorization owner, source path, or arbitrary failure prose.

Projection maps only these already-owned outcomes:

- a complete successful HTML response becomes `document`;
- an explicitly classified route, resource, or action expected failure becomes
  `expected-error` with its stable code;
- an existing typed `303`, `307`, or `308` response becomes `redirect` after the
  existing same-origin rules are rechecked;
- an existing unexpected failure or explicitly selected current-truth result
  becomes `recover`;
- refusal, missing ownership, incomplete streaming, unsupported status or media
  type, oversized output, cancellation, and unsafe provenance produce no
  envelope.

The projected document transports the exact completed rendered document once,
uses the fixed server-owned structural identity `fadeno-document-root`, and
derives the document title only from the framework-rendered head. Raw byte,
HTML, title, URL, identity, record, depth, and duration limits remain those of
ADR 0045 and are checked before publication. The response transport is
`no-store`. Encoding failure cannot fall back by repeating a mutation.

Private projection records use an exact internal version and lossless round
trip. Unknown keys or versions refuse. This is internal evidence, not a public
runtime, analyzer, logging, or extension schema.

## Alternatives considered

- Render a separate partial document: rejected because it would execute
  application behavior twice and create a second renderer.
- Infer authorization from a protocol field, cookie string, or route URL:
  rejected because matching data does not prove the same server authority.
- Put provenance and action/resource details in the browser envelope: rejected
  because the closed transport needs only application data, while forensic
  evidence may contain server-only ownership facts.
- Project arbitrary handler responses: rejected because V2-03 can prove only
  outcomes constructed by the existing framework authorities.
- Add interception now: rejected because V2-04 and V2-06 separately own request
  eligibility and native fallback timing.

## Consequences

- Native and private update results share one route, resource, action, session,
  rendering, authorization, and error decision.
- Projection can refuse conservatively without changing the native response.
- A later request transport must create and bind the private authority before
  invoking the handler; it cannot reconstruct ownership afterward.
- The projector and redacted record remain private package internals and may
  change during prerelease work.
- This additive prerelease package behavior carries one pending minor
  Changeset. It introduces no new public export.

## Validation

`pnpm check:v2-server-update` uses a current packed framework to prove native
and projected document, expected-error, redirect, action, resource, and recovery
equivalence; exact construction provenance; opaque authorization and cross-user
refusal; generation and operation isolation; body and serialization bounds;
redacted logs; cancellation; rollback; stale-output removal; and lossless
projection-record round trips. The canonical application retains executable
success, refusal, machine, flow, and recovery artifacts. `pnpm ci:local` retains
all native, package, security, renderer, action, resource, and release gates.
