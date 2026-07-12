# ADR 0028: Contextual rendering security

- Status: Accepted
- Date: 2026-07-12
- Owners: Fadeno maintainers
- Related specifications: [Routing, rendering, streaming, and failures](../spec/routing-rendering-streaming.md), [Rendering threat model](../security/rendering-threat-model.md)
- Supersedes: None

## Context

V1 cannot implement JSX rendering until it distinguishes HTML parser contexts,
defines the universal URL XSS floor, makes raw insertion explicit, and fixes
nonce and redaction ownership. A generic HTML-escape function is insufficient:
attributes, URLs, RCDATA, RAWTEXT, CSS, comments, foreign content, and raw
insertion have different grammars and failure modes.

This slice must freeze security policy without selecting JSX node shapes,
response construction, stream boundaries, header commit timing, or public
request-context constructors owned by V1-08 and V1-09.

## Decision drivers

- Ordinary strings are safe by default in every accepted sink.
- Unsupported contexts fail closed rather than borrowing the wrong encoder.
- Raw trust assertions are explicit in source and authentic at runtime.
- CSP is defense in depth, not a substitute for contextual encoding.
- Security fixtures become the V1-09 renderer's conformance input, not a
  disposable shadow renderer.

## Decision

V1 has one versioned machine-readable sink registry and fixture corpus. The
accepted sink classes are:

- HTML data text;
- double-quoted ordinary attributes;
- RCDATA children of `title` and `textarea`;
- navigation and resource URL attributes under an element/attribute policy;
- boolean attributes;
- closed enumerated attributes;
- authenticated raw HTML insertion.

HTML text and RCDATA normalize CRLF/CR to LF, replace NUL and unpaired UTF‑16
surrogates with U+FFFD, and encode `&`, `<`, and `>` as named entities. Ordinary
double-quoted attributes apply the same normalization and additionally encode
`"` as `&quot;` and `'` as `&#39;`. RCDATA never uses RAWTEXT rules: mixed-case
closing tags are harmless because `<` is encoded.

Dynamic tag names, dynamic attribute names, comments, event attributes,
`srcdoc`, meta refresh, `srcset`, `ping`, `xlink:href`, inline `style`, and
application children of `script` or `style` are refused. SVG, MathML, and
obsolete elements are outside the initial V1 renderer until a separate
foreign-content grammar is accepted. Application executable markup is not
created by raw strings or ordinary JSX attributes.

URL values are validated before attribute encoding. Navigation references for
`a[href]` and `area[href]` allow relative/network-path, `http`, `https`,
`mailto`, and `tel`. Form navigation (`form[action]`, `button[formaction]`, and
`input[formaction]`) allows relative/network-path, `http`, and `https`; V1-12
still owns same-origin, CSRF, and action identity. Resource references for
`img[src]`, `source[src]`, `audio[src]`, `video[src]`, `video[poster]`, and
`link[href]` allow relative/network-path, `http`, and `https`.

URL values containing ASCII whitespace/control characters, NUL, backslashes,
or absolute credentials are refused. `javascript`, `vbscript`, `data`, `blob`,
and `file` schemes are refused case-insensitively. Unknown explicit schemes are
refused. Entity-looking and percent-looking text is not decoded by policy; `&`
is encoded before parsing, so it cannot manufacture a scheme delimiter. The
policy preserves accepted URL bytes except for HTML attribute encoding and does
not claim same-origin safety.

Boolean sinks accept only booleans: true emits the static attribute name and
false omits it. Enumerated sinks accept only their registry token, in canonical
lowercase. Inline CSS is refused; applications use
`class` and external CSS until a separate property/value grammar earns scope.

The neutral package root exports exactly one raw constructor, `unsafeHtml`, and
one opaque type, `UnsafeHtml`. `unsafeHtml(html, { reason })` is an explicit
trust assertion, not a sanitizer. An ordinary string is not assignable to
`UnsafeHtml`; the reason must be a non-empty bounded review explanation. The
runtime token is frozen, null-prototype, authenticated by a same-package private
WeakMap, and accepted only by that package instance. Serialization may produce
an inert ordinary object, but serialization never preserves authority.
Strings, object copies, spreads, reflected-symbol attempts, proxies, clones,
JSON round trips, and tokens from another installed package instance fail
runtime authentication. The brand, stored HTML, and unwrapper are not exported.

This guarantee does not defeat `any`, type assertions, or intentionally hidden
wrappers. Review tooling audits the one named constructor and wrapper aliases
remain an application review obligation. Raw HTML is deliberate application
authority; the framework cannot detect a secret or script the application
explicitly places inside it and never adds a CSP nonce to raw markup.

A CSP nonce is per-response, immutable, generated from at least 128 CSPRNG bits,
never sourced from request URL/header/body data, and never reused with cached
HTML. Only framework-emitted executable markup receives it. V1-07 proves only
the private default 128-bit generation primitive, fresh token identity, output
shape, and raw non-blessing. V1-08/V1-09 own response identity, cache reuse,
header correlation, commit timing, request context, and real browser
enforcement. Until a matching
`Content-Security-Policy` header ships, the framework makes no CSP-protection
claim.

Structured redaction occurs before formatting. Framework public failures,
diagnostics, overlays, and log-hook payloads never automatically include
Authorization or Proxy-Authorization, Cookie or Set-Cookie, URL queries,
request bodies, sensitive configured fields, or Error message/stack/cause and
enumerable properties. Projection does not invoke getters and handles nested or
circular errors. This is source-and-sink policy, not global substring
replacement. Deliberate application rendering, including raw HTML, remains
outside automatic secret detection. Incident/status/response behavior stays
with V1-08.

## Alternatives considered

- One generic HTML escaper: rejected because URL, CSS, RAWTEXT, and raw
  insertion are different languages.
- Sanitize raw HTML automatically: rejected because sanitization is a separate
  policy with application-specific allowlists; the API is an explicit trust
  assertion.
- Accept inline style strings: rejected because HTML escaping does not make CSS
  values or `url()` safe.
- Public nonce or renderer-context constructor now: rejected because response
  and context ownership remains unresolved.
- Treat TypeScript opacity as unforgeable: rejected because assertions and
  `any` exist; runtime same-instance authentication is the enforceable claim.

## Consequences

- The rendering-security gate is resolved without implementing a renderer.
- V1-09 must reuse the accepted policy implementation and unchanged corpus.
- Foreign content, inline CSS, application RAWTEXT, and complex URL attributes
  are initially unavailable rather than weakly escaped.
- The package remains private; release impact and Changeset are none.
- Rollback removes the two root raw-HTML exports, private policy code, corpus,
  threat model, and ADR, restores the rendering-security gate, and leaves
  rendering blocked. A later contradiction supersedes this ADR.

## Validation

`pnpm check:v1-rendering-security` checks registry/corpus completeness; exact
canonical bytes and refusals for dangerous delimiters and invalid Unicode;
URL element/attribute/scheme matrices and obfuscations; style/RAWTEXT/dynamic-
name/foreign-content refusals; raw-token type and runtime authenticity across
copy/clone/proxy/physical-package-instance boundaries; the default nonce
primitive's entropy floor, immutability, output shape, and raw non-blessing;
and secret-safe structured projection with nested, circular,
and getter-throwing errors. Browser parser/CSP outcomes remain recorded for
unchanged V1-09 tri-engine consumption rather than being claimed here.
