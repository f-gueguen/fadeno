# ADR 0001: Canonical repository and authority

- Status: Accepted
- Date: 2026-07-10
- Owners: Fadeno maintainers
- Related specifications: [Architecture overview](../architecture/overview.md)
- Supersedes: None

## Context

The framework needs one implementation repository whose documentation and
tests can evolve with the code. Research material is useful for provenance but
contains conflicting and unimplemented designs.

## Decision drivers

- Contributors need one unambiguous source of current project law.
- Prior exploration must not silently become a public contract.
- AI-assisted work needs tracked instructions that are identical across
  sessions and contributors.

## Decision

This repository is the canonical home for Fadeno implementation, decisions,
current specifications, executable examples, and release artifacts.

The design repository is frozen and non-normative. Its files are not copied
here. Any useful idea enters this repository only as a current accepted ADR,
specification, ledger entry, or tested implementation.

`AGENTS.md`, `PROJECT_INVARIANTS.md`, and the current ledgers are tracked.
Contributor-local instructions cannot define project behavior.

## Alternatives considered

- Implement in the design repository: rejected because exploratory and
  canonical material would remain interleaved.
- Copy the design tree into an archive here: rejected because it would create
  a second apparent source of truth.
- Keep project instructions untracked: rejected because different agents and
  contributors would operate under different rules.

## Consequences

- The implementation repository starts small and intentionally lacks research
  history.
- Useful prior ideas must be restated and reviewed before they constrain code.
- The frozen repository needs a prominent pointer to this repository.

## Validation

Repository checks require the tracked authority files. The frozen repository
contains a freeze notice and points here.
