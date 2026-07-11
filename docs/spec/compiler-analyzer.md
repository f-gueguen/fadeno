# Compiler, analyzer, generated types, and diagnostics

The compiler and analyzer preserve standard TypeScript and JSX while enforcing
Fadeno's structural boundaries. They do not create a second source language.

## Inputs and ownership

1. Stock TypeScript parses application source.
2. Route roots, configuration, and package entrypoints are explicit build
   inputs. File discovery is deterministic and confined to declared roots.
3. Page and fragment render bodies are server-zone roots. Extractable event
   closures and islands are browser-zone roots. Shared modules remain
   environment independent.
4. Import and value-flow analysis refuses ambiguous execution ownership. It
   does not relocate code based on call-graph guesses.
5. Generated file paths cannot escape their configured root through source
   names, route parameters, symlinks, or platform-specific separators.

## Generated artifacts

The implemented vertical slice generates only artifacts consumed by working
behavior:

- a route manifest;
- stock-TypeScript declarations for route parameters and links;
- action-field and request-context declarations when their public contracts
  exist;
- extracted browser handler modules under ADR 0015's accepted private contract;
- a diagnostic registry and machine output only when there is a consumer.

Generation is reproducible: a clean second run over identical inputs produces
byte-identical outputs and does not rewrite unchanged files. Generated files
identify their generator version and are never hand-edited.

## Type spine

H3 must demonstrate that stock `tsc` catches invalid route parameters, link
destinations, action fields, and context access at the application source
location. Framework-specific editor services may improve presentation only
after the stock-TypeScript contract works.

Generated declarations cannot weaken a control-flow guarantee from runtime
behavior. Positive and negative type fixtures are public conformance artifacts.

## Interaction extraction

ADR 0015 accepts bounded extraction as a V3 implementation ingredient without
publishing the K0 marker syntax, candidate, filenames, or diagnostic schema.
The accepted semantic contract requires:

1. browser modules contain only the selected handler and one statically
   resolved self-contained behavior function; additional dependency emission
   is not accepted by the K0 corpus;
2. captured values satisfy the accepted serialization/plain-data corpus;
3. server imports, secrets, opaque capabilities, and unsupported closures are
   rejected with teaching diagnostics;
4. the handler module is not requested before the interaction strategy requires
   it;
5. the compiler never substitutes whole-fragment hydration for a rejected
   handler.

Capture analysis measures one canonical JSON envelope, including names and
framing, against a 65,536-byte UTF-8 limit before emission. Only referenced
root-body variable declarations may enter that envelope. Root parameters,
same-source helpers, extra imported helpers, unresolved runtime values, and
behavior functions with dependencies are refused conservatively. Emission is
transactional and rejects traversal plus symlinked roots, descendants, and the
nearest existing ancestor of a not-yet-created root.

## Diagnostics

Every diagnostic has a stable internal identifier, severity, concise message,
source range, explanation link, and actionable correction where one exists.
Expected user errors omit internal stack noise. Internal defects retain an
incident identity and reproduction context without leaking source secrets.

Diagnostic identifiers become compatibility-controlled only when DG-A0-02
accepts the external schema. Until then they remain internal but are still
snapshot-tested to prevent accidental churn.

## Conformance

- Positive and negative zone, import, capture, serialization, route, link,
  field, and context fixtures run under stock TypeScript.
- Two clean generations are byte-identical.
- Diagnostic fixtures assert identifier, source range, explanation link, and
  stable correction.
- Path and symlink fixtures prove generated output cannot escape declared roots.
- Public API and analyzer schema snapshots are added when those surfaces become
  externally supported, not before.
