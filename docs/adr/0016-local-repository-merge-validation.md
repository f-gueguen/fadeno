# ADR 0016: Local repository merge validation

- Status: Accepted
- Date: 2026-07-11
- Owners: Fadeno maintainers
- Related specifications: [Contributor workflow](../contributor-workflow.md)
- Supersedes: None

## Context

GitHub Actions stopped allocating runners for the private repository because
of account billing limits. Jobs failed before checkout and therefore provided
neither execution evidence nor a usable merge gate. Repository validation must
remain reproducible and bound to the reviewed commit without pretending that a
maintainer workstation is the frozen K0 reference host.

## Decision drivers

- Every merged commit still needs a frozen install and the complete repository
  check.
- Review fixes must be validated after they are committed, not only before a
  later push.
- K0 reference measurements must retain their versioned host classification and
  immutable historical provenance.
- Internal repository policy must not invent a public Fadeno command or a CI
  service product while TOOL-01 and DG-V1-07 remain unresolved.

## Decision

`pnpm ci:local` is the single internal merge-validation command while hosted
repository CI is unavailable. It:

1. refuses a dirty worktree;
2. records the exact starting `HEAD`;
3. runs `pnpm install --frozen-lockfile` and then `pnpm check` in that order;
4. refuses a dirty tree or changed `HEAD` after either step; and
5. reports the exact commit that passed.

The PR records that commit as maintainer-operated evidence after every review
fix. Active GitHub Actions merge workflows are removed rather than left as a
permanently failing or misleading authority.

This decision changes repository merge validation only. It does not change the
K0 reference environment, classify local execution as reference evidence,
authorize qualification on different hardware, create a public framework CLI,
or create a CI service integration. Historical hosted runs and immutable K0
artifacts remain valid evidence at their recorded source commits.

## Alternatives considered

- Merge with permanently red hosted jobs: rejected because failed-to-start jobs
  communicate a false code failure and provide no evidence.
- Treat ordinary `pnpm check` output from a dirty tree as the gate: rejected
  because it is not bound to the final reviewed commit.
- Reclassify the maintainer workstation as the K0 reference host here: rejected
  because performance and support claims require a separately reviewed,
  versioned environment contract.

## Consequences

- Merge enforcement is maintainer-operated rather than remotely enforced.
- Every final review commit incurs a complete local frozen validation run.
- A future hosted merge gate requires a later ADR and must not silently replace
  this command.
- K0-08 cannot publish reference performance evidence until a supported
  reference host is available or a separate ADR accepts a versioned replacement.

## Validation

Repository checks lock the command, step order, clean-tree and stable-HEAD
guards, documentation projections, absence of active hosted workflow files,
non-reference separation, and negative mutations. The final committed head runs
`pnpm ci:local` before merge.
