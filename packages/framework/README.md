# @fadeno/framework

This is the selected public Fadeno package. Its `0.0.0` manifest is an
unpublished release seed; the first qualified registry version will be an
alpha prerelease. It is not yet published or production-supported.

The runtime-neutral `.` facade exports the standard Web `Handler` type,
configuration, rendering and route outcomes, and the request-scoped resource
and action/session surfaces. The `./node` facade exports the Node HTTP adapter
contract, including the production bootstrap's exact HTTPS origin and generated
application identity inputs. The package executable owns project analysis,
transactional production build, retained development paths, and exact
non-interactive creation into a missing target:

```sh
fadeno create --project-root ./my-project
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

Projects created by the executable also expose `pnpm test`. That command uses
the pinned stock TypeScript compiler and Node's built-in test runner against
the application's route modules and Fadeno's production `renderRoute` and
`Handler` surfaces. It writes only disposable `.fadeno/test` output, removes
the prior output before compiling, and adds no framework test runtime or public
test helper.

Start an accepted build from its project root with an explicit port. An
application that declares actions also provides its canonical HTTPS origin and
active-first protected-session keyring:

```sh
FADENO_PORT=3000 \
FADENO_ORIGIN=https://app.example \
FADENO_SESSION_KEYS='active:<32-byte-base64url-key>' \
node --import ./dist/.fadeno/routes/loader.js ./dist/server/bootstrap.js
```

Pages declare a server-owned read with `defineResource({ read })` and consume it
only through their typed `context.read(resource, input)`. Equivalent bounded
structural inputs share one pending or settled result within a request. The
loader receives the request, request-owned cancellation signal, and a deeply
frozen normalized input. `resourceError({ code, status })` creates a typed
expected application outcome for the route error page; it does not create an
internal incident. Every request releases values, failures, dependencies, and
flow records when its response finishes. V1 deliberately has no cross-request
result cache. Input limits bound framework-retained normalized data; they do not
make an application-created giant object or proxy cheap to enumerate.

The permanent packed examples are the source of the resource usage and failure
documentation: `examples/v1-app/src/resources/projects.ts`,
`examples/v1-app/src/routes/page.tsx`, and the isolated resource lifecycle
scenario. `pnpm check:v1-running-example` and `pnpm check:v1-resources` execute
those files and compare their normalized evidence.

Native mutations use one `defineAction({ fields, authorize, run, keeps? })`
declaration. Forms receive generated action, field, and proof identities; the
runtime completely decodes and bounds POST input before mandatory application
authorization. `actionError` renders recoverable field/form failures, accepted
actions completely re-run the current page resources before rendering or a
same-origin 303, and `PageContext.session` exposes the protected read view.
Mutation callbacks alone receive buffered session writes and identity rotation.
Production action serving requires exact `FADENO_ORIGIN` and active-first
`FADENO_SESSION_KEYS` configuration. The initial replay/session owner is one
process only.

The permanent packed action example is
`examples/v1-app/src/routes/projects/page.tsx` with declarations and storage in
`examples/v1-app/src/projects.ts`. `pnpm check:v1-running-example` executes its
sign-in, validation, upload, create, read, update, replay-refusal, delete, and
stale-state recovery paths in all three browsers with JavaScript disabled.

Package internals discover and match route metadata, generate one
transactional application-bound `fadeno:routes` module, render matched routes,
and coordinate compiler/build freshness. Those modules are not package exports.
Publication is guarded by the repository release process. A supported analyzer
or editor schema remains later work; analyzer and action decision schemas stay
private package internals.
