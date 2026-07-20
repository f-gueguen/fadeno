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

The redirect GET is not mutation recovery and carries no action body, proof,
or mutation authority. A newer eligible navigation may cancel and supersede
it. If preservation, history ownership, transport, projection, or document
commit cannot be proved, the destination remains an ordinary native GET. A
redirect chain may likewise return to native GET. None of those paths repeats
the committed mutation.

### Ordering and atomic publication

The browser admits only the exact current operation identity, generation,
document epoch, normalized URL, sequence, cache policy, and unconsumed result
ID. Mutation and redirect-GET result IDs are consumed independently. Duplicate,
stale, delayed, permuted, cancelled, superseded, cross-document, or
cross-generation results cannot publish.

Pending state belongs only to the POST and is cleared before redirect GET
ownership begins. The current document remains authoritative until one whole
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
refusal, no repeated mutation, redacted causal flow, and current-truth recovery
in Chromium, Firefox, and WebKit. `pnpm ci:local` retains every prior native,
browser, security, package, and release gate.
