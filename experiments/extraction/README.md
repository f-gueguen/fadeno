# Extraction experiment

- Hypothesis: H2 — bounded interaction extraction.
- Harness slice: K0-05.
- Qualification slice: K0-06.
- Commands: `pnpm experiment:extraction -- --list` prints the locked inventory;
  `pnpm experiment:extraction -- --verify-harness` runs the two seeded controls;
  `pnpm experiment:extraction -- --verify-qualification` runs the local
  three-engine matrix; `pnpm experiment:extraction -- --qualify` requires a
  clean pinned reference environment and publishes an immutable manifest.

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
Both inventories are private experiment input, not an accepted authoring syntax
or external schema. The K0-06 checker-backed candidate, diagnostic catalogue,
GO decision, and immutable result support ADR 0015's semantic boundary. They
remain private evidence code with no package entrypoint or public export.

K0-06 adds a separately golden-bound companion root containing the private
`seedInteraction` experiment marker, nested closures, one positive plain-data
capture, and deliberately unrelated imports. Its pre-locked decision policy is:
GO only at 5/5; NARROW only when tabs alone fails and the four named core classes
plus every boundary pass; PIVOT on any core, identity, boundary, determinism, or
generation-safety failure.
