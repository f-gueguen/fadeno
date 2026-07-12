# Risk ledger

This ledger tracks current risks that can change implementation order or public
scope. It is not a feature list.

| Risk | Current control | Escalation trigger |
| --- | --- | --- |
| Browser updates destroy user state | ADR 0014 narrows structural reuse; DG-V2-01 must own affected scroll | V2 proceeds without explicit scroll management or patch-boundary refusal |
| Handler extraction is too magical or too narrow | ADR 0015 accepts only the bounded corpus and conservative refusal; implementation stays V3 | Useful interactions require hidden hydration or broader capture than the accepted contract |
| Security semantics drift behind runtime work | Each trust boundary ships with threat and negative tests | A boundary is implemented without size, origin, authorization, and logging behavior |
| Revalidation regresses beyond its accepted cost | ADR 0020 and the immutable H4 workload baseline V1 implementation | Runtime integration exceeds locked latency/query/memory controls |
| Documentation contradicts executable behavior | One authority order and one check command | A public example or spec cannot be derived from tested source |
| Package surface grows before consumers exist | Public packages require an ADR and demonstrated consumer | A package exists only to mirror an internal conceptual diagram |
| Scope exceeds maintainable capacity | Outcome gates precede tooling and adapter breadth | Work begins on optional tooling before the first vertical slice passes |
| Registry identity is unavailable | Publish nothing until names and ownership are verified | A selected public name cannot be secured consistently |
