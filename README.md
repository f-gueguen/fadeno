# Fadeno

Fadeno is a web-native application framework for plain TypeScript and JSX.

Its product direction is simple: application code uses the web's vocabulary—
pages, fragments, resources, actions, forms, links, islands, and state with an
explicit home—while compiler and runtime machinery remains inspectable rather
than becoming application vocabulary.

## Status

Fadeno is in V1 implementation. A private packed framework can analyze, build,
and run the canonical routed application through generated route bindings and a
verified loopback production bootstrap. The application, deliberate failures,
flow inspection, rollback, stale-output recovery, and production-only startup
run as executable repository evidence. No package is published or
production-supported yet, and the supported development server, resources,
actions, browser enhancement, public release identity, and final qualification
remain later work.

The four K0 kill-risk investigations are complete: structural preservation and
incremental declaration generation were narrowed, while bounded interaction
extraction and correctness-first revalidation were accepted within their
measured evidence.

See [the roadmap](docs/roadmap.md) and
[current V1 plan](docs/roadmap/v1.md).

For a complete view of planned capabilities, use the
[feature matrix](docs/product/scope.md), [traceability matrix](docs/traceability.md),
and [detailed V1 plan](docs/roadmap/v1.md).

The current adapter integration can be replayed with:

```sh
pnpm check:v1-public-package
```

It is a package/adapter smoke proof, not the supported `fadeno dev` workflow.
Production route generation and matching can be replayed with:

```sh
pnpm check:v1-routing
```

The current first running application and transactional production build can be
replayed from a freshly packed consumer with:

```sh
pnpm check:v1-running-example
```

## Repository contract

- [PROJECT_INVARIANTS.md](PROJECT_INVARIANTS.md) defines non-negotiable
  architectural constraints.
- [Accepted ADRs](docs/adr/README.md) record durable decisions.
- [Current specifications](docs/spec/) state intended public behavior.
- Released declarations, schemas, and conformance tests will govern observable
  released behavior once implementation exists.
- [ROADMAP_LEDGER.md](ROADMAP_LEDGER.md) tracks current execution state only;
  it does not make architectural decisions.

During development, run all currently available checks with:

```sh
pnpm check
```

The final committed PR head uses the internal local merge gate:

```sh
pnpm ci:local
```

That command requires a clean tree, runs a frozen install followed by the full
check, and reports the exact unchanged commit. It is repository validation, not
a public Fadeno CLI or K0 reference-qualification command.

Coding agents and contributors follow the
[canonical change workflow](docs/contributor-workflow.md), including small PRs,
atomic commits, executable examples, version intent, changelogs, migrations,
and rollback evidence.

## License

Fadeno is available under the [MIT License](LICENSE).

## Name

*Fadeno* means “thread” in Esperanto: a small strand connecting the parts of a
web application without becoming another application-layer concept.
