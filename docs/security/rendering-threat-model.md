# Rendering security threat model

This threat model is the V1-07 evidence companion to ADR 0028. It covers sink
policy and raw authority before a JSX renderer or response pipeline exists.

## Assets and actors

Assets are document integrity, script execution authority, per-response nonce
freshness, request credentials, application secrets, and safe diagnostics.
Attackers may control request/resource/error data or stored content. Trusted
but fallible application and dependency code may select the wrong sink or bless
unsafe content.

## Trust boundaries and sinks

Untrusted values can reach HTML data, attributes, RCDATA, URLs, raw insertion,
future framework executable markup, public failure pages, development overlays,
diagnostics, and structured log hooks. Route source and static JSX names are
trusted compiler inputs; dynamic names are refused.

## Threats and controls

- Parser breakout through `&`, `<`, quotes, end tags, comments, NUL, CR/LF, or
  malformed Unicode is controlled by exact sink encoders and refusals.
- Script URLs and authority confusion are controlled by the URL policy before
  attribute encoding. Form same-origin and CSRF remain V1-12 controls.
- Event attributes, `srcdoc`, meta refresh, complex URL lists, foreign content,
  inline CSS, and application RAWTEXT are refused until dedicated grammars.
- Raw HTML is authenticated explicit authority, never sanitization. Copies and
  cross-instance tokens fail. Review of constructor calls and wrappers remains
  required.
- CSP nonces are fresh framework-owned defense in depth. Raw HTML is never
  auto-nonced; nonce disclosure in raw markup can defeat CSP. Browser/header
  correlation is not claimed until V1-08/V1-09.
- Credential and secret sources are structurally removed before public/log
  formatting. Getters are not invoked and Error internals are not projected.

DOM clobbering through application-chosen `id` or `name` does not grant access
to framework authority because security decisions do not read named globals.
Renderer conformance will still include clobbering-shaped fixtures.

## Limits and residual risk

The framework cannot identify a secret that application code deliberately
renders as ordinary text or authenticated raw HTML. Contextual encoding prevents
parser interpretation, not disclosure. CSP cannot repair unsafe raw markup and
is not active without a correlated response header. CSS, SVG, MathML, iframe
documents, executable application markup, and complex URL-list grammars remain
outside the accepted V1-07 surface.

V1-08 owns failure status, incident identity, response commitment, and streams.
V1-09 owns renderer integration, real HTML output, nonce/header correlation,
browser parsing, and CSP violation evidence.
