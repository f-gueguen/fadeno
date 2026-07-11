# Type-spine experiment

- Hypothesis: H3 — stock-TypeScript route, form, and context typing.
- Harness slice: K0-07.
- Qualification slice: K0-08.
- Commands: `pnpm experiment:type-spine -- --list` prints the locked private
  contract without generating files; `pnpm experiment:type-spine --
  --verify-harness` runs contained deterministic generation and the seeded
  stock-TypeScript controls.

`fixtures/`, `tests/`, and `results/` are reserved by the K0 plan. K0-07 owns
the filesystem/generator harness and seeded consumers; K0-08 owns the 1,000
route corpus and immutable results. All runs use the central
[contract](../contract/README.md), [reference environment](../reference-environment.json),
and thresholds in the [K0 plan](../../docs/roadmap/k0.md).

The K0-07 generator accepts normalized semantic records only. It emits one
private, inspectable declaration artifact under an ownership manifest, refuses
unowned or symlinked output, replaces owned output transactionally, and leaves
byte-identical output untouched. Its fixed candidate names and file layout are
experiment ABI, not public route, form, context, or package syntax. K0-08 must
still qualify H3 on the 1,000-route corpus before any GO/NARROW/PIVOT decision.
