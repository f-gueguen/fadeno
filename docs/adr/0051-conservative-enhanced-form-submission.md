# ADR 0051: Conservative enhanced form submission

- Status: Accepted
- Date: 2026-07-20
- Owners: Fadeno maintainers
- Related specifications: [Forms, actions, redirects, cookies, and sessions](../spec/forms-actions-sessions.md), [Navigation and patching](../spec/navigation-patching-preservation.md), [Progressive enhancement](../spec/progressive-enhancement.md), [Security requirements](../security/requirements.md)
- Supersedes: None

## Context

ADRs 0035 and 0048 already provide one secure native action authority and one
private projection of the response that authority produced. ADRs 0049 and 0050
provide conservative browser request, document, history, focus, scroll,
cancellation, and recovery ownership for links. Forms still remain native.

V2-06 must connect forms to those existing owners without introducing an
alternate action endpoint, decoder, authorization callback, proof, replay
ledger, session path, redirect policy, renderer, or mutation recovery request.
It must also distinguish GET forms, which are navigations, from POST actions,
which may have committed even when the browser receives no usable response.

## Decision drivers

- Submit exactly the successful controls the browser would submit, including
  the initiating submitter, without maintaining a second field model.
- Keep GET forms free of mutation authority.
- Preserve ADR 0035's exact origin, proof, replay, authorization, upload,
  session, redirect, and revalidation ordering for protected POST actions.
- Decide eligibility before preventing an ordinary native submission.
- Give one submitted form bounded pending ownership and clear it on every
  terminal path.
- Never repeat a POST after its delivery becomes uncertain.
- Keep unsupported targets, encodings, controls, and preservation boundaries
  native.

## Decision

### Eligibility and successful controls

The explicit browser runtime observes trusted, uncancelled `submit` events.
It considers only a connected HTML form whose effective target is the current
browsing context, whose effective method is GET or POST, and whose effective
action is an uncredentialed same-origin URL without a fragment. A dialog form,
image submitter, unsupported method or encoding, other browsing context,
hostile URL, invalid submitter, or already-owned mutation remains native or is
refused without starting another request.
An explicit `noreferrer` form remains native so enhancement cannot add request
referrer data that the platform submission would omit.

The runtime derives effective action, method, target, and encoding from the
actual form and submitter properties. It constructs exactly one platform
`FormData(form, submitter)` after every non-value eligibility check succeeds.
That platform object owns successful-control selection, disabled controls,
checkbox/radio inclusion, selected options, direction fields, files, and the
submitter value. Applications do not receive a second form declaration or
client serializer.

For GET, each string value is encoded through `URLSearchParams`; a file
contributes its filename as native GET form encoding does. The form data
replaces the action URL query and the resulting request remains a navigation
with no action, proof-consumption, authorization, replay, or mutation owner.
URL-encoded names, string values, and filenames normalize line breaks to CRLF
before encoding, matching native form serialization.

For POST, enhancement admits only an exact HTTPS action URL under the generated
`/.fadeno/actions/v1/` owner and only URL-encoded or multipart form encoding.
URL-encoded bodies are produced from the successful controls, with a file
value represented by its filename; multipart uses the platform `FormData`
body. The server still applies all accepted body, field, file, name, count,
type, byte, and duration limits. Plain-text and non-generated POST forms remain
native.

### Preservation and pending ownership

Before interception, the runtime applies ADR 0050's current history and scroll
ownership checks and a form-specific preservation predicate. Dirty and focused
controls whose actual `form` owner is the submitted form are the submitted
state and may be owned by that operation. DOM containment does not grant that
ownership. Dirty controls owned by another or no form, open disclosure or top-layer state,
active media, non-collapsed document selection, mounted client identity,
content editing, unresolved focus, and element scroll remain native. The same
predicate runs again before document commit.

After successful-control construction, the runtime prevents the native event,
creates one operation, and sets `aria-busy="true"` on that exact form. It
restores the form's prior attribute on success, expected failure, redirect,
refusal, cancellation, native recovery, teardown, and failed commit. A second
same-context submission while a mutation owns the document is prevented and
sends no request. This is duplicate suppression only; ADR 0035's server replay
ledger remains authoritative.

GET submissions use navigation cancellation and newest-only publication. Once
a POST fetch begins, the operation is mutation-committed for recovery purposes.
It is not superseded by another enhanced operation. Runtime close, request
abort, malformed response, transport failure, projection refusal, or commit
failure after that point clears pending state and reloads the independently
trusted pre-submit current-truth URL with GET. It never invokes, reconstructs,
or resubmits the form POST; recovery never repeats the mutation.
If Back selects a same-document entry while the mutation is pending, recovery
first returns to the original mutation entry and then reads current truth; it
does not replace or erase the selected Back entry. If a committed mutation's
native redirect or recovery departure is cancelled, a bounded enhanced GET
repairs the stale document when form-preservation ownership still holds and
otherwise retains native GET recovery.

### Server and response ownership

The private update transport derives operation kind from the HTTP method. GET
remains `navigation`; POST becomes `mutation` only after exact request schema
and exact `Origin` equality are accepted. The transport binds the operation to
the exact incoming `Request`, invokes the existing handler/action wrapper once,
and projects that one native response once. Correlation headers carry no
authorization, action identity, proof, session, or submitted value.
The current-truth URL is percent-encoded as one bounded header value before
transport and decoded before same-origin URL validation. This preserves legal
URL commas without confusing them with a combined header value.

The existing action runtime still verifies method, media type, origin, route,
generation, session, proof, replay, successful controls, limits,
authorization, mutation, session publication, redirect, and revalidation in
its accepted order. Browser admission does not imply action authorization.

An admitted GET document follows the existing navigation commit. An admitted
POST document or expected validation response commits the returned complete
document at the GET-callable pre-submit current-truth URL rather than the
generated POST-only action endpoint. An admitted action redirect
performs its same-origin GET destination navigation and never repeats POST.
V2-07 may later enhance that redirect and complete broader action ordering; it
cannot weaken this non-repetition rule. A recovery outcome reloads the trusted
pre-submit current truth.

Private form flow records contain stable codes, operation kind, ownership,
causes, skipped work, redaction, and observable outcome. They contain no
control values, filenames, file bytes, action proof, cookies, session identity,
markup, URL query, authorization owner, or arbitrary failure prose. The public
browser facade and private protocol shape do not change.
Applied redirects, server-selected recovery, cancelled committed departures,
and ordinary document outcomes each record a terminal form flow before their
ownership leaves the current document.

## Alternatives considered

- Serialize fields from framework declarations in the browser: rejected
  because the platform successful-control algorithm and the native form are
  the authority.
- Intercept every POST and let the action server reject it: rejected because a
  non-generated or unsupported native form should not lose browser behavior.
- Retry POST after a network failure: rejected because the server may already
  have committed the mutation and consumed its proof.
- Disable controls while pending: rejected because it changes their submitted
  meaning and can hide values from application inspection. The form receives
  bounded busy state without altering successful controls.
- Add optimistic application hooks: rejected because optimistic authoring and
  rollback remain deferred.

## Consequences

- Eligible GET forms and protected POST actions gain optional enhanced
  delivery while the same native forms remain complete without JavaScript.
- Form enhancement is conservative; unsupported or preservation-unsafe cases
  remain native, and uncertain mutations recover through GET current truth.
- The public browser entrypoint gains additive prerelease behavior without a
  new export or public protocol. Exactly one pending minor Changeset records
  that behavior.
- V2-07 remains responsible for complete enhanced action redirect,
  revalidation, late-response, and authenticated CRUD ordering qualification.
- V2-08 remains responsible for general structural preservation.

## Validation

`pnpm check:v2-form-submission` uses a current packed framework and the
canonical application to prove native/enhanced GET encoding, URL, history, and
no-mutation authority; protected POST successful-control and outcome
equivalence; expected validation and correction; exact-origin, authorization,
cross-user, replay, duplicate, upload, size, and redaction controls; pending
ownership and cleanup; pre-interception preservation refusal; cancellation,
network uncertainty, close, rollback, redirect, current-truth recovery, and
stale-result removal in Chromium, Firefox, and WebKit. The same forms execute
with JavaScript disabled. `pnpm ci:local` retains every prior native, browser,
security, package, and release gate.
