# Fadeno framework package (private V1 integration)

This private workspace package proves Fadeno's first package and Node adapter
boundary. It is not published, production-supported, or the final registry
identity.

The runtime-neutral `.` facade exports the standard Web `Handler` type plus
`FadenoConfig`, `RouteConfig`, and the identity helper `defineConfig`. The
`./node` facade exports the raw Node HTTP adapter contract for the V1
integration smoke. The package executable currently owns project analysis and
transactional production build paths:

```sh
fadeno check --project-root ./my-project
fadeno check --project-root ./my-project --explain
fadeno build --project-root ./my-project
```

`check` validates current configuration and route framework semantics, reports
human diagnostics, and plans artifacts without writing them. `build` analyzes
and validates one current generation, emits into a contained stage, verifies a
versioned manifest and runtime closure, and atomically replaces `dist` while
preserving the last accepted generation on failure. Neither command has a
machine-output mode.

Start an accepted build from its project root with an explicit port:

```sh
FADENO_PORT=3000 node --import ./dist/.fadeno/routes/loader.js ./dist/server/bootstrap.js
```

Private package internals discover and match route metadata, generate one
transactional application-bound `fadeno:routes` module, render matched routes,
and coordinate compiler/build freshness. Those modules are not package exports.
Resources, actions, sessions, the development server, and publication support
remain later work.
