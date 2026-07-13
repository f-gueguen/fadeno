# Data consistency

## Request-scoped reads

ADR 0034 fixes one `defineResource({ read })` declaration and one
`context.read(resource, input)` call. The opaque declaration object is the
authored identity. The analyzer attaches construction-time source provenance;
applications do not maintain resource-name registries.

Equivalent input is a bounded tagged structural value: `null`, boolean, finite
number, string, dense array, or ordinary/null-prototype object with recursively
supported enumerable own string properties. Object key order is insignificant,
array order is significant, and `-0` equals `0`. The loader receives a deeply
frozen normalized snapshot rather than the caller's mutable object identity;
non-enumerable and symbol-keyed properties are stripped from both key and
snapshot. Cycles, enumerable accessors, sparse arrays, inherited enumerable
properties, custom prototypes, non-finite numbers, symbol values, and other
unsupported or over-budget values are refused without invoking loader or
accessor code. Proxy-interposed application objects are refused, may run their
own reflection traps during validation, and cannot customize identity;
external decoders must produce ordinary data before calling a resource.
The limits bound the normalized key and framework-retained data. Enumerating an
application-created object can still cost time proportional to that original
object's property count, and proxy traps are application execution rather than
a security boundary; applications should construct bounded ordinary inputs.

Each request owns a fresh declaration/input map. It records a dependency and
stores the loader promise before awaiting it, so equivalent concurrent and
later reads share one value, expected failure, or unexpected failure. Distinct
identity/input pairs execute independently. Attempted failures and cancellation
remain dependencies; refused inputs do not. Request completion releases all
entries, so a later request cannot observe a stale result or failure.

V1-11 implements this map as part of matched-route rendering and exposes the
same typed read capability to pages, layouts, not-found pages, and error pages.
Redirects close it immediately; streamed responses retain it until success,
failure, or cancellation cleanup. Expected failures select their declared HTTP
status and route error page without an internal incident. The canonical packed
application proves equivalent concurrent reads, distinct authorization
requests, expected failure, response cleanup, and next-request recovery.

V1 explicitly refuses shared, global, persistent, time-based, or other
cross-request result caches. A future shared cache requires a new decision with
explicit authorization and representation partitioning, freshness, bounded
storage, invalidation, eviction, and isolation evidence.

Expected loader failures use the branded `resourceError({ code, status })`
capability and propagate without becoming internal incidents. Unexpected
failures use the redacted incident path. Both reject `context.read` and flow to
the nearest applicable rendering boundary. The request signal owns shared work;
an aborted operation cannot publish a late value.

## Mutation and revalidation

After a successful action, every resource used by the active page revalidates.
The next server-derived output is computed from those results.

An action may declare `keeps` as opaque resource declaration references for
resources that it cannot affect for any input. The later action container stays
owned by DG-V1-05. Development verification detects unsafe declarations before
using the optimization. H4 accepts conservative resource-result comparison:
value, expected-error code/status, and ordering changes are detected, while
non-cacheable, unsupported, and over-budget values refuse the optimization.

The baseline remains correct when all `keeps` declarations are removed.

V1-11 implements one private revalidation owner that reruns the complete
immutable active dependency set in deterministic observation order, compares
only bounded supported outcomes, marks unsafe or inactive declarations, and
publishes no partial optimization result after cancellation. The action slice
will invoke that owner only after DG-V1-05 fixes the successful-action
container; V1-11 does not expose `keeps` or an action API by itself.

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
