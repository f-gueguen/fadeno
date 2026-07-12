# Hypothesis ledger

This ledger contains only active architectural claims that need evidence.
Results enter ADRs and conformance tests; Git history carries completed trials.
The [detailed K0 plan](../roadmap/k0.md) owns qualification fixtures, repetitions,
quantitative thresholds, artifacts, and atomic delivery slices.

## H4 — Correctness-first revalidation viability

- Claim: revalidating page resources after a successful action is practical for
  the intended CRUD application class when paired with request deduplication,
  caching, and optional verified `keeps` declarations.
- Experiment: implement one representative authenticated CRUD vertical slice,
  publish its data shape and workload, and measure latency, query count, memory,
  and stale-result behavior with and without verified optimizations.
- Pass: the unoptimized path remains correct and its measured cost supports an
  interactive application on the documented test environment; each optimization
  has attributable benefit and a documented comparison strategy catches unsafe
  declarations without exposing authorization-sensitive values.
- Pivot: if the default cost is not viable, revise the dependency and
  invalidation model before exposing actions publicly.
- Current evidence: Harness and exact-source qualification capability ready; no
  H4 result or decision has been collected.
- Status: In progress.
