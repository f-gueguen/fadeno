# ADR 0052: Enhanced action outcome ordering

- Status: Accepted
- Date: 2026-07-21
- Owners: Fadeno maintainers
- Related specifications: [Forms, actions, redirects, cookies, and sessions](../spec/forms-actions-sessions.md), [Navigation and patching](../spec/navigation-patching-preservation.md), [Progressive enhancement](../spec/progressive-enhancement.md), [Security requirements](../security/requirements.md)
- Supersedes: None

## Context

ADR 0051 permits one eligible protected POST to use the private update
transport, but deliberately hands an accepted action redirect back to native
GET navigation. V2-07 must complete redirect, revalidation, expected-error,
late-result, and authenticated CRUD ordering without creating a second action,
resource, router, history, or recovery owner.

The mutation may have committed before the browser can use its response. A
redirect destination is nevertheless a separate safe GET. Those two facts
require an explicit ownership handoff: the browser must never treat the GET as
a retry of the POST, and a delayed mutation or destination result must never
overwrite newer accepted work.

## Decision drivers

- Invoke the accepted action, authorization, replay, session, redirect, and
  complete revalidation path exactly once.
- Consume a mutation result before another operation can own the document.
- Follow an admitted action redirect through a fresh cancellable GET without
  repeating or reconstructing the POST.
- Preserve expected validation, current-truth recovery, and complete rendered
  documents as atomic server-owned outcomes.
- Refuse or recover through native GET whenever pre-V2-08 preservation cannot
  be proved.
- Keep ordering evidence bounded, redacted, private, and derived from actual
  operations rather than application values or diagnostic prose.

## Decision

### Server outcome order

The generated action endpoint remains the only mutation entrypoint. It accepts
method, media type, exact origin, route binding, generation, session, proof,
replay, decoded fields and files, authorization, and resource limits before
application mutation. Session publication follows the accepted action result.

Success and changed expected failure perform complete revalidation through the
existing page/resource owners. Unchanged expected failure renders the
structured field and form correction without claiming changed state. Before a
successful action redirect is returned, complete revalidation of current
server truth finishes or the action returns the accepted failure outcome. No
browser result can bypass or repeat this sequence.

### Browser operation handoff

An eligible POST owns one mutation operation from request start until one
private response is admitted, recovery is selected, or the operation is
interrupted. A document or expected-error result commits atomically at the
GET-callable current-truth URL. A recovery result or any uncertain committed
POST outcome reloads current truth through GET and never submits POST again.

For an admitted action redirect, the browser first records and consumes the
mutation result ID, clears the submitted form's pending state, and releases the
mutation operation. It then creates a new navigation operation with a fresh
opaque ID and monotonically newer sequence for the same-origin redirect
destination. That operation performs GET through the existing route/resource
projection and the same document, history, focus, scroll, cancellation, and
stale-result admission used by enhanced links.

The handoff first bounds the number of controls, aggregate records, and UTF-8
bytes that could be copied. An over-limit handoff refuses private destination
publication before serializing control state. It refreshes current truth
through GET without issuing the redirect destination: a native destination
that returns no document provides no completion signal with which to retain
committed-mutation recovery safely. This is an explicit conservative refusal;
the action is not repeated and the page cannot retain stale pre-mutation
markup. An admitted handoff then freezes the submitted form controls, their
exact bounded parent ancestry, their sorted attributes and
effective disabled state (including disabled `fieldset` inheritance),
select-option structure, exact option and optgroup parent identities and
hierarchy, and effective disabled state
(including disabled `optgroup` inheritance), selected `File` object identities,
active element, and a focused text control's caret/selection range and direction
after the mutation result is admitted. Any later value or structural edit,
inherited disabled-state change, file/control/option replacement,
form-association change, focus change, or caret/selection change refuses private
destination publication and returns to native GET. A newer eligible
GET that supersedes the redirect GET inherits committed-mutation recovery
ownership until a replacement document or native departure commits. An
interrupted-departure current-truth GET retains the same frozen handoff
predicate; a later submitted-control edit therefore refuses private recovery
publication and selects native current truth. A recovery GET retains the
committed-mutation recovery owner itself, so a newer cancelled activation may
supersede that GET and start a newer current-truth GET rather than stranding
stale markup. A history traversal that returns to native behavior observes
cancellation with the same recovery owner, including when a
cancelled traversal first has to repair its selected URL to the displayed
document. A same-document native link or GET-form supersession uses the same
fresh fragment-bearing native reload. The activation receives a new history
entry, including a same-hash activation, so Back still reaches the prior
fragment-free entry. If an application history hook commits that exact private
push and then throws, observable URL, state identity, and history-length
evidence keep rollback ownership instead of treating the push as uncommitted.
Successful staging also requires the selected private state, URL, history
length, and push-write sequence to match the exact requested replacement or
push. A hook cannot substitute state or change the write kind and have that
entry claimed as framework-owned.
A preinstalled window finalizer decides recovery takeover
while the activation is still cancelable and after document submit listeners
have finished. It revalidates the final GET action, method, target (including a
late change into either the current context or a separate browsing context), origin,
credentials, trust boundary, and request-privacy policy before constructing
`FormData(form, submitter)`. Native observation accepts an image submitter only
when the browser supplies its successful-control entry list; private form
eligibility remains conservative. For an admitted takeover, that recovery preflight
constructs successful controls once and then prevents the original native
default before the browser can serialize them again. If a `formdata` listener
makes the final private route ineligible during that construction, the
activation is refused instead of returning to a native default that would
serialize the controls a second time. A later submit-listener
edit is therefore included without a second `formdata` event. If propagation
does not reach the finalizer, no elapsed-time threshold infers that a native
departure finished. If propagation was already stopped when the runtime
observes a same-context form, it refuses the activation while it is still
cancelable and recovers current truth without serializing controls. If a later
listener stops propagation after runtime observation and the browser selects a
same-document fragment, the post-dispatch observer freezes each safe GET
routing selection before later listener microtasks, derives the corresponding
query from the supplied entry list, and retains at most sixteen distinct
destination candidates. Recovery accepts the candidate whose complete URL
matches the browser-selected entry; a later unrelated `FormData` snapshot,
candidate overflow, or ambiguity cannot replace it and instead recovers
current truth. The same-document decision compares that exact destination with
the trusted source path and query rather than assuming every HTTP GET creates
a replacement document. Recovery never reconstructs successful controls merely
because no candidate is admissible.
A listener-hidden cross-document activation stays
browser-owned because its response outcome is not observable to the current
document; no private recovery or freshness claim is made for that unsupported
handoff. A submission that reaches the window finalizer after a later document
listener cancelled it, or is already cancelled before the runtime document
listener observes it, recovers immediately. A `dialog` method
is also re-read after document listeners: a submission that remains
dialog-owned recovers the current document without navigation, while a final
GET method follows its final native destination. A late final
target in a separate browsing context remains a browser-owned destination while
the current document independently recovers committed current truth. Link finalization
re-reads destination, target, download, and privacy state after document
listeners; an activation that initially or finally selects another browsing
context preserves browser ownership while current truth recovers in the
opener. Modified-primary and middle-button activations follow the same
separate-context rule. A trusted click already cancelled before the runtime document listener
also supersedes obsolete redirect work and recovers current truth. An explicit anchor referrer
policy or link/form `noreferrer` directive, including an external-context form,
aborts the obsolete private
operation for same-document and cross-document destinations, stays entirely
browser-owned, and is never converted into a forced reload. That ownership is recovery provenance only; it
carries no mutation request or authority into the newer GET.

While committed-mutation recovery ownership is live, a same-context
cross-document link or form that reaches the finalizer but cannot be enhanced
safely is refused before its request starts. The current document recovers
committed truth and the user may retry from the fresh document. A native
response that creates no document exposes neither a completion event nor a
status to the old document, so a timeout would race a slow GET or POST.
Separate-context and explicit request-privacy activations remain browser-owned.
No native-departure timeout is evidence of completion.

The redirect GET is not mutation recovery and carries no action body, proof,
or mutation authority. A newer eligible navigation may cancel and supersede
it. If preservation, history ownership, transport, projection, or document
commit cannot be proved, the destination remains an ordinary native GET. A
redirect chain may likewise return to native GET. If that chain selects a
fragment on the still-displayed current resource, it uses the same fresh native
document reload as a direct fragment outcome rather than retaining stale
markup. None of those paths repeats the committed mutation.

Because URL fragments are not part of an HTTP request, an action redirect to a
fragment on the current resource does not issue a private GET whose result
could be confused with the fragment-bearing destination. It stages the
fragment URL in the current history entry and performs one real native reload
instead. A cancelled reload repairs the displayed-truth URL before
current-truth recovery begins. Reload starts synchronously after staging, so
pending-state observers or teardown cannot close enhancement in an intervening
stale-markup window. Recovery ownership remains live until departure commits;
if teardown runs synchronously inside `beforeunload` and the user cancels, the
same runtime resumes and fetches current truth. If the runtime cannot reacquire
private scroll ownership after that cancellation, it starts a native
current-truth replacement before teardown instead of closing over stale
markup. The same rule applies when a persisted page resumes while a committed
mutation recovery timer or GET owns freshness: failed history-method
reacquisition aborts the obsolete result and starts native current-truth
replacement before teardown. If a GET form staged a pushed
fragment entry successfully, cancellation first traverses back to the source entry, then
recovers current truth, so Back still reaches the preceding page rather than a
duplicate same-URL entry. Completion requires the exact requested source entry
and URL; an unrelated selected entry reloads natively instead of continuing
rollback recovery from the wrong record. If the rollback traversal call throws
synchronously, the pending rollback owner is cleared and native current-truth
replacement starts rather than waiting for a `popstate` that cannot arrive. A
failed push created no entry, so cancellation
repairs the current slot directly and never traverses to the preceding page.
If that repair itself fails, the browser immediately replaces the staged URL
with native current truth; private recovery never proceeds against a URL that
could not be repaired.
An explicit empty fragment delimiter is still a fragment selection even though
the URL API exposes its `hash` value as an empty string; it follows the same
fresh native-document rule.

### Ordering and atomic publication

The browser admits only the exact current operation identity, generation,
document epoch, normalized URL, sequence, cache policy, and unconsumed result
ID. Mutation and redirect-GET result IDs are consumed independently. Duplicate,
stale, delayed, permuted, cancelled, superseded, cross-document, or
cross-generation results cannot publish.

An admitted redirect-GET result is consumed before its own redirect chain is
handed to native navigation. Native handoff therefore cannot leave an admitted
result ID reusable by a later correctly bound operation.

Pending state belongs only to the POST and is cleared once before redirect GET
ownership begins. That old cleanup is idempotent, so it cannot clear the busy
state of a newer submission started while the redirect GET is pending. The
current document remains authoritative until one whole
destination document commits. URL, title, history, focus, scroll metadata, and
the rendered document publish together or roll back to native/current-truth
recovery. No partial resource or action state is applied in the browser.

### Evidence and compatibility boundary

The canonical packed application qualifies sign-in plus create, read, update,
delete, validation, redirect, revalidation, duplicate suppression, delayed
permutations, interruption, and recovery in native and enhanced modes. Flow
records name operation phases, owners, skipped mutation retry, and observable
outcome while excluding submitted values, files, proofs, cookies, sessions,
markup, and URL query data.

This adds no public action API, public protocol, public analyzer schema, or
stable flow schema. The existing `./browser` facade remains the only public
browser entrypoint. Structural reconciliation remains V2-08; this decision
only enhances boundaries already proven safe or returns them to native GET.

## Alternatives considered

- Follow the action redirect with native navigation only: retained as the safe
  fallback, but rejected as the complete V2-07 path because an admitted safe
  destination can use the existing cancellable GET owner.
- Reuse the mutation operation for the destination GET: rejected because the
  POST result and GET result have different request, URL, cancellation, and
  replay semantics.
- Return the redirect destination document from the action response: rejected
  because it would combine the action's current-truth revalidation with a
  second route outcome and blur request provenance.
- Retry the POST when redirect GET fails: rejected because the mutation and its
  proof may already have committed.
- Add optimistic client mutation state: rejected because optimistic authoring
  and rollback remain deferred.

## Consequences

- Eligible action redirects remain on the optional enhanced path through a
  separate GET when current ownership is safe.
- The same native action and resource owners still decide every application
  outcome, and JavaScript-disabled forms remain complete.
- Unsafe or uncertain redirect destinations may perform an extra harmless GET
  before native fallback; they never perform another mutation.
- The public browser behavior grows additively during prerelease, so exactly
  one pending minor Changeset records V2-07.
- V2-07A owns evaluator-facing integration; V2-08 still owns structural
  reconciliation.

## Validation

`pnpm check:v2-action-ordering` uses the current packed framework and canonical
application scenario to prove enhanced and native authenticated CRUD,
validation/correction, redirect GET handoff, complete revalidation, delayed and
permuted result suppression, cancellation/supersession, unsafe-boundary
refusal, post-handoff edit, caret/selection, and file-identity refusal, pending
owner isolation, enhanced and native
supersession recovery, recovery when native activation remains in the current
document, pre-request refusal for observable unenhanceable same-context
departures without elapsed-time inference, separate-context middle-button
ownership, teardown-safe same-resource fragment reload with history-stage
failure preservation and synchronous cancelled-close recovery, redirect-chain
fragment reload, selected and unsafe traversal cancellation recovery, inherited
GET-form push rollback, same- and same-hash native GET-form supersession with
one successful-control construction and native history preservation,
referrer-policy refusal,
redirect-result consumption, explicit empty-fragment delimiter preservation,
final separate-context target recovery, initially external and already-cancelled
link recovery, external-context `noreferrer` ownership, cancellation observed before the
runtime submit listener, stopped-submit refusal or safe fragment observation,
image-submitter and final-`formdata` retention, bounded handoff-snapshot
refusal, bounded post-dispatch destination selection, persisted-page recovery
reacquisition failure, synchronous rollback-traversal failure, dialog method
revalidation, control-ancestry refusal, failed
history-repair native replacement, recovery-GET supersession continuity, no
repeated mutation, redacted causal flow, and
current-truth recovery in Chromium, Firefox, and WebKit. `pnpm ci:local`
retains every prior native, browser, security, package, and release gate.
