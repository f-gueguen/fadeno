# ADR 0041: Immutable loopback deployment artifact

- Status: Accepted
- Date: 2026-07-18
- Owners: Fadeno maintainers
- Related specifications: [Build, adapters, and testing](../spec/build-adapters-testing.md), [Security requirements](../security/requirements.md)
- Supersedes: None

## Context

The production build already creates a transactional `dist/` generation and
verifies its installed runtime closure before listening. It is not a complete
deployment unit: source, tests, development dependencies, installation state,
runtime configuration, health checking, and selection of a previous release
still belong to an operator. A0-06 must select one small deployable boundary
without promising a hosting provider, broader listener address, trusted proxy,
multi-process session owner, or second server runtime.

## Decision drivers

- A release must run from bytes distinct from the source checkout.
- Runtime dependencies must exactly match the accepted build manifest without
  carrying project development dependencies.
- Configuration and secrets must remain runtime inputs, never artifact files.
- Failed startup or health must leave an earlier immutable release available.
- The existing loopback adapter, generated bootstrap, and public executable
  must remain the only implementation of build and serving semantics.

## Decision

The first supported deployment boundary is one immutable, source-free release
directory for a single Fadeno process on the same operating-system and
architecture boundary where it is assembled. The public command is exact:

```text
fadeno deploy --project-root <path> --output <missing-path>
```

The explicit output resolves from the command working directory, must be
outside the canonical project root, and must not exist. Its existing parent and
all ancestors are ordinary non-symlink directories. The command never updates,
reuses, or selects an existing release.

Deploy first runs the accepted production build. It copies that exact `dist/`
generation, the current package manifest, and the frozen lockfile into the
claimed release, then uses the project's pinned pnpm 11.7.0 with lifecycle
scripts disabled to install production dependencies only. It replaces the
temporary package manifest with a runtime-only manifest, removes the lockfile,
and accepts the release only after the build files, framework identity, and
complete installed production closure match the build manifest. Failure
removes the release directory claimed by that operation; unresolved cleanup is
a redacted internal failure.

An accepted release contains exactly `dist/`, `node_modules/`, and a
runtime-only `package.json`. It contains no application source, test source,
configuration source, environment file, lockfile, project development
dependency, or package lifecycle script. Installed runtime dependencies may
include implementation packages owned by the accepted framework runtime
closure; that does not make project development dependencies deployment
owners. The artifact is not claimed to be portable across operating systems or
architectures and is not a container or hosting-provider contract.

The generated loader and bootstrap remain the only start path:

```text
FADENO_PORT=<1..65535> node --import ./dist/.fadeno/routes/loader.js ./dist/server/bootstrap.js
```

The process continues to bind only `127.0.0.1`. A same-host operator-controlled
HTTPS terminator may forward to that loopback listener. Applications with
actions require the exact external HTTPS origin in `FADENO_ORIGIN` and an
active-first 32-byte key ring in `FADENO_SESSION_KEYS`. These and all other
secrets are injected into the process at start and are never copied from
`.env`, `.env.local`, or the build environment into the release.

Fadeno reserves no health endpoint. The created application uses an ordinary
GET of `/` as its readiness and health observation. Deployment succeeds only
after the candidate starts and that application-owned request returns the
expected successful document through the external HTTPS boundary. Stop sends
the existing graceful `SIGTERM` path. If startup, integrity, configuration, or
health fails, the operator stops the candidate and restarts the previously
healthy immutable directory. No mutable `current` link or in-place rollback is
part of the contract.

The command exposes human output and stable failure codes only. It adds no
machine-output option, public deployment manifest, package export, analyzer
schema, process manager, proxy, or multi-process action/session behavior.

## Alternatives considered

- Deploy `dist/` alone: rejected because the generated bootstrap deliberately
  verifies an installed production dependency closure.
- Copy the whole project and prune it on the host: rejected because source,
  tests, development packages, and environment files would become ambiguous
  release owners.
- Update one mutable release directory: rejected because a failed candidate
  could destroy the only known-good rollback bytes.
- Select a provider or container boundary: rejected because loopback listening,
  proxy trust, platform identity, and provider lifecycle would broaden A0-06
  beyond demonstrated evidence.
- Add a framework health route or process manager: rejected because health is
  application behavior and process supervision remains operator-owned.

## Consequences

- The initial deployment is deliberately single-process and same-platform.
- Packaging needs the exact pinned package manager and access to the locked
  production packages, but the accepted release starts with Node alone.
- Releases are retained and named by the operator; Fadeno refuses overwrite and
  does not maintain an active-release pointer.
- Broader addresses, trusted proxies, cross-platform artifacts, zero-downtime
  switching, and multi-process action/session ownership require later evidence
  and decisions.
- Rollback removes or stops only the failed candidate and restarts an unchanged
  prior directory. Published package rollback remains separately versioned.

## Validation

`pnpm check:a0-deploy` builds and packs the current framework, installs it into
the canonical application, and invokes only the public executable. It proves a
source-free production-only release, exact runtime closure, lifecycle-script
refusal, secret exclusion, missing/existing/contained output refusals, missing
runtime configuration, secure external health, graceful stop, corrupted
candidate refusal, previous-release restart, corrected release acceptance, and
stale generated-route removal. Normalized success, diagnostic, correction,
flow, and recovery records are permanent executable example evidence.
