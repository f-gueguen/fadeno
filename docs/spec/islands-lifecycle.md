# Islands and client lifecycle

An island is Fadeno's explicit boundary for UI that owns a browser lifecycle and
durable local state. It is not the default rendering unit.

## Ownership

1. An island receives serializable server input and renders useful server
   fallback HTML.
2. The island owns its mounted DOM interior, browser subscriptions, local state,
   and teardown. The server owns whether the island exists and its current
   inputs.
3. Server-derived updates do not inspect or morph a mounted island's interior.
4. Removal invokes teardown exactly once. Replacement invokes teardown before
   a new mount. Abandoned asynchronous setup is cancelled.
5. Changed server input is delivered through one defined update contract rather
   than silently remounting or mutating captured values.
6. Island identity is stable across unrelated page updates and explicit when
   repeated islands reorder.

DG-V3-02 selects the authoring adapter, identity syntax, serialization format,
mount strategies, input-update contract, and teardown API after the V2
preservation runtime exists.

## Loading and fallback

- No island runtime is sent to a route that contains no island.
- The default loading strategy cannot hide essential content or controls from
  the no-JavaScript document.
- Deferred or visibility-based loading preserves accessibility and does not
  lose an interaction without an explicit eager requirement.
- A load or mount failure leaves useful fallback output and reports a bounded
  diagnostic.

## Root islands

A route may declare an explicit root island and a reviewable JavaScript-required
reason. The server still returns useful status, metadata, and fallback content.
Root-island usage is visible to analyzer and review tooling.

Repeated root-island use is treated as product-fit feedback rather than a reason
to add implicit client ownership to all routes.

## State sharing

State shared between server output and islands has one declared home. URL,
resource, session, and device values enter through typed inputs or explicit
capabilities. There is no ambient framework-wide client store.

Two islands do not share local state by accidental module singleton. A future
shared authoring facility requires its own accepted contract and demonstrated
consumer.

## V3 conformance

- Server fallback is useful with JavaScript disabled.
- Mount, input update, reorder, removal, replacement, cancellation, and failure
  fixtures assert lifecycle counts and absence of leaked listeners or tasks.
- V2 navigation and action updates preserve mounted identity and local state.
- Serialization rejects functions, secrets, cycles, unsupported platform
  objects, oversized input, and unsafe markup.
- Multi-window tests cover only state whose declared home is shared across
  windows; island-local state remains local.
