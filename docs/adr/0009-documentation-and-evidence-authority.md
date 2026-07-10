# ADR 0009: Documentation and evidence authority

- Status: Accepted
- Date: 2026-07-10
- Owners: Fadeno maintainers
- Related specifications: [Architecture overview](../architecture/overview.md)
- Supersedes: None

## Context

Framework prose, examples, generated types, diagnostics, and runtime behavior
can drift unless their authority and validation are explicit.

## Decision drivers

- Public behavior must be traceable to durable decisions and executable proof.
- Examples should not be fictional alternate implementations.
- AI-assisted changes need mechanical conflict detection.

## Decision

Authority is assigned by concern:

- project invariants and effective ADRs govern architecture;
- released public declarations, schemas, and conformance tests govern
  observable released behavior;
- current specifications govern intended implementation behavior;
- executable examples and generated reference material demonstrate supported
  use;
- guides and roadmap material explain and sequence work.

These surfaces may not contradict one another. A conflict blocks the change
rather than being resolved through an implicit total ordering. Once behavior is
implemented, examples and documentation snippets import or execute the same
source used by tests. Generated artifacts are checked for reproducibility.

Hypotheses, risks, deferrals, and current work state have separate ledgers and
are not normative behavior.

## Alternatives considered

- Treat prose as the only source of truth: rejected because it cannot prove
  runtime behavior.
- Maintain copied example code inside Markdown: rejected because copies drift.
- Keep one large project ledger: rejected because decisions, history, risks,
  and work state have different lifecycles.

## Consequences

- Changes that create contradictions are incomplete.
- Documentation checks become part of the main repository check.
- Git history and immutable tags carry history; current ledgers stay concise.

## Validation

Repository checks validate ADR metadata, required authority files, links,
ledger structure, and forbidden stale project names. Implemented examples later
join the conformance command.
