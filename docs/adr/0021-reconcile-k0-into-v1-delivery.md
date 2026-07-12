# ADR 0021: Reconcile K0 evidence into V1 delivery

- Status: Accepted
- Date: 2026-07-12
- Owners: Fadeno maintainers
- Related specifications: [Product scope](../product/scope.md), [V1 plan](../roadmap/v1.md)
- Supersedes: None

## Context

K0 has four immutable results and effective decisions:

- H1 NARROW: structural browser updates are viable for the passing preservation
  classes, but layout-affecting scroll needs an explicit V2 boundary.
- H2 GO: bounded handler extraction is viable for V3 under conservative refusal.
- H3 NARROW: stock-TypeScript declarations and clean generation are viable for
  V1, but the whole-file incremental strategy is not.
- H4 GO: correctness-first revalidation is viable for the representative CRUD
  workload; public cache and `keeps` syntax remains gated.

The product matrix and several specifications still described H3 or H4 as
unresolved, and the outcome roadmap had no implementation-ready V1 plan. Leaving
those surfaces stale would make the next coding slice guess its dependencies,
public contracts, and first usable checkpoint.

## Decision drivers

- K0 results must change current scope without publishing experiment syntax.
- The first running framework should arrive before the full CRUD vertical slice.
- Open V1 contracts must resolve through their existing decision gates before
  implementation freezes accidental APIs.
- H3's incremental failure must not block correct clean generation.
- V2/V3 evidence must not expand the V1 JavaScript-free baseline.

## Decision

Adopt the detailed [V1 delivery plan](../roadmap/v1.md) as the implementation
order after K0. V1 remains a secure no-JavaScript vertical slice. It accepts:

- stock-TypeScript generated declarations with deterministic clean generation,
  while making no fast-incremental-generation claim;
- correctness-first full resource revalidation with request-local deduplication;
- one Web-standard server adapter and one demonstrated example consumer;
- native links and forms as the semantic baseline.

K0's browser patching and bounded extraction results remain V2 and V3 inputs.
Their private candidates, markers, filenames, and wire shapes do not enter V1.

The first running checkpoint is V1-04: a clean consumer starts one selected
adapter and serves a server-rendered HTML response through the first public
package boundary. It is intentionally smaller than the usable V1 exit. The
usable V1 exit is V1-14: the authenticated CRUD example and documentation pass
the full native, security, type, adapter, and clean-machine suites.

## Alternatives considered

- Implement the full CRUD slice before exposing a running checkpoint: rejected
  because adapter/package/build integration can be validated earlier.
- Treat H3 NARROW as a pivot away from generated declarations: rejected because
  correctness, stock compiler/LSP use, and clean latency passed.
- Move patching or extraction into V1: rejected because progressive enhancement
  is V2 and interaction ownership is V3.
- Resolve all V1 gates in one architecture PR: rejected because each contract
  needs focused evidence, fixtures, and rollback.

## Consequences

- K0 is complete and no hypothesis remains active.
- DATA-03 becomes accepted V1 scope under ADR 0020.
- V1 implementation can begin with the gate-first sequence in `roadmap/v1.md`.
- The first running version is near, but not yet a usable framework: K0-11 is
  followed by three decision/prototype slices and V1-04.
- Complete examples and user documentation remain a V1 exit requirement, not a
  post-release cleanup.

## Validation

Repository checks require all K0 experiments to be qualified, no active K0
hypothesis, scope/traceability alignment, the V1 plan's complete feature and
gate coverage, and current specifications that state each narrowed boundary.
