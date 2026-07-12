# ADR 0026: Route filesystem and generated links

- Status: Accepted
- Date: 2026-07-12
- Owners: Fadeno maintainers
- Related specifications: [Routing, rendering, streaming, and failures](../spec/routing-rendering-streaming.md), [Compiler and analyzer](../spec/compiler-analyzer.md)
- Supersedes: None

## Context

The route decision gate blocks routing until V1 selects one route root, filesystem grammar,
collision identity, internal manifest, and generated-link surface. ADR 0018
accepts deterministic declarations consumed by stock TypeScript, but its
private route identifiers and candidate layout are evidence rather than public
syntax. V1-05 must resolve the contract without implementing the V1-06 router
or borrowing renderer and stream behavior from later gates.

## Decision drivers

- Make discovery identical across supported filesystems.
- Keep source and generated paths confined to the explicit project root.
- Preserve route/parameter correlation under stock TypeScript.
- Construct safe canonical pathnames at runtime, not only plausible types.
- Keep the manifest internal and renderer module signatures unresolved.

## Decision

`fadeno.config.ts` gains one optional `routes` field. When present it is exactly
`{ root: string }`. The root is a non-empty project-root-relative POSIX path;
absolute paths, drive-like paths, backslashes, empty, `.` and `..` components,
NUL, missing roots, non-directories, and symbolic links are refused. Commands
do not search a monorepo or infer another route root. Omitting `routes` means
that the project has no routed application yet; V1-06 commands that require
routing will explain that omission.

A route directory contains only segment directories and these exact role files:

- `page.tsx` for a rendered page route;
- `handler.ts` for a raw `Request`-to-`Response` route;
- `layout.tsx`, `not-found.tsx`, and `error.tsx` for inherited route roles.

This ADR fixes role and ownership only. It does not fix any function signature,
JSX renderer contract, handler failure response, stream boundary, timeout, or
response-commit behavior. A directory cannot contain both `page.tsx` and
`handler.ts`. Other files, duplicate extensions, hidden entries, and symlinked
files or directories are refused rather than silently ignored.

Static segment directories match `[a-z0-9]+(?:-[a-z0-9]+)*`. A single dynamic
segment is `[name]`; a non-empty rest segment is `[...name]`. Parameter names
match `[A-Za-z_][A-Za-z0-9_]*`, may occur only once in a route, and cannot be
`__proto__`, `constructor`, or `prototype`. Rest segments are terminal.
Restricting authored static segments to lowercase ASCII removes case-folding,
Unicode-normalization, separator, and percent-encoding differences from
filesystem identity.

The canonical route identifier is its authored slash path, such as `/`,
`/accounts/[accountId]`, or `/files/[...parts]`. It has no trailing slash except
for `/`. Siblings may contain static, one dynamic, and one rest segment;
matching precedence is static, then dynamic, then rest. Two dynamic siblings
collide even when their parameter names differ, as do two rest siblings.
Page/handler co-location and duplicate canonical identifiers are collisions.
Pairwise diagnostics name both project-relative POSIX locations. Filesystem
ancestry establishes root-to-leaf layout, not-found, and error ownership;
cycles cannot be represented because every symlink is refused.

Discovery produces a schema-versioned internal manifest with project-relative
POSIX source paths, canonical route identifiers, segment/parameter kinds, and
applicable layout, not-found, and error sources. It contains no absolute host
paths and is not exported from the package. Entries and inherited source lists
use an explicitly tested code-unit order. Diagnostic identifiers remain
internal until DG-A0-02.

Clean generation extends the neutral package facade with a route-definition
map and the derived `RouteId`, `RouteParameters`, `RouteHrefInput`, and
`routeHref` surface. `RouteHrefInput` is a route-discriminated union: static
routes accept only `{ route }`; dynamic routes require exactly their correlated
`parameters`; rest values are non-empty readonly string tuples. Arbitrary
strings, missing or excess parameters, and lost union correlation fail under
stock TypeScript.

`routeHref` returns only a canonical pathname. It has no query or fragment
option; callers use web-standard URL APIs for those state homes. Each parameter
is a non-empty string other than `.` or `..`, encoded independently with
RFC 3986 percent encoding. Rest arrays contain at least one value and encode
one pathname segment per value. `/`, `?`, `#`, `%`, spaces, Unicode, and other
reserved data therefore cannot change route structure. Invalid runtime input
is refused rather than string-coerced or silently dropped. Generated links
never end in `/` except the root.

## Alternatives considered

- Implicit `src/routes`: rejected because route roots are explicit build inputs
  and monorepo guessing makes ownership unclear.
- Mixed-case or Unicode static segments: deferred because portable collision
  identity would require a larger normalization and filesystem contract.
- Filename suffixes such as `page.server.tsx`: rejected because exact role
  filenames and structural server ownership are simpler for the initial slice.
- A string-template link helper: rejected because it loses route/parameter
  correlation and makes encoding application-owned.
- Publish the manifest: rejected because no external consumer exists and
  DG-A0-02 still owns external analyzer schema compatibility.

## Consequences

- The route decision gate is resolved and V1-06 can implement one deterministic router and
  clean declaration generator from the accepted fixtures.
- The initial filesystem grammar is intentionally conservative and portable.
- V1 makes no bounded incremental-generation performance claim.
- Rollback supersedes this ADR, removes its config/type contract and fixtures,
  and restores the route decision to the open-gate ledger. No released migration is
  required while the package remains private.

## Validation

`pnpm check:v1-route-contract` validates the internal manifest schema and its
semantic correlations; repeats discovery over shuffled creation orders; checks canonical route identity,
inheritance, collisions, unsupported entries, traversal, separator,
case, Unicode, malformed and symlink fixtures; proves byte-identical manifests
without absolute paths; compiles positive and negative route/link fixtures with
stock TypeScript; binds the fixture type model to the discovered manifest; and
asserts exact runtime pathnames for reserved, Unicode, single, and rest
parameter values. V1-06 remains responsible for closed config-loader
integration, production router/generator/diagnostics, and runtime matching
precedence and route-matrix proof.
