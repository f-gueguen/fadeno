# Type-spine experiment

- Hypothesis: H3 — stock-TypeScript route, form, and context typing.
- Harness slice: K0-07.
- Qualification capability slice: K0-08A.
- Qualification evidence and decision slice: K0-08B.
- Commands: `pnpm experiment:type-spine -- --list` prints the locked private
  contract without generating files; `pnpm experiment:type-spine --
  --verify-harness` runs contained deterministic generation and the seeded
  stock-TypeScript controls; and `pnpm experiment:type-spine --
  --verify-qualification` checks the frozen corpus/runner contracts plus real
  stock `tsc` and TypeScript 7 LSP consumption without recording a result.

`fixtures/`, `tests/`, and `results/` are reserved by the K0 plan. K0-07 owns
the filesystem/generator harness and seeded consumers; K0-08 owns the 1,000
route corpus and immutable results. All runs use the central
[contract](../contract/README.md), [reference environment](../reference-environment.json),
and thresholds in the [K0 plan](../../docs/roadmap/k0.md).

The K0-07 generator accepts normalized semantic records only. It emits one
private, inspectable declaration artifact under an ownership manifest, refuses
unowned or symlinked output, replaces owned output transactionally, and leaves
byte-identical output untouched. A failed replacement restores the prior owned
tree or retains its exact backup for explicit recovery. Semantic IDs and keys
are bounded opaque values that are quoted in output; they do not choose route,
form, or field naming or cross-category collision policy. The fixed candidate
names and file layout are experiment ABI, not public route, form, context, or
package syntax. K0-08B must still qualify H3 on the 1,000-route corpus before
any GO/NARROW/PIVOT decision.

K0-08A freezes that workload in `qualification-corpus.json`. Its A and B inputs
contain exactly 1,000 opaque route records and differ in exactly `r0999`; the
separate topology projection supplies nested-workload coverage without turning
parent/depth metadata into framework syntax. The checked builder is the corpus
provenance control, while the qualification runner consumes the committed JSON
as its authority. No file under `results/` is produced by K0-08A.

The timing runner measures fresh child processes in the locked
clean-generator/stock-compiler/incremental-generator order. Five warmups are
discarded, 20 A/B samples are retained without retry, and p95 uses nearest
rank. Its pure projection treats invalid pre/postflight as inconclusive,
correctness or stock-tool failures as PIVOT, latency-only failures as NARROW,
and an all-pass observation as GO. K0-08A executes only a two-sample smoke
schedule and therefore cannot create qualification evidence.
