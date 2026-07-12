# Configuration, build, adapters, testing, and diagnostics

The repository exposes one coherent workflow from source to a tested deployment
artifact. ADR 0022 fixes the toolchain/configuration names, and ADR 0023 selects
Node HTTP as the initial adapter target without creating a public package.

## Configuration

1. Configuration is a typed standard module loaded from one documented project
   root.
2. The only discovered file is root `fadeno.config.ts`, with a default plain
   object export and a closed typed shape.
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

The V1 lifecycle workload measures edit/save to a fresh framework diagnostic
and edit/save to a cleared diagnostic across invalidation, generation,
TypeScript refresh, Fadeno analysis, and final consumer-visible publication.
Deep phase timing and profiles require an explicit flag. This workload does not
reuse or revive the narrowed K0 incremental-generation claim.

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
- The disposable lifecycle client initializes one root, opens valid source,
  introduces and repairs invalid source, verifies diagnostic identity, range,
  related locations, version and correction, applies sequential edits, changes
  direct and transitive dependencies, regenerates artifacts, reloads
  configuration, cancels or supersedes expensive work, rejects obsolete
  publication, closes and reopens documents, and verifies cleanup.
- Independent users repeat the intended workflow and seeded failure recovery
  before A0 chooses whether any supported editor product is justified.
