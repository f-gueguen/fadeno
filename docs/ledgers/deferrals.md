# Deferral ledger

These capabilities are outside the initial framework contract. Adding one
requires evidence, an accepted ADR, and a roadmap gate.

| Capability | Reconsider when |
| --- | --- |
| Partial prerendering | Streaming page and cache semantics pass conformance and a real application demonstrates the need |
| Pluggable context providers | Request context works across two adapters and an external provider cannot fit the public composition model |
| Multi-value field convenience types | The baseline form decoder and real applications establish required semantics |
| Multi-process action replay and session ownership | A demonstrated deployment requires scale beyond one process and an accepted atomic shared owner preserves proof consumption, rotation, expiry, and failure semantics |
| Scoped CSS compiler and asset pipeline | An independent application demonstrates that native external CSS is insufficient and an accepted decision defines ordering, source maps, diagnostics, security, build identity, and browser behavior |
| Additional runtime adapters | The server conformance suite exists and a maintainer or design partner owns the adapter |
| Component-library bridges | Islands are stable and a demonstrated application needs the bridge |
| Live resource transport | Ordinary resources, actions, ordering, and browser-state preservation pass conformance |
| Optimistic mutation authoring API | Action reconciliation and rollback semantics are proven in the vertical slice |
| Supported editor product | Before A0, independent users build the V1 workflow, diagnose seeded configuration/route/generation failures, inspect successful and failed flows, follow corrections, prove stale errors clear, and identify a specific unresolved workflow after the disposable private lifecycle consumer passes; packed conformance evidence is not a product decision |
| Public analyzer schema | A demonstrated supported consumer passes DG-A0-02; private V1 snapshots, accepted replacement events, packed machine fixtures, and the disposable private lifecycle consumer do not establish compatibility |
| CI service integration and machine-readable review output | Stable diagnostics and budget schemas have external consumers |
| Agent protocol integration and machine-oriented documentation feed | Public APIs and reference generation are stable enough to test accuracy |
| Hosted playground | The scaffold and examples are stable and can reuse the production compiler and runtime |
| Documentation version comparison UI | Multiple supported releases make source and migration comparison a demonstrated user need |
