# Streaming lifecycle threat model

This threat model accompanies ADR 0029 before the V1-09 JSX renderer exists.

## Assets and actors

Assets are status/header integrity, complete and well-owned HTML, nonce/header
correlation, bounded framework memory, cancellation propagation, secret-safe
failure reporting, and release of framework-owned resources. Attackers may
disconnect, stall reads, trigger slow or failing application work, or arrange
failures at parser- and commit-sensitive points. Application code may ignore an
abort signal or throw while producing a fallback.

## Threats and controls

- Status/header confusion is controlled by one irreversible head-publication
  transition distinct from the first body byte.
- Parser corruption is controlled by in-order slots and refusal to recover a
  boundary after any owned bytes were emitted.
- Out-of-order or late work is controlled by parent-owned cancellation,
  first-reason terminal state, and ignored late settlements.
- Slow clients are controlled by one pending chunk and no producer advance
  before sink acceptance.
- Timer, reader, listener, and boundary leaks are controlled by idempotent
  exactly-once cleanup on success and every failure/cancellation path.
- Error recursion is controlled by safe structured projection and a reporter
  failure path that cannot re-enter response handling.
- Nonce/header mismatch is controlled by allocation after final outcome
  selection and an immutable correlation record before head publication.

## Limits and residual risk

The framework cannot forcibly terminate application code that ignores its
abort signal. It removes references and refuses late output. A post-commit root
failure may truncate the response because changing status or inserting a new
document would be dishonest. V1 has no client mechanism for replacing visible
pending output, so unresolved boundaries pause their document position.

V1-09 owns actual HTML parser behavior, response construction, CSP headers,
executable markup, and adapter integration. V1-11 adds exactly-once
request-resource cleanup to the same response lifecycle and proves expected
resource failures before and after publication. Action authorization and
authentication expiry remain with their owning later V1 slices.
