# Data consistency

## Request-scoped reads

Resources provide server-owned reads. Calls with equivalent identity and input
deduplicate within a request. A page render records which resources contributed
to its output. Failures propagate to the nearest applicable rendering boundary.

Cross-request caching is not implicit. A cache policy, key, scope, freshness,
and authorization boundary must be explicit before values are shared across
requests or users.

## Mutation and revalidation

After a successful action, every resource used by the active page revalidates.
The next server-derived output is computed from those results.

An action may declare `keeps` for resources that it cannot affect. Development
verification must detect unsafe declarations before the optimization becomes
public. The revalidation experiment evaluates whether that check compares
resource values, serialized output, dependency hashes, or another conservative
observable. Its accepted semantics will be added to this specification.

The baseline remains correct when all `keeps` declarations are removed.

## Concurrent submissions

Enhanced clients prevent accidental duplicate submission while preserving
explicit repeated actions. Responses carry sufficient identity to prevent an
older result from overwriting a newer accepted result. The server remains the
authority after optimistic previews.

Exact request and response fields are a protocol decision made only after the
vertical slice validates ordering and replay behavior.

## Live data

Live updates, when introduced, use the same semantic render and preservation
rules as action-driven changes. Their transport can differ. Reconnect must
converge on server truth, and authorization expiry must close or reauthorize the
stream rather than continue with stale authority.

Live transport is deferred until the ordinary resource, action, and patch
model passes conformance.
