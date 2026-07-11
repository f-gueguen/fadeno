# Hypothesis ledger

This ledger contains only active architectural claims that need evidence.
Results enter ADRs and conformance tests; Git history carries completed trials.
The [detailed K0 plan](../roadmap/k0.md) owns qualification fixtures, repetitions,
quantitative thresholds, artifacts, and atomic delivery slices.

## H3 — Stock-TypeScript type spine

- Claim: generated declarations plus stock `tsc` can validate route parameters,
  links, action fields, and context without a custom language service.
- Experiment: generate deterministic declarations from a filesystem fixture and
  compile positive and negative consumers with stock TypeScript.
- Pass: invalid parameters, links, form fields, and context access fail at the
  intended source location; valid consumers compile; two clean generations are
  byte-identical.
- Pivot: if source locations or inference are inadequate, narrow the generated
  contract before adding editor-specific tooling.
- Status: Not started.

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
- Status: Not started.
