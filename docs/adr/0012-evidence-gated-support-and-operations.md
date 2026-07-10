# ADR 0012: Evidence-gated support and operations

- Status: Accepted
- Date: 2026-07-10
- Owners: Fadeno maintainers
- Related specifications: [Build and diagnostics](../spec/build-adapters-testing.md), [Security requirements](../security/requirements.md), [Progressive enhancement](../spec/progressive-enhancement.md)
- Supersedes: None

## Context

Claims about browser/runtime support, accessibility, performance, reliability,
observability, and upgrade safety become user commitments. A build succeeding
once or a roadmap mentioning an environment is not sufficient evidence.

## Decision drivers

- Support claims need reproducible conformance evidence.
- Production users need bounded failures, redacted observability, and a tested
  upgrade and rollback path.
- Performance and accessibility are behavior, not release-note decoration.

## Decision

Fadeno publishes support only for browsers, runtimes, adapters, databases, and
deployment shapes exercised by the applicable conformance suite.

Public alpha publishes measured compiler, browser, server, and build costs for
its supported slice. Beta adds load, latency, cancellation, reconnect where
applicable, memory-leak, and cache-correctness evidence plus structured error,
logging, metrics, and tracing hooks with redaction.

Stable release requires the published support matrix, accessibility audit,
upgrade and migration fixtures, compatibility checks, security review,
reproducible artifacts, and rollback drill to pass on the exact release
candidate. Quantitative claims identify their frozen reference environment and
relative baseline.

## Alternatives considered

- Infer support from platform API availability: rejected because host edge
  cases and browser behavior require execution evidence.
- Defer observability and upgrades until after 1.0: rejected because production
  behavior would become unreviewable at the compatibility boundary.
- Use only absolute performance numbers: rejected because hardware selection
  can determine the result; frozen environments and relative baselines are
  required.

## Consequences

- OPS-01, PERF-01, and ACCESS-01 are accepted release requirements.
- New adapter or browser support must add conformance ownership and CI evidence.
- Unsupported environments are stated explicitly rather than implied by local
  success.

## Validation

Release gates reproduce the support matrix, accessibility cases, benchmark
manifests, observability redaction, load/leak results, migration fixtures,
upgrade dry run, security review, artifact identity, and rollback drill.
