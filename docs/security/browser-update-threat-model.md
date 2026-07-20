# Browser runtime and private update threat model

This model covers the V2-02 loading and decode boundary selected by ADR 0047,
the V2-03 server projection selected by ADR 0048, V2-04's conservative link
interception selected by ADR 0049, and V2-05's history/focus/scroll boundary
selected by ADR 0050. It does not claim form interception or general state-
preserving reconciliation; those remain later slices.

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
- A private request-bound opaque authority owns projection. Its object identity,
  not a transported string, binds the authorization and representation context.

## Boundary controls

| Threat | Control | Evidence |
| --- | --- | --- |
| Untrusted script location | Generated-only root-relative path; network paths, credentials, fragments, backslashes, NUL, and other origins refuse | Renderer module-path tests |
| CSP bypass or policy drift | One external module uses the request-owned nonce; wrong/missing nonce and missing artifact execute nothing; rollback restores `script-src 'none'` | Three-engine packed browser runtime gate |
| Browser code enters server graphs | Exact `./browser` export; neutral root and Node closures cannot reach it; no Node dependency in browser closure | Current packed package gate |
| Import unexpectedly acquires ownership | Facade import has no side effect; startup is explicit, idempotent while active, and closable | Packed consumer and three-engine lifecycle |
| Insecure startup cannot create private identity | History ownership requires HTTPS or trustworthy loopback plus a secure random UUID capability before any private identity is created | Three-engine missing-capability refusal with native link recovery |
| Malformed or oversized response | Aggregate raw bytes checked before fatal UTF-8/JSON decode; every JSON value, maximum depth, and elapsed duration measured independently | Private transport boundary tests |
| Protocol downgrade or extension smuggling | Exact protocol/version and closed keys; older/newer versions, selectors, commands, and unknown fields refuse | Versioned corpus and mutation tests |
| Cached private result crosses a request | Fetch policy, response `no-store`, and envelope `no-store` are all required; result identities are single use | Protocol corpus |
| Cross-user or stale result applies | Current generation, document epoch, operation ID/kind/sequence/URL, origin, and result identity must all match independent context | Cross-generation, cross-origin, stale, and duplicate cases |
| Decode mistaken for authorization | Decoder returns only protocol admission; it has no authorization callback or application mutation authority | Boundary types and projector isolation |
| One user or representation projects another response | The exact opaque request authority must match construction evidence attached by routing/rendering/action code; it is never serialized or logged | V2-03 cross-user and copied-value refusals |
| Projection recreates application policy | The projector consumes the existing native response once and never calls routes, resources, actions, authorization, layouts, or rendering again | Invocation counters and native/projection equivalence |
| Provenance is reconstructed after cleanup | Route outcome is attached during construction; resource and action evidence is snapshotted before request cleanup | Route/resource/action causal fixtures and round trip |
| Server evidence leaks protected data | The transported envelope remains closed; the separate record retains only stable codes, ownership, causes, skipped work, and redaction state | Secret-canary record and logging tests |
| Hostile input leaks through logging | Decision and metric output contain stable codes/counts only and never echo transported markup, identity, credentials, or prose | Secret-canary and cross-user redaction cases |
| Cancellation publishes obsolete work | Aborted work returns a stable refusal and does not expose a decoded envelope | Cancellation test |
| Failure repeats a mutation | Every decision records `mutationResubmission: "never"`; uncertain committed work reloads current server truth | Recovery corpus |
| Hostile link acquires request ownership | Exact primary-click eligibility rejects credentials, other origins/schemes, target, download, modifiers, non-primary activation, and same-document fragments before `preventDefault()` | Packed pre-interception matrix |
| Browser correlation is mistaken for authorization | Private request headers are bounded freshness values only; the adapter creates a fresh opaque owner and binds the exact server `Request` before native handling | Integrated transport ownership and cross-user cases |
| User-owned state changes during fetch | The complete conservative preservation predicate runs before interception and again before commit; unsafe GET work returns to native destination | Dirty/top-layer/media/selection/client-identity/scroll race cases |
| Late or duplicate response overwrites current state | A newer sequence aborts its predecessor; generation, epoch, operation, URL, cancellation, and consumed-result identity are rechecked before one atomic commit | Permuted, cancelled, stale, and duplicate response cases |
| Transported markup executes code | Complete HTML is parsed inertly; the commit admits one framework document root and does not execute transported scripts | Hostile markup and rollback cases |
| History state is malformed, application-owned, or from another runtime chain | Only the exact private marker/version, active session identity, bounded entry/URL recovery record, and bounded scroll record are interpreted; guarded runtime writes are distinguished from application History API calls, and every other selected entry reloads current URL truth | Three-engine malformed/foreign/unowned traversal and same-URL copy recovery before and after reload |
| Application code copies a private-looking history state | A bounded active-runtime registry requires the exact state and URL created by the runtime, rejects repeated selection without an observed runtime traversal, persists the application-owned result across reload and every restart in that document, and fails closed on overflow | Three-engine cloned-entry and same-URL application-copy recovery |
| Browser restoration races runtime focus or scroll | Runtime temporarily selects manual restoration, focuses with scroll prevention, creates the destination entry before resetting its viewport, and restores the prior setting on close, page departure, startup refusal, or native recovery reload | Focus/scroll ordering, native-departure, reload/restart, and teardown checks |
| Numeric scroll is restored into changed layout | Enhanced traversal accepts only owned zero-scroll entries without observed element scroll; every nonzero or unsafe entry reloads | Document/element scroll refusal fixtures |
| Scroll events exhaust or cross history ownership | The first observed nonzero scroll makes an entry monotonically unsafe even after returning to zero or a forced flush, combined document and element ownership is retained, a guarded final flush stops after browser refusal, and traversal suppression remains tied to the newest traversal generation | Combined-scroll, mutation-limit, restart-monotonicity, and rapid traversal stale-write checks |
| Scroll changes race startup, traversal, close, or commit | Startup restores native scroll ownership after acquisition failure; displayed entry identity changes only after commit; bounded unsafe tracking and a bounded per-entry/URL restart record fail closed without disabling unrelated supported entries; scroll during pending traversal marks the displayed owner, cancels pending work, and reloads selected truth; recorded element-scroll ownership keeps later links native and is rechecked after request work; close during traversal reloads the selected URL; exact selected URL/state is revalidated before commit; pre-interception and pre-commit flushes capture late document scroll | Startup, overflow, per-entry resumption, state-replacement, element-link and pending-element refusal, multi-traversal, same-task, pending-traversal interruption, close-traversal, and late-scroll recovery checks |
| History selection succeeds before a later document commit, provenance check, or rollback failure | Document and history postconditions share one rollback boundary; every push selected during the failed commit rolls back before native reselection while a traversal replacement stays selected, preserving one-Back access without appending a duplicate destination | Three-engine focus/scroll commit failure, focus-time history mutation, multi-push recovery, persistent rollback failure, and single-entry recovery |
| A newer traversal takes an early native path while older work is pending | The newer traversal aborts its predecessor before checking the native-recovery boundary; obsolete work cannot redirect after the selected recovery | Three-engine native-supersession cancellation and stale-document recovery |
| A refused same-context activation occurs while traversal work is pending | Eligible and refused links plus still-native form submissions abort the traversal and repair displayed truth before native activation continues; form submission is not intercepted | Three-engine eligible-click, fragment-link, and native-form supersession with stale-document suppression |
| A user cancels required native recovery | Both preventDefault and legacy returnValue confirmation are observed; the still-active document repairs the selected slot to a fresh private entry at its trusted displayed URL, reacquires manual restoration, records the refusal, and either resumes enhancement or completes requested teardown | Three-engine traversal reload, close-time reload, post-selection fallback, and preselection fallback cancellation repair, flow, resumed-navigation, and native-after-close recovery |
| Motion preference changes correctness | V2-05 allocates no animation or transition work in either preference mode | Normal/reduced-motion no-animation checks |

## Native fallback and rollback

Blocked or disabled JavaScript leaves the native document active. V2-04 refuses
ineligible or preservation-unsafe links before preventing native behavior.
Operational rollback stops providing `browserModule`; the renderer emits no
script or private freshness metadata, the CSP returns to `script-src 'none'`,
no browser artifact is requested, and native links and forms still navigate.

## Residual risks

- V2-06 must prove form interception eligibility before preventing native
  behavior and must retain non-repeating mutation recovery.
- V2-05 through V2-09 must qualify actual reconciliation and preservation.
- The private schema may change before those consumers exist; it is not a
  compatibility promise.
