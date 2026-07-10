# Deferral ledger

These capabilities are outside the initial framework contract. Adding one
requires evidence, an accepted ADR, and a roadmap gate.

| Capability | Reconsider when |
| --- | --- |
| Partial prerendering | Streaming page and cache semantics pass conformance and a real application demonstrates the need |
| Pluggable context providers | Request context works across two adapters and an external provider cannot fit the public composition model |
| Multi-value field convenience types | The baseline form decoder and real applications establish required semantics |
| Additional runtime adapters | The server conformance suite exists and a maintainer or design partner owns the adapter |
| Component-library bridges | Islands are stable and a demonstrated application needs the bridge |
| Live resource transport | Ordinary resources, actions, ordering, and browser-state preservation pass conformance |
| Optimistic mutation authoring API | Action reconciliation and rollback semantics are proven in the vertical slice |
| Language server and editor extension | Stock TypeScript plus analyzer diagnostics reveal a specific unresolved editor workflow |
| CI service integration and machine-readable review output | Stable diagnostics and budget schemas have external consumers |
| Agent protocol integration and machine-oriented documentation feed | Public APIs and reference generation are stable enough to test accuracy |
| Hosted playground | The scaffold and examples are stable and can reuse the production compiler and runtime |
| Documentation version comparison UI | Multiple supported releases make source and migration comparison a demonstrated user need |
