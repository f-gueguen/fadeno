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

The initial repository deliberately has no fictional framework package or
example application. The first real package and example arrive together at the
V1-04 checkpoint after DG-V1-01 selects the boundary.

DG-V1-01 blocks the first package boundary until K0 imports and a demonstrated
consumer show the smallest useful split.

## Dependency direction

When packages are introduced, public facades may depend on private compiler or
runtime implementation packages. Implementation packages may depend on small
shared internal types. Adapters depend on the server contract. Examples depend
only on public entrypoints.

No package may import another package through a relative filesystem path or a
private deep import. A boundary check will enforce the rule when the first
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
