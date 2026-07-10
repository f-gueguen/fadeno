# Roadmap ledger

This tracked ledger contains current execution state only. Durable decisions
belong in ADRs; current claims requiring evidence belong in the hypothesis
ledger; Git history records completed work.

## Current slice

K0-03 — Private structural HTML-update candidate

## Exit criteria

- [ ] One private structural HTML-update candidate consumes a minimal patch
  input without creating a public API or export.
- [ ] Structural identity is explicit enough for the K0-02 passing control and
  later preservation fixtures to distinguish reuse from replacement.
- [ ] `pnpm experiment:morph -- --fixture intentional-replacement` executes a
  reviewed control that proves declared replacement remains possible.
- [ ] Candidate input, structural identity, and intentional replacement remain
  private to `experiments/morph/`.
- [ ] `pnpm check` passes from a frozen install.

## In progress

- The K0-03 private candidate, atomic refusal matrix, type fixtures, exact CLI
  grammar, and candidate-produced operation/state proof are implemented. Local
  contract checks and the exact three-engine intentional-replacement command
  pass; hosted evidence and final independent reviews remain pending.

## Blockers

- None.

## Open questions

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
- K0-02 — The strict-TypeScript fixture API runs a proven preservation control
  and a proven undeclared-state-loss control in Chromium, Firefox, and WebKit;
  the digest-qualified reference job verifies browser identity and retains
  trace, screenshot, operation, and before/after evidence without introducing
  a morph candidate or qualification result.
