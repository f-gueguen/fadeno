# Roadmap ledger

This tracked ledger contains current execution state only. Durable decisions
belong in ADRs; current claims requiring evidence belong in the hypothesis
ledger; Git history records completed work.

## Current slice

A0-07 — collect independent public-workflow evidence

## Exit criteria

- [x] Freeze the versioned independent-user task, privacy, retention, artifact
  identity, and synthetic-evidence refusal contract through ADR 0042.
- [ ] Retain at least two real independent participant attempts over one exact
  packed artifact without private guidance or omitted attempts.
- [ ] Verify install/create/test/check/dev/build/deploy, seeded failures,
  corrections, flow inspection, stale-state recovery, and missing workflows.
- [ ] Pass exact evidence replay, full local CI, and independent review gates.

## Active sub-slice

A0-07B1 replay and collection controls only. It verifies exact artifact and
attempt identity, all-started retention, privacy, task evidence, and synthetic
refusal before collection. It cannot claim user evidence, select editor
tooling, expose an analyzer schema, publish a package, or treat synthetic
fixtures as participants.

## In progress

- Merge commit `3be74fa` completes A0-07A with eleven exact ordered
  public-workflow tasks, a digest-bound instruction packet, a versioned attempt
  shape, two-participant minimum, anonymous bounded records, all-attempt
  retention, exact artifact identity, and fail-closed synthetic-evidence
  refusal. A0-07B1 now adds replay, exact clean-commit package reconstruction,
  and missing-directory participant-bundle controls before A0-07B2 may retain
  real observations.

## Blockers

- A0-07B2 acceptance requires at least two real independent non-contributors.
  Implementation and synthetic contract testing can continue, but no automated
  fixture or maintainer replay can satisfy that external evidence gate.

## Open questions

- DG-A0-02: compatibility-controlled external analyzer and diagnostic schema
  after a demonstrated supported consumer.

## Completed slices

- A0-06 — add the first supported deployment workflow. Merge commit `0272684`
  accepts ADR 0041 and adds the exact public deployment command,
  source-free production-only artifact, runtime identity verification, external
  HTTPS health, configuration refusal, graceful stop, prior-directory rollback,
  stale-route recovery, generated guidance, and review hardening without a
  provider, proxy implementation, process manager, or public machine schema.

- A0-05 — Merge commit `985a22f` adds the stock created-application test
  workflow, three production-runtime assertions, deliberate assertion and
  build-input refusals, normalized human/TAP evidence, correction, flow,
  recovery, stale-output removal, and generated guidance without another test
  runtime, public helper, or analyzer schema.

- A0-04 — Merge commit `0f3b351` adds the exact public create command, fixed
  TypeScript/TSX scaffold, packed check/build/dev/start proof, diagnostics,
  correction, flow, recovery, documentation, and mutation evidence without
  installing dependencies, publishing, or creating another runtime.

- A0-03 — Merge commit `18dbf8f` completes the public-name migration and
  establishes the `0.0.0` seed,
  Changesets alpha train, exact tarball and metadata, deterministic SPDX SBOM,
  guarded release-only publication transport, current-packed consumers, and
  permanent success/refusal/flow/recovery/rollback evidence without publishing.

- A0-02 — Merge commit `7dfe3a3` accepts the owner-verified unpublished
  `@fadeno/framework` identity, exact export/bin map, provenance bootstrap,
  trusted-publisher identity, and rollback boundary without publishing or
  making the package public.

- A0-02A — Merge commit `7757013` adds a TypeScript-only read-only registry
  preflight with normalized success/refusal fixtures, mutation guards, release
  policy, traceability, and risk evidence while leaving the package private.

- A0-01 — Merge commit `6de019c` accepts only application-owned same-origin
  external CSS for alpha, retains inline-style refusal and scoped-CSS deferral,
  and proves the packed canonical application in three engines with complete
  normalized failure, correction, flow, recovery, and stale-removal evidence.

- A0-00 — Merge commit `29ded97` decomposes public-alpha delivery into eleven
  dependency-ordered slices, records the blocked registry identity, assigns
  four decision owners, and mechanically enforces exact A0 feature, dependency,
  artifact, validation, and private-package contracts.

- V1-14D — Merge commit `d2acf0a` derives all V1-gated features and contained
  evidence into one checked exit manifest, qualifies the three-engine native
  accessibility baseline, retains bounded security/architecture/Big-O risks,
  and preserves private package, tooling, support, and performance limits.

- V1-14C — Merge commit `c305ec7` adds the canonical `pnpm check` script and
  one current-packed single-consumer gate for frozen installation, public
  entrypoints, check/build success and refusal, correction, stale diagnostic/
  artifact removal, development and production HTTP service, production-only
  installation, graceful shutdown, package/readme audit, and zero retained
  operation ownership.

- V1-DX-C5B — Result `20260717T090059Z-4d57a69-a4` records every declared
  warmup and sample with explicit
  phase detail, exact source/package/runtime/compiler/environment and host
  identity, accepted diagnostic and cleared replacements, complete artifact/
  disk evidence, and zero cleanup. Its independent verifier reconstructs the
  source commit, derives the summary from all samples, verifies file manifests,
  retains the prior sensitive-identity redactions, and makes no performance
  bound or public analyzer/tooling contract.

- V1-DX-C5A — Implementation commit `34daa55` freezes the exact two-workload,
  2-warmup, 5-repetition feedback contract; verifies current source, packed
  package, runtime, compiler, environment, monotonic endpoints, accepted-event
  order, stale-output recovery, no-retry completeness, and zero ownership; and
  retains normalized success, diagnostic, flow, refusal, and recovery evidence
  without retaining timing values or adding a public surface.

- V1-DX-C4 — Commit `173bb38` adds current-packed deterministic cancellation,
  supersession, newest-only delivery, close-during-work, post-close refusal,
  exact private ownership cleanup, and normalized interruption, flow, recovery,
  refusal, and cleanup evidence without exposing an analyzer product or schema.

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
- V1-13 — Merge commit `a36c5e9` implements the sole typed native action and
  protected-session runtime, bounded exact-origin POST boundary, authorization,
  replay and upload cleanup, complete resource revalidation, redacted failures,
  and the packed three-browser JavaScript-disabled authenticated CRUD workflow
  without an enhanced protocol, shared owner, analyzer schema, or editor
  product.
- V1-DX-C0 — Merge commit `a6c5295` decomposes the remaining private analyzer
  lifecycle and complete feedback-loop qualification into bounded C1-C5B
  milestones with aligned specifications, traceability, risks, policy checks,
  and no implementation or public product surface.
- V1-DX-C1 — Implementation commit `0aecd81` integrates open, ordered change,
  replacement, save, close, and reopen with the private project authority;
  derives one coherent saved-or-overlay input generation; rejects unsupported
  ownership; suppresses changed generations before publication; and retains
  permanent direct success, refusal, flow, and recovery evidence without a
  packed consumer, public schema, command, or editor product.
- V1-DX-C2 — Implementation commit `0bf6239` installs and verifies one current
  framework tarball before importing private analyzer bytes; observes accepted
  packed initialize, open, position-dependent edits, replacement, structured
  diagnostics, review correction, recovery, close, reopen, and cleanup; and
  retains normalized success, failure, correction, flow, recovery, and cleanup
  evidence without an export, command, editor metadata, stable schema, or
  supported editor product.
- V1-DX-C3 — Implementation commit `d4b3275` verifies current packed analyzer,
  invalidation-adapter, parser, and platform bytes before private imports;
  observes direct, genuine three-edge imported, configuration, rename,
  deletion, diagnostic-refusal, and recovery deliveries; correlates all seven
  generated values with exact disk bytes; and retains normalized success,
  refusal, flow, stale-artifact, recovery, and human diagnostic evidence without
  a public analyzer surface, schema, command, protocol, or editor product.
