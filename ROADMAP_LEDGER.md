# Roadmap ledger

This tracked ledger contains current execution state only. Durable decisions
belong in ADRs; current claims requiring evidence belong in the hypothesis
ledger; Git history records completed work.

## Current slice

K0-02 — Three-engine morph harness

## Exit criteria

- [ ] Chromium, Firefox, and WebKit projects execute through one private fixture
  API in the K0-01 reference environment.
- [ ] `pnpm experiment:morph -- --list` reports the complete fixture inventory
  without running it.
- [ ] A seeded passing fixture proves the harness can observe preservation.
- [ ] A seeded failing fixture proves the harness fails for an undeclared state
  loss instead of rewarding non-execution.
- [ ] Failure output captures a trace, screenshot, structural operation, and
  before/after state.
- [ ] Browser binaries and mutable host facts pass the K0-01 preflight before a
  run can be classified as reference evidence.
- [ ] No structural update candidate or public export is introduced.
- [ ] `pnpm check` passes from a frozen install.

## In progress

- K0-02 entry preparation; no browser harness has been implemented.

## Blockers

- None.

## Open questions

- K0-02: the smallest fixture API that proves all three engines execute and
  preserves seeded-failure integrity without defining the later morph input.
- DG-A0-01: public package names after registry ownership is secured.

## Completed slices

- F0 — The owner-approved canonical bootstrap is commit
  [`387d7f674dd193ae031cec52fd99a1f56242c170`](https://github.com/f-gueguen/fadeno/commit/387d7f674dd193ae031cec52fd99a1f56242c170),
  licensed under MIT by ADR 0013, and passed the frozen-install
  [`Check` run](https://github.com/f-gueguen/fadeno/actions/runs/29089431803).
- K0-01 — The four private experiment directories, v1 evidence schemas,
  hardened positive/negative fixtures, digest-pinned reference environment,
  and deterministic aggregate list/refusal contract are checked without
  claiming a harness or qualification result.
