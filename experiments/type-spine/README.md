# Type-spine experiment

- Hypothesis: H3 — stock-TypeScript route, form, and context typing.
- Harness slice: K0-07.
- Qualification slice: K0-08.
- Command: `pnpm experiment:type-spine` is not available until K0-07.

`fixtures/`, `tests/`, and `results/` are reserved by the K0 plan. K0-07 owns
the filesystem/generator harness and seeded consumers; K0-08 owns the 1,000
route corpus and immutable results. All runs use the central
[contract](../contract/README.md), [reference environment](../reference-environment.json),
and thresholds in the [K0 plan](../../docs/roadmap/k0.md).

No generator, declarations, result, or public export exists in K0-01.
