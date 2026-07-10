# ADR 0011: Supported developer workflow

- Status: Accepted
- Date: 2026-07-10
- Owners: Fadeno maintainers
- Related specifications: [Build and diagnostics](../spec/build-adapters-testing.md), [Compiler and analyzer](../spec/compiler-analyzer.md), [Contributor workflow](../contributor-workflow.md)
- Supersedes: None

## Context

A framework is not independently usable if installation, project creation,
development, checking, building, testing, and diagnosis require maintainer-only
knowledge. Stable runtime behavior also needs diagnostics that teach source and
execution boundaries.

## Decision drivers

- A new user and a coding agent need one discoverable path from clean checkout
  to deployed artifact.
- Diagnostics must make compiler-enforced boundaries understandable rather than
  appear as arbitrary rejection.
- Tooling must consume the same compiler, analyzer, and runtime contracts as
  user applications.

## Decision

Fadeno's supported public workflow covers installation, project creation,
development, project checking, production build, testing, diagnosis, and the
first supported deployment path without private guidance.

The compiler and analyzer provide stable human-facing diagnostic identities,
precise source locations, concise explanations, and correction guidance.
Machine-readable diagnostics become a compatibility-controlled surface only
after an external consumer and a versioned-schema ADR exist.

Scaffolds, commands, examples, and diagnostic tools use public entrypoints and
the production compiler/runtime. They do not maintain a second implementation.
Exact command names and package topology remain decision-gated until a working
vertical slice demonstrates them.

## Alternatives considered

- Treat developer tooling as optional documentation: rejected because a
  framework with structural compiler rules needs an executable diagnostic path.
- Ship separate simplified runtimes for scaffolds or playgrounds: rejected
  because their behavior would drift from production.
- Freeze command names before the vertical slice exists: rejected because names
  should follow demonstrated tasks and package ownership.

## Consequences

- CLI-01 and DX-01 are required release outcomes rather than roadmap wishes.
- A0 clean-machine acceptance tests exercise the entire documented workflow.
- Editor extensions, hosted playgrounds, and agent-specific products remain
  deferred until a concrete gap survives the base workflow.

## Validation

A clean environment follows only public documentation to install, create,
develop, check, build, test, diagnose seeded failures, and deploy the supported
application. Diagnostic snapshots and public-entrypoint checks prevent private
tooling paths.
