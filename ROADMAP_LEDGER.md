# Roadmap ledger

This tracked ledger contains current execution state only. Durable decisions
belong in ADRs; current claims requiring evidence belong in the hypothesis
ledger; Git history records completed work.

## Current slice

V1-13 — authenticated no-JavaScript CRUD vertical slice

## Exit criteria

- [x] Export the sole typed action declaration, field descriptor, expected
  failure, redirect, and request-scoped session capabilities selected by ADR
  0035 without exporting the private decision schema or adding a second
  mutation path.
- [x] Integrate bounded native POST decoding, exact HTTPS origin, generated
  route/action/field/proof identity, atomic replay consumption, mandatory
  authorization, upload cleanup, protected session publication, and redacted
  failures before any application mutation can run.
- [x] Integrate successful, changed, and unexpected mutation outcomes with
  complete resource revalidation; preserve safe expected-failure fields; and
  render or issue only normalized same-origin 303 completion.
- [x] Extend the packed canonical application into authenticated CRUD whose
  read, create, validation, update, upload, redirect, session rotation, and
  delete paths work with browser JavaScript disabled.
- [x] Retain executable success, deliberate refusal/failure, human and
  normalized diagnostics, correction, flow inspection, recovery, stale-state
  removal, security, type, accessibility, adapter, and packed-package evidence.
- [x] Align current specifications, scope, traceability, risks, examples, and
  rollback intent; pass focused, full, exact local, architecture, security,
  package-surface, and fresh review gates.

## In progress

- V1-13 is active from clean `main` after V1-12 and the post-R1 opportunity
  proposal merged. The proposal begins only after R1 and does not change the
  current delivery sequence or V1 contract.
- ADR 0035, the current forms/actions/sessions specification, the V1-12 private
  decision model, and the canonical packed application are the implementation
  authorities for the first public authenticated CRUD path.
- The runtime remains single-process for action replay and protected sessions.
  No enhanced submission protocol, shared replay/session owner, public
  analyzer schema, editor product, or post-R1 opportunity enters this slice.
- Public behavior is proven through the packed application's complete
  JavaScript-disabled workflow and permanent success, refusal, flow, and
  recovery artifacts executed through public package entrypoints.
- Exact implementation head `ce795c2` completes the typed declarations,
  bounded native adapter boundary, protected session publication, complete
  revalidation, redacted incidents, packed HTTPS CRUD application, and
  normalized executable evidence. It additionally proves non-null required
  inputs, 303-only action completion, form-instance-bound validation,
  sensitive-field non-reflection, opaque POST names, fallback action context,
  refusal without cookie minting, deterministic completion-time expiry,
  fixed-size long-return bindings, canonical checkbox values, multi-select
  refusal, tampered-session deletion, and specific unsafe-redirect refusal.
  Chromium, Firefox, and WebKit execute the workflow with JavaScript disabled.
- The architecture audit centralized action limits and preserved the standalone
  adapter boundary. The asymptotic audit found only linear work over explicitly
  capped actions, bodies, parts, files, session values, replay entries, and flow
  records; no broader performance claim is introduced. The adversarial review
  added pre-parser part bounds, authorization/replay evidence, rotated-session
  failure recovery, and redacted unexpected-action reporting.
- V1-13 exports no private decision schema, adds no public analyzer or editor
  product, retains one process-local replay/session owner, and does not add the
  deferred enhanced submission protocol.

## Blockers

- None.

## Open questions

- DG-A0-01: public package names after registry ownership is secured.
- DG-A0-02: compatibility-controlled external analyzer and diagnostic schema
  after a demonstrated supported consumer.

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
  slices and adds a decision gate before public build or development implementation.
- V1-DX-B7D1 — Commit `14de5c8` gives one retained private project authority a
  FIFO coordinator with immutable request identities, failure-absorbing drain,
  immediate derived freshness, and explicit idempotent close without adding a
  watcher, compiler pipeline, command, server, or public analyzer surface.
- V1-DX-B7D2 — Commit `23c9d58` adds deterministic invalidation batching,
  synchronous active supersession, constant-time pending unlink, atomic saved
  reconcile and forgetting, exact document-authority freshness, bounded retained
  ownership, and no watcher, compiler, command, server, or public analyzer surface.
- V1-DX-B7D3 — Commit `f2ab801` serializes analysis, atomic route application,
  two-pass stock-compiler validation, exact dependency and package freshness,
  retained rollback and cleanup, cancellation, supersession, close, and restart
  recovery without adding build, development, watcher, server, or public API.
- V1-DX-B7D4 — Commit `1ff4f42` translates bounded contained filesystem
  notifications into authoritative rescans, separates notification and
  admission identity, bounds path retention by count and bytes, preserves dirty
  work across refresh, and closes without adding an operating-system watcher,
  server, command, or public API.
- V1-DX-B7D5 — Merge commit `33ec934` accepts the exact build/development
  lifecycle contract after current packed decision evidence for compiler,
  output, runtime, environment, loader, last-good, diagnostics, and shutdown
  ownership, without shipping either command or a public analyzer surface.
- V1-DX-B7D6 — Merge commit `b381041` implements the packed transactional
  production build and generated production start with exact current-package,
  compiler, source, dependency, runtime, output, rollback, concurrency,
  redaction, and clean-consumer evidence.
- V1-DX-B7D7 — Merge commit `90aa4fb` implements the exact packed development
  command with authoritative rescans, fresh verified children, last-good
  diagnostics and startup rollback, bounded output and shutdown, and permanent
  canonical success/refusal/flow/recovery/cleanup evidence without exposing an
  analyzer schema or editor product.
- V1-10 — Merge commit `603e450` accepts ADR 0034, resolves the resource
  identity/cache gate through opaque declaration identity, deeply frozen
  normalized input, bounded request-only promise caching, failure and
  cancellation ownership, declaration-reference `keeps`, explicit shared-cache
  refusal, private executable evidence, and no public runtime or action/session
  surface.
- V1-11 — Merge commit `7b25772` implements the typed request-scoped resource
  runtime, bounded normalized-input promise ownership, renderer lifecycle,
  expected failure propagation, prompt cancellation, immutable dependencies,
  complete private revalidation, unsafe-`keeps` correction, packed
  success/failure/isolation/recovery examples, and no action, session, shared
  cache, editor product, or stable machine schema.
- V1-12 — Merge commit `82abb0f` accepts ADR 0035 and its private strict-TypeScript
  action/session decision model, bounded native request and upload contract,
  purpose-separated proof and replay ownership, protected session envelope and
  rotation, complete revalidation decision, redacted success/refusal/flow/
  recovery evidence, and no public runtime, editor product, external schema,
  or multi-process action support.
