# Revalidation experiment

- Hypothesis: H4 — correctness-first revalidation viability.
- Harness slice: K0-09.
- Qualification slice: K0-10.
- Command: `pnpm experiment:revalidation` is not available until K0-09.

`app/`, `fixtures/`, `tests/`, and `results/` are reserved by the K0 plan.
K0-09 owns the private CRUD benchmark and unsafe-`keeps` controls; K0-10 owns
qualification and immutable results. All runs use the central
[contract](../contract/README.md), [reference environment](../reference-environment.json),
and thresholds in the [K0 plan](../../docs/roadmap/k0.md).

No application, resource/action contract, result, or public export exists in
K0-01.
