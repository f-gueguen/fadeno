# ADR 0005: Resources and actions

- Status: Accepted
- Date: 2026-07-10
- Owners: Fadeno maintainers
- Related specifications: [Public model](../spec/public-model.md), [Data consistency](../spec/data-consistency.md)
- Supersedes: None

## Context

Application reads and mutations need visible ownership so rendering,
invalidation, security, forms, and diagnostics share one semantic model.

## Decision drivers

- Reads and writes have different caching and security properties.
- Ordinary mutations need a native HTML form path.
- Hidden client fetches and global stores make server truth hard to reason
  about.

## Decision

Resources own application reads consumed by pages and fragments. Actions own
ordinary mutations, and every action is callable through a standard HTML form.
GET forms are navigations, not actions.

Ordinary application code receives no general-purpose framework client-fetch
primitive and no default global client store. Data reaches changed output
through resource and state dependencies rather than selector-targeted update
commands.

Raw request handlers remain an explicit escape hatch for protocols or endpoints
that do not fit the page model.

## Alternatives considered

- One server-function primitive for reads and writes: rejected because it
  obscures cache, replay, CSRF, and invalidation semantics.
- Client fetching as the normal read path: rejected because it bypasses the
  server-rendered baseline.
- Target selectors returned by mutations: rejected because they couple data
  changes to incidental DOM structure.

## Consequences

- Resource dependency tracking is a core runtime responsibility.
- Actions require origin, replay, decoding, authorization, and size policies.
- Protocol-specific needs use visible escape hatches instead of expanding the
  ordinary application vocabulary.

## Validation

Conformance tests cover resource deduplication and failure behavior, native and
enhanced action submission, GET navigation forms, and forbidden client-zone
access to resource internals.
