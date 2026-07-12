# Configuration, build, adapters, testing, and diagnostics

The repository exposes one coherent workflow from source to a tested deployment
artifact. ADR 0022 fixes the toolchain/configuration names; DG-V1-06 still owns
the initial adapter rather than letting packages invent it independently.

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

DG-V1-06 selects exactly one initial runtime based on conformance feasibility
and maintainer ownership. Additional adapters remain deferred until the shared
suite exists.

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
