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

ADR 0037 selects `@fadeno/framework`, with public exports `.`, `./node`, and
`./jsx-runtime`, plus the `fadeno` executable at `./dist/cli.js`. ADR 0038 sets
the unpublished manifest seed to `0.0.0`; that seed is never published. The
first mechanical alpha plan consumes reviewed Changesets into the expected
`0.1.0-alpha.0` version and `alpha` distribution tag.

Every user-visible package change adds one pending Changeset with semantic
version intent and changelog-ready text. Internal, evidence-only, and
documentation-only changes declare why they do not affect a released package.
Feature branches do not run versioning or publication. Release slices consume
reviewed intent, generate the package changelog, and introduce no unrelated
behavior.

Trusted-publisher configuration requires an existing package. The first public
version therefore bootstraps from a supported hosted release runner using
explicit public access, provenance, and one package-scoped, time-bounded
credential held only in the protected release environment. That credential is
revoked immediately after publication. The exact repository/workflow/
environment trusted publisher then owns every later publication without a
long-lived token. ADR 0037 fixes that identity as repository
`f-gueguen/fadeno`, workflow `publish.yml`, environment `npm-production`, and
the publish operation only.

Every publication requires a public source repository and an exact matching
`repository.url`; a private repository is a refusal because it cannot produce
the required provenance. Hosted publication transports only an immutable
source commit that already passed local CI and never becomes merge authority.

The first alpha release notes and support text must disclose that independent
newcomer usability has not been qualified. They must also state that no editor
product or public analyzer schema is supported. Automated packed conformance
must not be described as observed user evidence.

A0-09 records a `qualified-alpha-candidate` only after its complete audit
manifest, external-decoder fuzz result, packed workflows, documentation,
reproducibility, rollback, and explicit limitations pass the root check. That
checkpoint does not publish, change the `0.0.0` seed, create a tag, or claim
production support. A0-10 remains the mechanical publication and public
identity-verification slice.

Non-registry artifacts include verifiable source identity and a software bill
of materials before stable release.

The package tarball contains its exact license, README, changelog, generated
runtime/declarations, and deterministic SPDX SBOM. `pnpm check:a0-release`
verifies those bytes, simulates the first alpha plan, exercises the
prepublication refusal boundary, and installs the current tarball without
publishing it.

Package names, ownership, and public entrypoints must be accepted before
the first registry publication.

### Registry ownership preflight

Before package identity is accepted, `pnpm capture:a0-registry` is an explicit maintainer
operation that prints normalized evidence without writing repository files. It
may query the current authenticated identity and existing package owners. When
given `--organization` and a matching scoped `--candidate`, it may also query
organization roles and candidate metadata. It never publishes, changes owners,
or authorizes publication. An unpublished scoped candidate is accepted only
when the authenticated identity owns its organization and the candidate lookup
returns not found.

`pnpm check:a0-registry` is the offline repository gate. It uses injected
responses and checked fixtures, so credentials and registry availability are
not merge prerequisites. Checked evidence does not itself authorize
publication.

## Documentation

Current documentation has one editable source tree. Each supported release
publishes an immutable documentation artifact from its tag. Repository copies
of the entire documentation tree are introduced only if multiple supported
versions demonstrate that need.
