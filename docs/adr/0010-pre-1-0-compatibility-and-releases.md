# ADR 0010: Pre-1.0 compatibility and releases

- Status: Accepted
- Date: 2026-07-10
- Owners: Fadeno maintainers
- Related specifications: [Release policy](../release-policy.md)
- Supersedes: None

## Context

Fadeno must learn from kill-risk experiments and design partners without
pretending every early API is permanent or making releases meaningless.

## Decision drivers

- Pre-1.0 evidence may require incompatible corrections.
- Users still need clear versions, migration guidance, and immutable artifacts.
- Publishing should correspond to tested, installable value rather than every
  repository edit.

## Decision

Before 1.0, Fadeno may make evidence-driven compatibility changes. Such a
change adds or supersedes the relevant ADR and updates the specification,
conformance tests, changelog, and migration guidance together.

Repository-foundation and experiment work does not create package releases.
Once publishable packages exist, public packages use a lockstep prerelease
train through alpha, beta, release-candidate, and stable checkpoints. Each
published tag is immutable and identifies the exact tested source.

Changesets are introduced when publishable packages exist. Trusted publishing
and provenance are required before public npm publication; long-lived registry
tokens are not the release design.

## Alternatives considered

- Tag and version every merged change: rejected because infrastructure and
  experiments do not always produce a consumable release.
- Promise final-form APIs before 1.0: rejected because it conflicts with
  evidence-driven development.
- Batch unrelated public changes without version intent: rejected because users
  need attributable compatibility information.

## Consequences

- Early adopters must expect explicit, documented pre-1.0 changes.
- Not every pull request is a release.
- Release automation is added only when there is an artifact to publish.

## Validation

Release CI verifies a clean install, lockstep public versions, changelog and
migration intent, immutable tag identity, package contents, provenance, and
reproducibility before publication.
