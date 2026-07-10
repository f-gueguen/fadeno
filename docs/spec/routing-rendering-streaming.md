# Routing, rendering, streaming, and failures

This specification defines required V1 behavior. Filesystem names and public
construction signatures remain blocked by DG-V1-02, DG-V1-03, and DG-V1-08.

## Route model

1. A build produces one deterministic route manifest from a configured route
   root.
2. The initial router supports static and parameterized page routes, nested
   layouts, a not-found outcome, route-local error handling, and raw
   `Request`-to-`Response` handlers.
3. A route collision, ambiguous segment, invalid parameter name, or layout
   cycle is a build error with a stable diagnostic and both source locations.
4. Generated declarations type route parameters and valid link destinations.
   Invalid links fail under stock TypeScript.
5. A page or layout cannot depend on browser-zone code except through an
   explicit island or extractable handler boundary.
6. Raw handlers are visible escape hatches. They do not inherit page resource,
   action, rendering, or patch behavior implicitly.

The route-root location, filenames, rest segments, and link-construction API
are resolved by DG-V1-02 using the H3 fixture corpus.

## Server rendering

1. A page request produces a complete HTML document with deterministic element
   and attribute ordering where ordering affects generated output.
2. Text and dynamic attribute values are escaped for their output context.
3. Boolean, enumerated, URL-bearing, style, and raw-text element attributes
   receive explicit renderer cases rather than one generic string path.
4. Raw HTML requires a deliberately unsafe capability and never accepts an
   ordinary string by accident.
5. CSP nonces flow from request context to framework-emitted executable markup.
6. Rendering observes request cancellation and stops resource and stream work
   after disconnect.
7. Framework diagnostics and error pages do not disclose secrets, cookie
   contents, authorization headers, or sensitive field values.

DG-V1-03 fixes the unsafe capability and exact context rules only after the
renderer threat model and negative fixtures exist.

## Streaming and boundaries

1. The renderer uses Web Streams and can flush document output without waiting
   for every independent resource.
2. A local boundary can render pending output and later complete its owned
   region without changing route ownership.
3. Failures before response commitment can select an HTTP error or redirect
   response. Failures after commitment are represented by the accepted
   streaming protocol and cannot pretend to change the committed status code.
4. Request disconnect, explicit cancellation, boundary timeout, and superseded
   work propagate to resources owned by the abandoned render.
5. Timeouts are bounded and observable; they do not leave detached work or
   partially authorized cache entries.
6. Boundary nesting has deterministic ownership for pending, error, and
   cancellation outcomes.

DG-V1-08 defines response-commit and boundary details before WEB-03 code becomes
public.

## Failure outcomes

- **Not found** is a typed control-flow outcome that stops the current route
  render and selects the nearest applicable not-found surface.
- **Redirect** is a validated response outcome, not a client patch command.
- **Expected failure** is safe application feedback suitable for a form or
  local boundary.
- **Unexpected failure** receives a stable incident identity and safe public
  response while preserving the original cause for server observability.

Error handling cannot narrow a value and then expose it as nullable in generated
types. Type fixtures cover narrowing across route and boundary control flow.

## V1 conformance

- Static, parameterized, nested-layout, not-found, error, redirect, and raw
  handler routes pass request/response fixtures.
- Escaping fixtures cover every output context and known dangerous delimiter.
- Streaming fixtures cover flush order, nested failure, timeout, cancellation,
  disconnect, and work cleanup.
- Two clean builds produce byte-identical manifests and declarations.
- The native HTML output passes the no-JavaScript workflow before enhancement
  tests are permitted to pass the slice.
