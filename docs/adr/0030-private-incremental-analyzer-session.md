# ADR 0030: Private incremental analyzer session

- Status: Accepted
- Date: 2026-07-12
- Owners: Fadeno maintainers
- Related specifications: [Compiler, analyzer, generated types, and diagnostics](../spec/compiler-analyzer.md), [Build, adapters, and testing](../spec/build-adapters-testing.md)
- Supersedes: None

## Context

V1 already generates route artifacts and reports framework diagnostics, but
those operations do not yet share one versioned workspace model. Recreating
configuration, ownership, invalidation, diagnostic, and explanation policy in
checks, watches, tests, and later development consumers would allow those
surfaces to disagree. It would also make stale or mixed-generation evidence
difficult to detect.

Ordinary TypeScript and JSX language behavior remains owned by stock
TypeScript. Fadeno needs only framework-semantic analysis: workspace and
configuration ownership, routes and generated artifacts, execution boundaries,
framework diagnostics and corrections, provenance, and bounded plan or explain
evidence. A supported editor product and a stable external analyzer schema have
not earned public contracts.

## Decision drivers

- One framework policy source must serve checks, watches, tests, and disposable
  development consumers.
- Unsaved document text and filesystem state must never be silently confused.
- Direct and transitive changes must replace one complete generation atomically.
- Cancellation and supersession must prevent obsolete work from publishing.
- Future framework modules must contribute evidence without expanding one
  rigid central graph.
- Static analysis must not predict observed runtime outcomes.

## Decision

V1 will implement one private, tool-neutral analyzer session. It accepts
versioned workspace and document operations and produces immutable snapshots.
The session is an internal implementation boundary, not a package export,
public subpath, supported protocol, or compatibility-controlled schema.

Each operation and snapshot carries a minimal envelope: analyzer/schema
version, operation identity, workspace epoch, requested facets, relevant
document versions, ownership inputs, completeness or interruption state, and
explicit truncation state. Correlation and causation identities are present
when evidence links operations or artifacts. Publication is allowed only when
that identity is still current.

Analyzer modules contribute namespaced, independently versioned facets. Each
contribution is bounded and declares its version. Consumers must explicitly
handle absent, unknown, and newer facet versions by preserving opaque evidence
or refusing unsupported interpretation; they may not silently reinterpret it.
The common envelope does not enumerate every future route, resource, action,
render, stream, handler, or browser fact.

V1 supports both saved files and unsaved single-root document buffers. Document
versions increase monotonically. A batch of position-dependent edits is applied
in declared order against the text produced by the preceding edit. Full
replacement, close, and reopen have explicit transitions. Invalid or
out-of-order versions are refused. URI normalization, containment, symlink
policy, line-ending handling, and analyzer-text equivalence use the same
workspace ownership rules as configuration, build, watch, and tests.
Multi-root workspaces are refused in V1.

Invalidation and recomputation are separate stages. The session derives the
complete affected dependency closure, orders work deterministically, records
why each item was invalidated, and recomputes or removes every affected result.
Unsupported cycles are rejected with structured evidence. Deleting or renaming
an owner removes its artifacts. Conformance includes a three-level dependency
chain, deletion, rename, and configuration-epoch changes.

Diagnostics, route manifests, generated declarations, mappings, and deleted
outputs publish as one workspace epoch. Diagnostic publication uses full-batch
replacement, so repairing an error removes its prior instance. A partial mix of
old and new artifacts is never observable.

Long-running analysis and deep explanation accept cancellation. Newer work
supersedes older work. A completed result is discarded unless its document
versions, workspace epoch, operation identity, requested facets, and ownership
inputs remain current.

Semantic construction records primary and related source origins,
module/transformation identity, generated-artifact ownership, and both
source-to-artifact and artifact-to-source relations. Source locations are exact
or explicitly absent with a reason; the analyzer never fabricates ranges.

Analyzer diagnostics retain stable Fadeno codes and add structured parameters,
module and phase, primary and related locations, causal instance identities,
skipped-work relations, internal-failure identity, correction intent,
redaction state, and explanation reference where applicable. Human text is
rendered from structured data. Behavior and corrections are never selected by
parsing prose. Static diagnostics remain distinct from runtime failures.

Corrections contain a stable internal fix identity, structured parameters,
concrete edits when safe, preferred status when applicable, an `automatic` or
`review` safety classification, and the diagnostic instances addressed. The
analyzer owns corrections; consumers only present or apply them.

Snapshots, diagnostic batches, cached results, explanations, and transported
artifacts are versioned and round-trip tested. Serialization preserves codes,
parameters, locations, causal edges, provenance, ownership, skipped-work
reasons, completeness, redaction, and truncation.

Plan and explain are lazy facets. Semantic detail is bounded by default; deep
forensic detail requires explicit activation and byte, record, depth, duration,
and child-event limits. Redaction occurs before collection. Cancellation and
explicit truncation are mandatory. Explanation never executes application
behavior again and is never required for correctness. Private analyzer
snapshots contain static facets only. Observed runtime operation records form a
separate record family with their own module-owned contributions. The two
families may be linked only by stable operation or artifact identity when
evidence exists.

The analyzer core is established before later compiler-managed action and
context declarations become fixed. The first running V1 application then
becomes the canonical success, failure, correction, flow-inspection, and
recovery corpus. Before V1 exit, a disposable private lifecycle consumer proves
the complete document and project lifecycle and the full edit-to-visible and
edit-to-cleared feedback loop.
Independent usability evidence is required before A0 selects any supported
editor product.

## Alternatives considered

- Keep separate check, watch, test, and editor logic: rejected because policy,
  invalidation, and ownership would drift.
- Expose a stable analyzer API now: rejected because no demonstrated supported
  consumer has earned schema compatibility.
- Define one exhaustive central result graph: rejected because module growth
  would turn every new framework fact into a central schema migration.
- Analyze saved files only: rejected because V1 must prove unsaved-buffer
  diagnostic freshness before editor lifecycle qualification.
- Combine static predictions with observed runtime truth: rejected because
  source analysis cannot establish request ordering, authorization outcomes,
  streaming timing, cancellation results, or browser behavior.

## Consequences

- V1 gains one private framework-semantic authority shared by all internal
  consumers without replacing ordinary TypeScript services.
- Implementation is split into model-checked V1/DX work packages so V1-09 is
  not destabilized and public examples begin only when a running app exists.
- Supported editor products, multi-root operation, and public schema stability
  remain deferred.
- The package remains private; release impact and Changeset are none.
- Rollback removes the auxiliary V1/DX work packages and this private decision,
  leaving existing route generation intact but blocking lifecycle claims.

## Validation

The roadmap assigns exact commands and evidence to V1-DX-A through V1-DX-C.
Repository model checks enforce their order, features, artifacts, and validation
commands. Implementation conformance covers synchronization, recomputation,
atomic publication, cancellation, provenance, structured diagnostics and
corrections, round trips, bounded explanation, packed examples, lifecycle
qualification, and complete feedback-loop timing.
