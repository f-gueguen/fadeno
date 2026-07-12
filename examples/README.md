# Examples

`adapter-smoke/` is the executable V1 package/adapter integration example. Its
tracked TypeScript source is copied byte-for-byte into a clean consumer and run
against the packed package.

It is not a routed or rendered framework application. Later examples continue
to use one tested source rather than copied Markdown snippets.

`v1-app/` is the canonical first running routed application. Its route source,
isolated failure fixture, normalized diagnostic, flow record, correction, and
recovery record are all verified against a freshly packed package by
`pnpm check:v1-running-example`.
