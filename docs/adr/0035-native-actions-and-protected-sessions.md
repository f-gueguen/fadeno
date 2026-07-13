# ADR 0035: Native actions and protected sessions

- Status: Accepted
- Date: 2026-07-14
- Owners: Fadeno maintainers
- Related specifications: [Forms, actions, redirects, cookies, and sessions](../spec/forms-actions-sessions.md), [Data consistency](../spec/data-consistency.md), [Public model](../spec/public-model.md), [Protocol requirements](../spec/protocol-requirements.md), [Security requirements](../security/requirements.md), [V1 plan](../roadmap/v1.md)
- Supersedes: None

## Context

ADRs 0005, 0006, 0020, and 0034 require native form-callable mutations,
explicit authorization, correctness-first resource revalidation, and no
cross-request resource cache. They do not decide how one declaration owns a
form, how untrusted fields and files are decoded, how a request proves its
origin and freshness, how replay is refused, or how an authenticated session
survives key rotation without exposing its values.

V1-12 supplies a private strict-TypeScript decision model, a versioned threat
corpus, and permanent normalized success, refusal, flow, correction, and
recovery evidence. It proves the decision without adding an action, session,
cookie, form, or upload package export. V1-13 owns that public implementation.

## Decision drivers

- The ordinary path must be a real HTML form that succeeds without JavaScript.
- One authored declaration must own identity, fields, authorization, mutation,
  expected failure, redirect, and revalidation metadata.
- No application callback may run before the entire untrusted request boundary
  is accepted.
- Application authorization must remain explicit and distinct from decoding.
- Session cookies must protect confidentiality and integrity, support bounded
  key rotation, and resist fixation.
- Duplicate or replayed native mutations must fail closed without relying on
  human-readable messages.
- Limits, cleanup, diagnostics, and flow evidence must exclude submitted values
  and secrets.

## Decision

### Declaration and form identity

V1-13 implements one server-only `defineAction` declaration:

```ts
const saveProject = defineAction({
  fields: {
    title: textField({ maximumBytes: 128 }),
    priority: integerField({ minimum: 1, maximum: 5 }),
    archived: checkboxField(),
    brief: fileField({ required: false, maximumBytes: 1_024 }),
  },
  authorize({ request, session, input }) {
    return canEdit(request, session, input);
  },
  async run({ request, session, input, signal }) {
    await storeProject(request, input, signal);
    return redirect("/projects");
  },
});
```

The exact immutable declaration object is runtime identity. Construction-time
source provenance and the application generation own generated identity.
Applications do not author action IDs, endpoints, proof fields, or raw input
names. A standard JSX form uses `<form action={saveProject}>`; controls use the
corresponding opaque `saveProject.fields.<name>` token as `name`. The renderer
emits the generated same-origin endpoint, `method="post"`, accepted encoding,
field names, and hidden proof. A GET form remains typed navigation and cannot
accept an action declaration.

V1 has exactly four single-value descriptors: `textField`, `integerField`,
`checkboxField`, and `fileField`. Text and integer are required unless declared
otherwise; an absent checkbox is `false`; optional absent fields are `null`.
Every supplied descriptor may occur once. Missing required, malformed,
duplicate, unexpected, counterfeit, or unsupported values are refused.
Multi-value convenience descriptors remain deferred. Raw request handlers may
parse their own `FormData` but are not actions and receive none of this action
contract automatically.

### Native boundary and ordering

An action accepts only `POST` with normalized media type
`application/x-www-form-urlencoded` or `multipart/form-data`. Before
application authorization or mutation runs, framework-owned code completes:

1. method, media type, declared and observed body limits;
2. exact `Origin` equality with the canonical HTTPS application origin, with no
   `Referer` fallback;
3. generated action endpoint, route applicability, and current application
   generation;
4. session existence and absolute expiry;
5. authenticated action/route/generation/session proof and proof expiry;
6. atomic replay consumption;
7. complete field and file decoding, type validation, and cleanup ownership;
8. processing deadline and all count, name, value, file, and aggregate limits.

Refusal skips authorization, mutation, and revalidation. Authorization receives
only decoded input, standard request data, cancellation, and a read-only session
view. `false` is an expected denial. A thrown authorization failure is a
redacted internal failure and still skips mutation. Only the mutation callback
receives session mutation capabilities.

The private model currently checks decoding before proof consumption so all
submitted storage has one cleanup owner; every step remains bounded and no
application callback runs. V1-13's streaming parser may reject method, origin,
declared size, or proof earlier, but must preserve the same observable codes,
single replay consume point, and exactly-once cleanup.

### Proof and replay

Each rendered form proof is an authenticated private v1 envelope bound to the
opaque action identity, applicable route, application generation, 32-byte
session identity, 32-byte session CSRF secret, issue time, and a fresh 24-byte
nonce. HMAC-SHA-256 uses a purpose-separated key derived from the active
session key. The proof carries no session secret. Proofs live for at most 15
minutes and never beyond session expiry. Wrong action, route, generation,
session, signature, encoding, or time fails closed.

An accepted proof is consumed once before authorization. The initial runtime
keeps an expiry-aware process-local ledger bounded to 4,096 live entries and 64
per session. Exhaustion refuses new mutations; it never evicts an unexpired
proof to make room. This is sufficient only for the supported single-process
V1 server. Multi-process action serving is unsupported until a new ADR selects
an atomic shared replay owner and proves failure and partition behavior.

Distinct freshly rendered proofs permit intentional repeated mutations.
Browser enhancement may suppress accidental concurrent submission later, but
it cannot weaken native replay enforcement.

### Limits and uploads

V1 limits are 8 MiB aggregate body bytes, 5 MiB per file, eight files, 128
parts, 64 KiB per scalar field, 128 UTF-8 bytes per field name, 256 UTF-8 bytes
per original file name, 16 declared accepted media types, and five seconds of
boundary processing. Declared content length, when present, and actual observed
bytes are both checked. Limits may become more permissive before 1.0 but never
silently less protective.

Files are streamed or spooled behind a framework-owned opaque upload value.
The application receives bytes or a contained handle only after complete
acceptance. Original names are untrusted display data, never filesystem paths.
Every partial and complete upload has idempotent exactly-once cleanup on
refusal, denial, failure, success, cancellation, and disconnect. A later direct
streaming upload capability requires a separate ownership decision.

### Failures, redirects, and revalidation

`actionError({ code, fieldErrors, formErrors, changed })` is the sole expected
mutation failure. The framework recognizes its opaque identity, never parses
its message. `code` is an uppercase stable application identifier. Field and
form errors are rendered structurally; safely reusable submitted values may be
redisplayed, but passwords, session values, proofs, cookies, and file bytes are
never retained or logged. `changed` defaults to `false`; `true` enters complete
resource revalidation. Independently actionable field failures remain
separate from the form failure.

Success enters complete resource revalidation. An explicit action redirect
must use status 303 and resolve to the exact HTTPS application origin; the
response uses a normalized path/query/fragment, not an external allow-list.
Without an explicit redirect the framework renders current server truth; a
fresh native GET may own that render. Unsafe redirect data after mutation is
refused and still performs complete revalidation. Unexpected mutation failure
uses a redacted incident identity and conservatively performs complete
revalidation because partial state change is unknown.

### Protected session

Pages and action callbacks receive a request-scoped session capability, never a
global cookie store. The read-only view has `get` and `has`; the mutation view
adds `set`, `delete`, `clear`, and `rotate`. Keys are bounded strings and values
use the closed deeply normalized grammar `null`, boolean, finite number,
string, dense array, and plain string-keyed object. Serialization is bounded to
2 KiB, 256 entries, and depth 16. Session writes are buffered and publish at
most one response cookie only after the owning outcome is known.

`FADENO_SESSION_KEYS` is the only V1 session-key input. It is a comma-separated,
active-first list of one to four `id:base64url` entries. IDs contain 1–32
letters, digits, `_`, or `-`; each decoded key is exactly 32 bytes. It follows
the accepted private environment precedence and is never placed in generated
output, diagnostics, flow records, or a browser artifact. Startup refuses an
invalid keyring. An application that renders or accepts an action requires a
keyring.

The cookie is `__Host-fadeno-session`, with `Path=/`, `Secure`, `HttpOnly`,
`SameSite=Lax`, no `Domain`, and at most 4,096 bytes for the complete name/value
pair. Its versioned envelope contains key ID, a fresh 96-bit nonce, AES-256-GCM
ciphertext, and a 128-bit authentication tag with cookie name, version, and key
ID as additional authenticated data. Plaintext contains version, session ID,
CSRF secret, creation time, absolute expiry, and normalized values.

Sessions expire absolutely after 12 hours. The active key encrypts; up to three
accepted prior keys decrypt and cause resealing with the active key without
extending absolute expiry or changing identity. Unknown key, malformed value,
tamper, and expiry fail closed and schedule cookie deletion. `rotate` creates a
new session ID and CSRF secret and resets absolute lifetime; applications must
call it on login, logout replacement, account change, or any authentication
privilege change. Ordinary value renewal retains identity and original expiry.
Deletion emits the same attributes with `Max-Age=0`.

The cookie remains a bearer credential. HTTPS, host-only scope, `HttpOnly`,
short absolute lifetime, rotation, same-origin proof, and deletion reduce but
cannot eliminate harm from a stolen valid cookie. V1 has no distributed
revocation store; logout deletes the client cookie and rotates replacement
identity, while immediate stolen-cookie revocation requires a later server-side
session owner.

### Diagnostics and evidence

Stable codes and structured phases select behavior. Human prose is rendered
from those values. Static analyzer evidence may report declaration, field,
route, and safe-correction provenance; observed authorization, replay,
mutation, redirect, upload cleanup, and session outcomes remain runtime facts.
Submitted values, file bytes, cookies, keys, proof material, and callback error
messages are redacted before diagnostic or flow construction.

The V1-12 model, schema, corpus, and normalized outputs are package-private
evidence. They are not an external schema or public API and may be replaced by
the V1-13 runtime while the decisions above remain effective.

## Alternatives considered

- Application-authored action strings and input names were rejected because
  collisions and refactors would separate source provenance from runtime
  identity.
- Raw `FormData` as the ordinary action input was rejected because duplicate,
  missing, file, limit, and typed failure behavior would diverge per action.
- `Referer` fallback and token-only origin checks were rejected because exact
  same-origin requests are the smaller V1 boundary.
- Reusable proofs and eviction of unexpired replay entries were rejected
  because either permits the same captured mutation to execute again.
- External redirect allow-lists were rejected because the authenticated V1
  application demonstrates no need for cross-origin completion.
- Plain signed session values were rejected because the contract permits
  confidential values. Server-only session storage was not selected because
  the initial single-process application does not yet justify a persistence,
  eviction, outage, and deployment contract.
- Sliding session expiry was rejected because background renewal obscures the
  credential's maximum lifetime.

## Consequences

- The former action/session decision gate is resolved and V1-13 may implement
  one public action/session path.
- Native mutation remains useful with JavaScript disabled and does not depend
  on a future enhancement protocol.
- Applications must provide a valid secret keyring before using actions and
  must rotate session identity on every privilege change.
- V1 action serving is single-process. Horizontal action serving and immediate
  distributed session revocation require later accepted owners.
- The private V1-12 model adds no export, supported editor product, external
  schema, or compatibility promise.

## Compatibility, rollback, and replacement

V1-12 changes no public package surface. Its private model and corpus can be
removed without application migration. V1-13 is the first pre-1.0
implementation of the accepted syntax. Rolling it back removes action endpoints,
session cookies, replay state, upload storage, generated field names, and
action artifacts together. A later algorithm, shared replay/session owner,
additional descriptor, redirect policy, or multi-process contract supersedes
this ADR explicitly and retains secure native POST as the baseline.

## Validation

- `pnpm check:v1-action-session-decision`
- `pnpm check:v1-public-package`
- `pnpm check:revalidation-qualification-evidence`
- `pnpm check`
- `pnpm ci:local`

The private decision check validates its versioned corpus and executes native
success, method/media/route/generation/proof refusal, missing/malformed/
duplicate/unexpected fields, aggregate and duration limits, hostile upload
cleanup, exact origin, cross-session isolation, denial, authorization failure,
bounded replay, safe and unsafe redirects, changed/unchanged expected failure,
tamper, expiry, active/prior key rotation, fixation resistance, redaction,
serialization, flow inspection, and fresh-request recovery.
