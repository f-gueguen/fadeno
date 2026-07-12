# ADR 0029: Streaming lifecycle and boundary ownership

- Status: Accepted
- Date: 2026-07-12
- Owners: Fadeno maintainers
- Related specifications: [Routing, rendering, streaming, and failures](../spec/routing-rendering-streaming.md), [Streaming threat model](../security/streaming-threat-model.md)
- Supersedes: None

## Context

The Node adapter already transports a standard `Response` body with Web Stream
backpressure and cancels it on disconnect. V1 still needs one renderer-owned
lifecycle before a JSX renderer can safely choose status and headers, stream
bytes, recover a local failure, or abandon work.

Response publication and first body output are different events. Once the
handler returns a `Response`, the adapter owns its status and headers even if no
body byte has been read. Treating the first byte as the only commit point would
allow the renderer to claim a status change that the Web boundary cannot make.

Visible pending replacement is also incompatible with the no-JavaScript V1
baseline: HTML already parsed by the browser cannot later be replaced without
a client mechanism. V1 therefore needs deterministic in-order streaming rather
than a hidden client patch protocol.

## Decision drivers

- Status and header behavior must match the actual `Response`/adapter boundary.
- Links, forms, error pages, and completed documents work without JavaScript.
- A local failure never corrupts already emitted HTML or claims a false status.
- Backpressure, cancellation, and cleanup have executable bounded behavior.
- The contract remains private until V1-09 demonstrates a renderer consumer.

## Decision

One request has one root response owner. Its monotonic phases are:

1. **uncommitted** — the handler still owns the outcome and no `Response` has
   been returned;
2. **head-published** — one immutable status/header snapshot has been returned
   to the adapter, but no non-empty body chunk has been accepted;
3. **body-started** — at least one non-empty body chunk has been accepted;
4. **completed**, **terminated**, or **cancelled** — one terminal state.

Head publication is the single response commit point. It occurs at most once.
The first body byte is recorded separately and cannot reopen status or headers.
Header mutation, replacement responses, redirects, and not-found selection are
refused after head publication.

Before commitment, route-level not-found selects 404, a separately validated
redirect selects its 3xx response, an unexpected failure selects a safe 500,
and a root deadline selects a safe 504. Disconnect, explicit cancellation, and
supersession abandon the response instead of manufacturing a replacement for a
request no longer owned. Incident identity and safe error markup are V1-09
renderer inputs; original error objects never enter public chunks.

After commitment, root failure, late redirect/not-found control flow, write
failure, or root timeout keeps the committed head and terminates the body. The
failure is projected through the secret-safe diagnostic source from ADR 0028.
Reporter failure is observed and discarded; it cannot recurse, replace the
primary failure, or prevent cleanup.

A local boundary owns a contiguous, in-order document slot. Content before an
unresolved boundary may flush, but the boundary and later siblings wait. V1
does not emit a client-visible pending placeholder. A failure or child deadline
may render the nearest active boundary fallback only while that boundary has
emitted no bytes. If the fallback fails, ownership escalates to the nearest
active, still-unemitted parent. If no such owner exists, or any affected
boundary already emitted bytes, the root body terminates. Redirect and
not-found remain route control flow and are never converted into local markup
after commitment.

Every child deadline is an absolute deadline no later than its parent's. A
child may narrow but never reset or extend inherited time. The framework owns
one timer per active deadline and clears it exactly once. The first accepted
cancellation reason wins. Parent cancellation cascades to every descendant;
child timeout cancels only that child subtree unless fallback escalation fails.
Late settlements after cancellation are observed and ignored.

Framework-owned timers, stream readers, sink listeners, and boundary records
are released exactly once on every terminal path. Abort signals are propagated
to application work. The framework does not claim it can forcibly stop
application code that ignores cancellation; it does guarantee that such late
work cannot emit chunks, mutate the committed head, or remain referenced by the
framework owner.

Output is pull/backpressure driven. At most one non-empty encoded chunk is
pending acceptance. The next producer step does not run until the sink accepts
the previous chunk. Empty chunks neither start the body nor create output.
Sink rejection terminates the root and cancels owned work.

The final response outcome is selected before allocating a nonce. For an HTML
response with framework executable markup, one nonce is allocated immediately
before head publication and frozen into both the CSP header plan and markup
authority. Redirects and bodyless outcomes allocate none. Neither headers nor
nonce identity can change after publication. V1-08 freezes correlation and
timing data; V1-09 owns actual header construction, emitted markup, adapter
integration, and browser enforcement.

The V1-08 state machine, schema, and corpus are private package internals. They
introduce no public renderer, boundary, response, context, stream, chunk,
timeout, cancellation, failure, incident, or nonce API.

## Alternatives considered

- Commit on first body byte: rejected because returning `Response` already
  gives status and header ownership to the adapter.
- Out-of-order pending replacement: rejected because it needs a client patch
  mechanism and breaks the no-JavaScript baseline.
- Buffer the whole document: rejected because it defeats the accepted
  streaming and backpressure direction.
- Recover after partial boundary bytes: rejected because arbitrary HTML parser
  state cannot be rolled back safely.
- Force-stop application promises: rejected because JavaScript cancellation is
  cooperative; ownership isolation is the enforceable guarantee.

## Consequences

- V1-09 can implement one renderer against a closed lifecycle and unchanged
  fixture corpus.
- No-JavaScript V1 streams completed boundary slots in source order and does
  not expose a visible loading fallback.
- Post-commit root failures can produce truncated transport, but never a false
  replacement status or secret-bearing error fragment.
- The existing adapter remains unchanged; force-close and adapter shutdown
  deadlines remain outside this slice.
- The package is private; release impact and Changeset are none.
- Rollback removes this ADR, private lifecycle code and corpus, restores the
  streaming decision gate, and leaves V1-09 blocked.

## Validation

`pnpm check:v1-streaming-lifecycle` validates a versioned exhaustive corpus for
one-time head publication, separate first-byte state, empty chunks, ordered
boundaries, nested fallback escalation, every pre/post-commit outcome,
inherited deadlines, timeout/disconnect/explicit/superseded cancellation,
write rejection, slow-sink backpressure, late settlements, throwing reporters,
nonce/header timing, and exactly-once framework cleanup.
