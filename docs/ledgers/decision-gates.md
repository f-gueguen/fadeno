# Decision-gate ledger

This ledger contains unresolved decisions that block a named implementation
boundary. It is not a place for proposals or meeting history. A gate leaves the
ledger when an effective ADR and current specification resolve it.

| ID | Needed before | Decision required | Required evidence | Resolution artifact | Status |
| --- | --- | --- | --- | --- | --- |
| DG-V1-05 | DATA-02 and STATE-01 implementation | Define field-descriptor and decoder semantics, action method/identity, origin and CSRF proof, replay policy, field/file limits, redirect validation, cookie protection, session rotation, and key lifecycle | Threat model plus native-form vertical slice | Form/action/session ADR | Open |
| DG-V2-01 | ENH-01 implementation | Define experimental patch identity, scroll boundary, ordering, redirects, errors, recovery, cache policy, and version negotiation | ADR 0014 narrowed result and V1 action round trip | Patch-protocol ADR and versioned fixtures | Open |
| DG-V3-02 | ISLAND-01 implementation | Define island authoring adapter, mount triggers, serialized input, changed-input delivery, teardown, and root-island declaration | V2 preservation runtime and lifecycle spike | Island-lifecycle ADR | Open |
| DG-A0-01 | Public package publication | Secure and select unscoped names or an npm organization and map public entrypoints | Registry ownership verification and actual package consumers | Package-publication ADR | Open |
| DG-A0-02 | External analyzer consumers | Define diagnostic-code lifecycle and versioned machine-readable analyzer schema | Stable internal diagnostics used by build/check | Analyzer-schema ADR and schema fixtures | Open |
| DG-A0-03 | CSS-01 inclusion | Decide whether scoped CSS is required for alpha and, if so, its ownership and ordering semantics | Executable application styling needs and browser behavior | CSS ADR or explicit deferral | Open |

## Gate rules

1. A coding agent must inspect this ledger before starting a roadmap slice.
2. Work may gather the evidence named by a gate, but may not invent the blocked
   public contract inside implementation code.
3. The resolving change adds an ADR, updates the relevant specification and
   traceability row, removes the gate, and adds executable validation.
4. If evidence rejects the capability, update the scope and deferral ledgers in
   the same change rather than leaving a dead gate.
