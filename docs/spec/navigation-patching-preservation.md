# Navigation, patching, and preservation

Enhanced navigation is an alternate delivery path for the same server-owned
application outcome. It does not create a second routing, action, or state
model.

## Native equivalence

1. An enhanced link targets the same URL, method, authorization context, and
   history outcome as its native navigation.
2. An enhanced form submits the same successful controls and receives the same
   validation, action, redirect, and revalidation outcome as its native form.
3. Enhancement code intercepts only when it can safely own the request. Before
   interception or after recoverable failure, the browser path remains valid.
4. A mutation whose delivery state is uncertain is never blindly repeated as a
   fallback. Recovery first determines or requests current server truth.

## Request lifecycle

- Pending state is associated with the initiating navigation or form and is
  cleared on completion, cancellation, redirect, fallback, or teardown.
- Prefetch work is cancellable and cannot acquire mutation authority.
- Superseded navigation work is cancelled when safe. A late response cannot
  overwrite a newer accepted URL or document state.
- History entries, back/forward navigation, URL state, title, focus, and scroll
  follow browser semantics defined by conformance fixtures.
- Optional navigation transitions cannot delay correctness, trap focus, or
  ignore reduced-motion preferences.

## Semantic update model

Server-derived updates identify structurally owned output rather than accepting
application selector commands. Navigation, action completion, and later live
data share render, ordering, recovery, and preservation semantics, but their
transport envelopes may differ.

ADR 0045 selects an **exact private version 1 envelope** for V2 implementation
evidence. It binds application generation, document epoch, the current
operation, normalized request URL, and sequence, a single-use result identity,
and a server-owned structural root. Document and expected-error outcomes must
match that operation URL exactly; route changes use typed redirects. It is
`no-store`, strict about unknown fields and versions,
and remains private; an external consumer still requires a separate ADR and
demonstrated compatibility evidence.

ADR 0046 accepts the package and loading direction for the later browser
runtime. A generated application browser module will statically import the
explicit `@fadeno/framework/browser` facade and may be emitted only through the
framework-owned external module-script and request-nonce path. The neutral
root and Node facade cannot reach browser code. V2-01A adds no real export or
runtime; V2-02 must demonstrate the concrete bootstrap and current packed
consumer before enhancement can claim ownership.

ADR 0047 supplies that concrete bootstrap and packed consumer. Importing the
facade has no side effect; explicit start is idempotent until close. Generated
route execution may provide one root-relative same-origin browser module, which
the renderer emits once with its existing request nonce. Wrong or missing
nonce, missing artifact, disabled JavaScript, environment refusal, and rollback
execute no enhancement and preserve native controls. This is a loading
boundary only: link/form interception and document reconciliation remain
unimplemented.

## Preservation contract

An update preserves state not owned by the server result:

- focused element, text selection, and caret;
- dirty form controls unless the accepted result explicitly resets them;
- disclosure, dialog, and popover state;
- media playback state;
- relevant document and element scroll position;
- mounted island identity, lifecycle, and local state.

Structural identity must not depend on unstable array position alone. An
intentional replacement is explicit and independently testable. A preservation
failure is correctness failure, not cosmetic variance.

ADR 0014 narrows the structural mechanism: node reuse alone does not preserve
exact numeric scroll when layout changes before the document viewport or before
content inside a scroller. ADR 0045 therefore admits an in-place update only
when both relevant document and element preceding layout are proven unaffected.
Any **affected or unknown preceding layout** refuses in-place mutation and
returns to current server truth through the native path. This restriction does
not imply that K0's or V2-01's private identity format is public. Scroll
classifications must be exact strings and are not coerced from other values.

## Ordering, errors, and recovery

1. Messages contain sufficient request and structural identity to reject stale,
   duplicate, misrouted, or unsupported results.
2. Unknown required fields, invalid identity, unsupported protocol version, and
   oversized content fail closed.
3. Redirects and expected failures have typed protocol outcomes; executable
   strings are never evaluated.
4. After protocol desynchronization, the client can recover through a normal
   request for current server truth.
5. Development diagnostics explain which resource, action, or navigation
   caused an update without exposing protected data.

ADR 0045 makes these rules exact for the private V2 boundary: only the matching
application generation, document epoch, operation ID, sequence, operation kind,
normalized operation URL, and unconsumed result may apply. Document/error URLs
must match that operation URL; typed `303`/`307`/`308`
redirects are same-origin HTTPS in deployed contexts, with same-origin HTTP
limited to trustworthy loopback development hosts; mutation redirects are
`303` and retain the native exact same-origin HTTPS and no-credentials
restriction even during loopback development. The consumer verifies `no-store`
in both its fetch mode and quote-aware parsing of observed response
`Cache-Control` metadata rather than trusting the envelope alone. Malformed,
unsupported, stale, duplicate, unsafe, cached, oversized, or over-time results
change no document state. Boundary measurements must be nonnegative safe
integers before their maxima are checked, and the measured aggregate envelope
cap still applies when an individual field is at its own cap. Recovery must
match an independently trusted current-truth URL and cannot select a route from
transported data. Navigation may return to its native request before
commit; uncertain mutation recovery performs a safe GET and **never repeats a
mutation**.

The V2-02 production byte boundary uses fatal UTF-8 decoding, checks aggregate
raw bytes before parsing, counts every JSON value as one structural record,
measures maximum depth and elapsed processing time independently, and checks
cancellation before publication. Its result contains stable decisions and
metrics only; transported markup, identity, credentials, and failure prose are
not returned. The exact encoder/decoder and envelope remain private package
internals under ADR 0047.

ADR 0048 adds the private server projection that produces those bytes. It
consumes the one native `Response` already created by the route, resource,
action, session, and renderer authorities and never executes application
behavior again. An opaque request-bound authorization owner and exact operation
authority must match the construction evidence attached to the response.
Document, expected-error, redirect, and recovery outcomes retain a separate
redacted causal record; markup and authorization identity remain absent from
that record. Missing ownership, cross-user or cross-generation input,
incomplete output, unsupported status or media type, cancellation, and limit
exhaustion produce no envelope. Request transport and interception remain
unimplemented until V2-04 and V2-06.

ADR 0049 implements V2-04's first link path. The runtime decides eligibility
before preventing native activation and admits only ordinary same-origin GET
links in the current browsing context. It refuses dirty controls, disclosure or
top-layer state, media, selection/caret, mounted client identity, scroll, and
unknown preservation boundaries both before interception and before commit.
The Node adapter binds bounded browser correlation to a fresh opaque server
owner, invokes the existing native handler once, and projects that response
once. Browser admission independently checks current generation, document
epoch, operation, sequence, URL, cache, cancellation, and result consumption.
Only then may one inert complete document or typed redirect update URL, title,
history, focus, and the next document epoch. Superseded, malformed, refused, or
failed GET work returns to native destination or current-truth navigation.
Forms and general state-preserving reconciliation remain later V2 work.

ADR 0050 selects V2-05's browser-state qualification boundary. Runtime-owned
history entries carry a private exact-version marker, the active bounded chain
identity, a bounded entry identity, and recorded document scroll state while automatic restoration is
disabled for the active runtime.
The first observed nonzero document or element scroll makes the entry
monotonically unsafe even after the viewport returns to zero or a forced final
flush runs, avoiding repeated History API writes; an eligible click
performs guarded flushes before interception and immediately before commit, and
stays native if the browser refuses either. A bounded private entry identity
allows traversal to mark the outgoing document unsafe even when its scroll event
has not yet been delivered. Initial history-acquisition failure restores native
scroll restoration.
New cross-document links may leave a document-scrolled origin without treating
the document scroller as element state, then commit the destination at the top
with focus moved without scrolling. Back/forward remains enhanced only for owned
zero-scroll entries without observed element-scroll ownership; malformed,
foreign-chain, unowned, nonzero-scroll, or element-scroll entries reload their selected current
URL. An exact supported owned entry can resume enhancement after that current-
truth reload; application-owned or malformed state cannot. Ownership also
requires a bounded active-runtime registry containing the exact created state
and URL; copied fields, repeated unobserved selection, changed state, and
registry overflow refuse. Recorded element-scroll ownership keeps later link
activation native after the live element returns to zero. Traversal scroll
suppression remains tied to the newest traversal generation. The runtime keeps
the identity of the document actually displayed separate from a merely selected
entry, changes it only after commit, and becomes fail-closed for traversal if
its bounded unsafe-identity tracker fills. A bounded chain-scoped refusal record
survives native reload when an unsafe outgoing entry could not be rewritten;
malformed or unavailable persistence refuses traversal. Scroll during pending
traversal cancels the pending response and queues the same current-truth native
recovery after a 50-millisecond supersession window. A newer traversal replaces
the queued recovery. The selected URL and exact private state
are revalidated immediately before commit. Native recovery and page departure
restore the pre-enhancement scroll-restoration mode. A destination history entry
is created before its viewport resets to the top. Non-collapsed selection
and unresolved focus/state still refuse. Native recovery guarantees current
URL and document truth but not a pixel position, and the runtime does not apply
its recorded refusal number to a fresh layout. Closing during a pending
traversal reloads the selected current URL after restoring native scroll
ownership. A newer traversal cancels its predecessor before taking an early
native path. If history selection succeeds but a later document commit step
fails, native recovery replaces the selected destination rather than appending
a duplicate entry even if local scroll rollback also fails. If the user cancels
an unsafe traversal's native reload, the active document replaces the selected
slot with a fresh private entry at the trusted displayed-document URL,
reacquires its restoration owner, and records the refusal before resuming.
No transition work is allocated in
either normal or reduced-motion mode.

## Narrowed H1 result and V2 conformance

K0-04 established cross-engine structural viability for focus/selection/caret,
dirty controls, disclosure/top-layer state, media, island identity, and declared
replacement. It did not establish layout-affecting document or element scroll.
The following V2 obligations therefore remain prospective requirements, not
claims supported by the K0 candidate.

- Chromium, Firefox, and WebKit run the complete preservation corpus for both
  navigation- and action-driven updates.
- Ordering fixtures permute, duplicate, delay, cancel, and corrupt responses.
- Native and enhanced flows end with the same URL, server data, field errors,
  and accessible document state.
- Keyboard, focus, reduced-motion, and screen-reader review accompanies
  automated accessibility checks.
- Network interruption before, during, and after a mutation demonstrates a
  non-duplicating recovery path.
