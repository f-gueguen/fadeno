# Morph experiment

- Hypothesis: H1 — browser-state-preserving server updates.
- Harness slice: K0-02.
- Qualification slice: K0-04.
- Command: `pnpm experiment:morph` is not available until K0-02.

`fixtures/`, `tests/`, and `results/` are reserved by the K0 plan. K0-02 owns
the fixture API and seeded harness failure; K0-03 owns the private candidate;
K0-04 owns the complete corpus and immutable results. All runs use the central
[contract](../contract/README.md), [reference environment](../reference-environment.json),
and thresholds in the [K0 plan](../../docs/roadmap/k0.md).

No harness, candidate, result, or public export exists in K0-01.
