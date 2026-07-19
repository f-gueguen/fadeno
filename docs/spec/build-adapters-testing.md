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
remains refused; ADR 0043 defers every external analyzer schema and consumer.

Optional `.env` and `.env.local` files load in that order before the existing
process environment, which has final precedence. The strict line grammar and
refusals are defined by ADR 0022. Each file is a bounded owned ordinary file
decoded with fatal UTF-8; malformed bytes refuse as `FADENO_BUILD_ENV` before
precedence is applied. Loaded values remain server-only unless a future explicit
public-input schema validates their release.

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

ADR 0037 selects `@fadeno/framework` as the only public package identity. Its
exact public map is `.`, `./node`, `./jsx-runtime`, and the `fadeno` executable
at `./dist/cli.js`. The former pre-publication workspace name is not an alias
and is never published. A0-03 atomically moves the manifest, generated imports,
consumers, documentation, and release machinery to the accepted identity. Its
`0.0.0` seed is publishable metadata but never a published version.

ADR 0038 requires a pending Changeset for every user-visible package outcome.
The first release plan consumes those reviewed intents into
`0.1.0-alpha.0`. Exact tarball contents include the generated declarations and
runtime, package README, changelog, license, and normalized SPDX SBOM. A
prepublication guard refuses the seed version, dirty or unqualified source,
wrong tag/workflow/repository identity, private source, absent provenance, or
the wrong bootstrap/trusted credential mode.

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

ADR 0040 selects the first supported application-test workflow without adding
a helper. Created projects expose `pnpm test`: their pinned stock TypeScript
compiler emits application and typed test source into a disposable
`.fadeno/test/` tree after removing the prior tree, and Node's built-in test
runner executes one exact emitted entry. Tests use application modules and the
declared production `renderRoute` and `Handler` surfaces. Production compilation
does not include tests, and its compiler rejects `.fadeno/test/` output even if
an application broadens its production configuration. No private import,
second runtime, public test export, or public analyzer contract is introduced.

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

## Public project creation

ADR 0039 assigns `fadeno create --project-root <path>` to the existing public
executable. Creation is exact, non-interactive, and network-free. It accepts
only a missing target with a valid lowercase package-name basename beneath an
existing parent whose complete existing path consists only of ordinary
non-symlink directories. It prepares every byte, claims the target with
exclusive directory creation, and writes one fixed contained allowlist;
refusal or a later failure removes the directory owned by that operation.

The created manifest pins the executing `@fadeno/framework` version and
delegates only check, build, development, and production start to the existing
package/compiler/runtime. The bounded action-free template is sourced from the
tested canonical application and demonstrates routed TypeScript/JSX plus
application-owned same-origin external CSS. Project creation does not install
dependencies, initialize version control, execute generated code, add a test
runtime, or create another framework implementation. `pnpm check:a0-create`
owns packed success/refusal/flow/recovery evidence and exact generated bytes.
ADR 0040 extends that fixed template with a stock `pnpm test` command and typed
application test. `pnpm check:a0-test` owns its packed success, deliberate
assertion failure, normalized human and TAP output, correction, disposable
output cleanup, and repaired rerun evidence.

## Deployment

ADR 0041 selects the exact public deployment form
`fadeno deploy --project-root <path> --output <missing-path>`. The output is an
immutable release directory outside the canonical project root. Its parent and
ancestors are existing ordinary non-symlink directories, and an existing output
is never updated or selected.

Deploy runs the same accepted production build, claims the missing release,
copies the exact `dist` generation plus temporary package/lock inputs, and uses
the project's pinned pnpm 11.7.0 with lifecycle scripts disabled to install
production dependencies only. It then writes a runtime-only package manifest,
removes the lockfile, and verifies the build identity plus complete installed
runtime closure. The accepted root contains only `dist`, `node_modules`, and
`package.json`; source, tests, configuration, environment files, project
development dependencies, and lifecycle scripts are absent. A failed operation
removes only its claimed release or reports redacted unresolved cleanup.

The artifact starts through the existing generated loader and bootstrap, binds
only loopback, and is assembled for the same operating-system and architecture
boundary. An operator-owned same-host HTTPS terminator supplies the external
boundary. `FADENO_ORIGIN` names that exact HTTPS origin and
`FADENO_SESSION_KEYS` supplies the active-first key ring at process start; no
runtime secret is copied into release bytes. The created application's ordinary
GET `/` is the first health observation, not a reserved framework route.
`SIGTERM` uses the accepted graceful drain. Candidate startup, integrity,
configuration, or health failure rolls back by stopping that candidate and
restarting a retained, unchanged prior release directory. No mutable active
link, provider contract, proxy implementation, public deployment manifest,
machine-output option, or multi-process owner is introduced.

`pnpm check:a0-deploy` owns the packed artifact success, output and
configuration refusals, external HTTPS health, graceful stop, corrupted
candidate rollback, corrected release, secret/dev/source exclusion, flow, and
stale generated-route removal evidence.

## Independent usability evidence

ADR 0043 records the first alpha's independent-newcomer status as
`deferred-unqualified`. Automated packed workflows qualify mechanical behavior
only: they do not establish onboarding, discoverability, correction, editor, or
assistive-technology usability. First-alpha status, support, and release notes
must disclose that limitation. No editor product or public analyzer schema is
selected.

ADR 0042's superseded A0 sequencing still provides the retained later
collection contract. The versioned packet covers install/create/test/check/dev/build/deploy,
separate successful and failed explanation tasks, exact seeded
configuration/route/generation failures, correction, stale-state recovery, and
a missing-workflow report. At least two participants who have never contributed
to the Fadeno repository must use the same exact source commit and
packed-tarball SHA-256 without private guidance.

Records are anonymous and bounded by the packet's pre-observation attempt
contract. Every task fixes its applicable required artifact categories, and
every started attempt is retained with its outcome and assistance category.
Synthetic fixtures, omitted attempts, facilitator intervention
presented as independent success, changed instruction bytes or tasks, and
artifact mismatch are refused. `pnpm check:a0-usability-contract` validates the
pre-observation packet and its negative controls. Later real attempts qualify
only the exact artifact they name and do not retroactively qualify the first
alpha.

A0-07B1 derives replay status rather than trusting a participant or facilitator
success flag. One closed manifest must enumerate every started and retained
anonymous attempt with no omissions. Every attempt uses the same packet and
package identity, including the independently reconstructed source commit;
completed tasks supply their frozen applicable artifacts,
which are contained regular files with exact digests and bounded normalized
bytes. Refused or abandoned recovery tasks retain the matching recovery state.
Duplicate participants or artifacts, missing recovery, unclassified assistance,
stale packet identity, and path-bearing output are refused.

The permanent synthetic replay contains two complete shapes plus one
facilitator-assisted abandonment. It exercises the aggregate and negative
controls but always derives `synthetic-fixture-excluded`, never accepted user
evidence. Run `pnpm check:a0-usability-replay-contract`; its normalized output
is `fixtures/a0-independent-usability/replay-summary.normalized.json`.

Participant collection uses one missing facilitator-owned bundle directory.
`pnpm capture:a0-usability-bundle --output <missing-path>` requires a clean
commit, packs the current framework, reconstructs that same commit through a
Git archive, frozen offline install, build, and pack, and requires identical
package filename, version, and SHA-256. Failure removes the claimed directory.
The accepted bundle contains exactly the package tarball, frozen JSON and
Markdown task packets, a digest-bound cover sheet, and a short guidance file;
it contains no observations or claim of user evidence. Run
`pnpm check:a0-usability-artifact` for the real reconstruction and synthetic
integrity/refusal controls.

After the facilitator has retained and redacted every started attempt under
`evidence/a0/independent-usability/attempts/`, close the collection in one
contained manifest and run
`pnpm check:a0-usability-evidence --manifest <repository-relative-manifest>`.
The private command reads the claimed source commit, reconstructs that exact
ancestor from the repository, repacks it from the frozen offline dependency
graph, and requires the reconstructed commit, package SHA-256, and package
version to match every retained attempt. It then applies the A0-07B1 privacy,
retention, artifact, recovery, independence, and two-participant gates. Real
replay reserves synthetic/fixture participant markers, rejects contact values,
and closes over the entire retained attempts subtree so no unreferenced file
can be blessed. Until real records exist, command tests cover fail-closed usage,
non-manifest input, and adversarial real-mode refusals; no synthetic success
path may stand in for participants. The
checked facilitator-only retention procedure is
[`COLLECTION.md`](../../evidence/a0/independent-usability/COLLECTION.md); it is
not added to the participant bundle and cannot change the frozen task bytes.

## A0-09 alpha qualification

A0-09 derives one `qualified-alpha-candidate` record from the complete current
gate set. `pnpm check:a0-alpha-qualification` accepts only the exact security,
native-accessibility, existing-performance, package, documentation,
clean-machine, reproducibility, rollback, and deferred-usability/tooling audit
set. Each audit names root-check gates and contained tracked evidence; mutation
tests refuse an omitted gate, unsafe or untracked evidence, a published seed,
an unsupported claim, or a public analyzer/editor export.

The security audit includes a deterministic two-replay fuzz worker with a
fixed seed, bounded input bytes, a process deadline, accepted and refused
controls for every surface, complete outcome classification, and action-response
secret-canary checking. The complete threat inventory distinguishes public
decoders from integrity-checked framework-owned artifacts and from private
analyzer transports. Qualification preserves the recorded narrow or
baseline-only performance conclusions and introduces no new budget.

The clean-machine audit reuses the current packed package gates rather than a
workspace shortcut: the canonical application covers install/check/build/dev/
start, and the A0 creation, application-test, and immutable-deployment gates
cover their isolated success, failure, correction, recovery, stale-removal, and
rollback paths. Automated packed evidence does not establish newcomer or
assistive-technology usability. At A0-09 qualification the package was the
unpublished `0.0.0` seed; that checkpoint did not publish, tag, or establish
registry/docs identity. The current A0-10 release source is
`@fadeno/framework@0.1.0-alpha.1` and owns those remaining checks. The immutable
`0.1.0-alpha.0` source release stopped before registry upload because hosted
repository visibility evidence was incomplete.
The retained A0-09 qualification remains bound to the immutable source commit
that contained the `0.0.0` package seed; the current working-tree version is
not retroactively presented as the input to that historical qualification.

## A0-10 first-alpha release and public replay

A0-10 mechanically advances the reviewed failed transport recovery into exactly
`@fadeno/framework@0.1.0-alpha.1`. The private example workspaces remain
`0.0.0`. `pnpm check:a0-first-alpha-release` owns the pre-publication contract:
it binds the prior alpha-candidate qualification, exact prerelease state,
package metadata, changelog, SBOM, release notes, publication workflow, and an
immutable manifest of every tracked release-documentation file. A clean source
commit must produce the same documentation archive bytes twice and must round
trip every extracted file against that manifest. Closed-tree validation rejects
missing, additional, linked, or otherwise unsafe extracted entries. The archive
also includes root Markdown files referenced by its README and roadmap documents.

The gate includes permanent normalized success, deliberate wrong-version
refusal, human diagnostic, correction, flow, and recovery evidence under
`evidence/a0/release/source`. The flow records which release inputs own each
decision and why registry publication, tagging, and trusted-publisher setup are
skipped during source review. Recovery proves the seed-version diagnostic is
removed and that no incorrect version or premature tag was created.

The release publication job checks out the immutable tag and runs
`pnpm verify:a0-release-event` before the irreversible registry step. That gate
resolves the tag commit directly, requires the exact source release notes and
the closed set of documentation assets, downloads both assets, and validates
their bytes against a fresh deterministic build from the checked-out tag before
validating their receipt and contents. The release target field is descriptive and is not
used as source identity because it can retain a mutable branch name even when
the release owns an immutable tag.

`pnpm verify:a0-public-alpha` begins only after publication. It refuses any
version or source identity other than the immutable first alpha, retrieves the
package from the public registry into a clean consumer, and replays create,
test, check, build, development, deployment, and rollback without a workspace
or packed-tarball shortcut. It separately verifies the registry distribution
tag, package metadata and provenance, source tag/release, documentation archive
and release-note identities. Registry provenance is accepted only from the
framework version's own `dist.attestations` metadata; the aggregate registry
signature audit remains a secondary cryptographic check. The signed statement
must bind the package digest and tagged commit to the Fadeno repository,
publication workflow, protected `npm-production` environment, and hosted
builder. The verifier rejects extra registry channels and release assets, then rebuilds
and packs the immutable tagged source, then compares the complete path, byte
length, and digest set with the downloaded registry package so self-consistent
registry hashes cannot hide stale, extra, or changed package content. Public
observations are retained only after they exist; source qualification never
fabricates them.

ADR 0044 makes the observed first-package alias rule explicit: exactly `alpha`
and the registry-mandated `latest` must resolve to `0.1.0-alpha.1`. Every other
channel or target is refused.

The first publication used one package-scoped bootstrap credential. That
permission could not administer or revoke tokens, so a separately
maintainer-authenticated registry session revoked it immediately and verified
zero active tokens. The hosted secret was then removed and the exact trusted
publisher configured. Current hosted publication contains neither a bootstrap
secret nor an impossible self-revocation step. `pnpm check:a0-public-release`
retains normalized post-publication success, refusal, correction, flow, and
recovery without changing the immutable documentation manifest. Trusted
publication does not allocate that token.

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
compiler version and package, platform, architecture, a digest of sorted
environment variable names without values, contract digest, monotonic endpoints,
operation and workspace identity,
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

The `a1` capture was initially refused because its working-file permission
identity could not be reconstructed from its Git commit. Review then found that
both `a1` and the initially accepted `a3` fingerprinted environment values.
Their raw identities and timings were removed before merge; only verified
redaction tombstones remain, and neither is baseline evidence. The missing `a2`
result was never retained or interpreted because an ordering defect in the
independent source-tree verifier was corrected before evidence acceptance. The
runner now hashes sorted environment variable names without values. The first
accepted result under that rule is `20260717T090059Z-4d57a69-a4`; no prior
timing result was selected.

The retained source commit must remain an ancestor of the reviewed branch and
merge; C5B therefore preserves branch history rather than squashing it. Source
reconstruction reads `100644` and `100755` modes from the Git tree instead of
the archive extraction filesystem, so the verifier is independent of umask.
From that exact source, the verifier performs a frozen offline install, rebuilds
and repacks the framework, extracts the package, and compares the reconstructed
tarball, installed package tree, compiler, runtime, platform, and architecture
identities with the raw record. Sibling JSON agreement is insufficient. A
retained capture atomically publishes raw, identity, host, derived summary, and
manifest documents as one verifier-ready directory.

The accepted result records the exact Apple M2 Pro, 10-logical-CPU, 32 GiB,
Darwin arm64 host, runtime and compiler versions, name-only environment
identity, raw attempts, derived summary, and file manifest. Across all five
samples, diagnostic replacement has a 49.823042 ms median and 53.108291 ms p95.
Cleared replacement has a 448.635208 ms median and 450.980584 ms p95; its
median phase values are 0.067916 ms invalidation, 143.142708 ms analysis and
generation, 215.078958 ms compiler refresh, and 88.511500 ms accepted consumer
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
- Current packed synthetic consumers following only repository documentation
  mechanically run the supported application and recover seeded route, form,
  security, and boundary failures. This is not newcomer-usability evidence.
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
- Independent newcomer collection remains deferred for the first alpha. Later
  users repeat the intended workflow and seeded failure recovery before a new
  decision can justify any supported editor product.
