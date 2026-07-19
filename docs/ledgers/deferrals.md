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
| Independent newcomer usability qualification | After the first alpha, when two non-contributors are available to run the versioned packet against one exact current artifact; ADR 0043 preserves the ADR 0042 privacy, retention, identity, and synthetic-refusal contract and forbids treating absence as success |
| Supported editor product | Independent users later identify a concrete unresolved workflow and a product-specific lifecycle suite can qualify it; ADR 0043 selects no editor product for the first alpha, and packed/private analyzer conformance remains insufficient |
| Public analyzer schema | A demonstrated supported consumer and a later ADR establish diagnostic lifecycle, versioning, and schema fixtures; ADR 0043 removes the former A0 gate by deferring the entire external surface, not by accepting compatibility |
| CI service integration and machine-readable review output | Stable diagnostics and budget schemas have external consumers |
| Agent protocol integration and machine-oriented documentation feed | Public APIs and reference generation are stable enough to test accuracy |
| Hosted playground | The scaffold and examples are stable and can reuse the production compiler and runtime |
| Documentation version comparison UI | Multiple supported releases make source and migration comparison a demonstrated user need |
