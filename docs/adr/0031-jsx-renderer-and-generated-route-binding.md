# ADR 0031: JSX renderer and generated route binding

- Status: Accepted
- Date: 2026-07-12
- Owners: Fadeno maintainers
- Related specifications: [Routing, rendering, streaming, and failures](../spec/routing-rendering-streaming.md), [Public model](../spec/public-model.md), [Build, adapters, and testing](../spec/build-adapters-testing.md)
- Supersedes: None

## Context

V1 has deterministic route discovery and generated links, an accepted sink
security policy, and an accepted streaming lifecycle, but no server JSX
renderer or running routed application. The first implementation must connect
those contracts without introducing a manual route registry, a second escaper,
or a second response state machine.

Standard TypeScript JSX transformation also requires a runtime module. That
module becomes public compiler input, so its exact subpath and types need an
explicit boundary before application source depends on them.

## Decision drivers

- Application routes remain filesystem-owned and deterministically generated.
- JSX remains standard TypeScript with HTML-shaped names.
- Rendering reuses accepted sink, raw-authority, nonce, and lifecycle policy.
- Essential output is a complete semantic document without JavaScript.
- The public surface is the minimum demonstrated by one packed application.

## Decision

The existing logical package adds exactly one public `./jsx-runtime` subpath.
It exports `jsx`, `jsxs`, `Fragment`, and the TypeScript `JSX` namespace needed
by the automatic transform. The root facade exports an opaque render-node type,
page and layout context types, one local `Boundary` primitive, typed not-found
and redirect outcomes, and one matched-route rendering operation used by
generated application bindings. It does not export a route table, route-source
loader, renderer internals, sink classifiers, lifecycle controls, nonce
constructors, stream chunks, or boundary state.

The existing `./node` adapter options add one request-scoped
`failureObserver`. Its structured report carries incident identity,
pre/post-publication phase, stable failure code, a redacted projection, and the
original cause. The cause is delivered only to that server-owned callback and
never enters the response or projection. Callback failure is observed and
discarded without changing response or cleanup ownership.

Intrinsic elements and attributes are closed to the HTML sink registry accepted
by ADR 0028. Children accept only authenticated render nodes, authenticated raw
HTML, strings, finite numbers, booleans with no visible output, nullish values,
and arrays of accepted children. Async component results and boundary child
functions may resolve to accepted children and are wrapped in authenticated
render nodes; direct promise children are not accepted. Arbitrary
objects, symbols, invalid promises, unknown elements or attributes, event
attributes, foreign content, inline style, application RAWTEXT, and void-element
children are refused. Runtime checks mirror the type boundary.

The private build generator emits deterministic application bindings from the
accepted route manifest. Bindings statically import discovered page, layout,
not-found, error, and raw-handler modules, perform metadata-only matching, and
invoke the public matched-route renderer. Authored source never registers paths
or supplies a manifest. Generated binding identity remains correlated with the
route manifest and is replaced transactionally with it.

A page receives its standard `Request`, decoded route parameters, and root
cancellation signal. A layout receives the same context plus its child node.
The generated binding supplies the selected matched route, so the renderer does
not rediscover filesystem policy. A typed redirect is validated before response
publication. A typed not-found outcome selects the nearest generated not-found
surface. Unexpected pre-publication failure selects the nearest generated error
surface with a secret-safe incident identity; the original error never enters
public markup.

The renderer directly consumes ADR 0028's classifier, encoders, raw capability,
nonce authority, and diagnostic projection. It directly consumes ADR 0029's
streaming lifecycle and boundary ownership. A local boundary keeps its dynamic
slot unpublished until it completes and passes sink validation. Pre-emission
failure may use its fallback; failure after an emitted slot terminates the root.
Output remains source ordered and pull driven with at most one pending chunk.
Cancellation and cleanup propagate through the accepted lifecycle.

Construction and return of the actual `Response` is the head-publication event.
Not-found, redirect, and unexpected failure replacement therefore complete
before that response is returned. A post-publication failure cannot replace its
status or headers.

Ordinary server-only pages allocate no nonce and emit no framework executable
markup. A private renderer-integrated conformance fixture exercises the future
framework-owned executable-markup path and proves one matching CSP header and
markup nonce. Missing, wrong, or reused nonce authority is refused or blocked;
authenticated raw HTML is never automatically blessed. The canonical example
does not add a no-op script merely to demonstrate CSP.

The canonical V1 application and isolated scenarios are installed from a
current packed package. They compile tracked TSX, generate bindings from the
tracked route sources, start through public entrypoints, assert behavior, and
normalize unstable evidence. Documentation is sourced from those executed
files.

## Alternatives considered

- Public manual route registry: rejected because filesystem discovery is the
  accepted authoring model.
- General component runtime: rejected because V1 needs server HTML and one
  local boundary, not a client-owned component lifecycle.
- Renderer-specific escaping or stream state: rejected because it would fork
  already accepted security and lifecycle policy.
- Always emit executable markup: rejected because the no-JavaScript application
  does not need it and unnecessary script expands security scope.
- Workspace-linked example: rejected because stale distribution output and
  missing exports could remain hidden.

## Consequences

- V1 gains its first running routed page and a narrow public JSX contract.
- The generated route binding is build output, not a second authoring API.
- Resources, actions, request context extensions, client enhancement, and
  public analyzer contracts remain later work.
- The package is still private and unpublished; release version and Changeset
  impact are none.
- Rollback removes the runtime subpath, renderer, binding generator, canonical
  example, and this ADR while preserving V1-06 through V1-08 evidence.

## Validation

`pnpm check:v1-renderer` replays the unchanged V1-07 and V1-08 policies through
real JSX output and proves ordered streaming, fallback, termination, and CSP
correlation. `pnpm check:v1-running-example` proves current-package route
generation, generated links, parser/CSP enforcement, route outcomes, nested
ownership, failure observation, and permanent success/failure/flow/recovery
evidence. `pnpm check:v1-public-package`, `pnpm check`, and `pnpm ci:local`
continue to verify package boundaries and the complete repository.
