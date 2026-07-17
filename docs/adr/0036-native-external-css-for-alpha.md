# ADR 0036: Native external CSS for alpha

- Status: Accepted
- Date: 2026-07-17
- Owners: Fadeno maintainers
- Related specifications: [Progressive enhancement](../spec/progressive-enhancement.md), [Routing, rendering, streaming, and failures](../spec/routing-rendering-streaming.md)
- Supersedes: None

## Context

The alpha application needs useful styling without weakening the contextual
rendering boundary or committing Fadeno to a compiler-owned CSS language.
The canonical packed application demonstrates that ordinary browser CSS is
sufficient for the current document, form, error, focus, and preference
workflows. Browser evidence also showed that the renderer's previous
`default-src 'none'` policy blocked those same-origin stylesheets.

## Decision drivers

- Keep CSS authoring inside standard browser and TypeScript ownership.
- Preserve the renderer's refusal of inline CSS and application-owned
  `style` children.
- Make the current alpha styling path executable through public package
  entrypoints and real browsers.
- Avoid promising an asset pipeline or scoped styling contract without a
  demonstrated need.

## Decision

Alpha applications use native external CSS. Application code may render
ordinary `class` attributes and same-origin stylesheet links, and may serve a
CSS response from an application-owned raw handler. The application owns
stylesheet ordering, cascade, selector scope, and cache policy.

Rendered documents include `style-src 'self'` in their Content Security Policy.
They do not include `unsafe-inline`. Inline `style` attributes,
application-owned `style` children, runtime style injection, and cross-origin
stylesheets remain unavailable through the rendered-document policy.

Fadeno does not add scoped CSS, CSS modules, selector rewriting, extraction,
critical-CSS generation, an asset pipeline, or stylesheet hot replacement for
alpha. Such a surface remains deferred until an independent application shows
that native CSS is insufficient and a separate accepted decision defines
ordering, source maps, diagnostics, security, build identity, and browser
behavior.

This is an application convention and rendering-security decision, not a new
stable package API. The framework package remains private and has no release
impact or Changeset.

## Alternatives considered

- Inline style strings: rejected because HTML escaping is not a CSS grammar and
  ADR 0028 already refuses that sink.
- A framework CSS compiler for alpha: deferred because the current executable
  application does not demonstrate the cost or contract.
- Relaxing CSP to permit arbitrary style sources: rejected because the current
  application needs only application-owned same-origin CSS.

## Consequences

- The canonical application has one browser-native styling path that works
  with JavaScript disabled.
- Focus visibility and reduced-motion behavior can be tested as browser CSS,
  without claiming complete manual accessibility qualification.
- Applications that need inline, cross-origin, scoped, compiled, or dynamically
  injected CSS must wait for a separately evidenced decision.
- Rollback removes the application CSS route and example evidence, restores the
  prior CSP, and reopens the CSS-01 decision boundary.

## Validation

`pnpm check:a0-css` verifies the decision, specification, deferral, package
boundary, application sources, CSP policy, and permanent evidence inventory.
`pnpm check:v1-renderer` proves same-origin external CSS is permitted while
inline CSS sinks remain refused. `pnpm check:v1-running-example` consumes the
current packed framework through public entrypoints, proves computed styles,
focus visibility, and reduced-motion source in Chromium, Firefox, and WebKit
with JavaScript disabled, and executes success, failure, correction,
flow-inspection, recovery, and stale-artifact-removal fixtures.
