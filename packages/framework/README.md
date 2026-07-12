# Fadeno framework package (private V1 integration)

This private workspace package proves Fadeno's first package and Node adapter
boundary. It is not published, production-supported, or the final registry
identity.

The runtime-neutral `.` facade currently exports only the standard Web
`Handler` type. The `./node` facade exports the raw Node HTTP adapter contract
for the V1 integration smoke. Routing, rendering, resources, actions, and CLI
server behavior are not implemented here yet.
