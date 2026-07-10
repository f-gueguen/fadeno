# Roadmap ledger

This tracked ledger contains current execution state only. Durable decisions
belong in ADRs; current claims requiring evidence belong in the hypothesis
ledger; Git history records completed work.

## Current slice

K0-04 — H1 browser-state-preservation qualification

## Exit criteria

- [ ] The reviewed corpus covers focus/selection/caret, dirty controls,
  disclosure/dialog/popover, media, document/element scroll, structural
  insert/remove/reorder, and intentional replacement.
- [ ] Chromium, Firefox, and WebKit execute every fixture for 20 CI repetitions
  and 100 qualification repetitions without retrying failures.
- [ ] There are zero undeclared state-loss, focus-transfer, runtime-error, or
  unhandled-promise failures; intentional replacement occurs in every declared
  control.
- [ ] Failure evidence names the structural operation and exact before/after
  state through the checked portable artifact contract.
- [ ] Immutable raw manifests support an effective go, narrow, or pivot ADR and
  update H1, PATCH-01 traceability, specifications, risks, and support claims
  without creating a public patch protocol.
- [ ] `pnpm install --frozen-lockfile`, `pnpm check`, and
  `pnpm experiment:morph -- --qualify` pass on the required environments.

## In progress

- K0-04 entry preparation only. No qualification corpus, repeated result,
  immutable manifest, or H1 decision ADR has been implemented.

## Blockers

- None.

## Open questions

- K0-04: before adding the full preservation corpus, reassess whether
  scenario-specific evidence policy should split from the stable artifact/trace
  verifier and its mutation checker; K0-03 keeps their two-key independence.
- K0-04: measure the one-shot candidate's document-wide identity scan under the
  repeated corpus before introducing a cached index or retained root handle;
  K0-03 avoids stale lifecycle state while enforcing ambiguity refusal.
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
- K0-03 — One private strict-TypeScript candidate prevalidates a bounded
  structural input before DOM writes, proves exact root/input reuse and declared
  peer replacement in Chromium, Firefox, and WebKit, refuses ambiguous or
  unsupported input without partial mutation, and retains independent K0-02 and
  K0-03 reference evidence without resolving H1 or DG-V2-01.
