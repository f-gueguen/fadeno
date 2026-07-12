# Architecture overview

This document maps the current architecture without claiming implementation
that does not yet exist.

## Product shape

Fadeno serves HTML from pages and fragments. Resources provide server-owned
reads. Actions perform mutations through native forms. The browser may enhance
navigation and submissions by applying server-derived output while preserving
browser and user-owned state. Explicit islands own interactions that need a
client lifecycle.

```text
request
  -> adapter
  -> route and page
  -> resources
  -> server renderer
  -> HTML response

form submission
  -> action
  -> resource revalidation
  -> updated server output
  -> navigation response or enhanced patch
```

The diagram is a semantic flow. It does not decide whether two flows use the
same wire envelope.

## Authority map

| Material | Purpose | Authority |
| --- | --- | --- |
| `PROJECT_INVARIANTS.md` and effective ADRs | Architectural constraints and rationale | Architecture |
| Released declarations, schemas, and conformance tests | Observable released behavior | Released behavior |
| `docs/spec/` | Current intended behavior | Current implementation contract |
| `docs/product/scope.md` | Capability inclusion, state, and first delivery gate | Product scope |
| `docs/traceability.md` | Cross-document coverage and expected evidence | Coverage index |
| Executable examples | Demonstration of released behavior | APIs they exercise |
| Current ledgers and roadmap | Evidence, risk, deferral, and work state | Non-normative |

A conflict between these surfaces blocks the change. Architecture cannot claim
behavior that conformance disproves, and released behavior cannot silently
violate an architectural constraint.

## Repository shape

- `packages/` contains packages only after a boundary has an implementation and
  demonstrated consumer.
- `experiments/` contains kill-risk evidence and does not define public APIs.
- `examples/` contains only applications executed in CI.
- `docs/adr/` contains accepted architectural decisions.
- `docs/spec/` contains the current behavioral contract.
- `docs/ledgers/` separates hypotheses, risks, and deferrals.
- `scripts/` contains repository-wide policy checks.

ADR 0024 selects one logical framework package from K0 imports and a packed
private consumer. ADR 0025 creates that private package and its executable Node
adapter smoke example at the V1-04 checkpoint. ADR 0027 keeps route discovery,
generation, and metadata matching private inside that package while generated
applications consume the isolated `fadeno:routes` module. Route module
execution and rendering are implemented by V1-09 through ADR 0031's generated
binding, narrow JSX runtime, matched-route renderer, and packed application.

ADR 0030 adds a private analyzer session inside the selected package. It is the
single framework-semantic authority for checks, watch/build integration, tests,
and disposable lifecycle evidence. Stock TypeScript remains the authority for
ordinary TypeScript and JSX language behavior. The analyzer session, facets,
and snapshots are not public exports or supported protocols.

## Dependency direction

The initial package has a runtime-neutral `.` facade and a Node-specific
`./node` facade. Public facades may depend inward on private implementation;
the neutral root cannot reach Node, compiler, or browser-only graphs. Private
zones may be reorganized without becoming independent public packages.
Adapters depend on the server contract. Examples depend only on public
entrypoints.

Private analyzer modules depend inward on shared workspace ownership,
configuration, route generation, diagnostics, and later compiler semantics.
Consumers request immutable bounded facets; modules do not depend outward on a
specific CLI, watcher, test runner, or editor product. Static analyzer evidence
and observed runtime evidence remain separate dependency branches.

No package may import another package through a relative filesystem path or a
private deep import. The boundary check enforces static imports, re-exports,
dynamic imports, traversal, and symlink canonicalization before the first real
package is added.

## Evidence gates

K0 tested four claims before committing to public runtime architecture:

1. browser-state-preserving HTML updates;
2. bounded interaction extraction;
3. stock-TypeScript route, form, and context typing;
4. correctness-first revalidation at representative cost.

ADRs 0014, 0015, 0018, and 0020 preserve their NARROW/GO outcomes. ADR 0021 and
the [V1 plan](../roadmap/v1.md) define how those results constrain delivery; the
hypothesis ledger is now empty.
