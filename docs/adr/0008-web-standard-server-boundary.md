# ADR 0008: Web-standard server boundary

- Status: Accepted
- Date: 2026-07-10
- Owners: Fadeno maintainers
- Related specifications: [Execution boundaries](../spec/execution-boundaries.md), [Protocol requirements](../spec/protocol-requirements.md)
- Supersedes: None

## Context

The framework server core must accept requests, stream responses, and support
multiple runtimes without allowing adapters to redefine application behavior.

## Decision drivers

- Standard platform types reduce adapter-specific surface area.
- Streaming, cancellation, and disconnect behavior need a common contract.
- Runtime support should be earned through conformance, not declared in a plan.

## Decision

The server core uses standard `Request`, `Response`, `URL`, `Headers`, and Web
Streams. Adapters translate host capabilities at the outer boundary and publish
their supported capability set.

An adapter is supported only after passing the shared conformance suite. An
adapter may reject an unsupported capability explicitly; it may not silently
change application semantics.

## Alternatives considered

- A framework-specific request and response abstraction: rejected because it
  duplicates platform concepts and expands every adapter.
- Runtime-specific application entrypoints: rejected because behavior would
  drift between hosts.
- Promise support for named runtimes before tests exist: rejected because a
  roadmap mention is not compatibility evidence.

## Consequences

- Runtime-specific features live behind explicit adapter capabilities.
- Cancellation and streaming semantics need cross-runtime fixtures.
- Support documentation is generated from conformance evidence.

## Validation

Every adapter runs the same request, streaming, cancellation, error, header,
cookie, and disconnect conformance cases.
