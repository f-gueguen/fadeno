# Contributing

Fadeno is currently validating its highest-risk architectural claims. The
project is licensed under the [MIT License](LICENSE). Unsolicited external
contributions are not yet open; coordinate with a maintainer before preparing
work so it belongs to an approved roadmap slice.

Before contributing:

1. Read [AGENTS.md](AGENTS.md) and [PROJECT_INVARIANTS.md](PROJECT_INVARIANTS.md).
2. Confirm the work belongs to the current slice in
   [ROADMAP_LEDGER.md](ROADMAP_LEDGER.md).
3. Read the affected rows in [product scope](docs/product/scope.md) and
   [feature traceability](docs/traceability.md).
4. Follow the [contributor workflow](docs/contributor-workflow.md).
5. Read the relevant ADRs, specifications, and ledgers.
6. Discuss any new public package, public concept, or network protocol before
   implementation; each requires an ADR.

Every change should be one atomic outcome, evidence-backed, and include its
tests, executable example where applicable, documentation, compatibility and
rollback analysis, and release intent. Run `pnpm check` before requesting
review.

Changesets become required only after publishable packages exist, and only for
changes that affect their users.

Unless a separately reviewed agreement says otherwise, contributions accepted
by the project are provided under the repository's MIT License.
