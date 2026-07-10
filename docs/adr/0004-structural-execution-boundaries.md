# ADR 0004: Structural execution boundaries

- Status: Accepted
- Date: 2026-07-10
- Owners: Fadeno maintainers
- Related specifications: [Execution boundaries](../spec/execution-boundaries.md)
- Supersedes: None

## Context

A compiler-assisted framework can relocate work between server and browser in
ways that are difficult to see during review and dangerous around secrets,
side effects, and bundle size.

## Decision drivers

- Network and trust boundaries must remain visible in source structure.
- Refactoring should not silently change where code executes.
- Static analysis needs explicit boundaries that produce useful diagnostics.

## Decision

Fadeno uses structural execution zones:

- page and fragment render bodies, resources, actions, and server modules
  execute on the server;
- islands and event-handler closures selected for extraction are explicit
  browser-zone roots, even when their syntax is nested in a server render body;
- shared modules are pure with respect to server-only and browser-only globals.

Cross-zone values must satisfy the applicable serialization and validation
contract. Unsupported closures or imports produce diagnostics; the compiler
does not move them speculatively.

## Alternatives considered

- Infer execution from usage: rejected because small refactors can cross a
  network boundary invisibly.
- File suffixes as the only boundary: rejected because public primitives still
  need semantic constraints and value-flow checks.
- Make all application code universal: rejected because most server and browser
  capabilities are not meaningfully interchangeable.

## Consequences

- Some source patterns that JavaScript permits will be rejected at a boundary.
- Nested handler syntax does not grant its browser closure access to the
  surrounding server scope; capture rules govern each value explicitly.
- Diagnostics and generated manifests become part of the developer contract.
- Compiler analyses must default to refusal when execution ownership is
  ambiguous.

## Validation

Positive and negative fixtures exercise legal imports, serialization, closure
capture, secret access, and browser-global access for every zone.
