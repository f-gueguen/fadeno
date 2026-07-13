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

Run the verified application, failure, flow, and recovery evidence with:

```sh
pnpm check:v1-running-example
```

That gate runs two byte-identical builds, starts the generated production
bootstrap, exercises the routed application, seeds the compiler failure under
`scenarios/build-compiler-error/`, proves `dist` stays unchanged, applies the
tracked correction, and proves an output disappears after its source owner is
deleted. Human and normalized manifest evidence is read from `expected/`; flow
and recovery evidence is read from the scenario's `expected/` directory.

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
