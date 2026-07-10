# Roadmap ledger

This tracked ledger contains current execution state only. Durable decisions
belong in ADRs; current claims requiring evidence belong in the hypothesis
ledger; Git history records completed work.

## Current slice

F0 — Canonical repository authority and governance bootstrap

## Exit criteria

- [x] The freeze notice is authored in the design repository checkout.
- [x] The canonical repository is initialized on `main`.
- [x] Project invariants and agent instructions are tracked.
- [x] Accepted decisions are represented as ADRs.
- [x] Current specifications contain no copied design analysis.
- [x] Hypothesis, risk, and deferral ledgers are separated.
- [x] Every planned capability is classified in the feature matrix.
- [x] Current specifications cover each initial implementation surface.
- [x] Feature traceability maps decisions, specifications, gates, and evidence.
- [x] The K0 plan defines atomic slices, artifacts, commands, and thresholds.
- [x] The contributor and coding-agent workflow is canonical and checked.
- [x] One repository check command validates governance and documentation.
- [x] CI is configured to run the same check command from a frozen install.
- [ ] Hosted CI passes on the initial commit.
- [x] The design-repository freeze notice is committed.
- [x] A repository license is selected before external contributions open.
- [x] The initial repository contents are reviewed and committed by the owner.

## In progress

- Hosted CI validation of the owner-approved initial commit.

## Blockers

- Hosted CI evidence is pending the initial push to the authorized private
  repository.

## Open questions

- DG-A0-01: public package names after registry ownership is secured.

## Completed slices

- None. F0 remains open pending hosted CI evidence for the initial commit.
