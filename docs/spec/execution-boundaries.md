# Execution boundaries

## Zones

Fadeno assigns application code to visible execution zones.

| Zone | Owned constructs | Permitted capabilities |
| --- | --- | --- |
| Server | Page and fragment render bodies, resources, actions, server modules | Secrets, storage, request context, server I/O |
| Browser | Extracted event-handler closures, islands, browser modules | DOM and browser APIs, serializable inputs |
| Shared | Pure modules | Environment-independent computation |

Imports and captured values must flow in the permitted direction. A browser
zone cannot import a server module or receive an opaque server capability.
Shared modules cannot inspect environment globals to choose behavior.

An event-handler closure nested syntactically in a server render body is a
browser-zone root once selected for extraction. It does not inherit permission
to capture the surrounding server scope; each import and captured value must
satisfy the extraction boundary.

## Interaction outcomes

The analyzer classifies rendered interaction into one of three intended
outcomes:

1. HTML with no browser behavior;
2. a bounded extracted handler;
3. an explicit island.

Extraction is allowed only when captures and operations satisfy the validated
plain-data and closure rules. A pattern outside those rules receives a stable,
teaching diagnostic. It is never silently converted into broader hydration.

ADR 0015 accepts the bounded closure, import, plain-data capture, identity, and
lazy-loading semantics for V3. The exact K0 authoring marker and candidate
remain private evidence code; a later implementation may expose only a
stock-TypeScript surface that preserves this refusal-first boundary.

## Generated artifacts

The compiler may generate route manifests, declarations, handler modules, and
diagnostic output. Generation must be deterministic, reproducible from tracked
source, and inspectable. Generated output cannot be the sole place a public
decision is recorded.

## Refactoring constraint

Moving code across a zone requires a visible source change. A refactor that
changes execution ownership without changing the boundary declaration is a
compiler defect.
