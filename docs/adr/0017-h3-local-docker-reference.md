# ADR 0017: H3 local Docker reference environment

- Status: Accepted
- Date: 2026-07-12
- Owners: Fadeno maintainers
- Related specifications: [Build and diagnostics](../spec/build-adapters-testing.md), [K0 plan](../roadmap/k0.md)
- Supersedes: None

## Context

ADR 0016 replaced unavailable hosted merge validation but deliberately did not
classify a maintainer workstation as the existing K0 reference environment.
H1 and H2 evidence remains bound to the frozen GitHub linux/x64 browser host.
H3 needs stock-TypeScript correctness and relative compiler/generator timings,
not browser support, and cannot run on the unavailable hosted runner.

## Decision drivers

- Historical H1/H2 provenance and browser support evidence must remain exact.
- H3 ratios need pinned userspace, runtime, resource ceilings, workload, and
  pre/postflight rather than an unconstrained native workstation.
- Docker Desktop limits container resources but does not isolate host load,
  power, or thermal state.
- A failed performance threshold must produce the predeclared NARROW outcome,
  not an after-the-fact benchmark optimization.

## Decision

H3 uses the private `k0-h3-local-docker-arm64-v1` reference contract under
`experiments/type-spine/`. It is separate from and not equivalent to the
historical `k0-linux-x64-v1` browser reference.

The H3 environment requires:

- the recorded Apple M2 Pro arm64 host class, macOS build, AC power, nominal
  thermal state, minimum storage, and bounded pre/postflight load;
- Docker Desktop/Engine 29.1.3 with no competing qualification container;
- the digest-pinned Node 22.14.0 bookworm-slim linux/arm64 image;
- a container-local source copy, 2 CPU, 8 GiB memory with no swap, 256 PIDs,
  and network disabled during correctness and measurement;
- pnpm 11.7.0, TypeScript 7.0.2, and the exact dependency lock digest; and
- host plus cgroup observations immediately before warmup and after all
  samples. A mismatch or postflight drift makes the attempt inconclusive.

K0-08 is split for source provenance. K0-08A lands the environment, independent
1,000-route corpus, runner, verifier, stock-tool controls, and decision policy
with no immutable result. K0-08B executes only from the exact clean merged
K0-08A commit on canonical `main`, publishes every reference-valid attempt, and
adds the resulting ADR.

The corpus contains only private opaque IDs, scalar parameter/field records,
and workload-only parent/depth metadata. It does not choose filesystem roots,
route filenames, segment notation, form decoding, or request-context syntax.

## Measurement and decision policy

The locked runner uses five warmups and exactly 20 no-retry samples for clean
generation, stock `tsc --noEmit`, and single-route generation. Generator and
`tsc` are fresh pinned child processes and their rounds are interleaved. p95 is
nearest rank: `sorted[ceil(0.95 * count) - 1]`.

Every incremental sample alternates two inputs that differ in exactly one route
and must report one replacement with the expected changed digest and exact type
delta. The no-change fast path is never a performance sample.

- GO requires every correctness, determinism, stale-output, stock `tsc`, stock
  TypeScript 7 LSP language-server, clean-latency, and incremental-latency gate
  to pass. TypeScript 7 replaced the custom `tsserver` protocol with LSP.
- NARROW requires all non-performance gates to pass while either latency gate
  fails.
- PIVOT follows a type-correctness, source-location, deterministic-generation,
  stale-output, or stock-tool failure.
- Environment/preflight/postflight/evidence-integrity failure is inconclusive
  and produces no H3 decision.

## Alternatives considered

- Reuse the GitHub browser reference identity locally: rejected because the
  provider, architecture, hardware, power, and browser facts would be false.
- Use native macOS timings: rejected because CPU/memory/userspace cannot be
  constrained and current background load is not isolated.
- Optimize incremental generation before measuring: rejected because it would
  move the threshold after observing the candidate.
- Land capability and result in one squash PR: rejected because the executed
  source would not remain an ancestor of the merged evidence commit.

## Consequences

- H3 evidence supports the type-spine decision only; it makes no browser,
  deployment, or cross-architecture support claim.
- Reference execution waits for honest preflight rather than weakening limits.
- The likely NARROW performance outcome is acceptable evidence.
- H4 still requires its own reviewed reference-environment decision.

## Validation

K0-08A checks the strict environment and corpus schemas, pinned image identity,
locked commands and p95 policy, A/B one-route delta, diagnostics, language-
service transcript controls, result projection, negative mutations, and the
absence of immutable H3 results. K0-08B validates source ancestry, raw samples,
pre/postflight, exact artifact inventory, derived thresholds, and decision.
