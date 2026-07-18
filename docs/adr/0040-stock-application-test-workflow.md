# ADR 0040: Stock application test workflow

- Status: Accepted
- Date: 2026-07-18
- Owners: Fadeno maintainers
- Related specifications: [Build, adapters, and testing](../spec/build-adapters-testing.md)
- Supersedes: None

## Context

ADR 0011 requires an application-test workflow, ADR 0024 retains one logical
framework package, and ADR 0039 deliberately leaves testing out of the initial
project template until A0-05 demonstrates the smallest useful boundary. The
created application already has stock TypeScript, the platform test runner,
and Fadeno's production `renderRoute` and `Handler` surfaces. Adding a second
test runtime or a public helper before those surfaces prove insufficient would
duplicate behavior and enlarge the compatibility contract without evidence.

## Decision drivers

- A created project needs one discoverable command that tests application
  behavior rather than framework internals.
- Test compilation and execution must use the supported stock toolchain and
  the production public runtime.
- A failing assertion must be understandable, repeatable, and clear after the
  source is repaired.
- Test output must not enter the production build or become stale application
  authority.

## Decision

The created project exposes `pnpm test`. The script uses its pinned stock
TypeScript compiler to emit a dedicated `.fadeno/test/` tree from application
source and TypeScript/TSX tests, then uses Node's built-in test runner on one
exact emitted entry file. Test source imports only the application and declared
public package entrypoints. It exercises the production `renderRoute` function
and raw `Handler` contract; it does not emulate routing, rendering, requests,
responses, or JSX.

The test compiler has an explicit configuration separate from the production
build. Its output is framework-ignored, repository-ignored, and removed before
each compile so deleted or renamed sources cannot survive as runnable tests.
The command is deterministic and non-interactive. A failed compile or test
returns a nonzero status through the stock tool that produced it.

A0-05 adds no `fadeno test` CLI form, public test helper, package export,
analyzer schema, or second framework runtime. A later helper requires a
demonstrated application case that the production public surface cannot express
and a separately reviewed public contract.

## Alternatives considered

- Add a framework-owned test runner: rejected because the stock compiler,
  platform runner, and production runtime already satisfy the demonstrated
  application.
- Add public route or session test helpers now: rejected because the created
  application needs none and premature helpers would create parallel semantics.
- Test only emitted production files: rejected because application tests need
  typed TSX authoring while production output must remain free of test files.
- Include tests in the production compiler configuration: rejected because a
  deployable artifact must not acquire test ownership.

## Consequences

- `pnpm test` compiles the small application before executing tests; A0 makes
  no test-startup performance claim.
- The initial scaffold demonstrates document rendering and a raw CSS handler.
  Later applications can add stock tests for resources, actions, and sessions
  through their accepted public semantics.
- Test output is disposable local state and never a release artifact.

## Validation

`pnpm check:a0-test` creates a project from the current packed framework,
installs that exact tarball, and runs the scaffolded command. It proves rendered
document and handler behavior, introduces one assertion failure, retains
normalized human and TAP evidence, restores the test, proves the failure and
disposable output clear, and refuses disposable test output as a production
compiler input. Package-boundary and example gates run alongside this check;
the local merge gate wraps the repository check separately and is never invoked
from `check:a0-test`. Mutation checks refuse private imports, a second test
runtime, production test inclusion, missing cleanup, or an unasserted example.
