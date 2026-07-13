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
| Analyzer consumers observe stale or mixed generations | ADR 0030 requires versioned documents, workspace epochs, complete affected closure, atomic replacement, cancellation, and stale-result suppression; B7D1 serializes retained work and B7D2 batches admissions, signals obsolete analysis, distinguishes terminal outcomes, and grants derived ownership only to the newest complete generation | Diagnostics, declarations, manifests, mappings, or deletions from different epochs become jointly observable |
| Generated route replacement loses the last accepted disk set | B7C applies only an exact current diagnostic-free publication, validates one previous generation, fault-tests real filesystem operations, and leaves failed restore state recoverable on the next run | Diagnostic refusal deletes disk output, mixed generations appear, or recovery guesses ownership of transaction debris |
| Complete project analysis scales superlinearly before feedback qualification | Existing document synchronization, diagnostic authority matching, and deep-route ancestor validation retain correctness-first full-state checks; V1-DX-C measures the complete feedback loop before any optimization claim | Canonical application growth makes edit-to-visible or edit-to-cleared latency miss the later locked feedback budget |
| Analyzer growth hardens one rigid schema | Module-owned facets are namespaced, independently versioned, bounded, and explicit about unknown/newer versions | A new framework module requires central enumeration or an unsupported facet is silently interpreted |
| Static evidence is presented as observed runtime truth | Static analyzer and runtime records remain separate facets linked only by evidence identity | Source analysis claims request ordering, authorization, streaming, cancellation, or browser outcomes |
| Development lifecycle appears correct only in direct tests | V1-DX-C requires packed canonical-app recovery, a disposable lifecycle client, and full feedback-loop timing | Stale errors survive repair, transitive artifacts lag, or obsolete work publishes in the lifecycle harness |
| Filesystem notifications are mistaken for semantic truth | B7D4 treats events only as contained invalidation hints, coalesces them, excludes owned outputs, and rescans through the project authority | Rename/null/duplicate/overflow events miss a change, publish twice, or trigger an output loop |
| Analyzer, compiler, and server expose different generations | B7D3 must serialize current analysis, B7C application, stock-compiler refresh, and validation; B7D7 later serves only an accepted complete generation | Compiler/server reads during route replacement, stale compiler output publishes, or a request observes mixed ownership |
| Retained analysis accumulates historical route-root source text | B7D2 atomically reconciles the full desired/forgotten owner set, requires exact managed open identity, and proves three still-existing disjoint roots retain only current source text | Repeated disjoint route-root changes make retained memory or reconciliation cost depend on cumulative historical files rather than current ownership |
