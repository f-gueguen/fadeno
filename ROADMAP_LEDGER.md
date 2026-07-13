# Roadmap ledger

This tracked ledger contains current execution state only. Durable decisions
belong in ADRs; current claims requiring evidence belong in the hypothesis
ledger; Git history records completed work.

## Current slice

V1-DX-B7D3 — serialized analyzer application and compiler validation

## Exit criteria

- [ ] Run analysis, provisional route-artifact application, validation-only
  stock compilation, final freshness validation, and acceptance or rollback as
  one retained coordinator operation.
- [ ] Preserve the exact last accepted route generation across compiler
  diagnostics, cancellation, supersession, process failure, cleanup failure,
  and first-generation or restart recovery.
- [ ] Bind compiler acceptance to the current coordinator generation, analyzer
  publication, provisional artifact identity, and live operation signal without
  building a second application dependency graph.
- [ ] Terminate and await every compiler child before rollback, queue progress,
  or close completion, while producing no `dist`, build-info, cache, declaration,
  map, or other compiler output.
- [ ] Prove real stock-compiler success, direct/transitive/delete/rename failure
  and recovery, late stale refusal, consumer exclusion, transaction recovery,
  package inaccessibility, full repository, local CI, architecture, Big-O, and
  fresh independent review gates.

## In progress

- B7D3 adds one private retained refresh operation to the B7D2 coordinator. It
  performs analysis, provisional B7C application, compiler validation, final
  freshness, and commit or rollback before its coordinator item settles.
- B7C's immediate application capability remains available to existing private
  consumers. A new private two-phase transaction retains verified rollback
  ownership and first-generation recovery identity until validation commits.
- The compiler boundary invokes the installed stock compiler asynchronously in
  one discovery pass and one validation pass, accepts exact resolved-input records only from the
  project, selected compiler, or verified installed package roots, streams a
  globally bounded cancellable project inventory, bounds and redacts captured
  output, awaits actual child termination, and never emits application files.
- Final acceptance rechecks the project inventory, the content identity of
  every resolved compiler input including dependencies, and the exact
  provisional and rollback artifact state. Rollback failure stays owned and
  prevents successful close until deterministic recovery succeeds.
- Route generations move between authoritative, rollback, and non-authoritative
  garbage names only by atomic rename. Partial garbage deletion cannot damage
  the accepted set, is retried by the retained owner and restart recovery, and
  prevents successful close while cleanup remains unresolved.
- The stock compiler owns ordinary direct and transitive module refresh. Fadeno
  binds acceptance to operation and artifact identity but does not maintain a
  second application dependency graph.
- B7D3 treats explicit newer admissions as invalidation. Translating arbitrary
  filesystem notifications into contained admissions remains B7D4.
- DG-V1-06 still gates public compiler inputs and build/development contracts.
  No `dist`, watcher, command, server, public schema, or editor product is added.
- V1-DX-C follows the complete V1 app and precedes V1-14; its lifecycle and
  feedback evidence is split into one-outcome sub-slices.

## Blockers

- None.

## Open questions

- DG-A0-01: public package names after registry ownership is secured.
- DG-A0-02: compatibility-controlled external analyzer and diagnostic schema
  after a demonstrated supported consumer.
- DG-V1-06: exact public build and development workflow contract before either
  command is implemented.

## Completed slices

- F0 — The owner-approved canonical bootstrap is commit
  [`387d7f674dd193ae031cec52fd99a1f56242c170`](https://github.com/f-gueguen/fadeno/commit/387d7f674dd193ae031cec52fd99a1f56242c170),
  licensed under MIT by ADR 0013, and passed the frozen-install
  [`Check` run](https://github.com/f-gueguen/fadeno/actions/runs/29089431803).
- K0-01 — The four private experiment directories, v1 evidence schemas,
  hardened positive/negative fixtures, digest-pinned reference environment,
  and deterministic aggregate list/refusal contract are checked without
  claiming a harness or qualification result.
- K0-02 — The strict-TypeScript fixture API runs a proven preservation control
  and a proven undeclared-state-loss control in Chromium, Firefox, and WebKit;
  the digest-qualified reference job verifies browser identity and retains
  trace, screenshot, operation, and before/after evidence without introducing
  a morph candidate or qualification result.
- K0-03 — One private strict-TypeScript candidate prevalidates a bounded
  structural input before DOM writes, proves exact root/input reuse and declared
  peer replacement in Chromium, Firefox, and WebKit, refuses ambiguous or
  unsupported input without partial mutation, and retains independent K0-02 and
  K0-03 reference evidence without resolving H1 or DG-V2-01.
- K0-04 — The locked 18-case corpus completed 20 and 100 no-retry repetitions
  in Chromium, Firefox, and WebKit. ADR 0014 narrows H1 around layout-affecting
  document/element scroll while retaining the 16 passing preservation classes;
  exact failure signatures, portable evidence, and immutable result manifests
  gate any later change without creating a public patch protocol.
- K0-05 — The locked 5/10 TypeScript corpus and separate executable seed prove
  actual three-engine browser identity, response/module/request evidence, and a
  canary-bearing refusal boundary in merged commit `04792c5`, without an
  extractor, H2 decision, or public API.
- K0-06 — Exact clean source commit `267cd0f` completed the locked 5/10 corpus,
  100 interactions plus 17 H1 identity operations per accepted fixture, and
  three-engine no-retry matrix in hosted run 29144470073. ADR 0015 accepts H2
  with a GO decision and resolves the former extraction-contract gate; the immutable
  manifest preserves generated bytes, raw observations, diagnostics, decision
  controls, source identity, and reference preflight without publishing K0
  syntax, diagnostic schemas, or packages.
- K0-07 — Commit `0df184d` establishes one private, deterministic, contained
  stock-TypeScript type-generation harness with correlated route/link types,
  five valid and five invalid consumers, anti-fake controls, rollback recovery,
  and no public authoring syntax or H3 qualification claim.
- K0-08A — Commit `122ba57` freezes the H3-only local Docker reference, exact
  1,000-route A/B corpus, stock TypeScript 7 compiler/LSP controls, fresh-child
  5/20 timing runner, pre/postflight and decision projections, and negative
  mutations without publishing an H3 result or decision.
- K0-08B — Commit `1398b78` retains a reference-valid 20-sample H3 result from
  exact source `122ba57`. ADR 0018 accepts stock-TypeScript declaration
  correctness and clean latency while narrowing incremental generation after
  its 0.863475 incremental/clean ratio exceeded the locked 0.25 maximum.
- K0-09 — Commit `86daceb` locks the private authenticated 10,000-row H4
  harness, input-aware request deduplication, manifest-driven baselines,
  complete rendered freshness controls, exact JSON comparison refusal, and
  4/4 resource-bound unsafe-`keeps` detection without collecting a result.
- K0-10A — Commit `51594a8` freezes the H4-only reference identity, deterministic
  10,000-cycle correctness schedule, complete-output paired timing, forced-GC
  RSS method, retained-attempt launcher, independent verifier, and strict
  GO/PIVOT/INCONCLUSIVE contracts without collecting a result.
- K0-10B — Commit `67f51ca` retains all 12 exact-source H4 attempts, independently
  verifies attempt 12 as the first complete reference-valid run, and accepts
  correctness-first revalidation through ADR 0020 with every locked gate green.
- K0-11 — Commit `143cbb4` reconciles all four K0 outcomes through ADR 0021,
  publishes the model-checked 14-slice V1 plan, and makes `experiment:all`
  verify every immutable K0 outcome.
- V1-01 — Commit `6d03a92` freezes the root TypeScript config, command and
  output ownership, strict environment precedence, and deterministic private
  workflow prototype through ADR 0022.
- V1-02 — Commit `e417d8a` selects Node 22.17 HTTP through ADR 0023 and proves
  request/response translation, streaming, backpressure, cancellation,
  authority handling, cookies, and graceful drain in a private adapter suite.
- V1-03 — Commit `7c4fb9d` selects one logical package through ADR 0024 and
  proves its exports and dependency direction with a packed private consumer.
- V1-04 — Commit `1edea3c` creates the private framework package, moves the
  selected Node adapter behind its exact public subpath, and proves the tracked
  smoke example from an installed tarball on current and minimum runtimes.
- V1-05 — Commit `92f10d5` accepts ADR 0026 and proves portable route discovery,
  an ownership-correlated internal manifest, stock-TypeScript link correlation,
  and exact runtime pathname construction without implementing the router.
- V1-06 — Commit `e9f249a` supersedes the impossible global link binding with
  ADR 0027 and implements exact config loading, transactional app-bound route
  generation, metadata-only matching, structured diagnostics, and recovery.
- V1-07 — Commit `79e9d49` accepts ADR 0028 and proves a closed contextual sink
  policy, exhaustive versioned security corpus, authenticated raw-HTML
  capability, private nonce primitive, and structured diagnostic redaction.
- V1-08 — Commit `945c48e` accepts ADR 0029 and freezes one private streaming
  lifecycle with deterministic boundary ownership, bounded backpressure,
  cancellation, cleanup, nonce timing, and exhaustive versioned conformance
  without adding a public renderer or stream API.
- V1-DX-A — Commit `f3be905` accepts ADR 0030, schedules model-checked private
  analyzer foundation and lifecycle milestones, preserves external schema and
  editor-product gates, and introduces no analyzer implementation or export.
- V1-09 — Commit `e561836` accepts ADR 0031 and implements the narrow JSX
  runtime, generated route binding and link runtime, nearest not-found
  ownership, streamed rendering, CSP/parser evidence, correlated failure
  observation, and the packed canonical application with permanent failure,
  flow, correction, and recovery examples.
- V1-DX-B1 — Commit `6b225c9` implements the private single-root analyzer
  session, exact saved/overlay document authority, versioned lifetimes,
  transactional sequential edits, immutable document-only snapshots, and
  atomic refusal evidence without exposing an analyzer API or editor product.
- V1-DX-B2 — Commit `ff1eeaa` adds private namespaced, independently versioned
  facets; bounded normalized plain-data contributions; explicit
  absent/unknown/newer handling; strict lossless snapshot serialization; and a
  permanent normalized fixture without exposing an analyzer schema or product.
- V1-DX-B3 — Commit `cb83bf8` adds the private dependency ownership graph,
  deterministic causal closure and recomputation, configuration epochs,
  deletion/rename cleanup, construction-time provenance, and strict schema-v3
  round trips against the canonical V1 application corpus.
- V1-DX-B4 — Commit `266f036` publishes one complete private analyzer epoch,
  atomically replaces facets, artifacts, and deletions, suppresses cancelled,
  superseded, stale, or refused work, and preserves strict schema-v4 recovery
  evidence without exposing an analyzer product or schema.
- V1-DX-B5 — Commit `43a9250` adds private code-owned diagnostic semantics,
  exact/null locations, causal and skipped-work evidence, redacted internal
  failures, freshness-bound automatic/review corrections, strict round trips,
  and canonical success/refusal/recovery fixtures without exposing a schema.
- V1-DX-B6 — Commit `747604e` adds private lazy bounded static explanation,
  module-owned route flow and strict transport, cancellation and freshness,
  construction-time budgets, structural truncation evidence, causal ordering,
  canonical success/refusal/recovery fixtures, and no analyzer export or editor
  product.
- V1-DX-B7A — Merge commit `b6fb1df` adds one retained private project authority,
  complete deeply immutable route artifact planning, configuration and structural
  freshness, atomic diagnostics/artifacts/removals, typed collision facts,
  provenance, flow and recovery evidence, and no filesystem or public analyzer
  surface.
- V1-DX-B7B — Commit `5c8fc17` adds the packed human `fadeno check` workflow,
  static non-executing configuration parsing, exact installed implementation and
  parser identity, stable success/collision/correction/flow/recovery evidence,
  and no filesystem writes, machine schema, or editor product.
- V1-DX-B7C — Commit `47cc591` applies only one exact current analyzer-published
  route set through the contained transaction, preserves last-good output across
  diagnostics and real operation faults, centralizes route artifact identity,
  migrates canonical project integration, and adds no build/watch or public API.
- V1-DX-B7D0 — Commit `ebb6a86` decomposes retained consumption into bounded
  coordination, batching, compiler, watcher, decision, build, and development
  slices and adds DG-V1-06 before public build or development implementation.
- V1-DX-B7D1 — Commit `14de5c8` gives one retained private project authority a
  FIFO coordinator with immutable request identities, failure-absorbing drain,
  immediate derived freshness, and explicit idempotent close without adding a
  watcher, compiler pipeline, command, server, or public analyzer surface.
- V1-DX-B7D2 — Commit `23c9d58` adds deterministic invalidation batching,
  synchronous active supersession, constant-time pending unlink, atomic saved
  reconcile and forgetting, exact document-authority freshness, bounded retained
  ownership, and no watcher, compiler, command, server, or public analyzer surface.
