# ADR 0027: Generated route module and production routing

- Status: Accepted
- Date: 2026-07-12
- Owners: Fadeno maintainers
- Related specifications: [Routing, rendering, streaming, and failures](../spec/routing-rendering-streaming.md), [Compiler and analyzer](../spec/compiler-analyzer.md)
- Supersedes: ADR 0026

## Context

ADR 0026 correctly selected a portable filesystem grammar, internal manifest,
correlated link types, and safe pathname construction. Its proposed package-
root `routeHref(input)` binding is not implementable without weakening another
accepted boundary: generated declarations can add application-specific types
to the neutral package facade, but cannot supply that function with the
application's runtime route table. A global registration would mix applications
and requests; a public compiler/manifest subpath would expose private internals;
and accepting any syntactically valid route would fail the required unknown-
route refusal.

V1-06 also needs exact metadata-only matching and transactional generated-state
rules before production code can replace the private contract prototype.

## Decision drivers

- Bind route types and runtime membership to one application without globals.
- Preserve ADR 0024's exact package exports and neutral root closure.
- Keep route modules unexecuted until renderer and stream gates resolve.
- Match encoded URLs deterministically with safe parameter capture.
- Replace manifest, runtime links, and declarations as one correlated set.

## Decision

ADR 0026's route root, role files, segment grammar, collision identity,
diagnostic location policy, and internal manifest semantics remain unchanged
and are incorporated into this decision. In summary:

- optional config is exactly `routes: { root: string }`;
- the root is project-relative, POSIX-shaped, real-path confined, and
  symlink-free;
- role files are exactly `page.tsx`, `handler.ts`, `layout.tsx`,
  `not-found.tsx`, and `error.tsx`;
- static segments are lowercase ASCII kebab names, `[name]` is dynamic, and
  `[...name]` is terminal rest;
- parameter names are unique safe ASCII identifiers;
- page/handler co-location, same-kind parameter siblings, unsupported entries,
  and semantic route duplicates are refused with project-relative locations;
- static, dynamic, and rest precedence is fixed in that order.

The generated application route surface is the virtual module
`fadeno:routes`, not the framework package root. It exports application-bound
`RouteId`, `RouteParameters`, `RouteHrefInput`, and `routeHref`. The generated
declaration is consumed by stock TypeScript. The generated JavaScript contains
an immutable table for exactly one application and implements the same
route-discriminated, exact-parameter, RFC 3986 pathname contract. Unknown
routes, missing or excess parameters, empty/dot/dot-dot parameter values,
malformed Unicode, and invalid rest values are refused at runtime.

The virtual name is the canonical application import. V1-06 emits its concrete
JavaScript and declaration under framework-owned `.fadeno/routes/`. V1-09's
build integration must resolve `fadeno:routes` to that concrete module; V1-06
tests the concrete generated file directly at runtime and the virtual module
through stock TypeScript. No runtime resolver, package subpath, or route-module
loader is introduced in this slice.

Each generated application module closes over its own frozen route definitions.
Two applications loaded in one process neither share nor mutate route state and
each refuses the other's routes. The framework package root gains only neutral,
route-independent config types and `defineConfig`; it does not contain fixture
route literals or reach compiler/Node modules.

The private matcher consumes the validated internal manifest and an encoded URL
pathname. It splits on literal `/` before decoding individual segments. It
rejects noncanonical trailing or repeated slashes, malformed percent/UTF-8,
empty and dot/dot-dot decoded parameter values, and does not inspect the query
or fragment. Percent-encoded static spellings such as `/%61bout` do not match a
static `about` segment; static authored bytes must appear canonically. Encoded
parameter `/`, `%`, and Unicode remain one captured segment. Captured parameter
records have null prototypes.

Matching explores static, then dynamic, then rest at every level with
backtracking: a preferred branch that dead-ends cannot prevent a less-specific
sibling from matching. Rest captures one or more remaining segments. A match
returns only route identity, role source metadata, inherited role metadata, and
parameters. It never imports or executes a page, layout, not-found, error, or
handler module.

Production generation owns exactly `.fadeno/routes/` and emits one correlated
set: `manifest.json`, `index.js`, `index.d.ts`, and an ownership record. All
files carry one generator version and source digest. Generation stages and
validates the entire set before a directory-level replacement. Discovery,
rendering, validation, or replacement failure preserves the last accepted set.
An identical run changes neither bytes nor mtimes. A changed run removes stale
route members by replacing the owned set. Unowned contents, symlinked path
components, traversal, source changes between discovery and commit, and
generation identity mismatches fail closed.

`fadeno check` and `fadeno build` require routes when they perform route work;
an omitted route config receives a structured explanation. `fadeno dev` uses
the same validator and generator. V1-06 integrates this closed shape with the
existing configuration loader without changing environment precedence.

Diagnostics are internal structured values with identifier, severity, concise
message, deterministic project-relative locations, explanation link, and
correction. Their external schema and compatibility remain gated by DG-A0-02.
Expected route errors do not expose absolute paths, source contents, secrets,
or internal stack noise.

## Alternatives considered

- Package-root module augmentation plus global registration: rejected because
  independent applications would share mutable runtime state.
- Package-root `routeHref` accepting syntactically valid unknown routes:
  rejected because types and runtime membership would disagree.
- Public manifest or compiler package subpath: rejected because no independent
  consumer justifies expanding ADR 0024's exports.
- Execute route modules in the route matrix: rejected because renderer,
  handler-failure, and stream signatures remain unresolved.
- Write manifest and declarations independently: rejected because a crash could
  publish mutually inconsistent route identities.

## Consequences

- Application code gets one canonical, stock-TypeScript generated route import
  with an app-local runtime binding.
- The first running framework still remains V1-09 because virtual-module build
  resolution and route module execution are intentionally absent.
- Clean generation is correct and reproducible but makes no bounded incremental
  performance claim.
- Rollback removes the production generator/matcher, invalidates or deletes
  `.fadeno/routes/`, restores the private contract evidence if needed, and
  supersedes this ADR. No published migration is required while private.

## Validation

`pnpm check:v1-routing` must prove exact config loading; deterministic discovery;
structured diagnostics; the full static/dynamic/rest fallback and encoded-path
matrix; null-prototype captures; byte-identical correlated generation; unchanged
mtimes; stale removal; source/output symlink and traversal refusal; preservation
of the previous accepted set after injected failures; stock-TypeScript virtual-
module positive and negative fixtures; two independent generated applications
in one process; unknown-route runtime refusal; package-root neutrality; and no
route module import or execution.
