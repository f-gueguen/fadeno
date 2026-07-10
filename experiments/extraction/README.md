# Extraction experiment

- Hypothesis: H2 — bounded interaction extraction.
- Harness slice: K0-05.
- Qualification slice: K0-06.
- Command: `pnpm experiment:extraction` is not available until K0-05.

`fixtures/`, `tests/`, and `results/` are reserved by the K0 plan. K0-05 owns
accepted/rejected fixture and module-graph contracts; K0-06 owns qualification
and immutable results. All runs use the central [contract](../contract/README.md),
[reference environment](../reference-environment.json), and thresholds in the
[K0 plan](../../docs/roadmap/k0.md).

No analyzer, extractor, result, or public export exists in K0-01.
