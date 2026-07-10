# Outcome roadmap

The roadmap defines evidence gates, not dates, release counts, or a speculative
package inventory. Only the current slice appears in detail in
[ROADMAP_LEDGER.md](../ROADMAP_LEDGER.md).

The next implementation gate has a reviewed
[detailed K0 plan](roadmap/k0.md). A detailed plan for the following gate is
written only after the current evidence is accepted, so future work is neither
forgotten nor specified from guesses. The
[feature matrix](product/scope.md) preserves full release coverage meanwhile.

## F0 — Canonical foundation

Outcome: one checked repository contains current project law, accepted
decisions, specifications, and separated ledgers. The design repository is
frozen. No fictional runtime surface is presented.

## K0 — Kill-risk evidence

Outcome: each active hypothesis has a reproducible experiment, recorded
environment, result, and go, narrow, or pivot decision. Browser updates and
interaction extraction run in real browsers. Type generation runs through
stock TypeScript. Revalidation is measured in a representative data workflow.

## V1 — Secure no-JavaScript vertical slice

Outcome: one authenticated CRUD application routes, renders, reads, submits,
validates, redirects, revalidates, and handles failures with JavaScript
disabled. A server adapter, renderer, resource/action model, form decoder,
cookie policy, threat model, test helpers, and reproducible build exist only to
the extent required by that slice.

## V2 — Browser enhancement

Outcome: the same application enhances navigation and actions without changing
their semantics. Cross-browser conformance covers preservation, history,
focus, duplicate submission, stale responses, cancellation, and recovery. The
runtime's measured cost is published.

## V3 — Interaction ownership

Outcome: evidence from K0 determines the supported extracted-handler boundary.
Explicit islands provide lifecycle and local state. Diagnostics teach accepted
and rejected patterns, and server updates preserve client-owned identity.

## A0 — Public alpha

Outcome: a new user can install, scaffold, build, test, diagnose, and deploy the
supported vertical slice from public artifacts. Security gates, package
contents, provenance, rollback, and clean-machine installation are verified.
The public surface remains explicitly pre-1.0.

## B0 — Beta reliability

Outcome: design-partner applications exercise upgrades and production
operations. Support matrices, load and leak results, observability hooks,
compatibility checks, migration fixtures, and independent security findings are
published and acted upon.

## R1 — Stable release

Outcome: public declarations, configuration, diagnostic codes, and external
schemas are frozen for 1.0; accessibility, interoperability, documentation,
security, reproducibility, and rollback audits pass; release candidates soak
before the exact tested artifacts become 1.0.

Scope is re-estimated after K0 and after V1. Calendar forecasts are not treated
as architecture.
