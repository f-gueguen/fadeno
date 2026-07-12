# ADR 0020: Accept correctness-first revalidation

- Status: Accepted
- Date: 2026-07-12
- Owners: Fadeno maintainers
- Related specifications: [Data consistency](../spec/data-consistency.md), [K0 plan](../roadmap/k0.md)
- Supersedes: None

## Context

H4 asked whether revalidating every page resource after a successful action is
correct and practical for Fadeno's intended CRUD application class, and whether
request-local deduplication plus conservative comparison can safely support a
later selective optimization. K0-09 froze the private six-resource, nine-read,
10,000-row workload. K0-10A froze the qualification environment, 10,000-cycle
schedule, complete-output latency boundary, forced-GC RSS method, and decision
thresholds before collecting a result.

Exact clean merged source commit
[`51594a8`](https://github.com/f-gueguen/fadeno/commit/51594a8b8f460a9b28e1e0ade25816a5a898395b)
ran in the H4-only Docker reference. Attempts 1 through 11 were retained as
environmentally inconclusive because host-idle samples missed the frozen limit.
Attempt 12 was the first complete reference-valid attempt and therefore owns the
decision.

All 10,000 correctness cycles passed with zero stale cycles and zero
deduplication failures. Default p95 was 25,209 ns; selective p95 was 19,375 ns;
their ratio was 1.301110 against the 2.0 maximum. Default p95 was 0.025209 ms
against the 300 ms maximum. RSS growth was 0.048961 against the 0.10 maximum.
All unsafe-`keeps`, comparison, environment, and artifact-integrity gates passed.

## Decision drivers

- Correctness and authorization-safe failure behavior are mandatory.
- Default full revalidation must remain viable without selective declarations.
- Performance results must come from the first complete reference-valid attempt.
- Public resource, action, cache, and `keeps` syntax remains a separate V1 gate.

## Decision

H4 is **GO**. Fadeno accepts correctness-first server revalidation as the V1
internal direction: after a successful action, the framework may revalidate all
resources used by the active page, with equivalent request-local reads
deduplicated by resource identity and input.

Selective `keeps` remains an optional later optimization. Before it becomes
public, its API and comparison semantics must pass DG-V1-04 and preserve the
qualification's conservative refusal behavior for non-cacheable or unsupported
values. The GO result does not authorize cross-request caching or public syntax.

## Alternatives considered

- Pivot the invalidation model: rejected because every locked product gate
  passed.
- Treat an earlier full measurement as authoritative: rejected because its
  postflight host samples failed.
- Weaken the host-idle threshold to finish sooner: rejected because results may
  not move their frozen environment policy.
- Require selective declarations for viability: rejected because the default
  path passed both absolute and relative latency limits.

## Consequences

- DATA-03 may proceed to V1 implementation planning without an H4 blocker.
- The default implementation remains correct with all `keeps` declarations
  removed.
- DG-V1-04 still owns public resource/cache/`keeps` shape and semantics.
- H3's incremental-generation NARROW remains independent; it does not reduce
  the accepted revalidation scope.

## Validation

The independently verified immutable
[qualification result](../../experiments/revalidation/results/qualification-result.json)
binds attempt 12's raw capture to the exact source and frozen inputs. The
checker validates all 12 retained attempt records, rescans retained text,
recomputes environment and artifact links, independently derives every metric
and gate, and rejects any result projection mismatch.
