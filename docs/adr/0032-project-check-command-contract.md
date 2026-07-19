# ADR 0032: Project-check command contract

- Status: Accepted
- Date: 2026-07-13
- Owners: Fadeno maintainers
- Related specifications: [Build and diagnostics](../spec/build-adapters-testing.md), [Compiler and analyzer](../spec/compiler-analyzer.md), [V1 plan](../roadmap/v1.md)
- Supersedes: None

## Context

ADR 0022 accepts `fadeno check`, and V1-DX-B7A provides one private project
analyzer authority, but no packed executable currently consumes it. B7B needs
the smallest public command that proves real project diagnosis without exposing
the private analyzer transport or crossing the external-schema gate.

## Decision drivers

- One command must use the same project authority as later build and watch work.
- Project-root discovery must be explicit and reproducible.
- Human diagnostics and semantic flow inspection are required now.
- Machine-readable diagnostics remain refused; ADR 0043 defers an external
  analyzer schema and ADR 0011 requires demonstrated need.
- Usage errors, expected project errors, and internal failures need distinct
  automation outcomes without exposing stacks or absolute paths.

## Decision

The private framework package declares exactly one executable with
`"bin": { "fadeno": "./dist/cli.js" }`:

```text
fadeno check --project-root <path> [--explain]
```

`check` is the only accepted subcommand in this slice. `--project-root` is
mandatory exactly once and consumes one non-empty value. Relative values resolve
once against the command working directory; the analyzer then owns all path and
URI normalization. `--explain` is optional exactly once and requests only the
bounded semantic static route explanation. Positional roots, duplicate options,
unknown options, deep explanation, custom budgets, facet selection, and implicit
ancestor or current-directory discovery are refused as usage errors.

The executable is a thin Node entry over the private project analyzer. It does
not add a package export or reimplement configuration, route, diagnostic,
correction, explanation, or artifact policy. `check` never writes `.fadeno`,
`dist`, or another project file.

To preserve that boundary, project checking parses configuration without
executing it. B7B accepts a default-exported plain object literal or the same
literal wrapped once in `defineConfig`, plus only the canonical named
`defineConfig` import. Parentheses and type-only `as` or `satisfies` wrappers do
not add runtime behavior. Computed values, spreads, local bindings, additional
imports/statements/exports, calls other than the outer `defineConfig`, and every
side-effecting form are refused as configuration diagnostics. The standard
TypeScript parser owns syntax; command code does not interpret text with regular
expressions or execute application configuration.

Human output is the only public output in B7B:

- a complete framework route analysis with no diagnostic exits `0` and writes
  one concise, narrowly scoped success report to stdout;
- a complete project with expected configuration, ownership, route, or analyzer
  diagnostics exits `1` and writes the human diagnostic report to stderr;
- invalid command syntax exits `2` and writes one usage report to stderr;
- an unexpected internal failure exits `3` and writes one redacted incident
  report to stderr without a stack, cause, source text, or absolute project path.

When `--explain` is active, a complete analyzer result appends the semantic
static flow report to the same stream as its success or diagnostic report.
Explanation never changes the exit status and never reruns application behavior.

`--format`, JSON, analyzer serialization, diagnostic serialization, stable
diagnostic-code lifecycle, and any other machine-readable command report are
refused. Private normalized fixtures remain conformance evidence only. ADR 0043
defers a compatibility-controlled external schema, and ADR 0011 still requires
demonstrated need.

## Alternatives considered

- Implicit current-directory or ancestor discovery: rejected because the same
  invocation could acquire different ownership in a workspace or subprocess.
- Publish analyzer modules or a tooling subpath: rejected because B7B needs one
  command consumer, not a second public analyzer API.
- Add JSON by projecting private diagnostics: rejected because any documented
  machine report becomes a compatibility surface while ADR 0043 defers it.
- Apply planned artifacts during check: rejected because validation and
  filesystem replacement have different rollback and freshness contracts.
- Expose deep explanation and budget knobs: rejected because B7B needs one
  understandable semantic flow, not a public analyzer control protocol.

## Consequences

- B7B may add one `bin.fadeno` entry and a private internal command driver.
- Root, Node adapter, and JSX package exports remain unchanged.
- Packed examples can exercise success, deliberate failure, explanation, and
  recovery through the installed executable without filesystem generation.
- B7C remains the only owner of transactional artifact application, and B7D
  remains the owner of retained build/watch consumers.

## Validation

- Exact parser tests cover missing, duplicate, empty, positional, unknown, and
  unsupported machine-output arguments.
- A clean packed consumer invokes only its installed `fadeno` binary against the
  canonical application and isolated collision fixture.
- The harness proves exit codes, stream ownership, correction guidance, semantic
  flow, recovery, no-write behavior, and a seeded stale-package refusal.
- Package checks prove the binary is present while private analyzer deep imports
  and public export growth remain refused.
