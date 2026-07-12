# V1 running application

This is the canonical first running Fadeno application. Its tracked TSX routes
are discovered into a generated application binding, compiled against a current
packed framework, served through the public Node adapter, and exercised by the
repository gate.

Run the verified application, failure, flow, and recovery evidence with:

```sh
pnpm check:v1-running-example
```

The deliberate route-role collision lives under `scenarios/`; it never makes
the primary application unbuildable.
