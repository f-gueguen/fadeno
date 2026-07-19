# Browser runtime and private update threat model

This model covers the V2-02 loading and decode boundary selected by ADR 0047.
It does not claim navigation, form, reconciliation, or authorization outcome
projection; those remain later slices.

## Assets and owners

- The server-rendered document and native controls remain the correctness
  baseline.
- The renderer owns the external module element and request CSP nonce.
- The application build owns the generated browser entry and its exact linked
  framework files.
- The browser operation owns its URL, kind, sequence, document epoch,
  application generation, and consumed result identities.
- Application authorization remains on the server. Protocol validity never
  implies authorization.

## Boundary controls

| Threat | Control | Evidence |
| --- | --- | --- |
| Untrusted script location | Generated-only root-relative path; network paths, credentials, fragments, backslashes, NUL, and other origins refuse | Renderer module-path tests |
| CSP bypass or policy drift | One external module uses the request-owned nonce; wrong/missing nonce and missing artifact execute nothing; rollback restores `script-src 'none'` | Three-engine packed browser runtime gate |
| Browser code enters server graphs | Exact `./browser` export; neutral root and Node closures cannot reach it; no Node dependency in browser closure | Current packed package gate |
| Import unexpectedly acquires ownership | Facade import has no side effect; startup is explicit, idempotent while active, and closable | Packed consumer and three-engine lifecycle |
| Malformed or oversized response | Aggregate raw bytes checked before fatal UTF-8/JSON decode; every JSON value, maximum depth, and elapsed duration measured independently | Private transport boundary tests |
| Protocol downgrade or extension smuggling | Exact protocol/version and closed keys; older/newer versions, selectors, commands, and unknown fields refuse | Versioned corpus and mutation tests |
| Cached private result crosses a request | Fetch policy, response `no-store`, and envelope `no-store` are all required; result identities are single use | Protocol corpus |
| Cross-user or stale result applies | Current generation, document epoch, operation ID/kind/sequence/URL, origin, and result identity must all match independent context | Cross-generation, cross-origin, stale, and duplicate cases |
| Decode mistaken for authorization | Decoder returns only protocol admission; it has no authorization callback or application mutation authority | Boundary types and V2-03 deferral |
| Hostile input leaks through logging | Decision and metric output contain stable codes/counts only and never echo transported markup, identity, credentials, or prose | Secret-canary and cross-user redaction cases |
| Cancellation publishes obsolete work | Aborted work returns a stable refusal and does not expose a decoded envelope | Cancellation test |
| Failure repeats a mutation | Every decision records `mutationResubmission: "never"`; uncertain committed work reloads current server truth | Recovery corpus |

## Native fallback and rollback

Before any later interception, blocked or disabled JavaScript simply leaves the
native document active. V2-02 performs no document update. Operational rollback
stops providing `browserModule`; the renderer emits no script, the CSP returns
to `script-src 'none'`, no browser artifact is requested, and native links and
forms still navigate.

## Residual risks

- V2-03 must prove that server outcome projection cannot cross authorization
  or representation boundaries.
- V2-04 and V2-06 must prove interception eligibility before preventing native
  behavior and must retain non-repeating mutation recovery.
- V2-05 through V2-09 must qualify actual reconciliation and preservation.
- The private schema may change before those consumers exist; it is not a
  compatibility promise.
