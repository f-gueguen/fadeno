# ADR 0013: MIT license

- Status: Accepted
- Date: 2026-07-10
- Owners: Fadeno maintainers
- Related specifications: [Contributor workflow](../contributor-workflow.md), [Release policy](../release-policy.md)
- Supersedes: None

## Context

Fadeno needs explicit contribution and redistribution terms before accepting
external contributions or beginning K0. The repository currently contains no
third-party runtime or development dependencies, so no dependency license
requires a more restrictive project license.

## Decision drivers

- Framework users need permission to use Fadeno in open-source and proprietary
  applications.
- Contributors need concise, conventional contribution terms.
- The project should not introduce copyleft or patent-policy complexity without
  evidence that it is required.
- The license must be compatible with the repository's current dependency-free
  bootstrap and reviewed again when dependencies are introduced.

## Decision

Fadeno is licensed under the MIT License. Contributions accepted by the project
are provided under the same license unless a separately reviewed agreement is
introduced through a later ADR.

Dependency additions must continue to pass license-compatibility review. This
decision does not select package names, registry ownership, or publication
rights.

## Alternatives considered

- Apache License 2.0: credible and permissive, but its additional patent and
  notice machinery is unnecessary for the dependency-free bootstrap.
- MPL 2.0 or GPL-family licenses: rejected because reciprocal obligations would
  narrow adoption without an owner requirement for copyleft.
- No license until publication: rejected because K0 entry and contribution
  governance require explicit terms before implementation begins.

## Consequences

- Fadeno can be used, modified, and redistributed under conventional permissive
  terms while retaining the copyright and permission notice.
- The license provides no warranty.
- Future dependencies and contributed assets still require compatibility
  review; the root license does not override their terms.

## Validation

The root `LICENSE` contains the MIT text, contributor guidance links it, and the
repository documentation check refuses a checkout that omits it.
