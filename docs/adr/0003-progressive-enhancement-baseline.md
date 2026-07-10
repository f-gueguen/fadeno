# ADR 0003: Progressive enhancement as the baseline

- Status: Accepted
- Date: 2026-07-10
- Owners: Fadeno maintainers
- Related specifications: [Progressive enhancement](../spec/progressive-enhancement.md)
- Supersedes: None

## Context

Fadeno targets applications that can perform their essential work with web
documents, links, forms, and server responses.

## Decision drivers

- Essential navigation and mutation paths should survive unavailable or
  failing JavaScript.
- Native browser behavior provides a stable accessibility and recovery base.
- Client code should be proportional to the interaction being added.

## Decision

Server-rendered HTML is the baseline. Links navigate and forms submit without
JavaScript. Enhancement may add in-place patches, pending feedback, optional
transitions, focus management, and isolated rich interaction, while preserving
the baseline path.

A route whose essential behavior requires JavaScript declares that requirement
and a reviewable reason. Rich client ownership uses an explicit root island;
Fadeno does not provide an implicit application-wide client mode.

## Alternatives considered

- Client rendering as the default: rejected because it makes the enhancement
  runtime the only path.
- Treat JavaScript availability as an application assumption: rejected because
  it hides a product boundary and weakens recovery behavior.
- Ban rich client routes: rejected because explicit islands are a useful escape
  hatch.

## Consequences

- Every ordinary workflow needs a no-JavaScript conformance path.
- Enhancements must preserve browser semantics, URLs, and accessibility.
- Applications dominated by root islands are outside Fadeno's intended fit.

## Validation

Executable examples test essential links and forms with JavaScript disabled as
well as their enhanced paths in supported browsers.
