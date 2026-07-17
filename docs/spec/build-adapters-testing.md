# Configuration, build, adapters, testing, and diagnostics

The repository exposes one coherent workflow from source to a tested deployment
artifact. ADR 0022 fixes the toolchain/configuration names, and ADR 0023 selects
Node HTTP as the initial adapter target without creating a public package.

## Configuration

1. Configuration is a typed standard module loaded from one documented project
   root.
2. The only discovered file is root `fadeno.config.ts`, with a default plain
   object export and a closed typed shape.
   Ownership is validated as a non-symlink ordinary file before source bytes are
   read. B7B parses the demonstrated plain literal or `defineConfig`-wrapped
   literal with the standard TypeScript parser and never executes configuration.
   Side-effecting or computed forms are refused. Analysis is accepted only when
   those exact source bytes remain current.
3. Unknown keys, invalid combinations, missing paths, and unsupported adapter
   capabilities fail before serving or building.
4. Configuration used by a production build is serializable into a redacted
   manifest for diagnosis. Secrets and process-specific values are excluded.
5. Development and production share application semantics; development checks
   may add verification but cannot become a correctness dependency.

## Development and build

The core commands are `fadeno dev`, `fadeno build`, and `fadeno check`.
`.fadeno/` contains disposable internal state; transactional, reproducible
deployable output belongs to `dist/`. Scaffold and additional diagnostic
convenience commands remain A0 work.

ADR 0032 fixes the first packed check invocation as
`fadeno check --project-root <path> [--explain]`. The root is mandatory and
explicit; semantic explanation is the only option. Complete success exits `0`,
expected project diagnostics exit `1`, usage exits `2`, and redacted unexpected
failure exits `3`. Human output is public now. Machine-readable command output
remains refused while DG-A0-02 is open.

Optional `.env` and `.env.local` files load in that order before the existing
process environment, which has final precedence. The strict line grammar and
refusals are defined by ADR 0022. Loaded values remain server-only unless a
future explicit public-input schema validates their release.

A production build:

- starts from a clean checkout and frozen dependency install;
- emits only declared server, browser, manifest, declaration, and asset outputs;
- contains no server secret in browser output;
- is reproducible for identical tracked source and declared environment;
- records framework/compiler versions and adapter capabilities;
- reports route, diagnostic, and browser-byte summaries without claiming
  precision the build cannot attribute;
- fails on stale generated artifacts or public-contract drift.

V1-DX-B7C implements only the private route-artifact application boundary used
by later build and development consumers. It consumes one exact current analyzer
publication, not a generic artifact list, and it cannot rediscover or rerender
route facts. Diagnostic publications preserve the last accepted disk set.
Directory replacement never exposes mixed generations, although portable
backup-and-replace has a bounded interval with no route directory; retained
consumer application/compiler serialization is implemented by V1-DX-B7D3. Actual
filesystem-operation and restart-recovery tests cover stage, backup, replace,
validation, restore, and cleanup failures. No command behavior changes in B7C.

## Package boundary

ADR 0024 selects one logical framework package with a runtime-neutral `.`
facade and a Node-only `./node` adapter facade. The root is compiled without
Node types and cannot reach Node, compiler, or browser-only modules. Its API may
grow only as later V1 decisions accept those public contracts.

Package exports are an explicit allowlist. Examples and consumers use package
specifiers and declared subpaths; internal files remain private even when they
are present in package contents. Cross-package relative imports, re-exports,
dynamic imports, traversal, symlink escapes, and private deep imports are
errors. Registry naming remains separate from this relative topology.

ADR 0025 fixes the first private package surface. `.` exports the standard Web
`Handler` type. `./node` exports `listenNodeHttp`, `ListenNodeHttpOptions`,
`NodeHttpServer`, `nodeHttpCapabilities`, and `NodeHttpCapabilities`. The
workspace identifier is internal and non-publishable; it is not a registry
decision. Later accepted contracts may extend the root without adding another
way to perform the same job.

ADR 0031 adds exactly `./jsx-runtime` for the standard automatic JSX transform
and the minimum root rendering symbols demonstrated by V1-09. It adds no manual
route registry. Private build output statically binds discovered route modules
to the matched-route renderer and remains correlated with the generated route
manifest.

The same decision extends `ListenNodeHttpOptions` with a request-scoped
`failureObserver` and exports its structured report type. Pre-publication
failure pages and post-publication termination share incident correlation. The
safe projection is redacted; the original cause reaches only the server-owned
callback. A throwing or rejecting callback cannot change transport cleanup.

ADR 0033 also extends the same options with an optional numeric `port` for the
verified production bootstrap. Omission or zero keeps the raw adapter's
ephemeral behavior; the production bootstrap accepts only `1..65535`.

## Adapter contract

1. The core accepts standard `Request` and returns standard `Response` values
   using Web Streams and cancellation.
2. An adapter translates host startup, address, environment, body, stream,
   disconnect, and shutdown behavior at the outer boundary.
3. Each adapter publishes a capability declaration covering streaming,
   cancellation, trailers if used, request limits, trusted proxy input, and
   graceful shutdown.
4. Unsupported required capability fails visibly; the adapter cannot silently
   buffer, drop cancellation, trust proxy headers, or change cookie semantics.
5. Only adapters that pass the shared suite appear in the support matrix.

ADR 0023 selects Node 22.17.0 or newer with built-in `node:http` as the initial
adapter target. Its declared capability set includes streamed requests and
responses with backpressure, disconnect cancellation, and graceful active-work
drain. It explicitly excludes response trailers, adapter-enforced request-size
limits, and trusted proxy headers. The adapter derives request URL authority
from its listener rather than untrusted host or forwarded metadata.

The selected adapter does not enter the support matrix until its public package
surface passes the shared conformance suite. Additional adapters remain
deferred until that suite exists.

The V1-04 packed smoke proves the successful raw `Handler` path. Handler
failure, response-commit, renderer timeout, and forced shutdown semantics remain
owned by the later streaming-boundary decision and are not frozen by this
surface.

## Test layers

| Layer | Required evidence |
| --- | --- |
| Unit | Pure renderer, decoder, identity, ordering, and analyzer rules |
| Type | Positive and negative stock-TypeScript fixtures |
| Integration | Route/resource/action/session behavior over `Request`/`Response` |
| No JavaScript | Essential navigation, validation, mutation, redirect, and authentication workflows |
| Browser | Chromium, Firefox, and WebKit enhancement and preservation behavior |
| Security | Malformed, hostile, unauthorized, replayed, oversized, and cross-user cases |
| Adapter | Shared streaming, cancellation, header, cookie, disconnect, and shutdown suite |
| Reproducibility | Two clean builds and generated-artifact comparisons |

Test helpers may expose resource execution, action submission, page rendering,
and document interaction only after the underlying public semantics exist. Test
APIs cannot become a second runtime implementation.

## Private experiment evidence

K0 experiment results use checked, versioned contracts under
`experiments/contract/`. The historical browser experiments use
`experiments/reference-environment.json`; a non-browser experiment may add a
scoped reference only through an accepted ADR and strict pre-measurement
contract that preserves prior evidence. Container and applicable browser
toolchains are digest-pinned. Mutable host facts are recorded for every
attempt, and a preflight deviation classifies the run as non-reference before
measurement. Relative performance comparisons run in one exclusive attempt.

This contract validates evidence shape and integrity only. It does not claim
that any experiment harness, framework mechanism, browser support, or
qualification result exists.

## Diagnostics and support

- User errors provide a stable identifier, source location, concise reason,
  explanation link, and smallest correction.
- Production failures provide a safe public response and structured server
  hook with redaction.
- A project-check command aggregates type, generated-artifact, boundary,
  configuration, security-policy, and documentation validation.
- The support matrix is evidence-generated from the versions exercised in CI;
  a roadmap mention does not imply support.
- A0 clean-machine tests prove installation, scaffold, development, check,
  build, test, and deployment without private instructions.

ADR 0030 adds one private analyzer authority for framework semantics. Check,
watch/build integration, tests, and disposable development consumers resolve
the same workspace root and configuration, normalize URIs and paths through
the same containment and symlink rules, own generated outputs consistently,
share redaction and error semantics, and publish only current complete epochs.
Unsupported multi-root input is refused explicitly.

Analyzer examples begin after V1-09 and extend the canonical application plus
an isolated failure-scenario harness. They install a current packed framework,
use public package entrypoints, assert behavior, normalize unstable values, and
source documentation snippets and expected output from executed files. A
deliberate failure never prevents the primary application from building.

Before the B7D6 and B7D7 packed build and development slices, private analyzer
foundation fixtures may copy the canonical application as semantic corpus.
Those fixtures are conformance evidence, not public build or development
examples. The
`check:v1-analyzer-package` gate rebuilds and packs the current framework,
proves the private implementation is present, and proves package exports still
refuse analyzer deep imports. B7B executes analyzer examples through the packed
public check workflow. ADR 0033 permits B7D6 and B7D7 to add packed build and
development examples. B7D6 implements the build half and B7D7 implements the
retained development half through the installed public executable.
B6's private canonical-app flow
fixtures contain both module-rendered human output and normalized machine
output from executed success, deliberate route refusal, and recovery
operations.

The V1 lifecycle workload measures edit/save to a fresh framework diagnostic
and edit/save to a cleared diagnostic across invalidation, generation,
TypeScript refresh, Fadeno analysis, and final accepted consumer-visible
replacement. Reading internal current state is not a publication observation.
Deep phase timing and profiles require an explicit flag. This workload does not
reuse or revive the narrowed K0 incremental-generation claim.

## Retained build and development sequence

`fadeno check`, `fadeno build`, and the exact explicit-root/explicit-port
`fadeno dev` form are implemented project commands. B7D1 gives the
private project authority one retained FIFO coordinator and exactly one analyzer
session. Frozen admission handles preserve monotonic request identity across
success and failure. Analysis and explanation never overlap; admitted work
drains through idempotent close, while new and derived work refuses as soon as
closing starts. This private lifecycle changes no command, output directory, or
server behavior.

B7D2 extends that same coordinator with deterministic analysis batches. A
same-turn burst records a compact first/latest/count identity, supersedes
pending middle work, signals active obsolete work, and gives application and
explanation authority only to the newest complete result. Pending obsolete work
unlinks in constant time instead of remaining as FIFO tombstones. Cancellation,
supersession, expected failure, and close are distinct terminal paths. A
result-continuation handoff and close both recheck the owned drain, so no
accepted invalidation can disappear at the idle boundary.

B7D2 also replaces per-document project synchronization with one atomic session
reconcile. The transition validates the full desired/forgotten set and exact
saved-revision ownership against cloned state, then publishes one document
snapshot and epoch. Project scanning never creates or overwrites unsaved
overlays. Former route-root files are forgotten even when they still exist,
while duplicate aliases, stale revisions, symlinks, text mismatch, and open
desired or forgotten buffers preserve the complete prior state. Direct,
structural, configuration,
deletion, rename, and burst fixtures issue only a generic private analysis
admission after mutating authoritative project state.

B7D3 gives that coordinator one private retained refresh operation. Analysis,
provisional B7C application, validation-only stock compilation, final freshness,
and commit or rollback execute as one queue item. The exact previous route set
or first-generation empty state remains recoverable until acceptance. Compiler
diagnostics, process failure, cancellation, supersession, ownership drift, and
close all await child termination and restore the prior accepted generation. A
rollback failure remains explicitly owned, is retried before later work or
close, and prevents successful close if deterministic recovery still cannot
restore the accepted state.

The compiler is invoked asynchronously from the installed toolchain with the
project configuration and no emit or incremental output. A first stock-compiler
pass discovers and content-identifies the exact resolved inputs; a second pass
performs validation and must report the same input and ownership identities.
Resolved local inputs must remain under the canonical project root;
only the selected compiler package and exact installed package roots with
matching ordinary manifests may resolve outside it. Aggregate dependency-store
or ancestor directories never grant ownership, and every non-empty successful
input-list record is interpreted exactly rather than whitespace-normalized.
Project source symlinks and validators bound to another root refuse. A globally
bounded project-owned inventory is streamed with bounded memory, actual-byte
accounting, file-stability checks, and cancellation checks; it must remain
unchanged across compilation and is rechecked immediately before commit. Every
resolved compiler input is also content-identified and rechecked immediately
before commit, including inputs below installed package roots. Device, inode,
size, modification, and change identities prevent a changed input from being
accepted merely because its bytes were restored before the child exited.
Package
discovery has global entry and manifest-byte limits, observes cancellation, and
binds each logical installed-package entry, canonical root, package identity,
manifest content, and manifest change identity. Compiler text is
not exposed, and acceptance binds the coordinator generation, analyzer
publication, provisional artifact identity, compiler version, validation
inventory identity, and resolved-input identity. The
framework project authority owns route, configuration, containment, and
generated-output facts; the stock compiler owns the ordinary application module
graph. No second application graph, `dist`, build-info, watcher, command, server,
or public analyzer surface is introduced.

Provisional, prior, empty, and non-authoritative garbage route directories have
distinct transaction names. Authoritative replacement, acceptance, and restore
use atomic rename before recursive cleanup. A partial cleanup can therefore
leave only non-authoritative garbage; the retained owner and restart recovery
retry it without treating it as a rollback generation. Unresolved rollback or
cleanup remains owned and prevents successful analyzer close. The retained
recovery owner is installed before restart recovery, staging, or any later
transaction mutation, so even an early persistent failure blocks successful
close and remains recoverable by a later process.

B7D4 next adds a filesystem adapter that treats notifications only as rescan
hints. It must coalesce changes, avoid owned-output loops, retain a dirty signal
for work arriving during an operation, and recover by deterministic rescan
rather than interpreting notification names as truth. None of these private
stages implies a public production build or development server.

The B7D4 private adapter normalizes named hints against the project root,
refuses external, malformed, or symlink paths, and excludes `.fadeno` and
repository metadata before scheduling. Rename, missing-name, alias ambiguity,
and bounded precise-hint count or aggregate-byte overflow become full-workspace
rescans rather than semantic path operations; an overlong individual path is
refused before retention. Raw notification identity is distinct from accepted
batch-admission identity. A bounded debounce and maximum delay coalesce idle
bursts on a monotonic production clock; injected backward clock movement cannot
strand accepted work. Notifications admitted during one B7D3 refresh form exactly one later
batch. Flush and idempotent close own completion, cancellation, timer cleanup,
project close, and observer isolation. This is disposable watcher-lifecycle
evidence only: no operating-system watcher, server, CLI, or public contract is
selected.

ADR 0033 resolves the build and development contract. Build requires one
explicit project root; development additionally requires one explicit
`1..65535` port and binds only `127.0.0.1`. Both capture immutable
generation-scoped environment and runtime identities, consume one current
analyzer publication, obtain structured stock-compiler diagnostics without
parsing prose, and emit only a clean fresh generation. Build stages outside
`dist`, validates the complete stage, and atomically accepts or restores one
generation. Its production entry is the generated route loader followed by the
generated server bootstrap, with one required `FADENO_PORT` and loopback-only
V1 listening.

Development keeps application imports out of the supervisor and runs each
accepted generation in a fresh child. Diagnostic, cancelled, stale, or failed
candidates leave the last accepted child active. A successful switch drains
the previous child before the new child binds the explicit port; V1 promises a
bounded switch and rollback, not uninterrupted reload. Notification names
remain hints for authoritative rescan. Full diagnostic batches replace prior
batches, and repair clears stale diagnostics. The first termination signal
starts a 5,000 ms graceful drain; a repeated signal or deadline forces owned
children and exits `3`. Statuses are `0` for complete success/graceful stop, `1`
for expected project or startup diagnostics, `2` for usage, and `3` for
unexpected or forced failure. B7D6 and B7D7 separately implement and document
these contracts with executable success, failure, flow, recovery, and cleanup
evidence.

B7D6 implements the production half through the installed `fadeno` executable.
It first obtains one diagnostic-free retained analyzer/compiler generation and
then runs the current packed emission child against the same accepted route
artifacts. The child captures structured stock-compiler diagnostics before any
emit, verifies exact project and installed-package ownership, emits with
no-check only after a clean snapshot, and rechecks source, dependency,
environment, compiler, and framework identities. Expected diagnostics remove
the candidate stage and preserve the accepted `dist` generation.

Build ownership is exclusive per project. A concurrent live owner is refused;
a later operation may recover only a syntactically valid lock whose recorded
process no longer exists. A second independent generation immediately before
acceptance must reproduce the first generation's input, compiler-dependency,
runtime-reference, and emitted-output identities. This final check includes
newly discovered source, configuration and environment changes, and direct or
transitive external compiler input changes.

The command adds one deterministic build-owned bootstrap and a versioned
manifest to the complete stage. The manifest contains file and runtime hashes,
compiler and analyzer artifact identity, and the environment fingerprint but no
environment values, absolute roots, timestamps, or secrets. Atomic renames
replace `dist`; only a previous generation whose bounded manifest and exact
owned file set validate may become rollback authority, and it remains so until
the complete candidate identity is rechecked. Startup parses the required port,
verifies the exact manifest file set and the bounded installed closure of
declared production, installed optional, and required peer dependencies, and
only then dynamically imports the public Node adapter and generated application
handler. Root development dependencies and unrelated installed packages do not
enter the runtime closure. Emitted application imports are scanned under
explicit source, token, and reference limits and every external package must
belong to that declared production graph. Non-literal dynamic imports,
development-only imports, absolute package paths, and undeclared imports are
refused before acceptance. A required root peer is part of the graph and must
remain installed for production startup.
The route loader is still a required earlier Node import.

The canonical packed application is the public build example. Its gate proves
two clean packed consumers produce byte-identical builds, an initial compiler
failure leaves no `dist`, and later compiler failures preserve last-good output.
It also proves redacted compiler text, current and newly added source and
configuration freshness, environment and external compiler freshness,
framework-runtime freshness, concurrent refusal and crash recovery, declared
runtime-package enforcement, a required root peer, production-only reinstall
and start,
an injected post-stage identity failure with actual rollback, unowned output
and fabricated rollback refusal, correction and diagnostic clearing,
deleted-owner artifact cleanup, secret exclusion, normalized production
dependency evidence, bounded-manifest refusal, missing-port, missing-loader and
changed-runtime refusal before readiness, unrelated development-package
independence, production start, HTTP behavior, and graceful stop.
The build driver and generation child remain package-private; no machine command
output, public analyzer schema, development watcher, or broader listener address
is introduced.

B7D7 implements the development half through the same installed `fadeno`
executable and shared accepted-generation owner. One retained supervisor owns
the recursive operating-system watcher, B7D4 adapter, private project analyzer,
generation transaction, and isolated child processes. Notifications never
select semantic work: `.fadeno`, `dist`, and repository metadata are excluded,
while every accepted direct, transitive, configuration, rename, deletion, or
burst hint causes authoritative current-workspace analysis.

The initial diagnostic-free generation is staged, accepted, verified, and
started with the generated loader registered before the bootstrap. Only that
child imports application modules, receives the frozen generation environment,
and binds `127.0.0.1` at the explicit port. Later clean work drains the prior
child, atomically accepts one candidate output, and starts a fresh child. A
diagnostic leaves the prior child and `dist` active; repair replaces the whole
diagnostic observation with a clean-generation notice. Cancellation and
supersession terminate the generation child and prevent candidate acceptance.
If candidate startup fails after output acceptance, the output transaction
restores the prior generation and the prior child is restarted before later
work is admitted.

The first termination signal closes watcher admission and begins complete
analyzer, compiler, transaction, server, and child drain. A 5,000 ms deadline
or repeated signal force-terminates owned children and exits `3`; graceful
completion exits `0`. An occupied address is one stable expected startup
refusal with exit `1`, and malformed command input is usage exit `2`. The
packed canonical scenario proves last-good compiler refusal and repair, stale
artifact deletion, direct/transitive/configuration/rename/burst behavior,
graceful shutdown, active-stream repeated-signal force, address refusal, and
normalized flow/recovery evidence. It introduces no public watcher API,
machine output, analyzer schema, editor product, or broader listener address.

## V1-DX-C evidence stages

V1-DX-C is delivered as planning, integration, qualification, interruption,
and measurement stages rather than one harness PR. C0 enforces the sequence.
C1 integrates saved and overlay document lifecycles with the same private
project authority used by check, build, development, tests, and filesystem
rescans. C2 installs a current package tarball and qualifies open, one ordered
position-dependent unsaved edit batch, line-ending and analyzer-text
equivalence, diagnose/correct/repair/close/reopen behavior through a disposable
private lifecycle consumer. C3 qualifies saved direct and three-level transitive
changes, configuration reload, rename/deletion, and generated declaration and
manifest replacement/removal. C4 uses deterministic compiler-child barriers
rather than sleeps to qualify explicit cancellation, shared-authority
supersession, obsolete-result suppression, newest-only accepted delivery, close
during work, post-close refusal, balanced child settlement, and exact private
ownership cleanup.

C3 records only immutable filesystem-adapter observer deliveries. Each success
delivery includes the analyzer-produced empty diagnostic batch, publication,
application result, and stock-compiler validation for one operation. Each
diagnostic failure includes its analyzer-produced diagnostic batch and
publication while the previously accepted generated directory remains
byte-identical. Callback capture is synchronous because callback exceptions are
intentionally isolated; assertions occur after flush and require exactly one
captured delivery, matching callback/flush identity, all seven unique generated
paths and values, exact generated-directory bytes, and no transaction debris.
The genuine transitive control places its leaf outside the configured root-file
include and reaches it only through a three-edge import chain from one included
owner. Package, parser, platform executable, analyzer, and invalidation-adapter
identities are verified with mutation canaries before absolute installed-path
imports.

C4 rebuilds and installs the current tarball before importing its private
analyzer, compiler, and invalidation modules by absolute installed path. Its
TypeScript barrier child distinguishes cooperative cancellation from an
uncooperative obsolete completion. Only filesystem-adapter callbacks count as
accepted consumer truth; interruption identities and post-close refusals are
captured from the matching operation or flush promise. Normalized fixtures
retain interruption, refusal, causal flow, recovery, and cleanup. They record
that provisional compiler candidates can own disk bytes while active but can
never become an accepted delivery. The final accepted generation must match
all seven generated values and disk bytes, contain no stale route or diagnostic,
and leave no transaction debris.

The packed development scenario additionally blocks an active child candidate,
admits a newer saved edit, and proves the interruption-only observer resets
candidate decision ownership without printing failure output. The immediately
queued batch must accept and serve the newest edit; a third notification is not
permitted as a recovery trigger.

The package-owned lifecycle runner is conformance infrastructure, not a public
entrypoint. It may be present in packed internals only while export and deep
import tests keep it inaccessible. It defines no command, generic transport,
editor metadata, supported editor product, or stable machine schema. Public
examples continue to execute separately through declared public entrypoints.

C5A freezes the feedback workload and verifier before retaining results. The
contract names exact canonical mutations and the save boundary; source commit,
tarball, runtime, compiler, and environment identities; a stale-output canary;
the monotonic start and final accepted-event endpoints; warmups, repetitions,
raw attempt records, refusal controls, and completeness rules. Default runs
collect only end-to-end timing. An explicit flag enables bounded phase detail
and profiles. Attempts are not retried or selected until a favorable value
appears.

The frozen workload adds one valid `/feedback` page to a packed copy of the
canonical application. A diagnostic attempt writes one exact sibling handler,
samples the monotonic start after the write returns and before notification,
and ends only when the consumer receives the matching full diagnostic
replacement. A clearing attempt removes that handler, samples the same save
boundary, and ends only at the matching empty successful replacement. The
declared order is diagnostic then clear for two warmups and five samples. There
are no per-attempt retries and all fourteen attempts must remain present.

The raw private envelope binds the source commit and complete source-tree
digest, tarball bytes, installed package tree, runtime version and executable,
compiler version and package, platform, architecture, redacted environment
digest, contract digest, monotonic endpoints, operation and workspace identity,
diagnostic codes, publication and disk identities, validity controls, and final
ownership cleanup. The independent verifier rejects identity mismatch,
missing or reordered attempts, the wrong final event, non-monotonic duration,
incomplete cleanup, hidden phase detail, incomplete runs, and retry selection.
The dry run restores a deliberately changed installed file before imports and
retains normalized diagnostic, flow, refusal, recovery, and machine evidence;
it does not retain measured durations.

C5B retains and independently verifies edit-to-fresh and edit-to-cleared raw
evidence. Correctness, freshness, identity, cleanup, or completeness failure
invalidates the attempt and blocks qualification. No accepted latency budget
exists at this boundary, so timing values are baseline evidence only. Any
threshold, optimization claim, or renewed incremental bound requires a later
separately accepted slice.

The first retained capture, `20260717T082930Z-5d35543-a1`, is preserved as a
refusal because its working-file permission identity could not be reconstructed
from its Git commit. Its timing values are explicitly not baseline evidence.
The runner then uses Git-owned modes for tracked source, and the independently
verified accepted result is `20260717T083804Z-836baf1-a3`. The missing `a2`
result was never retained or interpreted because an ordering defect in the
independent source-tree verifier was corrected before evidence acceptance; it
is not a selected timing result.

The accepted result records the exact Apple M2 Pro, 10-logical-CPU, 32 GiB,
Darwin arm64 host, runtime and compiler versions, aggregate redacted environment
identity, raw attempts, derived summary, and file manifest. Across all five
samples, diagnostic replacement has a 49.992958 ms median and 60.895375 ms p95.
Cleared replacement has a 453.158333 ms median and 475.358625 ms p95; its
median phase values are 0.072792 ms invalidation, 144.214667 ms analysis and
generation, 221.999458 ms compiler refresh, and 91.773000 ms accepted consumer
replacement. Diagnostic attempts correctly skip compiler refresh. These values
describe only this exact workload and host; they are not a budget or an
incremental-performance claim.

## V1 and A0 conformance

- A clean checkout reaches the same build through the documented commands.
- Invalid configuration and missing adapter capability fail before listening.
- Browser bundles contain no known server-only module or fixture secret.
- All applicable test layers run through one repository check entrypoint, with
  expensive qualification suites callable explicitly and required at release
  gates.
- A stranger following only repository documentation can run the supported
  application and understand a seeded route, form, security, and boundary
  failure.
- Analyzer package and lifecycle checks rebuild and install the current packed
  framework before executing consumers; stale distribution output cannot
  satisfy conformance.
- The disposable private lifecycle consumer initializes one root, opens valid source,
  introduces and repairs invalid source, verifies diagnostic identity, range,
  related locations, version and correction, applies one declared-order
  position-dependent edit batch with exact line-ending and analyzer-text
  equivalence, changes
  direct and transitive dependencies, regenerates artifacts, reloads
  configuration, cancels or supersedes expensive work, rejects obsolete
  publication, closes and reopens documents, and verifies cleanup.
- Independent users repeat the intended workflow and seeded failure recovery
  before A0 chooses whether any supported editor product is justified.
