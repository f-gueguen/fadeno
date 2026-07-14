# Post-R1 opportunity roadmap

Status: **Proposal for post-stable evidence gathering**

This document starts only after [R1](../roadmap.md) has released the exact
qualified 1.0 artifacts. It does not change, reinterpret, schedule, or pull
forward any work from F0 through R1. It remains separate from the current
roadmap while that roadmap is being delivered.

The opportunities below are not current product scope, delivery gates, public
contracts, dates, package plans, or claims that features exist. A candidate can
enter the current [product scope](../product/scope.md) only through the existing
decision, ADR, specification, traceability, executable-evidence,
compatibility, and release workflow.

## Provisional naming

This proposal groups evidence under provisional **E1** through **E4 evolution
horizons**. A horizon is a discussion and research boundary, not a release or
delivery gate.

- Gate and release naming after R1 requires an accepted governance decision.
- No R2 or 2.0 release is assigned by this proposal.
- Compatible accepted outcomes may ship in 1.x releases under the
  [release policy](../release-policy.md).
- A detailed plan is written for one accepted outcome only after its entry
  evidence, authority, dependencies, negative cases, and rollback are known.

## Invariants carried forward

Every investigation starts from the [project invariants](../../PROJECT_INVARIANTS.md):

1. complete server-rendered HTML, links, and forms remain the baseline;
2. resources and actions remain the ordinary server read and mutation model;
3. browser cost remains proportional to declared interaction ownership;
4. unsupported extraction never becomes implicit hydration;
5. every state value retains one explicit home;
6. server, browser, and shared execution zones remain visible and inspectable;
7. correctness does not depend on an optimization declaration;
8. support, security, accessibility, and performance claims require executable
   evidence.

An investigation that cannot preserve an invariant must propose the invariant
change separately, in plain language, with product, compatibility, migration,
security, and rollback consequences. A feature implementation cannot make that
change implicitly.

## Candidate horizons

| Horizon | Question | Candidate evidence areas | Evidence required before scheduling any feature |
| --- | --- | --- | --- |
| **E1 — Target-workflow evidence** | Where does the stable document, form, authenticated CRUD, and bounded-interaction workflow still create avoidable cost or confusion? | Independent-user tasks, local interaction research, accessibility findings, diagnostic comprehension, measured browser and development costs | Repeated observed friction from public 1.0 use; a named existing owner or a decision proving a new boundary; measurable acceptance and rollback |
| **E2 — Runtime-breadth evidence** | Which delivery capabilities can broaden server-owned applications without creating a second state, read, mutation, or authorization model? | Shared-cache research, optimistic action research, LIVE-01 reconsideration, PPR-01 reconsideration | Stable production evidence for resources, actions, enhancement, preservation, islands, security, observability, and declared single- or multi-instance support; composite failure corpus |
| **E3 — Boundary-ecosystem evidence** | Which deployment, widget, and diagnostic consumers justify extending an existing outer boundary? | Additional adapter research, BRIDGE-01 reconsideration, observed runtime diagnosis, verified integrations, deferred island-coordination investigation | One maintained demonstrated consumer per proposed boundary; adapter or island conformance ownership; telemetry and security model where observed data is collected |
| **E4 — Accumulated-confidence evidence** | What do several compatible releases and production histories show is still unsafe, expensive, or difficult to adopt? | Upgrade and rollback history, long-duration reliability, multi-instance operational history, performance history, learning material, support ownership | Several compatible releases and protected production reports; stable workloads and environments; evidence that a framework change is narrower than documentation or operational guidance |

These horizons do not impose a delivery order on unaccepted features. Each
candidate is admitted independently, but it must qualify against every already
accepted mechanism with which it can interact.

## Improvement analysis

| Area requiring further evidence | Possible addition or change | What it could provide | Honest limit | Horizon |
| --- | --- | --- | --- | --- |
| Overall full-stack and CRUD experience | Observe one complete public workflow and remove repeated friction through the narrowest existing API, diagnostic, correction, example, or command | Faster creation and safer maintenance of Fadeno's target applications | No promise to optimize every application shape | E1 |
| Local reactive interaction | Research additional bounded handler patterns and improve refusal guidance when an island is required | Immediate local interaction without fragment hydration | The concrete V3 authoring surface and accepted classes remain authoritative; research examples are not promises | E1 |
| Accessibility defaults | Investigate static semantic diagnostics and extend browser and assistive-technology conformance where gaps are observed | Earlier feedback and verified native/enhanced equivalence | Static analysis cannot replace manual accessibility review | E1 |
| Data and cache breadth | Investigate whether a shared resource cache can meet authorization, representation, freshness, invalidation, eviction, capacity, concurrency, cancellation, and isolation requirements | Lower repeated server work for safely reusable reads | Request-scoped resources remain the baseline; arbitrary loaders must not be executed twice implicitly | E2 |
| Rendering flexibility and partial prerendering | Reconsider PPR-01 through a separate output-reuse decision that may select resource caching, output caching, both, or neither | Reusable document output with fresh server-owned regions if it proves safe | PPR cannot inherit cache correctness from a resource cache automatically | E2 |
| Optimistic experience | Investigate a preview whose state home is one form submission and whose result always reconciles to server truth | Faster perceived mutations without a second mutation API | Preview state cannot become application-readable shared state or authorize work | E2 |
| Live applications | Reconsider LIVE-01 using the existing resource, ordering, preservation, authorization, and recovery semantics | Authenticated live server-owned views | A live protocol still needs bounded private delivery state and declared multi-instance behavior | E2 |
| Rich interactive UI | Improve island fallback, lifecycle diagnosis, and evidence-backed bridge ergonomics | Better rich widgets inside server-owned pages | Repeated root islands remain guidance to use another framework | E1/E3 |
| General client state | Investigate explicit coordination only after a real application proves URL, resource, serializable input, or one larger island inadequate | Deliberate coordination between related widgets | A new group lifetime may be a new state home and may require an invariant change | E3 |
| Runtime development tooling | Investigate the observed diagnosis users need before selecting an inspector, CLI, editor, local overlay, or protocol | Runtime ownership and invalidation visibility if a safe consumer is demonstrated | Static analyzer evidence and observed runtime evidence remain separate | E3 |
| Deployment breadth | Generalize the adapter conformance suite only when a second maintained target is demonstrated | More deployment choices with explicit capabilities | Platform API similarity is not support evidence | E3 |
| Component and integration ecosystem | Reconsider BRIDGE-01 for one maintained consumer before designing a general bridge abstraction | Reuse without making an external component model the default | No generic plugin boundary before multiple consumers prove common behavior | E3 |
| Production confidence | Extend upgrade, rollback, load, leak, incident, redaction, compatibility, and deployment evidence across releases | Lower operational and upgrade risk | R1 starts the history; a roadmap cannot manufacture maturity | E4 |
| Ecosystem, community, and hiring | Maintain executable learning paths, verified integration status, and explicit support ownership | Lower adoption and training cost | Adoption is an external outcome, not a framework feature or scheduled win | E3/E4 |
| Performance | Preserve stable workloads for each accepted capability and publish attributable budgets and regressions | Workload-specific evidence instead of universal speed claims | No single overall performance winner is claimed | E1-E4 |
| Offline-first applications | Add no ordinary framework feature; document the root-island or separate-client-framework boundary | An honest escape hatch without competing ordinary data authorities | First-class offline ownership conflicts with the current product boundary | Not planned |

## Candidate investigations

The sections below record questions and evidence needed to decide whether a
candidate should be accepted, narrowed, left deferred, or rejected. They do not
select public syntax, packages, protocols, providers, products, or supported
behavior.

### Target-workflow investigation

**Questions before acceptance**

- Which project creation, authenticated CRUD, validation, upload, bounded
  interaction, island, testing, diagnosis, upgrade, build, or deployment tasks
  repeatedly fail or require private guidance after R1?
- Is the narrowest correction documentation, an executable example, a teaching
  diagnostic, a safe correction, or a change to an existing public contract?
- Would the correction create a second way to perform an existing job?
- Can success be measured through task completion, diagnostic comprehension,
  recovery success, emitted browser code, or end-to-end feedback latency?

**Evidence before scheduling**

- Independent clean-machine and upgrade task recordings with seeded failures.
- Repeated failure or confusion at the same owned boundary.
- Public-surface, documentation, migration, compatibility, and rollback impact
  for the smallest proposed correction.

**Possible value if accepted**

- A defensible developer-experience claim scoped to applications Fadeno is
  designed to serve.
- Less framework-specific decision work without expanding the public
  vocabulary unnecessarily.

### Bounded local interaction investigation

Synchronized fields, conditional controls, tabs, disclosure, and local
filtering are non-normative research examples. Their presence here does not
claim that V3 accepts their concrete source or behavior.

**Questions before acceptance**

- Which additional interaction patterns occur repeatedly after R1 and remain
  inside the accepted plain-data, identity, lifetime, and lazy-loading limits?
- Can the existing extraction boundary express them without network access,
  server imports, opaque captures, cross-island mutation, or unbounded work?
- When extraction refuses, does the diagnostic teach the smallest explicit
  island alternative?
- Does any proposal change the accepted V3 authoring surface or only extend its
  qualified corpus and guidance?

**Evidence before scheduling**

- Positive and negative stock-TypeScript corpus agreed before implementation.
- Chromium, Firefox, and WebKit lazy-load, identity, cancellation, and repeated
  interaction evidence.
- Generated graph inspection proving no fragment renderer, server capability,
  or implicit hydration enters accepted output.
- Emitted-byte and interaction-latency measurements in a named environment.

**Possible value if accepted**

- More small interactions with browser cost proportional to their behavior.
- Clearer guidance at the handler-to-island boundary.

### Accessibility investigation

**Questions before acceptance**

- Which accessibility failures can static source or generated output establish
  without misleading false certainty?
- Which native and enhanced outcomes need stronger page-title, announcement,
  label, error-association, pending-feedback, focus, keyboard, reduced-motion,
  fallback, or mount-failure coverage?
- Which findings require documentation or runtime behavior instead of a
  compiler diagnostic?

**Evidence before scheduling**

- False-positive and false-negative diagnostic corpus.
- Three-engine keyboard and focus evidence plus named assistive-technology
  review.
- Native and enhanced outcome equivalence under success, validation, redirect,
  error, cancellation, and recovery.

**Possible value if accepted**

- Earlier actionable feedback and stronger evidence that enhancement preserves
  the accessible document baseline.

### Observed runtime diagnosis investigation

This investigation does not preselect a visual inspector or claim that current
static explanation already owns runtime observations.

**Questions before acceptance**

- Which observed route, resource, action, revalidation, navigation, patch,
  handler, island, preservation, recovery, or browser-cost facts users cannot
  diagnose through existing outputs?
- Which runtime boundary collects each fact, and is collection local, remote,
  development-only, sampled, or explicitly enabled?
- What are the retention, transport, tenant-isolation, consent, redaction,
  truncation, correlation, and teardown rules?
- Does the demonstrated consumer need human output only or a
  compatibility-controlled schema?
- Which product surface is smallest: an existing command, a local report, an
  overlay, an editor consumer, or something else?

**Evidence before scheduling**

- A demonstrated consumer and threat model.
- Protected-data, malicious-input, stale-record, cancellation, unsupported
  version, retention, transport, and overhead corpus.
- Explicit separation of static analyzer facts and observed runtime records.

**Possible value if accepted**

- An observed explanation for why work ran, did not run, was refused, became
  stale, or triggered recovery.

### Shared resource cache investigation

**Questions before acceptance**

- Which repeated resource reads produce material cost in real supported
  applications after request-local deduplication?
- Can a cache define authorization and representation partitioning, freshness,
  invalidation, eviction, capacity, failure caching, cancellation, stampede
  control, isolation, restart, and single- or multi-instance ownership?
- Can optional declarations remain correctness-preserving when removed?
- How is unsafe configuration detected without implicitly executing arbitrary
  application loaders twice?
- Which decisions can be explained without exposing protected inputs or cache
  keys?

**Evidence before scheduling**

- Replay-safe conformance fixtures rather than shadow execution of arbitrary
  application loaders.
- Cross-user, authorization-change, locale and representation, stale, eviction,
  failure, cancellation, concurrency, memory-bound, restart, and deployment
  topology corpus.
- Equivalent application outcomes with every optional cache declaration
  removed.
- Named load and latency measurements against the uncached baseline.

**Possible value if accepted**

- Lower server cost and latency for reads that are demonstrably safe to reuse.
- A cache model that remains subordinate to resource correctness and explicit
  authorization ownership.

### Optimistic action investigation

**Questions before acceptance**

- Which mutations benefit materially from a preview before the server result?
- Can preview state be modeled as bounded form state keyed to exactly one action
  submission?
- Is that state inaccessible as shared application data and destroyed on
  resolution, navigation, session or authority change, cancellation, or
  teardown?
- How do validation, authorization, redirect, failure, uncertain delivery,
  rollback, a newer submission, and a concurrent live update reconcile?
- Can the native form result remain canonical and can uncertain delivery avoid
  blind repetition?

**Evidence before scheduling**

- Duplicate, delayed, reordered, cancelled, disconnected, validation,
  authorization, redirect, session-change, rollback, live-race, and recovery
  corpus.
- Native and enhanced convergence on the same server truth.
- Accessibility review of pending, success, failure, replacement, and rollback
  feedback.

**Possible value if accepted**

- Faster perceived mutations without a second client mutation API or browser
  authorization model.

### Live resource investigation

**Questions before acceptance**

- Which applications need LIVE-01 after ordinary resources, actions, and
  enhanced updates have stable production evidence?
- Which semantic outcomes can reuse resource identity, server rendering,
  ordering, state preservation, authorization, and recovery?
- What bounded framework-private delivery state is required to track sequence,
  version, deduplication, gaps, or reconnect without becoming an
  application-visible client resource store?
- What owns that state, how long does it live, and how is it torn down?
- Does the first supported topology enforce one process, or can it prove shared
  subscription, invalidation, replay, and authorization semantics across
  instances?
- Which transport best satisfies the accepted semantic contract?

**Evidence before scheduling**

- Reconnect, gap, duplicate, reorder, authorization expiry, session rotation,
  backpressure, cancellation, navigation, action race, optimistic race, island
  preservation, teardown, leak, and topology corpus.
- Multi-window convergence only for values whose declared state home is shared.

**Possible value if accepted**

- Live server-owned views without an application-maintained client cache or
  reconciliation engine.

### Partial-prerendering investigation

PPR-01 requires its own output-reuse decision. A shared resource cache, if one
is ever accepted, does not automatically supply safe HTML reuse.

**Questions before acceptance**

- Which workloads benefit materially from reusable output plus dynamic
  server-owned regions?
- Does the safe mechanism require resource caching, output caching, both, or
  neither?
- What single authority coordinates invalidation when more than one reuse layer
  exists?
- How are route identity, authorization, representation, status, redirect,
  headers, cookies, CSP, freshness, capacity, eviction, cancellation, stream
  failure, and rollback decided?
- Can optimization remain correct when omitted and remain explainable without
  asking authors to classify a component tree into server and client modes?
- Does the supported topology enforce one process or prove multi-instance cache
  and invalidation behavior?

**Evidence before scheduling**

- Cross-user leakage, stale output, authorization change, dynamic error,
  redirect, header, cookie, CSP, cancellation, stream ordering, invalidation,
  restart, deployment topology, and rollback corpus.
- Complete no-JavaScript document and action outcomes.
- Workload-specific latency, server-cost, and storage comparison.

**Possible value if accepted**

- Faster reusable server output while preserving server ownership and the
  complete document baseline.

### Adapter expansion investigation

**Questions before acceptance**

- Which maintained application or design partner needs a second adapter?
- Which existing conformance rules are truly portable, and which remain owned
  by the current Node adapter?
- What capability declaration covers request bodies, streaming, cancellation,
  cookies, trusted proxy input, limits, shutdown, and platform cache behavior?
- Who maintains the target and its minimum/current support matrix?

**Evidence before scheduling**

- The shared adapter suite executed on the demonstrated target before support
  is claimed.
- Host-specific disconnect, backpressure, authority, header, cookie, proxy,
  limit, shutdown, deployment, and rollback evidence.
- Visible refusal when an application requires an unsupported capability.

**Possible value if accepted**

- Broader deployment without moving host-specific behavior into the
  Web-standard server core.

### Island bridge and coordination investigation

Shared state for a group of islands is **deferred**. Reconsideration requires a
demonstrated application that cannot be served adequately by URL state,
resource state, serializable inputs, or one larger island. Before any authoring
facility is accepted, a state-home ADR must decide whether the existing
invariant covers the proposed scope and lifetime or must be amended.

**Questions before acceptance**

- Which maintained component consumer cannot fit the native island contract
  economically?
- Can one bridge preserve useful server fallback, serializable input, explicit
  identity, changed-input delivery, mount failure, update, reorder, teardown,
  cancellation, accessibility, and bounded browser cost?
- Do multiple related islands really need shared browser state, or can URL,
  resource, serializable input, or one larger island own it?
- If shared browser state is required, is its scope and lifetime an existing
  island state home or a new group state home?
- Does answering that question require changing the data-and-state invariant?

**Evidence before scheduling**

- One real maintained bridge consumer and its lifecycle, error, leak, CSP,
  accessibility, and browser-cost corpus.
- A state-home ADR before any shared-island authoring facility.
- Explicit refusal of ambient module singletons, implicit global stores, and
  silent remounting.

**Possible value if accepted**

- Reuse of selected rich widgets without making an external component model or
  whole-route client ownership the default.

### Production, adoption, and performance investigation

**Questions before acceptance**

- Which failures recur across maintained releases, upgrades, rollbacks,
  restarts, incidents, and supported deployment shapes?
- Which problem requires a framework change rather than documentation, an
  operational practice, or an integration fix?
- Does any supported multi-instance deployment require a shared replay,
  session, subscription, invalidation, or cache owner for basic correctness?
- Which integration has a named maintainer, executable compatibility suite, and
  support tier?
- Which benchmark definitions can remain stable enough to show trends rather
  than hide regressions through dataset or environment changes?

**Evidence before scheduling**

- Upgrade, downgrade, rollback, load, leak, cancellation, restart, key
  rotation, incident redaction, disaster recovery, and compatibility history.
- Single- or multi-instance correctness declared and enforced by each feature
  when it is accepted; E4 does not postpone that requirement.
- Frozen workload definitions, reference environments, raw results, and
  relative baselines.
- Independent protected production reports and repeated learning or support
  gaps.

**Possible value if accepted**

- Lower operational, upgrade, adoption, and training risk based on accumulated
  evidence rather than roadmap assertions.

## Composite conformance requirement

Independent feature admission does not mean isolated qualification. Each
accepted candidate must add pairwise and workflow tests against every relevant
accepted mechanism.

| Candidate | Minimum combined failures to qualify |
| --- | --- |
| Shared resource cache | Action revalidation, authorization or session change, cancellation, failure, restart, representation change, and every supported deployment topology |
| Optimistic action | Native submission, enhanced submission, validation, redirect, cancellation, uncertain delivery, newer action, live update if accepted, and session or authority change |
| Live resource | Action completion, optimistic preview if accepted, navigation, cache invalidation if accepted, authorization expiry, reconnect, island preservation, and topology change |
| Partial prerendering | Resource and output invalidation, action result, live update if accepted, authorization change, redirect, headers, cookies, CSP, cancellation, stream failure, restart, and topology change |
| Additional adapter | Every accepted resource, action, enhancement, handler, island, cache, live, PPR, observability, shutdown, and rollback contract claimed on that target |
| Island bridge or coordination | Navigation and action updates, live input if accepted, reorder, removal, replacement, cancellation, failure, session change, accessibility, and leak behavior |

A candidate may declare one-process-only support, but the adapter and support
matrix must enforce and publish that limit. Broader support requires
multi-instance semantics before release, not as later operational polish.

## Philosophy changes considered

No invariant change is recommended now. One future investigation could reveal
that a change is needed; it must not assume the answer in advance.

| Possible change | Benefit | Cost | Current recommendation |
| --- | --- | --- | --- |
| Make a global client store and client-fetch API ordinary framework concepts | Familiar SPA architecture and easier client-owned graphs | Creates a second read and mutation model, weakens explicit state homes, and makes convergence application-owned | Reject; use island-local state, an evidence-backed explicit boundary, or another framework |
| Hydrate a fragment automatically when handler extraction fails | Fewer authoring refusals and broader accepted closures | Makes ownership and payload unpredictable, risks capability capture, and hides a network-boundary change | Reject; keep a teaching diagnostic and require an explicit island |
| Make offline-first applications a core target | Broadens addressable applications and supports disconnected mutation | Requires durable client authority, conflict resolution, synchronization, and a client-owned object graph | Reject; use a root island or client-first framework for that route or application |
| Remove guidance against repeated root islands | Lets teams remain on Fadeno as client ownership expands | Turns an escape hatch into an implicit SPA architecture while retaining server-first complexity | Reject; keep the product-fit warning honest |
| Add a shared state home for a group of islands | Allows related widgets to coordinate without one large island | Adds identity, lifetime, serialization, update, teardown, and possibly a new category of browser-owned state | Deferred; first prove a consumer, then decide in a state-home ADR whether the existing invariant is sufficient or must change |

In simple terms, the first four changes would make Fadeno more general by
making it less explicit. They would reduce some short-term friction but erase
the main reason for Fadeno to exist. The island-group question is narrower: it
might help real widget composition, but it could also become a global client
store under a different name. Evidence must decide.

## Admission and planning rules

1. R1 completion and post-release usage evidence are entry requirements; this
   document cannot pull work into the pre-R1 roadmap.
2. A horizon is not a delivery gate. An accepted feature receives a real gate
   only when product scope, traceability, decision authority, current
   specification or explicit decision gate, and executable proof are updated
   together.
3. Each candidate begins with one demonstrated problem, negative cases,
   compatibility intent, security consequences, rollback, and the smallest
   qualifying experiment or decision harness.
4. A deferred capability may be accepted, narrowed, retained as deferred, or
   rejected. Listing it here does not predetermine the result.
5. A new public package, protocol, cache, adapter, bridge, diagnostic product,
   state home, or transport requires a demonstrated consumer and an accepted
   ADR.
6. Single- or multi-instance support is a correctness decision for each
   feature, not an E4 maturity enhancement.
7. Every accepted feature qualifies alone and in combination with relevant
   previously accepted features.
8. Performance, accessibility, support, and security language remains
   evidence-scoped and names its environment, workload, and limitations.
9. If evidence requires a project-invariant change, propose it separately with
   product-positioning, compatibility, migration, security, and rollback
   consequences.

## Explicit exclusions

This proposal does not promise:

- canonical E1-E4 names, an R2 gate, or a 2.0 release;
- an ambient client store or ordinary client-fetch API;
- implicit hydration or arbitrary browser closure capture;
- first-class offline ownership;
- any specific cache, live transport, output-reuse mechanism, provider adapter,
  component bridge, diagnostic product, or public protocol;
- a public analyzer or runtime schema without a demonstrated consumer;
- universal performance superiority;
- ecosystem size, hiring supply, or production maturity by a scheduled date.
