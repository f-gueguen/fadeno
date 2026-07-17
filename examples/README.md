# Examples

`authority.json` assigns every packaged example exactly one role. `v1-app/` is
the sole canonical V1 application and documentation source. The documentation
source contract within that application owns its executed source and every
normalized success, failure, correction, flow, recovery, and stale-removal
record.

`adapter-smoke/` is the executable V1 package/adapter integration checkpoint. Its
tracked TypeScript source is copied byte-for-byte into a clean consumer and run
against the packed package.

It is not a routed or rendered framework application, a tutorial source, or an
independently usable V1 workflow. Later documentation continues to use one
tested source rather than copied Markdown snippets.

`v1-app/` is the canonical first running routed application. Its route source,
transactional production build and start, generated link, nested ownership
surfaces, isolated route and compiler failure fixtures, normalized diagnostics
and manifest, failure reports, flow records, corrections, rollback, recovery,
and stale-artifact removal are verified against a freshly packed package by
`pnpm check:v1-running-example`.
