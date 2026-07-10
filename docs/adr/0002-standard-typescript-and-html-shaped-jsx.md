# ADR 0002: Standard TypeScript and HTML-shaped JSX

- Status: Accepted
- Date: 2026-07-10
- Owners: Fadeno maintainers
- Related specifications: [Public model](../spec/public-model.md)
- Supersedes: None

## Context

Fadeno needs expressive, statically checked application code without requiring
a language fork or teaching a second template language.

## Decision drivers

- Stock editors, formatters, and TypeScript must understand source files.
- Markup should resemble the HTML ultimately sent to the browser.
- Framework behavior should be discoverable through typed imports.

## Decision

Application source uses standard TypeScript and JSX accepted by stock
TypeScript tooling. Fadeno does not add grammar.

JSX uses HTML-shaped names such as `class` and `for`. Event properties use
camel-cased DOM names. Framework behavior is expressed through typed imports,
components, and arguments rather than magic attributes or selector strings.

Generated declarations may enrich route, form, and context types, but the
result must remain valid input to stock `tsc`.

## Alternatives considered

- A custom single-file component language: rejected because it adds a parser,
  editor integrations, and a second syntax contract.
- React-shaped aliases as the canonical markup: rejected because Fadeno emits
  HTML and should teach the platform vocabulary.
- String protocols in attributes: rejected because they weaken discovery,
  refactoring, and type checking.

## Consequences

- The compiler analyzes a standard syntax rather than owning it.
- Familiar JSX code may need mechanical attribute-name fixes.
- Type generation must be deterministic and compatible with normal TypeScript
  project references.

## Validation

Conformance fixtures compile with the supported stock TypeScript version and
cover generated route, form, and context declarations.
