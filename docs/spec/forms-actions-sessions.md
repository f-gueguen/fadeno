# Forms, actions, redirects, cookies, and sessions

This specification defines the secure native-form path selected by ADR 0035.
V1-12 contains the private decision evidence; V1-13 implements the public
single-process runtime and packed JavaScript-disabled workflow without exposing
that decision schema.

## Form contract

1. Every ordinary action is callable from a standard HTML form without client
   JavaScript.
2. Framework field descriptors generate valid HTML names and attributes and
   decode the corresponding `FormData` into typed input. Required text,
   integer, and file descriptors are non-null in stock TypeScript; only an
   explicitly optional descriptor contributes `null`.
3. Missing, malformed, duplicate, and unexpected fields have explicit decoder
   behavior. Multi-value convenience types remain deferred; raw `FormData`
   remains available to raw handlers.
4. Validation distinguishes field errors, form errors, and unexpected server
   failures. Returned HTML associates errors only with the submitted form
   instance and preserves user input when safe. Textareas and selects restore
   safe values; password and file inputs never do.
5. GET forms are typed navigations. They do not invoke mutation actions.
6. File inputs enforce content-length, per-file, aggregate, count, type, and
   processing-time limits before application code trusts the value.

`defineAction({ fields, authorize, run, keeps? })` is the sole declaration.
`textField`, `integerField`, `checkboxField`, and `fileField` are the complete
V1 descriptor set. `<form action={declaration}>` and
`name={declaration.fields.name}` use opaque generated identities; applications
do not author endpoints, proof fields, action IDs, or raw field names. Input,
textarea, select, and submit-button names use the same token translation; raw
logical names at the POST boundary are refused rather than treated as a second
wire format. Each rendered action URL carries a bounded form-instance index.
The proof covers a SHA-256 binding digest over that index, route identity, and
the complete accepted return location, so repeated forms cannot share
validation state and long accepted query strings do not overflow the proof's
route-identity field. Action checkboxes always emit the decoder's canonical
`on` value regardless of an authored value. A multiple select cannot use an
action field token because V1 descriptors are single-value.

The exact limits are 8 MiB aggregate body bytes, 5 MiB per file, eight files,
128 parts, 64 KiB per scalar field, 128 UTF-8 bytes per field name, 256 UTF-8
bytes per original filename, 16 accepted media types per file descriptor, and
five seconds of boundary processing. File names remain untrusted display data.
Every partial or complete upload has framework-owned exactly-once cleanup.

## Action contract

1. An action owns an ordinary mutation and executes only on the server.
2. The request boundary accepts only native POST with normalized URL-encoded or
   multipart media type. It validates exact HTTPS origin, action and route,
   rendered form instance, current application generation, session, signed proof, replay, fields,
   files, freshness, and limits before application code.
   URL-encoded names and values must remain well-formed UTF-8 after percent
   decoding; multipart headers and non-file field values must be well-formed
   UTF-8 before the platform form parser can replace malformed bytes.
3. Application authorization is evaluated after complete decoding through the
   declaration's mandatory `authorize` callback; successful decoding never
   implies authorization. The callback receives a read-only session view and a
   failure is redacted and fail-closed.
4. A successful action either redirects or completes into the resource
   revalidation path. It cannot issue arbitrary selector-targeted updates.
5. An expected action failure does not revalidate unless its documented result
   changed server state.
6. A proof is HMAC-SHA-256 bound to action, route, generation, session identity,
   rendered form instance, session CSRF secret, issue time, and a 24-byte nonce. It lives at most 15
   minutes and is atomically consumed once before authorization. Its non-secret
   key ID permits an accepted prior session key to verify a still-fresh form;
   the HMAC key is purpose-separated with HKDF-SHA-256.
7. Replay retention is expiry-aware and bounded to 4,096 process entries and
   64 per session. The initial action server is single-process; multi-process
   mutation serving is unsupported until an atomic shared owner is accepted.
8. `actionError` is the sole expected failure identity. It carries a stable
   uppercase code, distinct field and form errors, and an explicit `changed`
   boolean. Behavior never depends on parsing its prose.

## Ordering and redirects

Enhanced requests carry sufficient identity to keep an older result from
overwriting a newer accepted result. Native submissions retain ordinary browser
navigation semantics.

Action redirects use status 303 and exact same-origin HTTPS destinations. V1
has no external redirect allow-list. Success and changed or unknown mutation
failure enter complete resource revalidation; unchanged expected failure does
not. A rejected redirect after mutation still revalidates current server truth.

## Cookies and sessions

1. Cookie defaults are `Secure`, `HttpOnly`, restrictive `SameSite`, and the
   narrowest viable path unless the declared use requires otherwise.
2. Client-readable cookies are separate capabilities and cannot contain server
   secrets or authorization grants.
3. Session values are authenticated; confidential values are encrypted. The
   format carries key identity and supports rotation without silent logout when
   an accepted prior key remains valid.
4. Session fixation is prevented across authentication privilege changes.
5. Expiry, renewal, deletion, maximum size, and serialization failure have
   deterministic behavior.
6. Request context exposes typed session capabilities without making cookies a
   global mutable store.

The request-scoped session view exposes bounded structural `get` and `has`.
Mutation code additionally receives buffered `set`, `delete`, `clear`, and
`rotate`; authorization cannot mutate the session. `rotate` is mandatory after
login, logout replacement, account change, and every privilege change.

The sole key input is active-first `FADENO_SESSION_KEYS` with one to four
`id:base64url` entries and exactly 32 decoded key bytes each. The fixed
`__Host-fadeno-session` cookie is `Secure`, `HttpOnly`, `SameSite=Lax`,
`Path=/`, has no `Domain`, and is at most 4,096 bytes including name and value.
Its AES-256-GCM v1 envelope authenticates cookie metadata and encrypts session
identity, CSRF secret, timestamps, and at most 2 KiB of normalized values.
Sessions have 12-hour absolute expiry. The active key encrypts; up to three
prior keys decrypt and trigger resealing without extending expiry. Unknown key,
tamper, malformed values, and expiry fail closed and clear the cookie. An
expired, malformed, or tampered cookie produces one deterministic refusal with
only the deletion cookie; it is not replaced during that request.
An action POST rejected by the exact-origin check does not open or publish a
replacement session. If an accepted callback reaches absolute session expiry
before completion, the runtime reports a deterministic redacted failure,
revalidates with a fresh anonymous session, and publishes only that new
session; renewal never throws past the response boundary.

## V2 form enhancement

ADR 0051 adds optional delivery for eligible forms without adding another form
or action model. A trusted submit event remains native unless the effective
action, method, target, encoding, submitter, current document, and preservation
boundary are all accepted before interception. The platform
`FormData(form, submitter)` algorithm is the sole browser successful-control
owner.

GET forms encode those controls into the destination URL and remain navigation
operations. They never acquire action, proof, replay, authorization, session
mutation, or revalidation authority. POST enhancement is limited to the exact
HTTPS generated action owner and to URL-encoded or multipart encoding. The
existing action runtime still performs every native origin, route, generation,
session, proof, replay, field/file, authorization, mutation, redirect, and
revalidation check.

The submitted form alone receives bounded `aria-busy` ownership. Its prior
state is restored on every terminal path. A second submission while a mutation
is pending sends no request. Once POST delivery begins, failure, cancellation,
teardown, malformed output, or commit refusal reloads the independently trusted
pre-submit URL with GET and never repeats the mutation. Submitted values,
filenames, files, proofs, cookies, sessions, and URLs remain absent from private
flow evidence.

ADR 0052 completes the V2-07 action outcome order. An admitted successful
action document or state-changing expected response commits at the GET-callable
current-truth URL after the existing server action and revalidation path runs
once. An unchanged expected validation response does not run revalidation and
commits only its exact unchanged-current-truth validation outcome; it cannot
publish stale assumptions about changed resources. An admitted action redirect
consumes that mutation result, clears mutation pending
state, and hands the same-origin destination to a fresh cancellable navigation
operation. The destination is read through GET with a distinct operation ID and
sequence; it never carries the action body or repeats the POST. Newer navigation
may supersede that GET, while unsafe preservation, stale identity, cancellation,
or commit failure returns to native destination GET or current-truth recovery.
All document, URL, history, focus, and diagnostic replacement remains atomic.
At this recovery handoff, a native GET form is finalized after document submit
listeners, so their final action and control edits are authoritative. The
recovery preflight validates the destination and request-privacy boundary
before constructing platform successful controls once, then prevents the
original native default while it is still cancelable so the browser does not
serialize them again. A fragment destination receives native push-style
history, including a same-hash activation; explicit request-privacy directives
remain native and are never replaced by a forced reload. Selected-push rollback
and synchronous teardown during a cancelled fragment reload retain the
committed mutation's current-truth recovery owner. The rollback completes
before recovery so Back reaches the preceding page. Completion requires the
exact requested source entry and URL; an unrelated `popstate` reloads natively
instead of continuing obsolete recovery. Fragment staging likewise requires
the exact requested private state, URL, replacement length, and push-write
sequence before ownership is claimed. A push may truncate forward history
without increasing `history.length`, so its own observed push sequence and
exact selected state/URL are authoritative. Handoff capture has bounded
control, record, and UTF-8 byte budgets; an over-limit handoff refuses private
publication before serializing controls and refreshes current truth without
requesting an unobservable redirect destination. This covers `204`, attachment,
and other responses that create no document and therefore emit no reliable
departure-completion event. If submit propagation is already
stopped when the runtime observes a same-context form, the runtime refuses it
while the event is cancelable and recovers current truth without constructing
`FormData`. If a later listener stops propagation and the browser selects a
safe same-document fragment, document capture recognizes the trusted
browser-owned `formdata` event, accepts an image submitter from that supplied
entry list, and copies the entries plus contemporaneous safe routing before
listener microtasks. Document-bubble and final window observation restore the
browser-owned list to that capture snapshot and admit it only while routing
remains unchanged. Later entry-list or routing changes recover current truth
as ambiguous. Capture stops at the same 4,096-record and 256-KiB UTF-8 bounds
before cloning a value or deriving a destination. At most sixteen distinct candidates are
retained; overflow rejects the whole set even if an exact candidate appeared earlier. Only a complete
candidate URL that matches the browser-selected entry may retain that
fragment; a hidden event, later unrelated snapshot, overflow, or ambiguity
recovers current truth. Capture, bubble, and dynamic window observers are
detached on every terminal path. Whether the GET
replaces the document is determined from that exact destination relative to
the trusted source path and query, not from the method alone. Observation and
destination derivation remain distinct facts: recovery does not construct
another `FormData` merely because no safe candidate is admissible.
A submission cancelled by a later document listener after it reaches the
window finalizer, or already cancelled before the runtime document listener,
recovers through the same no-serialization path. Final target ownership may
select a separate browsing context after earlier listeners; that destination
stays browser-owned while the current document recovers committed truth. Link
finalization re-reads destination, target, download ownership, and privacy
directives after document listeners; an activation that leaves the current
document in place remains browser-owned while that document recovers committed
truth.
Modified-primary and middle-button activations use the same separate-context
ownership. A same-context cross-document activation that reaches the finalizer
but cannot be enhanced safely is refused before its request starts while
committed recovery is live; current truth recovers and the user may retry. No
timeout treats elapsed time as native completion. A cross-document activation
hidden from the finalizer by a later propagation stop remains browser-owned,
and the runtime makes no private freshness claim because the old document
cannot observe a no-document response.
The final effective method is equally authoritative: a retained `dialog`
submission recovers without document departure, while a listener-selected GET
uses its final native destination. Handoff equality includes exact bounded
control ancestry and effective disabled state inherited through
`fieldset` and `optgroup` ownership, exact optgroup hierarchy, descendant
text-node identity, parent, and content, and remains in
force through interrupted-departure recovery. Final target ownership is
resolved after document submit listeners. A failed fragment push repairs the
current entry directly because no pushed entry exists to roll back. A recovery
GET retains the committed-mutation recovery owner when newer work supersedes
it, and an empty fragment delimiter still selects the fresh native-document
path even though its parsed hash string is empty.

## V1 conformance

- The authenticated CRUD workflow submits, validates, fails, redirects, and
  succeeds with JavaScript disabled.
- Decoder fixtures cover missing, malformed, duplicate, unexpected, oversized,
  and hostile fields and files, canonical checkbox values, and multiple-select
  refusal.
- Security fixtures cover cross-origin requests, missing/invalid CSRF proof,
  unauthorized actions, replay, unsafe redirects, session fixation, rotation,
  tampering, expiry, and cross-user isolation.
- Enhanced and native submissions produce equivalent accepted application
  outcomes once enhancement exists; V1-13 qualifies the native outcome first,
  and ADR 0048 projects that same action response without invoking the action,
  authorization, revalidation, resource, page, or renderer a second time.
- V2-06 qualifies exact GET URL/no-mutation equivalence and protected POST
  successful controls, expected validation, pending cleanup, origin,
  authorization, cross-user, replay, cancellation, duplicate, network,
  teardown, redirect, and current-truth recovery across three browsers and the
  JavaScript-disabled baseline. Replacing a GET form action query with an empty
  successful-control set retains the native empty `?` delimiter.
- Logs and diagnostics prove that secret and sensitive values are redacted.
- The V1-12 normalized success, refusal, correction, flow, and recovery files
  are private evidence, not a supported wire schema or public runtime output.
- The V1-13 packed application permanently executes sign-in, validation,
  upload, create, read, update, delete, replay refusal, session rotation,
  per-row failure scoping, sensitive-value non-reflection, complete
  revalidation, and stale-output recovery over HTTPS in all three qualified
  browsers with JavaScript disabled.
