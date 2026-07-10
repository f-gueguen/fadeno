# Risk ledger

This ledger tracks current risks that can change implementation order or public
scope. It is not a feature list.

| Risk | Current control | Escalation trigger |
| --- | --- | --- |
| Browser updates destroy user state | H1 runs before action enhancement | Any declared preservation case has no reliable cross-browser strategy |
| Handler extraction is too magical or too narrow | H2 requires explicit fixtures and refusal diagnostics | Useful interactions require hidden hydration or broad closure capture |
| Security semantics drift behind runtime work | Each trust boundary ships with threat and negative tests | A boundary is implemented without size, origin, authorization, and logging behavior |
| Revalidation is correct but too expensive | H4 measures a representative slice before public actions | Baseline latency or query load is unsuitable for interactive CRUD |
| Documentation contradicts executable behavior | One authority order and one check command | A public example or spec cannot be derived from tested source |
| Package surface grows before consumers exist | Public packages require an ADR and demonstrated consumer | A package exists only to mirror an internal conceptual diagram |
| Scope exceeds maintainable capacity | Outcome gates precede tooling and adapter breadth | Work begins on optional tooling before the first vertical slice passes |
| Registry identity is unavailable | Publish nothing until names and ownership are verified | A selected public name cannot be secured consistently |
