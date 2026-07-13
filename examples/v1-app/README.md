# V1 running application

This is the canonical first running Fadeno application. Its tracked TSX routes
are discovered into a generated application binding, compiled against a current
packed framework, served through the public Node adapter, and exercised by the
repository gate.

Run the verified application, failure, flow, and recovery evidence with:

```sh
pnpm check:v1-running-example
```

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
the primary application unbuildable.
