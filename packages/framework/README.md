# Fadeno framework package (private V1 integration)

This private workspace package proves Fadeno's first package and Node adapter
boundary. It is not published, production-supported, or the final registry
identity.

The runtime-neutral `.` facade exports the standard Web `Handler` type plus
`FadenoConfig`, `RouteConfig`, and the identity helper `defineConfig`. The
`./node` facade exports the raw Node HTTP adapter contract for the V1
integration smoke.

Private package internals now discover and match route metadata and generate one
transactional, application-bound `fadeno:routes` module under `.fadeno/routes/`.
Those compiler files are not package exports, and route source modules are not
executed yet. Rendering, resources, actions, virtual-module build resolution,
and the supported CLI server remain later V1 work.
