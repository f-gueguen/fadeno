# ADR 0018: Narrow the type spine around incremental generation

- Status: Accepted
- Date: 2026-07-12
- Owners: Fadeno maintainers
- Related specifications: [Compiler and analyzer](../spec/compiler-analyzer.md), [Build and diagnostics](../spec/build-adapters-testing.md), [K0 plan](../roadmap/k0.md)
- Supersedes: None

## Context

H3 proposed deterministic generated declarations that stock TypeScript tools
could use for route parameters, correlated links, action fields, and request
context. K0-08A froze a 1,000-route A/B corpus, stock `tsc` and TypeScript 7 LSP
controls, five warmups, 20 no-retry samples, and the decision thresholds before
reference execution.

Exact clean merged source commit
[`122ba57`](https://github.com/f-gueguen/fadeno/commit/122ba574a5de78394ca375277c867378af0bd658)
completed the digest-pinned local Docker qualification. All preflight,
postflight, cgroup, network, OOM, correctness, source-diagnostic, determinism,
stale-output, compiler, and language-server gates passed.

Clean generator p95 was 92,524,125 ns, stock `tsc --noEmit` p95 was
223,740,376 ns, and single-route incremental generator p95 was 79,892,292 ns.
The clean/`tsc` ratio passed at 0.413533 against the 1.5 maximum. The
incremental/clean ratio failed at 0.863475 against the 0.25 maximum.

## Decision drivers

- Correct stock-tool behavior and application-source diagnostics are required.
- A latency-only failure must produce the predeclared NARROW outcome.
- The result must not be optimized or reclassified after observing it.
- Editor plugins must not compensate for generator invalidation architecture.

## Decision

H3 is **narrowed**. Deterministic declarations consumed by stock `tsc` and the
stock TypeScript 7 LSP language server are accepted as the V1 type-spine
direction. The current whole-file generator and its transactional replacement
strategy are experiment code, not an acceptable production incremental design.

Before V1 implementation claims incremental generation, it must introduce and
qualify a bounded invalidation/output strategy whose single-route work meets the
locked ratio without weakening type correlation, stale-output removal,
determinism, or stock-tool compatibility. A custom editor plugin is not the
fallback.

## Alternatives considered

- Declare GO because clean generation is faster than `tsc`: rejected because
  the separately locked incremental threshold failed.
- Pivot away from generated declarations: rejected because every correctness,
  diagnostic, deterministic, stale-output, compiler, and language-server gate
  passed.
- Optimize and rerun before deciding: rejected because that would move the
  candidate after observing the qualification result.
- Add a framework-specific language service: rejected because stock TypeScript
  already consumed the output and the failure is generator invalidation cost.

## Consequences

- TYPE-01 retains a stock-TypeScript generated-declaration direction for V1.
- Production planning must budget an incremental invalidation redesign and
  qualification before promising fast single-route updates.
- The private corpus, file layout, ownership marker, and candidate names remain
  evidence code rather than public authoring or package syntax.
- K0 can continue to H4 without resolving route or form syntax.

## Validation

The independently verified immutable
[qualification result](../../experiments/type-spine/results/20260712T022123Z-122ba57-a1/manifest.json)
binds the raw 20-sample capture, exact source/corpus/contract/reference/lock
digests, stock-tool proof, derived metrics, and NARROW projection. The capture
verifier rejects source, environment, ordering, cgroup, OOM, artifact, and
decision mutations.
