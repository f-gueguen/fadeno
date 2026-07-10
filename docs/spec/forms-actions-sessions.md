# Forms, actions, redirects, cookies, and sessions

This specification defines the secure native-form path required by V1. Exact
request identity, security proof, field descriptors, and cookie mechanisms are
blocked by DG-V1-05.

## Form contract

1. Every ordinary action is callable from a standard HTML form without client
   JavaScript.
2. Framework field descriptors generate valid HTML names and attributes and
   decode the corresponding `FormData` into typed input.
3. Missing, malformed, duplicate, and unexpected fields have explicit decoder
   behavior. Multi-value convenience types remain deferred; raw `FormData`
   remains available to raw handlers.
4. Validation distinguishes field errors, form errors, and unexpected server
   failures. Returned HTML associates errors with controls and preserves user
   input when safe.
5. GET forms are typed navigations. They do not invoke mutation actions.
6. File inputs enforce content-length, per-file, aggregate, count, type, and
   processing-time limits before application code trusts the value.

## Action contract

1. An action owns an ordinary mutation and executes only on the server.
2. The request boundary validates action identity, route applicability, method,
   media type, origin/CSRF proof, authorization, freshness, and input limits.
3. Application authorization is evaluated inside the action's request context;
   successful decoding never implies authorization.
4. A successful action either redirects or completes into the resource
   revalidation path. It cannot issue arbitrary selector-targeted updates.
5. An expected action failure does not revalidate unless its documented result
   changed server state.
6. Accidental duplicate submission is suppressed in the enhanced path while
   explicit repeated actions remain possible through distinct accepted
   requests.
7. Replay and idempotency behavior is explicit per action class before public
   release.

## Ordering and redirects

Enhanced requests carry sufficient identity to keep an older result from
overwriting a newer accepted result. Native submissions retain ordinary browser
navigation semantics.

Redirect destinations are validated against a declared same-origin or explicit
allow-list policy. A redirect is represented consistently in the native and
enhanced paths and never interpolated into executable markup.

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

DG-V1-05 resolves the concrete proof, algorithms, key lifecycle, limits, and
failure response through a threat model and negative test corpus.

## V1 conformance

- The authenticated CRUD workflow submits, validates, fails, redirects, and
  succeeds with JavaScript disabled.
- Decoder fixtures cover missing, malformed, duplicate, unexpected, oversized,
  and hostile fields and files.
- Security fixtures cover cross-origin requests, missing/invalid CSRF proof,
  unauthorized actions, replay, unsafe redirects, session fixation, rotation,
  tampering, expiry, and cross-user isolation.
- Enhanced and native submissions produce equivalent accepted application
  outcomes.
- Logs and diagnostics prove that secret and sensitive values are redacted.
