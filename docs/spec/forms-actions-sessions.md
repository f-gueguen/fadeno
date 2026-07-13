# Forms, actions, redirects, cookies, and sessions

This specification defines the secure native-form path selected by ADR 0035.
V1-12 contains private decision evidence only; V1-13 owns the public runtime.

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

`defineAction({ fields, authorize, run, keeps? })` is the sole declaration.
`textField`, `integerField`, `checkboxField`, and `fileField` are the complete
V1 descriptor set. `<form action={declaration}>` and
`name={declaration.fields.name}` use opaque generated identities; applications
do not author endpoints, proof fields, action IDs, or raw field names.

The exact limits are 8 MiB aggregate body bytes, 5 MiB per file, eight files,
128 parts, 64 KiB per scalar field, 128 UTF-8 bytes per field name, 256 UTF-8
bytes per original filename, 16 accepted media types per file descriptor, and
five seconds of boundary processing. File names remain untrusted display data.
Every partial or complete upload has framework-owned exactly-once cleanup.

## Action contract

1. An action owns an ordinary mutation and executes only on the server.
2. The request boundary accepts only native POST with normalized URL-encoded or
   multipart media type. It validates exact HTTPS origin, action and route,
   current application generation, session, signed proof, replay, fields,
   files, freshness, and limits before application code.
3. Application authorization is evaluated after complete decoding through the
   declaration's mandatory `authorize` callback; successful decoding never
   implies authorization. The callback receives a read-only session view and a
   failure is redacted and fail-closed.
4. A successful action either redirects or completes into the resource
   revalidation path. It cannot issue arbitrary selector-targeted updates.
5. An expected action failure does not revalidate unless its documented result
   changed server state.
6. A proof is HMAC-SHA-256 bound to action, route, generation, session identity,
   session CSRF secret, issue time, and a 24-byte nonce. It lives at most 15
   minutes and is atomically consumed once before authorization.
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
tamper, malformed values, and expiry fail closed and clear the cookie.

## V1 conformance

- The authenticated CRUD workflow submits, validates, fails, redirects, and
  succeeds with JavaScript disabled.
- Decoder fixtures cover missing, malformed, duplicate, unexpected, oversized,
  and hostile fields and files.
- Security fixtures cover cross-origin requests, missing/invalid CSRF proof,
  unauthorized actions, replay, unsafe redirects, session fixation, rotation,
  tampering, expiry, and cross-user isolation.
- Enhanced and native submissions produce equivalent accepted application
  outcomes once enhancement exists; V1-13 qualifies the native outcome first.
- Logs and diagnostics prove that secret and sensitive values are redacted.
- The V1-12 normalized success, refusal, correction, flow, and recovery files
  are private evidence, not a supported wire schema or public runtime output.
