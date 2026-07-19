# Fadeno

Fadeno is a web-native application framework for plain TypeScript and JSX.

Its product direction is simple: application code uses the web's vocabulary—
pages, fragments, resources, actions, forms, links, islands, and state with an
explicit home—while compiler and runtime machinery remains inspectable rather
than becoming application vocabulary.

## Status

Fadeno has completed its qualified private V1 and public A0. The corrected
first alpha is published as `@fadeno/framework@0.1.0-alpha.1`, and V2-00 now
owns the browser-enhancement plan from that verified native baseline.
The qualified first-alpha candidate remains recorded as the immutable A0-09
input, and A0-10 records the corrected public release derived from it.
The immutable `0.1.0-alpha.0` source release stopped before registry upload
when hosted visibility evidence was incomplete. The package can analyze, build,
and run the canonical routed application through generated route bindings and a
verified production bootstrap. The application includes request-owned
resources and an authenticated native-form CRUD workflow with protected
sessions, validation, upload, redirects, replay refusal, and complete
revalidation. Deliberate failures, flow inspection, rollback, stale-output
recovery, three-browser JavaScript-disabled operation, and production-only
startup run as executable repository evidence. The package has public metadata
and guarded release machinery. The alpha is experimental and has no production
support.
Packed creation, application testing, immutable deployment, deterministic
external-decoder fuzzing, and the complete public command workflow now pass
automated qualification. Independent newcomer
usability has not been qualified and no editor product or public analyzer
schema is supported; those remain explicitly deferred. A0-10 completed the
immutable tag, provenance publication, documentation artifact, and public
install verification for this exact release source. Browser enhancement is the
current V2 plan, remains blocked on its protocol decision before implementation,
and leaves islands in V3.

The four K0 kill-risk investigations are complete: structural preservation and
incremental declaration generation were narrowed, while bounded interaction
extraction and correctness-first revalidation were accepted within their
measured evidence.

See [the roadmap](docs/roadmap.md), [completed V1 plan](docs/roadmap/v1.md),
[completed A0 plan](docs/roadmap/a0.md), and [current V2 plan](docs/roadmap/v2.md).

Current V1 documentation is generated from executed source and verified
output:

- [getting started](docs/guides/getting-started.md);
- [resources, actions, and sessions](docs/guides/resources-actions.md);
- [diagnostics, flow inspection, and recovery](docs/guides/diagnostics-recovery.md);
- [V1 API reference](docs/reference/v1-api.md).

For a complete view of planned capabilities, use the
[feature matrix](docs/product/scope.md), [traceability matrix](docs/traceability.md),
and [current V2 plan](docs/roadmap/v2.md).

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

That check also drives the packed authenticated CRUD example over HTTPS in
Chromium, Firefox, and WebKit with browser JavaScript disabled.

The complete private V1 boundary can be reconstructed with:

```sh
pnpm check:v1-exit
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
