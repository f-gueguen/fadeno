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
disabled for the active runtime. Startup requires a trustworthy origin and a
secure random identity generator before claiming history.
Every actual runtime start, including a restart after close in the same
document, re-keys the selected entry with a fresh runtime session and entry
before it can enter the active registry. Same-document restarts retain prior
nonzero document and element-scroll evidence; newly loaded documents derive
that evidence from their live layout. Serialized marker fields alone are never
positive ownership proof.
The first observed nonzero document or element scroll makes the entry
monotonically unsafe even after the viewport returns to zero or a forced final
flush runs, avoiding repeated History API writes; an eligible click
performs guarded flushes before interception and immediately before commit, and
stays native if the browser refuses either. A bounded private entry identity
allows traversal to mark the outgoing document unsafe even when its scroll event
has not yet been delivered. History-wrapper installation and initial history
acquisition are guarded. Failure restores every exact original History API
function that was replaced, restores native scroll restoration, and declines
enhancement without throwing. Every acquisition of manual scroll ownership is
accepted only when the browser reads `manual` back; a silent assignment refusal
returns to native ownership.
New cross-document links may leave a document-scrolled origin without treating
the document scroller as element state, then commit the destination at the top
with focus moved without scrolling. The final postcondition checks the actual
document viewport, not merely that a scroll request was issued. Back/forward remains enhanced only for owned
zero-scroll entries without observed element-scroll ownership; malformed,
foreign-chain, unowned, nonzero-scroll, or element-scroll entries reload their selected current
URL. An exact supported owned entry can resume enhancement after that current-
truth reload; application-owned or malformed state cannot. Ownership also
requires a bounded active-runtime registry containing the exact created state
and URL; copied fields, repeated unobserved selection, changed state, and
registry overflow refuse. Runtime-guarded History API writes are distinguished
from application calls through either the instance or `History.prototype`; an
application-created exact or same-URL copy remains
application-owned across reload and explicit restart in the same document. A
recovery removes only the exact selected session, entry, and URL record, so a
second application-owned record at the same URL remains refused. Missing or
replaced selected private state retains the record and refuses enhancement; URL
equality alone never consumes it. A later loaded document may resume only after
exact recovery and fresh re-keying. Persistence reads
and writes use the same bounded 8,192-byte current-URL class; over-bound input
fails closed.
Recorded element-scroll ownership keeps later link activation native after the
live element returns to zero and is rechecked after asynchronous request work
or after document scroll was already recorded. Traversal scroll
suppression remains tied to the newest traversal generation. The runtime keeps
the identity of the document actually displayed separate from a merely selected
entry, changes it only after commit, and becomes fail-closed for traversal if
its bounded unsafe-identity tracker fills. A bounded per-session, entry, and URL
refusal record survives native reload when an unsafe outgoing entry could not be
rewritten or application code created the selected state. Current-truth reload
re-keys and clears only the exact recovered unsafe entry; malformed, unavailable,
or overflowing persistence refuses traversal. Scroll during pending
traversal cancels the pending response and queues the same current-truth native
recovery after a 50-millisecond supersession window. Delayed recovery retains
traversal ownership until it runs or a newer activation supersedes it. A newer
traversal replaces the queued recovery. Both link and traversal work capture
their source URL, exact private state, and active ownership; all three are
revalidated immediately before commit. A forced scroll flush is followed by a
fresh source-state read, and rollback focus plus collapsed-selection endpoints
are derived from the same precommit document shape that rollback retains. Native recovery and page departure
restore the pre-enhancement scroll-restoration mode. A destination history entry
is created before its viewport resets to the top. Non-collapsed selection
and unresolved focus/state still refuse. Native recovery guarantees current
URL and document truth but not a pixel position, and the runtime does not apply
its recorded refusal number to a fresh layout. Closing during a pending
traversal reloads the selected current URL after restoring native scroll
ownership. Cancellation repairs the selected slot to displayed truth before
teardown completes and the closed runtime leaves subsequent activation native.
Closing during an ordinary pending link aborts that request before teardown
completes. A close that is still repairing traversal or commit ownership remains
the active public owner until cleanup finishes, so immediate restart cannot
install a second runtime.
A newer traversal cancels its predecessor before taking an early native path.
A refused same-context link or still-native same-context form aborts any pending
enhanced request; when that request is a traversal, selected truth is repaired
before native activation continues. Form submission is observed for
supersession only, not intercepted. A newer eligible link supersedes an
ordinary pending link and stays enhanced; only a refused activation remains
native.
If history selection succeeds but a later document, focus, metadata, scroll, final
history-provenance, or runtime-lifecycle check fails, document and history postconditions roll back
together. Document rollback reinserts the actual precommit nodes and restores
the exact previously focused node and collapsed selection when they still exist, preserving their identity,
listeners, and application-owned properties. A newly pushed selection is rolled back before native navigation
reselects it, including additional synchronous application pushes during the
failed commit. Additional pushes made after traversal selection are removed
before native replacement of that selected entry, so no duplicate
entry is appended even if local scroll rollback also fails. If the user cancels
an unsafe traversal's native reload, the active document replaces the selected
slot with a fresh private entry at the trusted displayed-document URL,
reacquires its restoration owner, and records the refusal before resuming.
Both `preventDefault()` and legacy non-empty `returnValue` confirmation are
observed. A canceled replacement after a post-selection commit failure receives
the same repair. A canceled preselection fallback also repairs the current
entry and reacquires manual restoration before enhancement resumes.
No transition work is allocated in
either normal or reduced-motion mode.

ADR 0051 adds V2-06's conservative form boundary. GET forms use the platform
successful-control set to construct a navigation URL and have no mutation
authority. Protected POST enhancement admits only exact same-origin HTTPS
generated action endpoints with URL-encoded or multipart bodies. The exact
incoming request still passes once through ADR 0035's native action, proof,
replay, authorization, session, redirect, and revalidation owner before its
single response is projected.

Dirty and focused controls inside the submitted form may belong to that
submission; dirty controls outside it and every still-unqualified preservation
boundary remain native. The exact submitted form receives bounded busy state,
restored on every terminal path. Once a POST request begins, any cancellation,
transport ambiguity, projection refusal, close, or commit failure reloads the
trusted pre-submit current truth with GET and never resubmits the mutation.
An admitted action redirect first consumes the mutation result, clears its
pending owner, and releases the mutation operation. A fresh cancellable GET
operation with a newer sequence then owns the redirect destination through the
same document, history, focus, scroll, and stale-result checks as an eligible
link. Handoff bounds control count, aggregate records, and UTF-8 bytes before
serializing any control value; over-limit evidence refuses private destination
publication and refreshes current truth without issuing an unobservable
destination GET. An admitted handoff freezes the submitted controls, selected `File` identities,
active element, and a focused text control's caret/selection range and
direction; a later edit, file/control replacement, focus change, or selection
change refuses private publication. Pending cleanup is one-shot and cannot
clear a newer submission's busy state. A newer eligible navigation supersedes that GET while
inheriting committed-current-truth recovery until a replacement document or
native departure commits. An observable ineligible same-context
cross-document activation is refused while it remains cancelable; current
truth recovers before any native request, and no elapsed-time threshold infers
completion. A selected same-document
fragment, whether selected by a link or native GET form, instead reloads the
fragment-bearing destination as a fresh document. Native fragment
supersession stages a new history entry, including for a same-hash activation,
and an empty fragment delimiter follows the same rule even though its parsed
`hash` string is empty, so Back preserves the preceding entry. Native GET-form supersession derives
its URL from one platform successful-control construction and does not trigger
a second `formdata` event. The final link destination, browsing context,
download ownership, and privacy directives are read again after document
listeners. Explicit referrer-policy and `noreferrer` activations, including
external-context forms, retain browser ownership and are not converted into
forced reloads. An activation that selects another browsing context, including
modified-primary and middle-button activation, preserves browser ownership
while committed current truth recovers in the opener. A trusted click already cancelled before the
runtime document listener cancels obsolete redirect work and begins the same
current-truth recovery.
A preinstalled window finalizer observes final document-listener edits before
it constructs a native GET destination. It validates origin, credentials,
protocol, method, target, trust, and request-privacy eligibility before any
`FormData` construction; only then may it construct successful controls once
and prevent the still-cancelable native default. If a `formdata` listener
makes the final private route ineligible during that construction, the runtime
refuses the activation rather than returning to a native default that would
construct successful controls again. If propagation was already
stopped when the runtime observes a same-context form, the runtime refuses it
without serialization. If a later listener stops propagation and the browser
selects a same-document fragment, the post-dispatch path retains the browser's
one successful-control object, accepts an image submitter from that native
entry list, derives the destination after all `formdata` listeners, stops
observation before a later microtask serialization, and never stages a second
history entry. If the observed object produces no safe destination, the
runtime does not construct another `FormData` as a fallback. A listener-hidden cross-document activation remains
browser-owned without a private freshness claim. A final `dialog` method that cannot depart
recovers current truth, while a listener change from `dialog` to GET follows
the final native destination. A submission that reaches the window finalizer already
cancelled by a later document listener recovers immediately rather than waiting
for a departure that cannot happen. A submission already cancelled before the
runtime document listener follows the same recovery path. If the final target
selects a separate browsing context, that destination remains browser-owned
while the current document recovers committed truth. Policy-owned activation aborts obsolete
private work without installing a forced recovery navigation.
A redirect GET result is consumed before a further redirect returns to native
ownership. When that further redirect selects a fragment on the still-displayed
current resource, it also reloads one fresh native document. A history
traversal retains committed-mutation recovery through selected-URL repair and
unsafe-entry native recovery; cancellation repairs the displayed URL before
current-truth GET begins. If an application history hook commits the exact
staged push and then throws, the selected URL, private state identity, and
history-length change prove that the entry exists, so cancelled recovery rolls
it back instead of treating the push as uncommitted.
Handoff comparison includes each control's exact bounded parent ancestry,
control attributes, effective disabled state from
the control and its owning `fieldset`, form association, select-option
structure, exact option identity, and option disabled state inherited from an
`optgroup`, plus exact optgroup parent identity and option hierarchy, as well as
values, files, focus, and selection. The same frozen comparison remains the
publication predicate for an interrupted-departure current-truth GET.
Transport, projection, preservation, or document-commit failure returns to
native GET, while a cancelled native departure reloads committed current truth
through GET without repeating POST. A fragment redirect on the current
resource bypasses private GET and performs one real native destination reload;
that reload starts synchronously after URL staging. If history staging fails,
the native handoff first selects the intended fragment destination; a cancelled
reload repairs displayed truth before recovery. If application-owned history
state prevents that repair, native replacement immediately returns to current
truth rather than beginning private recovery against the staged URL. V2-08 owns broader structural
preservation. If synchronous teardown occurs inside the fragment reload's
cancelled `beforeunload`, recovery ownership remains live and the runtime
resumes current-truth recovery. If private scroll ownership cannot be
reacquired, native current-truth replacement starts before runtime teardown.
A GET form that inherits committed-mutation
recovery also carries it through selected-push rollback and a cancelled native
replacement. Cancellation of a pushed-fragment replacement traverses back
before current-truth recovery only when the push committed; a failed push
repairs the current entry directly. After a committed push, the next Back
reaches the preceding page rather than a duplicate same-URL entry. If submit propagation stops before the window
finalizer and a later document listener prevents departure, post-dispatch
observation recovers current truth without serializing successful controls. A
submission cancelled by a later document listener after it reaches the window
finalizer recovers through the same no-serialization path. Finalization
resolves the effective form and submitter target after document listeners,
including a late change into the current browsing context or a separate
browsing context, and re-reads link
destination, target, download, and privacy state. Every explicit anchor
referrer policy or `noreferrer` directive remains browser-owned for both
same-document and cross-document destinations.

Every current-truth recovery GET retains the committed-mutation recovery owner.
If a newer activation supersedes that GET and is then cancelled, the newer
operation starts current-truth recovery again; obsolete completion cannot clear
or publish over that recovery owner.

A selected-push rollback is itself pending owned work. Its exact traversal
identity and recovery operation remain current until the matching `popstate`.
A newer activation may supersede that owner; the delayed rollback then observes
the newer operation and cannot replace its destination with obsolete current
truth. When a bounded handoff cannot be captured, current truth is refreshed
directly and the redirect destination is not requested, because a `204`,
attachment, or other no-document response offers no native completion event
with which to discharge committed-mutation recovery.

Same-context activation is resolved against the current window, including
`_parent`, `_top`, and its current name. Explicit anchor referrer-policy and
`noreferrer` directives remain native. A traversal performs one final live
document/element-scroll refusal without writing into the selected destination;
only the actual document scroller is excluded from element ownership. History
installation restores exact original instance and prototype property
descriptors, and wrapper/write-sequence provenance detects a native prototype
push even when it cannot be inferred from history length, so it cannot
reuse a registered state as framework ownership. Repair carries monotonic
unsafe-scroll evidence to the fresh repaired entry. Failure to read back manual
restoration on a persisted page closes enhancement before another traversal.

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
- GET form cases prove exact URL/history and absence of mutation authority;
  POST cases prove exact successful controls, origin/authorization/replay
  ownership, pending cleanup, and current-truth recovery without resubmission.
