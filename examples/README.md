# Examples

`adapter-smoke/` is the executable V1 package/adapter integration example. Its
tracked TypeScript source is copied byte-for-byte into a clean consumer and run
against the packed package.

It is not a routed or rendered framework application. Later examples continue
to use one tested source rather than copied Markdown snippets.

`v1-app/` is the canonical first running routed application. Its route source,
transactional production build and start, generated link, nested ownership
surfaces, isolated route and compiler failure fixtures, normalized diagnostics
and manifest, failure reports, flow records, corrections, rollback, recovery,
and stale-artifact removal are verified against a freshly packed package by
`pnpm check:v1-running-example`.
