# Fadeno framework package (private V1 integration)

This private workspace package proves Fadeno's first package and Node adapter
boundary. It is not published, production-supported, or the final registry
identity.

The runtime-neutral `.` facade exports the standard Web `Handler` type,
configuration, rendering and route outcomes, and the request-scoped resource
surface. The `./node` facade exports the raw Node HTTP adapter contract for the
V1 integration smoke. The package executable owns project analysis,
transactional production build, and retained development paths:

```sh
fadeno check --project-root ./my-project
fadeno check --project-root ./my-project --explain
fadeno build --project-root ./my-project
fadeno dev --project-root ./my-project --port 4173
```

`check` validates current configuration and route framework semantics, reports
human diagnostics, and plans artifacts without writing them. `build` analyzes
and validates one current generation, emits into a contained stage, verifies a
versioned manifest and the installed declared production-dependency closure,
and atomically replaces `dist` while preserving the last accepted generation
on failure. Unrelated development packages are not startup inputs. Neither
command has a machine-output mode.

Start an accepted build from its project root with an explicit port:

```sh
FADENO_PORT=3000 node --import ./dist/.fadeno/routes/loader.js ./dist/server/bootstrap.js
```

Pages declare a server-owned read with `defineResource({ read })` and consume it
only through their typed `context.read(resource, input)`. Equivalent bounded
structural inputs share one pending or settled result within a request. The
loader receives the request, request-owned cancellation signal, and a deeply
frozen normalized input. `resourceError({ code, status })` creates a typed
expected application outcome for the route error page; it does not create an
internal incident. Every request releases values, failures, dependencies, and
flow records when its response finishes. V1 deliberately has no cross-request
result cache.

The permanent packed examples are the source of the resource usage and failure
documentation: `examples/v1-app/src/resources/projects.ts`,
`examples/v1-app/src/routes/page.tsx`, and the isolated resource lifecycle
scenario. `pnpm check:v1-running-example` and `pnpm check:v1-resources` execute
those files and compare their normalized evidence.

Private package internals discover and match route metadata, generate one
transactional application-bound `fadeno:routes` module, render matched routes,
and coordinate compiler/build freshness. Those modules are not package exports.
Actions, sessions, publication support, and a supported analyzer or editor
schema remain later work.
