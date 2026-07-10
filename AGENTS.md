# Agent instructions

These instructions are tracked so every human and AI contributor works from
the same project law.

## Required reading

Before non-trivial work, read in this order:

1. [PROJECT_INVARIANTS.md](PROJECT_INVARIANTS.md)
2. [ROADMAP_LEDGER.md](ROADMAP_LEDGER.md)
3. [Product scope](docs/product/scope.md) and
   [feature traceability](docs/traceability.md)
4. [Contributor and coding-agent workflow](docs/contributor-workflow.md)
5. Relevant accepted ADRs in [docs/adr](docs/adr)
6. Relevant current specifications in [docs/spec](docs/spec)
7. Relevant hypotheses, risks, decision gates, and deferrals in
   [docs/ledgers](docs/ledgers)

## Authority rules

1. Durable decisions belong in accepted ADRs, never only in chat, a task plan,
   or the roadmap ledger.
2. Specifications describe current intended behavior; they do not claim that
   unimplemented behavior exists.
3. Hypotheses remain hypotheses until evidence supports an ADR and executable
   contract.
4. Guides and examples may explain behavior but may not introduce behavior.
5. A conflict between invariants, ADRs, specifications, exports, schemas,
   examples, and tests blocks the change. Resolve it in the same change.

## Work rules

1. Keep changes inside the smallest boundary that satisfies the task.
2. Name the affected feature IDs and check their traceability before editing.
3. Deliver one public behavior, infrastructure capability, experiment result,
   or durable decision per PR.
4. Do not cross an open decision gate by inventing a contract in code.
5. Do not add a public package without an ADR.
6. Do not add a second public way to perform an existing job.
7. Do not present an example until it executes in CI from the displayed source.
8. Add negative coverage for boundaries, security rules, and diagnostics.
9. Update ROADMAP_LEDGER.md when the current slice, gate, blocker, or open
   question changes.
10. Follow the version, Changeset, changelog, migration, and immutable-tag rules
    once a package is designated publishable, including its first release.
11. Run `pnpm check` plus every affected traceability command before claiming
    completion.

## Discovery

Prefer codebase-memory graph tools for code discovery once implementation
exists. Use text search for configuration, documentation, generated artifacts,
protocol fixtures, and literal error text.

## Done criteria

A non-trivial change is done only when:

1. it respects PROJECT_INVARIANTS.md;
2. tests or fixtures cover the affected behavior;
3. durable decisions are recorded in ADRs;
4. current specifications, scope, traceability, and ledgers agree;
5. tests and executable examples cover the public outcome where applicable;
6. compatibility, version/changelog intent, and rollback are explicit;
7. `pnpm check` passes, or a missing external capability is stated precisely.
