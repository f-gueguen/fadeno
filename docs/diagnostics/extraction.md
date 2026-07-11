# Private extraction diagnostics

These K0-06 identifiers and corrections are internal experiment evidence. They
are not an externally versioned analyzer schema; DG-A0-02 remains open.

## FADENO_K0_EXTRACT_SERVER_IMPORT

The reachable browser graph crosses into a `server-only:` module. Move secret,
database, or server I/O behind a resource or action.

## FADENO_K0_EXTRACT_OPAQUE_CAPTURE

The selected closure reaches an opaque capability. Create and own that
capability inside an explicit island.

## FADENO_K0_EXTRACT_CLASS_CAPTURE

The selected closure reaches a class instance. Capture bounded plain data or
use an explicit island with lifecycle ownership.

## FADENO_K0_EXTRACT_CYCLIC_CAPTURE

The selected closure reaches cyclic data. Break the cycle and capture bounded
plain data.

## FADENO_K0_EXTRACT_DYNAMIC_IMPORT

The selected closure uses a non-literal dynamic import. Use a statically
declared browser dependency.

## FADENO_K0_EXTRACT_AMBIENT_CAPTURE

A reachable dependency switches behavior through an ambient server/browser
global. Split ownership at a visible source boundary.

## FADENO_K0_EXTRACT_ASYNC_LIFETIME

The selected closure starts an unbounded timer lifetime. Use an explicit island
that owns teardown.

## FADENO_K0_EXTRACT_CAPTURE_SIZE

The serialized capture exceeds the private experiment limit of 65,536 bytes.
Pass a smaller plain-data value or use an explicit island.

## FADENO_K0_EXTRACT_NON_DETERMINISTIC_CAPTURE

The selected closure reaches a non-deterministic initializer. Compute the value
in an explicit state home.

## FADENO_K0_EXTRACT_AMBIGUOUS_FLOW

The checker cannot resolve a dependency or captured call result conservatively.
Use a statically resolvable dependency or an explicit island.
