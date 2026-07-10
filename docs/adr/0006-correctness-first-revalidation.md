# ADR 0006: Correctness-first revalidation

- Status: Accepted
- Date: 2026-07-10
- Owners: Fadeno maintainers
- Related specifications: [Data consistency](../spec/data-consistency.md)
- Supersedes: None

## Context

Mutation-specific invalidation declarations are easy to omit and can leave a
page displaying stale server state.

## Decision drivers

- Correctness should not depend on a complete manually maintained dependency
  list.
- The default must remain understandable under refactoring.
- Optimizations must be measurable and safe to remove.

## Decision

After a successful action, all resources used by the active page revalidate by
default.

An action may declare `keeps` for resources proven unaffected. Omitting `keeps`
only costs work; adding an incorrect entry risks stale data. The optimization
ships only with development verification that can report unsafe declarations,
and it must be removable without changing correctness. The exact observable
comparison is decided from the revalidation experiment rather than assumed in
this ADR.

Performance viability remains a kill-risk hypothesis until measured against a
representative vertical slice.

## Alternatives considered

- Require each action to list invalidated resources: rejected because omission
  creates silent stale state.
- Infer mutation effects from storage access: rejected as a database-specific
  and incomplete correctness mechanism.
- Provide multiple invalidation APIs: rejected because they increase the state
  space before evidence shows a need.

## Consequences

- The simple path favors correctness over minimum query count.
- Resource caching and deduplication are important to practical performance.
- `keeps` is an advanced, development-verified optimization rather than normal
  application bookkeeping.

## Validation

The vertical-slice experiment records query counts and latency for default
revalidation, compares candidate verification semantics, and demonstrates that
deliberately unsafe `keeps` declarations are detected before the optimization
becomes public.
