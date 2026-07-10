# Fadeno

Fadeno is a web-native application framework for plain TypeScript and JSX.

Its product direction is simple: application code uses the web's vocabulary—
pages, fragments, resources, actions, forms, links, islands, and state with an
explicit home—while compiler and runtime machinery remains inspectable rather
than becoming application vocabulary.

## Status

Fadeno is in repository-foundation and kill-risk validation. No framework
package is published and no example is presented as runnable yet.

The first implementation work is evidence gathering for four claims:

1. HTML morphing can preserve browser and user-owned state.
2. Small interactions can be extracted without component hydration.
3. Stock TypeScript can carry the route, form, and context type spine.
4. Revalidation by default is viable for the intended application class.

See [the roadmap](docs/roadmap.md) and
[current hypotheses](docs/ledgers/hypotheses.md).

For a complete view of planned capabilities, use the
[feature matrix](docs/product/scope.md), [traceability matrix](docs/traceability.md),
and [detailed K0 plan](docs/roadmap/k0.md).

## Repository contract

- [PROJECT_INVARIANTS.md](PROJECT_INVARIANTS.md) defines non-negotiable
  architectural constraints.
- [Accepted ADRs](docs/adr/README.md) record durable decisions.
- [Current specifications](docs/spec/) state intended public behavior.
- Released declarations, schemas, and conformance tests will govern observable
  released behavior once implementation exists.
- [ROADMAP_LEDGER.md](ROADMAP_LEDGER.md) tracks current execution state only;
  it does not make architectural decisions.

Run all currently available checks with:

```sh
pnpm check
```

Coding agents and contributors follow the
[canonical change workflow](docs/contributor-workflow.md), including small PRs,
atomic commits, executable examples, version intent, changelogs, migrations,
and rollback evidence.

## License

Fadeno is available under the [MIT License](LICENSE).

## Name

*Fadeno* means “thread” in Esperanto: a small strand connecting the parts of a
web application without becoming another application-layer concept.
