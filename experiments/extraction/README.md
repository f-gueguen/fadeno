# Extraction experiment

- Hypothesis: H2 — bounded interaction extraction.
- Harness slice: K0-05.
- Qualification slice: K0-06.
- Commands: `pnpm experiment:extraction -- --list` prints the locked inventory;
  `pnpm experiment:extraction -- --verify-harness` runs the two seeded controls.

`fixtures/`, `tests/`, and `results/` are reserved by the K0 plan. K0-05 owns
accepted/rejected qualification inputs and one separate executable harness seed;
K0-06 owns qualification and immutable results. All runs use the central [contract](../contract/README.md),
[reference environment](../reference-environment.json), and thresholds in the
[K0 plan](../../docs/roadmap/k0.md).

The qualification inventory binds the exact accepted/rejected TypeScript source
files, support declarations, hashes, logical module roles, edges, and triggers.
The `seed/` inventory separately binds the exact HTML/JavaScript bytes, response
paths, content types, roles, and edges served by the browser control. The seed is
not a qualification case and its shared-module edge is not imposed on the corpus.
Both inventories are private experiment input, not
an accepted extraction syntax or external schema. No analyzer, extractor,
result, qualification decision, or public export exists yet.
