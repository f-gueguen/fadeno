# ADR 0025: Public Node adapter smoke contract

- Status: Accepted
- Date: 2026-07-12
- Owners: Fadeno maintainers
- Related specifications: [Build, adapters, and testing](../spec/build-adapters-testing.md), [Package boundary](0024-initial-package-boundary.md)
- Supersedes: None

## Context

ADR 0024 selected one logical package and the relative `.` and `./node`
topology without fixing symbols. V1 now needs a real package and one external
consumer that can drive the accepted Node adapter through standard Web types.
The surface must remain smaller than the gated route, renderer, boundary,
resource, action, and CLI contracts.

## Decision drivers

- Expose the Web-standard server boundary without a framework-specific request
  abstraction.
- Name raw Node adapter startup distinctly from a future framework or CLI
  development server.
- Publish factual capability data without making its current minimum-version
  literal a permanent type.
- Keep one adapter implementation behind declared package exports.
- Demonstrate installed package behavior rather than workspace source aliases.

## Decision

The private V1 workspace package has an internal, non-publishable identifier.
It is not the future registry identity. The package is `private: true`, has no
publication configuration, receives no release version or Changeset, and
exports exactly `.` and `./node`.

The runtime-neutral `.` facade exports:

- `Handler` — `(request: Request) => Response | Promise<Response>`.

The `./node` facade exports:

- `listenNodeHttp(options)` — starts the raw Node HTTP adapter;
- `ListenNodeHttpOptions` — a `Handler`, optional hostname, and, as extended by
  ADR 0033, an optional fixed port;
- `NodeHttpServer` — the actual listener origin and idempotent asynchronous
  `close()` drain;
- `nodeHttpCapabilities` — the capability value fixed by ADR 0023;
- `NodeHttpCapabilities` — its closed public shape, with
  `minimumVersion: string` rather than a version-literal type.

`listenNodeHttp` defaults to loopback and an ephemeral port. ADR 0033 later
extends the same raw adapter with an optional fixed port for its verified
production bootstrap; omission or zero retains ephemeral ownership. It accepts a
successful raw `Handler`, translates the request and response, and returns the
listener's usable origin. This is adapter integration, not routing, rendering,
the `fadeno dev` server, or a production deployment contract.

ADR 0023's request translation, authority, streaming, backpressure,
cancellation, cookie, and graceful-drain capability evidence continues to
apply to the single package implementation. Handler rejection, renderer
failure, response commitment, timeout ownership, force-close policy, and
pre/post-commit error responses remain deliberately unspecified until the
streaming-boundary decision. The smoke example covers only a successful
`Request` to `Response` exchange and consumers cannot depend on current failure
behavior.

The implementation remains private under the package export allowlist. No
source, prototype, test, config, or private implementation subpath becomes a
public import. The tracked example source is installed and executed from the
packed tarball outside the workspace; its README does not maintain a second
code copy.

## Alternatives considered

- Export `serve`: rejected because it implies a high-level framework or CLI
  server while this slice owns only raw Node transport.
- Re-export internal implementation types: rejected because declaration paths
  and private organization would become public compatibility.
- Encode `"22.17.0"` as the capability type: rejected because raising a factual
  supported minimum should not require changing the interface shape.
- Run only a workspace-linked example: rejected because package contents,
  exports, declarations, and installation could be broken while source works.
- Define handler error responses now: rejected because response commitment and
  streamed failure ownership belong to the later boundary decision.

## Consequences

- A consumer can install the private tarball and complete a real HTTP exchange
  using only declared package exports.
- The first package API is intentionally small and may grow only through later
  accepted V1 contracts.
- The internal workspace identifier must be replaced by an owner-approved
  registry mapping before publication.
- Rollback removes the package and example, restores the private adapter
  location, supersedes this ADR, and returns V1-04 to pending. No published
  migration is required.
- Release impact is none because the package remains private and unpublished.

## Validation

`pnpm check:v1-public-package`:

- strictly checks the package and its DOM-only root;
- asserts one adapter implementation and capability declaration;
- builds and packs the actual package and matches an exact content allowlist;
- checks both export targets have present JavaScript and declarations;
- walks the runtime-neutral JavaScript and declaration closure and rejects Node
  built-ins, Node type references, external reachability, and path escapes;
- installs the tarball outside the workspace, copies the tracked example source
  byte-for-byte, compiles it with NodeNext, and runs its HTTP assertion;
- proves present internal JavaScript and declarations remain blocked from both
  TypeScript and Node runtime deep imports.

`pnpm check:v1-adapter` and `pnpm check:v1-adapter:minimum` continue to run the
full ADR 0023 suite against the same package implementation, including the
digest-pinned exact minimum runtime.
