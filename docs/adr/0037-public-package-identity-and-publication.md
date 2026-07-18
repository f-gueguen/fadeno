# ADR 0037: Public package identity and publication boundary

- Status: Accepted
- Date: 2026-07-18
- Owners: Fadeno maintainers
- Related specifications: [Build, adapters, and testing](../spec/build-adapters-testing.md), [Release policy](../release-policy.md)
- Supersedes: None

## Context

The qualified V1 application consumes one logical private package through its
root, Node adapter, JSX runtime, and executable. The `fadeno` registry
organization is authenticated under a maintainer owner, and the scoped
`@fadeno/framework` candidate is unpublished. A0 needs to select the public
identity without publishing a placeholder or making the current internal
manifest accidentally publishable.

Registry trusted-publisher configuration requires an existing package.
Provenance also requires a supported hosted release runner, a public source
repository whose identity exactly matches package metadata, and a public
package. The first publication therefore has a different authentication step
from later releases even though both must carry provenance.

## Decision drivers

- Preserve the demonstrated one-package topology and exact consumer surface.
- Make package, executable, source, and release-workflow identity mechanical.
- Publish every public version with provenance and immutable source identity.
- Keep local CI as merge authority while isolating hosted automation to release
  transport.
- Avoid a permanent or broadly scoped publication credential.

## Decision

The one public registry package is `@fadeno/framework`. It exposes exactly:

- `.` for the framework root;
- `./node` for the initial server adapter;
- `./jsx-runtime` for the stock JSX runtime; and
- the `fadeno` executable mapped to `./dist/cli.js`.

`fadeno-framework-internal` is only the pre-publication workspace identity. It
is not a public alias and is never published. A0-03 changes the manifest,
generated imports, packed examples, documentation, and release machinery
together. It selects the first alpha version under ADR 0010 and adds no second
package.

Public releases are produced only from the exact locally qualified immutable
source commit. A hosted release workflow may transport that commit for
publication; it is not a merge CI authority and may not substitute its own
qualification result.

The first publication bootstraps the registry package from a supported hosted
release runner with explicit public access and provenance. It uses a
maintainer-created, package-scoped, time-bounded credential held only by the
protected release environment. The credential is revoked immediately after
the first publication. Once the package exists, a trusted publisher restricted
to repository `f-gueguen/fadeno`, workflow filename `publish.yml`, protected
environment `npm-production`, and the publish operation replaces that
credential. Later releases contain no long-lived npm publication token and use
the trusted publisher with automatic provenance.

Before any publication, the source repository must be public and the
`repository.url` package field must match it exactly. Repository visibility is
an explicit release prerequisite, not authorized by this decision alone. If
those conditions or the required hosted identity are unavailable, publication
refuses rather than producing an unattested version.

Published name-and-version pairs and release tags are immutable. Before the
first publication, rollback restores the private manifest and removes release
automation. After publication, a defect is corrected by a new version and, if
needed, a moved distribution tag; the published version and source tag are
never replaced.

This decision resolves the former public-package identity gate. It does not
make the package publishable, publish a version, add an analyzer schema, or
introduce an editor product.

## Alternatives considered

- Publish `fadeno-framework-internal`: rejected because it exposes an
  implementation-stage identity to users.
- Publish a placeholder solely to configure trusted publishing: rejected
  because every public version is a permanent release artifact.
- Bootstrap locally without provenance: rejected because the first version is
  not exempt from the supply-chain contract.
- Keep a general publication token: rejected because later releases can use
  short-lived trusted-publisher credentials.

## Consequences

- A0-03 owns the atomic public manifest transition and release checks.
- A0-10 cannot publish while the source repository is private or until its
  visibility change is explicitly authorized and verified.
- The first release has a reviewed one-use credential bootstrap; subsequent
  releases have a simpler tokenless publication path.
- Adding another package, export, executable, or release provider requires a
  separately evidenced decision.

## Validation

`pnpm check:a0-publication` verifies the accepted identity, exact entrypoint and
binary map, private/unpublished current boundary, registry evidence, bootstrap,
trusted-publication, provenance, public-source prerequisite, and rollback
rules. A0-03 must add frozen pack/install, package-content, metadata, SBOM,
version, changelog, Changeset, and release-policy mutation evidence before the
manifest becomes publishable.
