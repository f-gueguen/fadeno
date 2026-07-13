# Public model

Fadeno's public vocabulary maps application intent to web concepts.

## Page

A page owns a routable HTML document. It receives typed route and request
context, reads through resources, and renders server output. Routes, parameters,
and valid links are generated into declarations consumable by stock TypeScript.

## Fragment

A fragment is reusable server-rendered output within a page. It is a semantic
rendering and dependency boundary, not a client component by default.

## Resource

A resource is a server-owned application read. Resources used during a render
are deduplicated within the request and recorded as page dependencies. A
resource cannot be called directly from browser-zone application code.

ADR 0034 fixes `defineResource({ read })` as the sole declaration and
`context.read(resource, input)` as the sole call. Declaration-object identity
and a deeply frozen normalized structural input snapshot determine
request-local promise deduplication. V1 refuses cross-request result caching.
V1-11 implements that public runtime, typed expected resource failures, request
cancellation and cleanup, and immutable dependency observations. The
correctness-first revalidation owner remains private until the action container
is accepted and implemented; no shared cache or alternate resource call exists.

## Action

An action is a server-owned mutation callable by a standard HTML form. Its
input is decoded and validated at the request boundary. It can return field or
form failure, redirect, or complete successfully and trigger revalidation.

A GET form represents navigation and does not invoke an action.

ADR 0035 fixes one `defineAction({ fields, authorize, run, keeps? })`
declaration with opaque generated form and field identity. The V1 descriptor
set is text, integer, checkbox, and file. Exact-origin proof, replay, complete
decoding, and limits finish before the mandatory application authorization;
only accepted authorized input reaches mutation. Expected failure is one typed
`actionError`, redirects are same-origin 303, and successful or possibly
changed state enters complete revalidation. V1-12 proves this privately;
V1-13 owns the first public implementation.

## Island

An island is an explicit client-owned boundary with serializable input,
lifecycle, and local state. Server updates do not replace a mounted island
implicitly; changed inputs follow a defined delivery contract.

An island may own a whole route when JavaScript is an explicit route
requirement. That use is an escape hatch rather than the default application
model.

## State home

Every UI state value has one declared home:

- URL state for shareable navigation state;
- form state for submitted or pending input;
- resource state for server-owned application data;
- session state for server-managed user continuity;
- device state for browser-local continuity with an explicit server fallback;
- element or island state for local interaction.

Moving state between homes is an application decision, not an implicit runtime
effect.

## Context and boundaries

Context carries typed request-scoped capabilities and values without global
mutation. Error and pending boundaries define local rendering outcomes. Raw
request handlers are the explicit escape hatch for endpoints that do not fit
the page and action model.

ADR 0035 fixes the protected session as another request-scoped capability. A
read view can inspect bounded normalized values. Only mutation execution can
buffer writes, deletion, or privilege-change identity rotation. The fixed
host-only encrypted cookie, active/prior keyring, absolute expiry, and failure
behavior are framework-owned; cookies never become an ambient state API.

ADR 0031 fixes the first construction boundary. Standard TypeScript's automatic
JSX transform imports the package's `./jsx-runtime` subpath. Page and layout
modules return opaque render nodes, promises of render nodes, or the narrow
typed route outcomes accepted by that ADR. Pages receive the standard request,
decoded route parameters, and cancellation signal; layouts additionally receive
their child node. Generated application bindings, not authored route tables,
connect those modules to the matched-route renderer.

The action and session names above are selected but remain unimplemented until
V1-13. Island and client-interaction signatures remain unset until their
vertical slices prove them. Names fixed by effective ADRs remain current
decisions.
