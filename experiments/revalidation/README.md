# Revalidation experiment

- Hypothesis: H4 — correctness-first revalidation viability.
- Harness slice: K0-09.
- Qualification slice: K0-10.
- Command: `pnpm experiment:revalidation -- --list` prints the locked private
  workload contract without executing qualification cycles.

`app/`, `fixtures/`, `tests/`, and `results/` are reserved by the K0 plan.
K0-09 owns the private CRUD benchmark and unsafe-`keeps` controls; K0-10 owns
qualification and immutable results. All runs use the central
[contract](../contract/README.md), [reference environment](../reference-environment.json),
and thresholds in the [K0 plan](../../docs/roadmap/k0.md).

K0-09's deterministic workload is a private evidence ABI. Resource IDs,
typed resource inputs, comparison tags, authentication records, and the
selective baseline are not public V1 syntax or exports. Equivalent inputs are
canonicalized for request-local identity; unsupported input/result values are
conservatively refused rather than compared through lossy serialization.
