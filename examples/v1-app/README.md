# V1 running application

This is the canonical first running Fadeno application. Its tracked TSX routes
are analyzed and built through the installed `fadeno` executable. A complete
candidate is compiled outside `dist`, verified, and then replaces the prior
accepted build as one generation. The generated bootstrap verifies the build
manifest and installed runtime before it imports application behavior.

After installing the packed framework, the demonstrated production workflow is:

```sh
pnpm build
FADENO_PORT=3000 pnpm start
```

The demonstrated development workflow is:

```sh
pnpm dev
```

It prints `Fadeno development server ready at http://127.0.0.1:4173.` only
after a complete verified generation is accepting requests. The permanent
`development-lifecycle` scenario is executed by `pnpm check:v1-development`
and proves direct and transitive reloads, diagnostic last-good behavior,
recovery, artifact cleanup, and graceful shutdown.

Run the verified application, failure, flow, and recovery evidence with:

```sh
pnpm check:v1-running-example
```

That gate installs the current packed framework into two clean consumers and
requires byte-identical builds. It starts the generated production bootstrap,
exercises the routed application, seeds the compiler failure under
`scenarios/build-compiler-error/`, and proves an initial failure leaves no
`dist`. Later failure, input-drift, concurrent-build, runtime-import, and
rollback scenarios must preserve the accepted output. The gate also kills a
builder, recovers its ownership lock, performs a production-only reinstall,
starts successfully without development dependencies, applies the tracked
correction, and proves an output disappears after its source owner is deleted.
Human and normalized manifest evidence is read from `expected/`; flow and
recovery evidence is read from the scenario's `expected/` directory.

The home route now performs two concurrent reads with equivalent structural
inputs and refuses to render unless they share one request-owned result. The
same packed server is then called with two authorization identities to prove
that a later request cannot reuse the earlier request's value. The
`resource-failure` route throws the typed expected 404 from
`src/resources/projects.ts`, while the `resource-recovery` route proves a
memoized 503 disappears with its completed request and succeeds on the next
request. Their human output lives in `expected/resource-*.txt`.

`scenarios/resource-lifecycle/expected/` contains the normalized request-flow,
input-refusal, expected-failure, unsafe-`keeps` correction, and recovery
records. `pnpm check:v1-resources` derives each record from runtime behavior;
`pnpm check:v1-running-example` derives the HTTP failure and recovery records
from the current packed application. The primary application remains buildable
because the deliberate failures are request-selected routes rather than
compile-time errors.

Run the packed human project-check workflow with:

```sh
pnpm check:v1-analyzer-workflow
```

That gate fresh-builds and packs the framework, verifies the installed CLI
closure identity, invokes the installed `fadeno` executable, and asserts the
tracked human outputs in `expected/check-success.txt`,
`expected/check-success-explain.txt`, `expected/check-collision.txt`, and
`expected/check-collision-explain.txt`. The recovery run must equal the success
output and leave neither `.fadeno` nor `dist` behind.

The deliberate route-role collision lives under `scenarios/`; it never makes
the primary application unbuildable. Its analyzer diagnostic preserves the last
accepted disk generation, and the recovery run proves stale route bytes are
removed only after a repaired complete publication is accepted.
