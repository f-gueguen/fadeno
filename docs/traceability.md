# Feature traceability

This matrix connects every canonical feature ID to its decision authority,
behavioral specification, evidence or blocker, delivery gate, and expected
executable proof. The product scope owns classification and first gate; this
document owns cross-document coverage.

| Feature | Decision authority | Specification | Evidence or blocker | Delivery | Executable proof |
| --- | --- | --- | --- | --- | --- |
| GOV-01 | [ADR 0001](adr/0001-canonical-repository-and-authority.md), [ADR 0009](adr/0009-documentation-and-evidence-authority.md), [ADR 0013](adr/0013-mit-license.md) | [Architecture overview](architecture/overview.md) | Owner-approved initial commit and hosted CI | F0 | `pnpm check`, frozen-install hosted CI |
| WEB-01 | [ADR 0002](adr/0002-standard-typescript-and-html-shaped-jsx.md), [ADR 0004](adr/0004-structural-execution-boundaries.md) | [Routing/rendering](spec/routing-rendering-streaming.md) | DG-V1-02 | V1 | Route, layout, not-found, error, raw-handler integration fixtures |
| WEB-02 | [ADR 0002](adr/0002-standard-typescript-and-html-shaped-jsx.md), [security invariants](../PROJECT_INVARIANTS.md#security-and-protocols) | [Routing/rendering](spec/routing-rendering-streaming.md) | DG-V1-03 | V1 | Contextual escaping, raw HTML, CSP, secret-leak negative fixtures |
| WEB-03 | [ADR 0008](adr/0008-web-standard-server-boundary.md) | [Routing/rendering](spec/routing-rendering-streaming.md) | DG-V1-08 | V1 | Stream flush, nested boundary, timeout, cancellation, disconnect fixtures |
| DATA-01 | [ADR 0005](adr/0005-resources-and-actions.md) | [Data consistency](spec/data-consistency.md) | DG-V1-04 | V1 | Deduplication, cache isolation, failure propagation fixtures |
| DATA-02 | [ADR 0005](adr/0005-resources-and-actions.md) | [Forms/actions/sessions](spec/forms-actions-sessions.md) | DG-V1-05 | V1 | Native form, decoder, action, redirect, upload and replay fixtures |
| DATA-03 | [ADR 0006](adr/0006-correctness-first-revalidation.md) | [Data consistency](spec/data-consistency.md) | H4 | K0/V1 | Revalidation benchmark and unsafe-`keeps` detection |
| STATE-01 | [Project invariants](../PROJECT_INVARIANTS.md#data-and-state) | [Public model](spec/public-model.md), [forms/actions/sessions](spec/forms-actions-sessions.md) | DG-V1-05 | V1/V2 | URL/form/resource/session/device/local ownership fixtures |
| TYPE-01 | [ADR 0002](adr/0002-standard-typescript-and-html-shaped-jsx.md), [ADR 0004](adr/0004-structural-execution-boundaries.md) | [Compiler/analyzer](spec/compiler-analyzer.md) | H3, DG-V1-02 | K0/V1 | Stock-TypeScript positive/negative and reproducibility corpus |
| SEC-01 | [Security invariants](../PROJECT_INVARIANTS.md#security-and-protocols) | [Security requirements](security/requirements.md), [forms/actions/sessions](spec/forms-actions-sessions.md), [protocol requirements](spec/protocol-requirements.md) | DG-V1-03, DG-V1-05 | V1 | Threat model plus malformed, hostile, unauthorized, replay, isolation tests |
| BUILD-01 | [ADR 0011](adr/0011-supported-developer-workflow.md) | [Build/adapters/testing](spec/build-adapters-testing.md) | DG-V1-01, DG-V1-07 | V1 | Boundary check, clean and repeated build, invalid config, secret scan |
| ADP-01 | [ADR 0008](adr/0008-web-standard-server-boundary.md) | [Build/adapters/testing](spec/build-adapters-testing.md) | DG-V1-06 | V1 | Shared request/stream/cancel/disconnect/shutdown suite |
| TEST-01 | [ADR 0009](adr/0009-documentation-and-evidence-authority.md), [ADR 0012](adr/0012-evidence-gated-support-and-operations.md) | [Build/adapters/testing](spec/build-adapters-testing.md) | K0-01 evidence contract; K0-02 morph harness | K0/V1 | `pnpm check:experiment-contract`, `pnpm experiment:morph -- --verify-harness`, then unit, type, integration, no-JS, browser, security, and adapter suites |
| ENH-01 | [ADR 0003](adr/0003-progressive-enhancement-baseline.md) | [Progressive enhancement](spec/progressive-enhancement.md), [navigation/patching](spec/navigation-patching-preservation.md) | DG-V2-01 | V2 | Native/enhanced equivalence, history, focus, ordering, recovery fixtures |
| PATCH-01 | [ADR 0003](adr/0003-progressive-enhancement-baseline.md), [ADR 0007](adr/0007-tiered-interactivity-direction.md) | [Navigation/patching](spec/navigation-patching-preservation.md) | H1; K0-02 harness and K0-03 private candidate | K0/V2 | Three-engine candidate/control integrity, then repeated preservation corpus |
| INT-01 | [ADR 0007](adr/0007-tiered-interactivity-direction.md) | [Compiler/analyzer](spec/compiler-analyzer.md), [execution boundaries](spec/execution-boundaries.md) | H2, DG-V3-01 | K0/V3 | Accepted/rejected extraction and module-graph corpus |
| ISLAND-01 | [ADR 0003](adr/0003-progressive-enhancement-baseline.md), [ADR 0007](adr/0007-tiered-interactivity-direction.md) | [Islands/lifecycle](spec/islands-lifecycle.md) | DG-V3-02 | V3 | Fallback, mount/update/reorder/teardown/leak fixtures |
| DX-01 | [ADR 0011](adr/0011-supported-developer-workflow.md) | [Compiler/analyzer](spec/compiler-analyzer.md), [build/adapters/testing](spec/build-adapters-testing.md) | DG-A0-02 for external schema | V1/A0 | Diagnostic snapshots, explanations, seeded-error clean-machine test |
| CSS-01 | [Project invariants](../PROJECT_INVARIANTS.md#progressive-enhancement) | Decision gate only | DG-A0-03 | A0 decision | Native CSS example or accepted scoped-CSS conformance |
| CLI-01 | [ADR 0011](adr/0011-supported-developer-workflow.md) | [Build/adapters/testing](spec/build-adapters-testing.md) | DG-V1-07 | A0 | Clean-machine install/scaffold/dev/check/build/test/deploy |
| DOC-01 | [ADR 0009](adr/0009-documentation-and-evidence-authority.md) | [Documentation authority](adr/0009-documentation-and-evidence-authority.md), [contributor workflow](contributor-workflow.md) | Executable source required | V1/A0 | Link/snippet/example/reference/release-doc validation |
| REL-01 | [ADR 0010](adr/0010-pre-1-0-compatibility-and-releases.md) | [Release policy](release-policy.md), [contributor workflow](contributor-workflow.md) | DG-A0-01 and publishable package required | A0 | Version/changelog/changeset/package/provenance/rollback checks |
| ACCESS-01 | [ADR 0012](adr/0012-evidence-gated-support-and-operations.md) | [Progressive enhancement](spec/progressive-enhancement.md) | V1 native baseline and release audits | V1/A0/R1 | Keyboard, focus, reduced-motion, automated and assistive-technology qualification |
| PERF-01 | [ADR 0012](adr/0012-evidence-gated-support-and-operations.md) | [Build/adapters/testing](spec/build-adapters-testing.md), [K0 plan](roadmap/k0.md) | K0-01 frozen environment; measurements begin in later experiment slices | K0/A0/B0 | `pnpm check:reference-image`, versioned manifests, and later compiler/build/server/browser budget checks |
| OPS-01 | [ADR 0012](adr/0012-evidence-gated-support-and-operations.md) | [Security requirements](security/requirements.md), [support policy](../SUPPORT.md) | Production applications and B0 measurements | B0/R1 | Support matrix, load/leak, observability, upgrade and security audits |
| LIVE-01 | [Deferral ledger](ledgers/deferrals.md) | [Data consistency requirements](spec/data-consistency.md) | Deferred trigger | After V3 | Transport, reconnect, auth-expiry and convergence suite if accepted |
| BRIDGE-01 | [Deferral ledger](ledgers/deferrals.md) | [Islands/lifecycle boundary](spec/islands-lifecycle.md) | Deferred trigger | After V3 | Mount/input/teardown interop suite if accepted |
| PPR-01 | [Deferral ledger](ledgers/deferrals.md) | None until accepted | Deferred trigger | After 1.0 evidence | Cache/stream correctness suite if accepted |
| TOOL-01 | [Deferral ledger](ledgers/deferrals.md) | None until accepted | Deferred trigger | After A0 need | Product-specific acceptance suite if accepted |

## Maintenance rules

1. Every feature row in `docs/product/scope.md` appears exactly once here.
2. A feature cannot enter a roadmap gate without decision authority, a current
   specification or explicit decision gate, and named executable proof.
3. A public implementation PR names the affected feature IDs in its description
   and updates every changed column in the same PR.
4. Repository checks validate feature-set equality and reject unindexed current
   specifications.
