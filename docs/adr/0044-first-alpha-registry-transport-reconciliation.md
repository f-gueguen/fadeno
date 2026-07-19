# ADR 0044: Reconcile first-alpha registry transport

- Status: Accepted
- Date: 2026-07-19
- Owners: Fadeno maintainers
- Related specifications: [Release policy](../release-policy.md), [Build and diagnostics](../spec/build-adapters-testing.md), [A0 roadmap](../roadmap/a0.md)
- Supersedes: None

## Context

The first public package version was published from the exact locally qualified
source with hosted provenance. Two pre-publication assumptions did not match the
registry's real authority boundaries:

- a package must have a `latest` distribution alias, including when publication
  explicitly selects the prerelease `alpha` alias; and
- a package-scoped publication credential can publish the package but cannot
  administer and revoke itself.

The registry therefore exposed both `alpha` and `latest` for the first package
version. The hosted cleanup step could not revoke its own credential. A
maintainer-authenticated registry session revoked that credential immediately,
verified that no active token remained, removed the hosted secret, and then
configured the exact trusted publisher.

Treating either observation as optional would weaken fail-closed release
evidence. Retaining the rejected assumptions would make the permanent verifier
and hosted workflow claim behavior that the registry cannot provide.

## Decision drivers

- Public evidence must describe the registry state that consumers actually see.
- The prerelease must not acquire an unreviewed additional release channel.
- A publication credential must not survive the bootstrap.
- Hosted automation must not claim authority it does not possess.
- The immutable release source and documentation artifact must remain unchanged.
- Later releases must use trusted publication without a long-lived package token.

## Decision

For the first package version only, public verification requires exactly two
distribution aliases: `alpha` and the registry-mandated `latest`. Both must
resolve to `0.1.0-alpha.1`; every other alias or target is refused. This does not
change Fadeno's intended prerelease channel and does not claim stable support.

Bootstrap credential removal is an explicit maintainer-owned recovery action.
The hosted package-scoped credential is never expected to revoke itself. The
recovery is complete only after an authenticated registry observation reports
zero active tokens and the hosted publication environment reports no bootstrap
secret.

After that recovery, the exact repository, workflow file, protected
environment, package namespace, and publication permission are bound as the
trusted publisher. Current hosted publication contains no bootstrap secret or
self-revocation step. ADR 0037's required outcome remains effective: the
bootstrap credential is revoked immediately after its one use and later
publication uses the trusted publisher. This decision corrects only the
mechanism and observed first-version alias set.

The release tag, package bytes, signed provenance, release notes, and uploaded
documentation assets remain immutable. Post-publication documentation and
evidence are validated from current source but are not inserted into the
historical documentation manifest.

## Alternatives considered

- Remove `latest`: rejected because the registry requires a `latest` alias for
  every package and refused removing the first package's mandatory alias.
- Accept any aliases that the registry creates: rejected because an unexpected
  channel or target would change consumer resolution.
- Give the package token organization-administration permission: rejected
  because publication does not require that broader authority.
- Keep self-revocation in hosted automation as best effort: rejected because a
  known impossible cleanup step creates misleading evidence.
- Rewrite the release-source documentation manifest: rejected because it would
  change the identity of an already published immutable artifact.

## Consequences

- `alpha` and `latest` currently resolve to the same experimental first alpha.
- No `beta`, stable-version, or other distribution alias is accepted.
- Bootstrap cleanup requires a separately authenticated maintainer action, and
  permanent recovery evidence records its completed result without retaining a
  secret.
- Later publication has no token fallback and depends on the exact trusted
  publisher configuration.
- The first alpha remains experimental and not production-supported.
- No package bytes, runtime behavior, editor product, analyzer export, or public
  schema changes.

## Validation

`pnpm check:a0-public-release` validates the accepted decision, exact normalized
public observation, deliberate alias and credential-boundary refusals,
correction, ownership flow, stale-diagnostic removal, zero-token/zero-secret
recovery, trusted-publisher cutover, current hosted workflow, and traceability.
`pnpm verify:a0-public-alpha -- --source-commit
4f30236d9734053cca0138ecfff5da1bbbdd1e18` remains the live transport and clean
public-consumer replay.
