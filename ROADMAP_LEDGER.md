# Roadmap ledger

This tracked ledger contains current execution state only. Durable decisions
belong in ADRs; current claims requiring evidence belong in the hypothesis
ledger; Git history records completed work.

## Current slice

K0-01 — Experiment contracts and frozen reference environment

## Exit criteria

- [ ] The reference environment records the runner image and capacity,
  operating system and architecture, Node.js and pnpm versions, browser builds,
  storage mode, power policy, and prohibited background load.
- [ ] The four private experiment directories follow one checked contract
  without exposing a public package or API.
- [ ] A versioned result-manifest schema requires source identity, environment,
  dependency-lock hash, command, warmup, repetitions, raw measurements,
  failures, and conclusion.
- [ ] Positive and negative fixtures prove the schema accepts complete evidence
  and rejects missing, malformed, non-finite, or path-escaping data.
- [ ] The aggregate command contract names every experiment without pretending
  that later harnesses or qualification results exist.
- [ ] `pnpm check:experiment-contract` passes.
- [ ] `pnpm check` passes from a frozen install.

## In progress

- K0-01 entry preparation; implementation has not started.

## Blockers

- None.

## Open questions

- K0-01: the exact reproducible GitHub-hosted runner capacity and browser-build
  pinning available to qualification jobs.
- DG-A0-01: public package names after registry ownership is secured.

## Completed slices

- F0 — The owner-approved canonical bootstrap is commit
  [`387d7f674dd193ae031cec52fd99a1f56242c170`](https://github.com/f-gueguen/fadeno/commit/387d7f674dd193ae031cec52fd99a1f56242c170),
  licensed under MIT by ADR 0013, and passed the frozen-install
  [`Check` run](https://github.com/f-gueguen/fadeno/actions/runs/29089431803).
