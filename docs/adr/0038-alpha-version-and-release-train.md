# ADR 0038: Alpha version and release train

- Status: Accepted
- Date: 2026-07-18
- Owners: Fadeno maintainers
- Related specifications: [Release policy](../release-policy.md), [Build, adapters, and testing](../spec/build-adapters-testing.md)
- Supersedes: None

## Context

ADR 0037 selects one public package and its publication identity. A0-03 must
make that package mechanically releasable without publishing an intermediate
version, losing per-change intent, or letting an ordinary feature branch mint
a release.

## Decision drivers

- Attribute every public outcome to explicit semantic-version intent.
- Produce the first alpha from the complete reviewed A0 candidate rather than
  publishing partial milestones.
- Keep feature work independent from mechanical versioning and publication.
- Make package contents, changelog, provenance, source, and rollback agree.

## Decision

Fadeno uses Changesets `2.31.1` for public package version intent and changelog
generation. Configuration is tracked under `.changeset`, uses `main` as its
comparison branch, and permits only public access. There is one logical public
package, so no fixed or linked multi-package group is introduced.

The public manifest seed version is `0.0.0`. It is never published. Each
user-visible package PR adds one pending changeset; internal, evidence-only, or
documentation-only work declares why no released behavior changes. A pending
changeset contains changelog-ready text and `major`, `minor`, or `patch` intent.

The first public changeset declares a minor release. At A0-10, the mechanical
release slice enters the `alpha` prerelease train and consumes all reviewed
pending changesets. From the `0.0.0` seed, the expected first published version
is `0.1.0-alpha.0` under the `alpha` distribution tag. Later alpha publications
advance the prerelease sequence; beta, release-candidate, and stable transitions
require their named roadmap checkpoints and never rewrite an existing version.

Feature branches do not run versioning or publication. The package's
prepublication guard refuses unless the checked-out immutable tag, manifest
version, source commit, release qualification, hosted provenance context, and
approved publication mode agree. A0-03 adds the guard and release workflow but
does not create a release, tag, registry version, or public repository.

This narrows ADR 0016's workflow-file absence rule to the boundary it intended:
hosted merge validation remains absent and `pnpm ci:local` remains the sole
merge authority. One release-event-only workflow may transport an already
locally qualified immutable package to the registry. It must not run on push,
pull request, schedule, or manual dispatch, and it cannot replace local CI.

The package changelog is generated from reviewed changesets. Compatibility
changes also update the stable migration file and executable before/after
fixture named by the same changeset. The V1 private-preview migration remains
a format seed rather than a released migration.

Rollback before publication restores the prior private manifest and removes
release machinery. Rollback after publication produces a new changeset and
version; it never deletes or replaces the published version or tag.

## Alternatives considered

- Publish each A0 milestone: rejected because incomplete workflows are not
  independent installable releases.
- Hand-edit versions and changelogs: rejected because intent can drift from the
  package and release plan.
- Begin at `1.0.0`: rejected because the evidence-driven pre-1.0 compatibility
  policy remains active.
- Publish the `0.0.0` seed: rejected because it is release machinery input, not
  a qualified user artifact.

## Consequences

- A0 feature PRs carry durable pending release intent without publishing.
- A0-10 remains a mechanical release slice and cannot introduce product work.
- The public package can be packed and installed before its first registry
  version while direct publication remains fail-closed.
- A later second public package would require a package-boundary ADR and an
  explicit lockstep/fixed-group decision.

## Validation

`pnpm check:a0-release` validates Changesets configuration and version intent,
simulates the first alpha plan without modifying the repository, verifies the
changelog and migration seed, freezes package contents and an SPDX SBOM, checks
the publication guard and workflow by mutation, and installs the current
tarball through public entrypoints. The local-CI contract independently refuses
any hosted merge trigger or workflow beyond the release-only transporter.
