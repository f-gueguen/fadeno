# ADR 0019: H4 local Docker reference environment

- Status: Accepted
- Date: 2026-07-12
- Owners: Fadeno maintainers
- Related specifications: [Data consistency](../spec/data-consistency.md), [K0 plan](../roadmap/k0.md)
- Supersedes: None

## Context

The hosted K0 Linux/x64 reference is unavailable, and ADR 0016 does not permit
ordinary local merge validation to become qualification evidence. ADR 0017
accepted an H3-only local Docker environment and explicitly required H4 to make
its own reviewed environment decision. H4 measures server-side correctness,
latency, and process memory; it does not need browser support.

## Decision drivers

- H4 thresholds must be frozen before any qualifying measurement.
- The environment must report its real host, architecture, userspace, power,
  thermal, resource-limit, and background-load constraints.
- Default and selective paths need the same pinned runtime and workload.
- A failed environment or evidence-integrity check must not become an H4
  product decision.
- Squash integration must not make the measured source a non-ancestor of its
  retained result.

## Decision

H4 uses the private `k0-h4-local-docker-arm64-v1` contract in
`experiments/revalidation/`. It is distinct from and not equivalent to the
historical K0 browser reference or the H3 reference, even though it reuses the
already verified Node image and observed host class from ADR 0017.

The environment requires the recorded Apple M2 Pro macOS host on AC power with
nominal thermal state; Docker Desktop/Engine 4.55.0/29.1.3; the digest-pinned
Node 22.14.0 linux/arm64 image; a container-local clean source copy; 2 CPUs,
8 GiB memory with no swap, 256 PIDs, and network disabled during proof and
measurement; the exact lock and toolchain; one qualification container; and
host/cgroup observations before warmup and after all phases.

K0-10 is split for provenance. K0-10A lands this environment, the complete
qualification contract, deterministic schedule, runner, independent verifier,
and negative controls without an immutable result or H4 decision. K0-10B runs
only the exact clean merged K0-10A commit from canonical `main`, allocates and
retains every launched attempt, uses the first complete reference-valid attempt
for the decision, permits environmental retries only, and publishes the result
plus GO or PIVOT ADR.

Qualification uses GO when every H4 gate passes, PIVOT when any product gate
fails, and INCONCLUSIVE when environment or evidence integrity fails. H4 has no
NARROW outcome under the accepted K0 plan.

## Alternatives considered

- Reuse the hosted K0 or H3 reference identity: rejected because scope,
  provider claims, and measurements would be false.
- Measure native macOS: rejected because runtime userspace and resource ceilings
  would be uncontrolled.
- Combine capability and result in one squash PR: rejected because the executed
  branch tip would not remain an ancestor of the merged evidence commit.
- Permit a NARROW performance outcome: rejected because the H4 authority says a
  failed gate pivots the invalidation/dependency model.

## Consequences

- H4 evidence supports only its private revalidation decision and makes no
  browser, deployment, or cross-architecture support claim.
- Preflight/postflight or integrity failures retain an inconclusive attempt but
  never produce a product decision.
- K0-10A can be reviewed without result-driven threshold changes.
- Public resource identity, cache, action, and `keeps` syntax remain blocked by
  their V1 decision gates.

## Validation

Repository checks strictly validate the H4 environment, lock hash, result
inventory, source split, and negative mutations. K0-10A later adds checks for
the schedule, full-output timing boundary, forced-GC RSS metric, capture/result
schemas, independent derivations, artifact secret scans, and absence of any H4
result or decision.
