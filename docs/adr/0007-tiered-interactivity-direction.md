# ADR 0007: Tiered interactivity direction

- Status: Accepted
- Date: 2026-07-10
- Owners: Fadeno maintainers
- Related specifications: [Execution boundaries](../spec/execution-boundaries.md), [Hypothesis ledger](../ledgers/hypotheses.md)
- Supersedes: None

## Context

Some pages need no browser logic, some need small local interactions, and some
contain long-lived client-owned widgets. Treating all three as component
hydration sends and executes unnecessary code.

## Decision drivers

- Browser cost should be proportional to interaction complexity.
- Rich client ownership must be explicit.
- Unsupported extraction must fail clearly rather than broaden silently.

## Decision

Fadeno's intended interaction gradient has three outcomes:

1. server-rendered output with no client behavior;
2. compiler-extracted handlers for bounded local interaction;
3. explicit islands for client-owned state and lifecycle.

The gradient is a product direction, not evidence that extraction works. The
exact closure rules, handler identity, state preservation, loading strategy,
and byte envelope remain governed by experiments. Unsupported extraction is a
diagnostic or a deliberate island boundary, never automatic whole-fragment
hydration.

## Alternatives considered

- Hydrate every interactive component: rejected because simple interactions
  pay the same ownership cost as rich widgets.
- Allow arbitrary server closures in browser handlers: rejected because the
  execution and serialization boundary becomes misleading.
- Avoid client-owned islands entirely: rejected because some interfaces need a
  real lifecycle and durable local state.

## Consequences

- Extraction is a kill-risk experiment before it becomes a public promise.
- Analyzer diagnostics are essential to teaching the boundary.
- An application can choose an explicit island when extraction constraints are
  a poor fit.

## Validation

A published fixture corpus covers accepted and rejected handlers, loading,
event delegation, identity across patches, and the absence of fragment-wide
hydration.
