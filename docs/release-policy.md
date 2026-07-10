# Release policy

## Before publishable packages

Repository-foundation changes and private experiments do not receive package
versions or release tags. They are validated by the main check command and Git
history.

## Publishable packages

Once an installable public package exists:

1. all public packages use one lockstep version through 1.0;
2. each user-visible change carries one changeset with compatibility intent;
3. release checkpoints use alpha, beta, release-candidate, and stable versions;
4. the release commit passes clean installation, package-content, conformance,
   documentation, security, and reproducibility checks;
5. the immutable tag identifies that exact commit;
6. the changelog explains affected packages and links migration guidance for
   compatibility changes;
7. a failed release is corrected by a new version, never by replacing a tag.

Every PR declares release impact. Public-package PRs include semantic version
intent, executable example and migration updates where applicable, and one
Changeset per independently releasable user outcome. Internal and
documentation-only PRs explain why no released behavior changes. Release PRs
are mechanical: they consume reviewed intent, increment versions, update
changelogs and the lockfile, and may not introduce unrelated behavior.

Compatibility changes follow the indexed
[migration policy](migrations/README.md) and execute their before/after fixtures
before release.

## Publication security

Public npm publication uses trusted publishing with generated provenance.
Release workflows pin permissions to the minimum required and do not store a
long-lived npm publication token.

Non-registry artifacts include verifiable source identity and a software bill
of materials before stable release.

DG-A0-01 must resolve package names, ownership, and public entrypoints before
the first registry publication.

## Documentation

Current documentation has one editable source tree. Each supported release
publishes an immutable documentation artifact from its tag. Repository copies
of the entire documentation tree are introduced only if multiple supported
versions demonstrate that need.
