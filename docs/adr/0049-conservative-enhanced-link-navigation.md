# ADR 0049: Conservative enhanced link navigation

- Status: Accepted
- Date: 2026-07-20
- Owners: Fadeno maintainers
- Related specifications: [Navigation and patching](../spec/navigation-patching-preservation.md), [Progressive enhancement](../spec/progressive-enhancement.md), [Security requirements](../security/requirements.md)
- Supersedes: None

## Context

ADRs 0045, 0047, and 0048 provide a private bounded update envelope, an
explicit browser runtime, and one-pass projection of the native server outcome.
V2-04 must connect them for the first enhanced link without weakening native
navigation, inventing another authorization path, or claiming preservation that
has not yet passed the later reconciliation corpus.

## Decision drivers

- Decide whether the runtime can own an activation before preventing native
  browser behavior.
- Reuse the exact native GET, credentials, route, resource, session, renderer,
  and response authorities.
- Cancel superseded work and prevent stale or duplicate results from committing.
- Keep authorization and representation ownership on the server.
- Apply only at a boundary whose browser- and user-owned state is still known
  to be safe.
- Retain native destination and browsing-context behavior for every refusal.

## Decision

The runtime listens for trusted primary `click` activations after explicit
startup. It considers only an uncredentialed same-origin `http` loopback or
`https` link using the current browsing context and an ordinary GET. External,
credentialed, targeted, downloaded, modifier-activated, non-primary,
cross-origin, unsupported-scheme, and same-document-fragment links remain
native. The runtime completes this eligibility decision before calling
`preventDefault()` and before acquiring request ownership.

V2-04 has no general reconciliation claim. It refuses before interception when
the document contains dirty controls, open disclosure or top-layer state,
active media, a non-collapsed selection or caret, mounted client-owned identity,
nonzero document or element scroll, or another relevant state/layout boundary
that it cannot prove safe. The same state predicate is checked again after
response admission and before commit. A boundary becoming unsafe while a GET is
in flight causes normal navigation to the already-selected destination.

An admitted activation creates one browser-owned navigation operation with a
monotonic sequence, opaque operation identity, current document epoch, current
application generation, exact destination, and cancellation signal. A newer
navigation aborts the older one. The fetch is same-origin, carries the browser's
normal credentials and referrer policy, follows no redirect automatically, and
uses request `no-store`. Its private headers carry bounded correlation values
only. They do not carry authorization, session identity, trusted route identity,
or application-selected response policy.

The Node adapter recognizes the exact private GET media request, validates its
closed bounded headers and same-origin URLs, and creates a fresh opaque server
owner. It binds the resulting operation to the exact `Request` object before
calling the existing handler. The existing action/session wrapper, handler,
route, resources, and renderer execute once. The adapter then asks ADR 0048's
projector to consume that native `Response` once. It returns only projected
bytes with private `no-store` response policy. A malformed request, missing
application generation, unowned response, authorization mismatch, limit,
cancellation, or projection refusal produces no update envelope. A later
native GET is safe because V2-04 never intercepts mutation controls.

The renderer emits private, framework-owned generation and document-epoch
metadata only when it emits the generated browser module. Generation is the
server-owned application build identity. Each complete rendered document gets
a fresh epoch. These values establish browser freshness, not authorization.
The applied document supplies the next epoch for subsequent operations.

The browser independently measures and strictly decodes the untrusted bytes,
then admits them against its locally retained generation, epoch, operation,
sequence, URL, cache observation, consumed result identities, and cancellation
state. Admission returns a private typed outcome only inside the browser graph.
No markup or protocol type becomes a public export.

For an admitted document or expected error, the runtime parses the complete
HTML inertly, requires exactly one framework-owned document root and valid next
metadata, replaces the server-owned document shell without executing transported
scripts, updates the title and URL, creates or replaces the history entry as
appropriate, and moves focus to the new document's primary heading or main
landmark. A typed redirect performs a same-origin GET navigation and never
interprets executable strings. History traversal requests the selected entry
with replacement semantics; refusal or failure reloads that current URL.

No old result may commit after a newer operation, close, cancellation, changed
generation/epoch, unsafe preservation boundary, malformed response, or consumed
result. Commit is atomic from the runtime's perspective: validation completes
before document, title, URL, history, focus, epoch, and consumed-result state
change. An exception during commit triggers a current-destination native reload;
the runtime never presents a partial result as accepted.

The runtime retains bounded redacted flow records containing stable codes,
operation/result correlation, decisions, ownership categories, skipped work,
and observable outcome. It retains no URL credentials, cookies, submitted data,
markup, session identity, opaque owner, or arbitrary failure prose. The records
remain private test and later runtime-explanation evidence.

## Alternatives considered

- Intercept every same-origin link and reconcile later: rejected because native
  behavior has already been prevented when preservation turns out to be unsafe.
- Trust the browser headers as authorization: rejected because transported
  correlation cannot prove server representation ownership.
- Issue a second partial-render request path: rejected because native and
  enhanced routing, authorization, and rendering would diverge.
- Preserve all controls, scroll, media, and mounted identity now: rejected
  because V2-05 and V2-08 own those broader conformance claims.
- Expose the update envelope through `./browser`: rejected because it remains a
  private implementation detail without an external compatibility owner.

## Consequences

- The first enhanced navigation works only for deliberately simple documents;
  richer pages retain correct native navigation.
- The public browser facade remains unchanged while its explicit startup gains
  link behavior.
- The Node adapter privately participates in transport but application handlers
  and route code see the same GET semantics.
- V2-05 can broaden history, focus, selection, and scroll qualification without
  changing request authority. V2-08 remains responsible for general structural
  preservation.
- This additive prerelease behavior carries one pending minor Changeset.

## Validation

`pnpm check:v2-link-navigation` must use a current packed framework and the
canonical application to prove an enhanced success, deliberate eligibility and
transport refusals before interception, cancellation and permuted stale-result
ordering, same-user authorization and cross-user isolation, resource limits,
redacted flow output, document/title/URL/history/focus commit, back/forward
smoke, rollback, native destination and browsing-context fallback, and recovery
that removes stale results. Chromium, Firefox, and WebKit run the applicable
browser cases. `pnpm ci:local` retains every native and prior release gate.
