# ADR 0024: Initial package boundary

- Status: Accepted
- Date: 2026-07-12
- Owners: Fadeno maintainers
- Related specifications: [Architecture overview](../architecture/overview.md), [Build, adapters, and testing](../spec/build-adapters-testing.md)
- Supersedes: None

## Context

V1 has a fixed toolchain and a feasible Node adapter but no package. Creating
separate packages for conceptual compiler, server, renderer, browser, or
adapter layers before real consumers exist would make internal organization a
public compatibility surface. Conversely, putting the Node adapter in an
unconditional root graph would break the runtime-neutral Web-standard boundary.

The K0 import evidence does not justify several public packages. The morph
candidate is browser-private, extraction is compiler-private and directly uses
the morph evidence, type-spine declarations are application-generated output,
and revalidation is server-private. None has an independent package consumer.

## Decision drivers

- Create only boundaries demonstrated by a clean consumer.
- Keep Node built-ins unreachable from a runtime-neutral facade.
- Preserve visible server, compiler, shared, and browser zones without turning
  each zone into a package.
- Make private deep imports and cross-package relative imports impossible.
- Avoid choosing a registry identity before ownership is secured.

## Decision

V1 begins with one logical framework package. Its relative public topology is:

- `.` — the runtime-neutral facade;
- `./node` — the Node-specific adapter facade selected by ADR 0023.

The root facade is compiled without Node types and cannot reach Node adapter,
compiler, or browser-only modules. Later accepted routing, rendering, data, and
action decisions may extend this facade; this ADR does not freeze its complete
API or any symbol name. The Node subpath may depend on the runtime-neutral Web
server contract and the private Node adapter implementation.

Compiler, analyzer, renderer, generated-declaration, server-runtime, and
browser-runtime code remain private implementation zones inside the logical
package unless a later ADR and demonstrated independent consumer justify a new
public package. One logical package does not permit those zones to collapse or
import across execution boundaries.

The package uses an explicit exports allowlist with no wildcard internal
export. Consumers, including examples, use package specifiers and declared
subpaths only. An internal file may be present in package contents without
becoming importable. If multiple physical packages are later introduced, they
import one another only through declared package exports; relative imports,
re-exports, dynamic imports, traversal, and symlink paths cannot cross package
roots.

The repository package checker owns that dependency rule. Public facades may
depend inward on private implementation. Private implementation cannot obtain a
second public path by deep import. Browser, compiler, and Node-specific graphs
remain unreachable from the neutral root unless a later accepted public
contract deliberately connects them.

The clean-consumer harness uses a generated sentinel package name only inside a
temporary directory. That name is not authority, documentation, an example, or
a registry claim. The actual local and publication identifiers remain an owner
decision. V1-04 creates the real workspace package and fixes the initial public
symbols using this topology.

## Alternatives considered

- Separate core, server, Node adapter, compiler, renderer, and browser packages:
  rejected because K0 and V1 have no independent consumers for those surfaces.
- Export the Node adapter from `.`: rejected because the neutral facade would
  inherit Node built-ins and cease to express the Web-standard boundary.
- Freeze the full root API now: rejected because route, renderer, resource, and
  action contracts still have their own evidence gates.
- Test source aliases or workspace paths: rejected because they can pass while
  package exports, declarations, contents, or installation are broken.
- Select a final npm name: rejected because registry ownership remains an owner
  gate and does not affect the relative export topology.

## Consequences

- V1-04 can create one package rather than inventing a package family.
- A Node application imports adapter behavior from `./node` while framework
  behavior remains rooted at the neutral facade.
- Private internal organization can change without public deep-import
  compatibility.
- Adding another public package or subpath needs a demonstrated consumer and an
  accepted change to this boundary.
- Rollback removes the private prototype and dependency rule, supersedes this
  ADR, and reopens the package decision; no published migration is required.
- Release impact is none because no publishable package exists.

## Validation

`pnpm check:v1-package-boundary` strictly type-checks the boundary code and:

- structurally rejects static imports, re-exports, dynamic imports, traversal,
  and canonical symlink escapes across synthetic package roots with existing
  target files;
- compiles the current type-only neutral prototype without Node types and
  asserts its emitted JavaScript and declaration have no module references;
  V1-04 must enforce reachability over the real package graph before creation;
- emits JS and declarations, packs a temporary tarball, installs it offline in
  a clean directory outside the workspace, compiles a NodeNext consumer using
  only `.` and `./node`, and runs a real adapter request;
- retains a valid unexported internal canary in the installed package while
  both TypeScript and Node runtime deep imports fail at the exports boundary;
- refuses to let the temporary sentinel name enter authority or examples.
