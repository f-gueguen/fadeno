# Product scope and feature matrix

This document is the canonical inventory of Fadeno capabilities. It prevents a
feature from being silently omitted, implied by a roadmap sentence, or treated
as accepted merely because it appeared in discussion.

## Product fit

Fadeno is for server-owned web applications whose essential workflows are
documents, links, forms, authenticated reads and mutations, and progressively
enhanced interaction. It optimizes for explicit state ownership, inspectable
server/browser boundaries, stock TypeScript, and graceful behavior when client
JavaScript is unavailable.

Fadeno is the wrong default for games, editors, canvases, offline-first clients,
or applications whose normal architecture is a client-owned object graph. Such
an application may use an explicit root island, but repeated root-island use is
a signal to choose a client-first framework.

## State meanings

- **Accepted** — an effective ADR or invariant commits the project to the
  outcome. Exact syntax may still require a decision gate.
- **Hypothesis** — the outcome is desirable but implementation viability must
  pass the named K0 experiment.
- **Open decision** — the capability is required, but implementation cannot
  begin until the named decision gate resolves its contract.
- **Deferred** — outside the initial contract; the deferral ledger owns the
  reconsideration trigger.

## Canonical feature matrix

| ID | Capability | First gate | State | Canonical owner |
| --- | --- | --- | --- | --- |
| GOV-01 | Tracked project law, ADR lifecycle, current ledgers, and one repository check | F0 | Accepted | [Architecture overview](../architecture/overview.md) |
| WEB-01 | Pages, deterministic route manifest, typed parameters and links, nested layouts, not-found and error outcomes, raw handlers | V1 | Filesystem, metadata matching, generation, and app-bound links implemented by V1-06 under [ADR 0027](../adr/0027-generated-route-module-and-production-routing.md); rendering remains later | [Routing and rendering](../spec/routing-rendering-streaming.md) |
| WEB-02 | Server JSX rendering, contextual escaping, explicit raw HTML, document metadata, and CSP nonce propagation | V1 | Sink security and raw authority accepted by [ADR 0028](../adr/0028-contextual-rendering-security.md); renderer remains V1-09 | [Routing and rendering](../spec/routing-rendering-streaming.md) |
| WEB-03 | Web Streams rendering, local boundaries, cancellation, disconnect, and timeout behavior | V1 | Accepted; boundary details require DG-V1-08 | [Routing and rendering](../spec/routing-rendering-streaming.md) |
| DATA-01 | Request-scoped resources with dependency recording, deduplication, caching rules, and bounded failures | V1 | Accepted; identity/cache details require DG-V1-04 | [Data consistency](../spec/data-consistency.md) |
| DATA-02 | Native forms, typed decoding, validation failures, actions, redirects, files, and duplicate-submission policy | V1 | Accepted; request contract requires DG-V1-05 | [Forms and actions](../spec/forms-actions-sessions.md) |
| DATA-03 | Correctness-first action revalidation and optional verified `keeps` optimization | K0/V1 | Accepted by [ADR 0020](../adr/0020-accept-correctness-first-revalidation.md); syntax requires DG-V1-04 | [Data consistency](../spec/data-consistency.md) |
| STATE-01 | Explicit URL, form, resource, session, device, element, and island state homes plus typed request context | V1/V2 | Accepted; persistence details require DG-V1-05 | [Public model](../spec/public-model.md) |
| TYPE-01 | Stock-TypeScript route, link, form, and context type spine with deterministic declarations | K0/V1 | Narrowed by [ADR 0018](../adr/0018-narrow-type-spine-incremental-generation.md) | [Compiler and analyzer](../spec/compiler-analyzer.md) |
| SEC-01 | Escaping, origin/CSRF, authorization, replay, redirect, cookie, cache, protocol, upload, and logging controls | V1 | Rendering security accepted by [ADR 0028](../adr/0028-contextual-rendering-security.md); form/session mechanism still requires DG-V1-05 | [Security requirements](../security/requirements.md) |
| BUILD-01 | Typed configuration, development server, production build, reproducible output, and clean-machine verification | V1 | Accepted; workflow fixed by [ADR 0022](../adr/0022-toolchain-and-configuration-contract.md), package topology by [ADR 0024](../adr/0024-initial-package-boundary.md), smoke surface by [ADR 0025](../adr/0025-public-node-adapter-smoke-contract.md) | [Build and diagnostics](../spec/build-adapters-testing.md) |
| ADP-01 | One conforming server adapter over `Request`, `Response`, and Web Streams | V1 | Accepted; Node HTTP selected by [ADR 0023](../adr/0023-node-http-initial-adapter.md), private public surface by [ADR 0025](../adr/0025-public-node-adapter-smoke-contract.md) | [Build and diagnostics](../spec/build-adapters-testing.md) |
| TEST-01 | Unit, type, integration, no-JavaScript, real-browser, security, and adapter conformance harnesses | K0/V1 | Accepted | [Build and diagnostics](../spec/build-adapters-testing.md) |
| ENH-01 | Enhanced links and forms with history, focus, scroll, pending, cancellation, ordering, and recovery | V2 | Accepted outcome; protocol requires DG-V2-01 | [Navigation and patching](../spec/navigation-patching-preservation.md) |
| PATCH-01 | Server-derived updates that preserve browser, user, and island-owned state | K0/V2 | Narrowed by ADR 0014; scroll boundary requires DG-V2-01 | [Navigation and patching](../spec/navigation-patching-preservation.md) |
| INT-01 | Lazy bounded event-handler extraction without fragment hydration | K0/V3 | [ADR 0015](../adr/0015-accept-bounded-interaction-extraction.md) | [Compiler and analyzer](../spec/compiler-analyzer.md) |
| ISLAND-01 | Explicit client-owned islands with serializable inputs, fallback HTML, lifecycle, and update isolation | V3 | Accepted outcome; authoring contract requires DG-V3-02 | [Islands and lifecycle](../spec/islands-lifecycle.md) |
| DX-01 | Stable diagnostics, human explanations, machine output, generated-reference validation, and framework checks | V1/A0 | Accepted; external schema requires DG-A0-02 | [Compiler and analyzer](../spec/compiler-analyzer.md) |
| CSS-01 | Native CSS baseline; any scoped-CSS compiler surface must earn a separate decision | A0 | Open decision DG-A0-03 | [Decision gates](../ledgers/decision-gates.md) |
| CLI-01 | Installation, scaffold, development, build, check, and diagnostic workflows usable without private guidance | A0 | Accepted outcome; core commands fixed by [ADR 0022](../adr/0022-toolchain-and-configuration-contract.md) | [Build and diagnostics](../spec/build-adapters-testing.md) |
| DOC-01 | Current specifications, executable examples sourced from tested code, generated reference, migrations, and immutable release docs | V1/A0 | Accepted | [Documentation authority ADR](../adr/0009-documentation-and-evidence-authority.md) |
| REL-01 | Explicit version intent, changelogs, immutable tags, provenance, reproducibility, and rollback | A0 | Accepted | [Release policy](../release-policy.md) |
| ACCESS-01 | Native semantic baseline, keyboard/focus behavior, user preferences, and accessibility qualification | V1/A0/R1 | Accepted | [Progressive enhancement](../spec/progressive-enhancement.md) |
| PERF-01 | Reproducible compiler, build, server, and browser cost evidence with frozen environments and relative baselines | K0/A0/B0 | Accepted | [Build and diagnostics](../spec/build-adapters-testing.md) |
| OPS-01 | Support matrix, structured errors, logs, metrics/tracing hooks, redaction, load/leak results, and upgrade verification | B0 | Accepted stable-release requirement | [Outcome roadmap](../roadmap.md) |
| LIVE-01 | Authenticated live resources and reconnect convergence | After V3 | Deferred | [Deferral ledger](../ledgers/deferrals.md) |
| BRIDGE-01 | Component-library bridges | After V3 | Deferred | [Deferral ledger](../ledgers/deferrals.md) |
| PPR-01 | Partial prerendering | After 1.0 evidence | Deferred | [Deferral ledger](../ledgers/deferrals.md) |
| TOOL-01 | Language-server, editor, agent-protocol, hosted-playground, and custom CI products | After A0 need | Deferred | [Deferral ledger](../ledgers/deferrals.md) |

## Release scope

- **K0** proves or rejects PATCH-01, INT-01, TYPE-01, and DATA-03.
- **V1** delivers a secure no-JavaScript vertical slice with WEB-01 through
  WEB-03, DATA-01 and DATA-02, accepted K0 outcomes, STATE-01, SEC-01,
  BUILD-01, ADP-01, and TEST-01.
- **V2** adds ENH-01 using the accepted PATCH-01 result.
- **V3** adds the accepted INT-01 result and ISLAND-01.
- **A0** makes the supported slice independently installable, diagnosable,
  documented, and releasable through CLI-01, DOC-01, DX-01, and REL-01.
- **B0/R1** establish ACCESS-01, PERF-01, and OPS-01 and freeze the tested public
  contract.

No capability is in scope merely because it is easy to scaffold or appears in
a dependency. Adding or reclassifying a row requires the same change to update
the traceability matrix and the relevant ADR, specification, hypothesis,
decision gate, or deferral.
