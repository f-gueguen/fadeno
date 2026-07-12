# Compiler, analyzer, generated types, and diagnostics

The compiler and analyzer preserve standard TypeScript and JSX while enforcing
Fadeno's structural boundaries. They do not create a second source language or
replace ordinary TypeScript parsing, typing, completion, hover, references,
rename, formatting, or refactoring.

## Private analyzer authority

ADR 0030 requires one private, tool-neutral analyzer session for Fadeno
semantics. Framework check, watch/build integration, tests, and a disposable
lifecycle consumer use that session instead of recreating configuration,
ownership, diagnostic, correction, or explanation policy.

The session is not a public package entrypoint or supported protocol. Its wire
representation and concrete TypeScript interfaces remain implementation
details until a demonstrated consumer and DG-A0-02 justify compatibility.

The analyzer owns only framework configuration and workspace ownership, route
and generated-artifact relationships, execution-boundary facts, framework
diagnostics and corrections, construction-time provenance, and framework plan
or explanation evidence. It does not infer observed request, authorization,
resource, streaming, cancellation, or browser outcomes from source.

## Operation and facet model

Every analyzer operation and immutable snapshot identifies:

- analyzer/schema version and operation ID;
- a workspace-incarnation identity unique across session restarts;
- workspace epoch and relevant document versions;
- requested namespaced facets and ownership inputs;
- completeness or interruption state;
- explicit truncation state where limits apply;
- correlation and causation IDs where evidence is linked.

Module-owned facets have independent versions and bounded contributions. An
absent facet, an unknown facet namespace, and a newer unsupported facet version
are distinct states. A consumer preserves opaque evidence or explicitly
refuses interpretation; it never silently discards or reinterprets it. The
envelope remains minimal and does not centrally enumerate future framework
concepts.

## Document synchronization

V1 supports saved files and unsaved buffers in one workspace root. The session
normalizes URI and path ownership through the same configuration rules as
build, watch, and tests. Multi-root requests are explicitly unsupported.

Document versions are monotonic. One operation may apply multiple sequential,
position-dependent edits; each edit addresses the text produced by the
preceding edit. Full-document replacement, close, and reopen are explicit.
Invalid or out-of-order versions are refused without mutating current text.
Normalization and line-ending tests prove the analyzer string is
code-unit-for-code-unit equivalent to its declared owner after each accepted
operation.

V1-DX-B1 represents saved backing text and an open unsaved overlay separately.
While open, the overlay is authoritative. A saved-file notification updates the
backing text without replacing the overlay; close reveals the latest backing
text. Reopen creates a new lifetime identity and may restart its document
version, so earlier-lifetime work cannot match it. Close carries the expected
current open version and lifetime. Change and replacement operations also carry
the lifetime; work queued for a closed lifetime is refused even when its
version would otherwise be newer than the reopened document.

Edit coordinates are zero-based JavaScript string code-unit offsets with half-open
`[start, end)` ranges. A batch is applied in declared order to a temporary text,
where edit N addresses the result of edit N-1. The complete batch commits once;
the analyzer never sorts edits or retains a valid prefix after a later refusal.
Non-integer, reversed, and out-of-bounds ranges are refused.

Every accepted transition advances the workspace epoch, including a same-text
replacement or saved notification with a new internal revision. A refusal
returns a frozen internal code and attempted operation identity but does not
change document state, lifetime, version, epoch, or the current snapshot.

Saved notifications are accepted only after fatal UTF-8 decoding of the
canonical owned file produces exactly the supplied JavaScript string. A
mismatch, missing owner, or decode failure is atomic and cannot publish a saved
state that differs from the filesystem. Workspace-incarnation identity and
session-prefixed operation IDs prevent stale work from a replaced session from
matching a new session whose epoch and document versions restarted.

Canonical document keys are file-backed paths beneath one absolute real root.
Equivalent absolute paths and encoded `file:` URIs collapse to one owner.
Other schemes, URI authority/query/fragment, root or directory ownership,
escapes, symlink components/aliases, and a second root are refused. Existing
files must be ordinary files. A new in-root file is accepted only when its
nearest existing ancestor is a real contained directory. Paths are never
lowercased generically.

Source JavaScript strings are preserved code-unit-for-code-unit; URI
normalization never changes text or line endings. Existing files decode as
fatal UTF-8 while preserving an initial BOM as U+FEFF. LF, CRLF, BOM, and
non-ASCII fixtures assert exact effective text rather than making a byte claim
about JavaScript strings.

B1 snapshots contain only the frozen operation envelope, ownership identity,
and effective document states. They have no facets. Every nested object and
array is frozen and prior snapshots remain unchanged. B2 adds namespaced facets
and serialization without redefining this document authority.

V1-DX-B2 derives a schema-v2 facet snapshot from one current B1 document
snapshot. The derived operation receives a fresh session-scoped operation ID
but retains the source workspace epoch, ownership, document versions, and
deeply immutable document objects. It does not replace the session's current
document snapshot or publish analyzer results; atomic publication remains B4.

A request names each desired facet namespace once. A module may contribute at
most one independently positive-integer-versioned value for a requested
namespace. Requests and contributions are sorted by code-unit order. A
consumer explicitly observes `absent` when no contribution exists, `unknown`
when it has no namespace reader, `newer` when the contribution exceeds its
supported version, or `supported`. Unknown and newer values remain opaque and
are preserved; consumers do not infer a fallback representation.

Facet values use normalized JSON-compatible plain data. Null, booleans,
strings, finite numbers other than negative zero, dense arrays, and plain
records are accepted. Sparse arrays, accessors, symbols, exotic prototypes,
undefined, non-finite or negative-zero numbers, and other lossy values are
refused before a snapshot exists. Record keys are normalized by code-unit
order. One operation permits at most 32 requests and 32 contributions, 65,536
UTF-8 bytes per contribution, 262,144 aggregate contribution bytes, depth 16,
and 4,096 value nodes per contribution. Duplicate or unrequested
contributions and every limit violation refuse the entire derived operation.

The private serialization envelope has version 1 and carries the complete
schema-v2 snapshot. Deserialization validates exact envelope and snapshot
fields, B1 document/open-version correspondence, facet bounds and normalized
ordering, then deeply freezes the result. Serialize/deserialize/serialize is
byte stable for accepted snapshots. Absent facets, opaque unknown or newer
facets, workspace and document identity, ownership, completeness,
interruption, and truncation survive round trips. Alternate serialization or
snapshot versions and malformed evidence are refused. These numbers and
interfaces remain private implementation contracts under DG-A0-02.

## Invalidation, recomputation, and publication

Invalidation discovers the complete affected dependency closure before
recomputation. It records the cause for each affected item and produces one
deterministic work order. Direct and at least three-level transitive changes
must refresh every affected result. Unsupported cycles are refused explicitly.
Deletion or rename removes artifacts whose owner disappeared; configuration
and generated-artifact changes advance the workspace epoch independently from
document versions.

Recomputation publishes diagnostics, route manifests, generated declarations,
mappings, and deletions atomically for one workspace epoch. Diagnostic batches
use full-replacement semantics. No consumer can observe a partial mixture of
generations, and repairing an error removes its stale diagnostic instance.

Long operations and deep explanation accept cancellation. New work supersedes
obsolete work. A completed result is publishable only while its document
versions, workspace epoch, operation ID, requested facets, and ownership inputs
remain current.

## Provenance

Route records, declarations, generated artifacts, ownership edges, later
resource/action relationships, extracted handlers, rendering decisions, and
explanation facets attach provenance during semantic construction. Provenance
contains the primary source origin, related origins, module/transformation
identity, generated-artifact owner, and both source-to-artifact and
artifact-to-source relations. Later reconstruction is not an acceptable source
of required evidence.

## Inputs and ownership

1. Stock TypeScript parses application source.
2. Route roots, configuration, and package entrypoints are explicit build
   inputs. ADR 0027's route root is project-relative, POSIX-shaped, real-path
   confined, and symlink-free. File discovery is deterministically sorted and
   confined to declared roots.
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

ADR 0018 establishes that stock `tsc` and the stock TypeScript language server
consume correlated generated declarations and report invalid route parameters,
link destinations, action fields, and context access at the application source
location. Framework-specific editor services are not required for V1.

The K0 whole-file incremental strategy did not meet its locked cost ratio. V1
therefore permits deterministic clean generation and unchanged-byte avoidance,
but makes no bounded single-route incremental claim until a redesigned strategy
qualifies without weakening correlation or stale-output removal.

Generated declarations cannot weaken a control-flow guarantee from runtime
behavior. Positive and negative type fixtures are public conformance artifacts.
ADR 0027's application-bound `fadeno:routes` module derives a
route-discriminated link-input union;
generation must retain correlation for static, dynamic, rest, and route-union
inputs rather than combining unrelated route and parameter unions.

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
same-source helpers, every imported runtime value or namespace member other
than the one self-contained behavior function, unresolved runtime values, and
behavior functions with dependencies are refused conservatively. Emission is
transactional and rejects traversal plus symlinks in every existing output-path
component. Capture numbers must be finite and must not lose negative-zero
semantics through JSON; `__proto__`, `constructor`, and `prototype` object keys
are refused at every nesting depth.

## Diagnostics

Every diagnostic has a stable internal identifier, severity, concise message,
explanation link, and actionable correction where one exists. A diagnostic tied
to source text has an exact source range; filesystem/configuration ownership
diagnostics carry the project-relative path and an explicit `null` range rather
than inventing a line number.
Expected user errors omit internal stack noise. Internal defects retain an
incident identity and reproduction context without leaking source secrets.

Diagnostic identifiers become compatibility-controlled only when DG-A0-02
accepts the external schema. Until then they remain internal but are still
snapshot-tested to prevent accidental churn.

Analyzer diagnostic results add structured parameters, module and phase,
primary and related locations, exact ranges or an explicit null-range reason,
causal diagnostic instance IDs, skipped-work relationships, internal-failure
identity, correction intent, redaction state, and explanation reference where
applicable. Human messages are rendered from structured fields. Consumers do
not parse prose to select behavior, identity, or fixes.

An independently actionable child remains a diagnostic instance rather than
being hidden in parent prose. A skipped operation names the causal diagnostic
instances that prevented it. Expected user errors remain separate from
internal failures, and ordinary runtime exceptions remain outside the static
analyzer contract.

## Corrections

Structured corrections contain a stable internal fix ID, parameters, concrete
edits when safe, preferred status when applicable, `automatic` or `review`
safety, and the diagnostic instance IDs addressed. The analyzer constructs the
correction. A consumer may present or apply it but does not infer edits from a
message.

Position-dependent correction edits follow the document synchronization order.
A correction is refused as stale unless its document version, workspace epoch,
and ownership inputs still match.

## Serialization and explanation

Snapshots, diagnostic batches, cached results, explanation records, and
transported artifacts are versioned. Round trips preserve diagnostic codes and
parameters, primary and related locations, causal edges, provenance, artifact
ownership, skipped-work reasons, completeness, redaction, and truncation.

Plan and explain data are lazy namespaced facets. Semantic detail is bounded;
forensic detail requires explicit activation and byte, record, depth, duration,
and child-event limits. Redaction happens before collection. Cancellation and
explicit truncation are observable. Contributions that exceed bounds, violate
redaction, or use unsupported versions are refused without corrupting the
snapshot. Explanation never re-executes application behavior and is never
required for correctness.

Private analyzer snapshots contain static facets only. Observed runtime
operation records use a separate record family and schema with independently
versioned module-owned contributions. The two families may be correlated
through stable operation or artifact identity only when the observed evidence
exists. Static analysis never reports an observed authorization result, request
order, stream timing, cancellation result, or browser outcome.

## Conformance

- Positive and negative zone, import, capture, serialization, route, link,
  field, and context fixtures run under stock TypeScript.
- Two clean generations are byte-identical.
- Diagnostic fixtures assert identifier, source range, explanation link, and
  stable correction.
- Path and symlink fixtures prove generated output cannot escape declared roots.
- Document synchronization reference-model fixtures cover incremental edits,
  sequential edit batches, full replacement, version refusal, close/reopen,
  normalization, and analyzer-text equivalence.
- Direct and three-level transitive dependency fixtures cover deterministic
  recomputation, cycles, deletion, rename, configuration epochs, and owner
  disappearance.
- Atomic-publication fixtures compare diagnostics, declarations, manifests,
  mappings, and deletions as one epoch, including error repair and recovery.
- Cancellation and supersession fixtures prove obsolete results are not
  published.
- Construction-time provenance, exact and explicitly unknown ranges, causal
  diagnostics, actionable children, and correction application have positive
  and refusal fixtures.
- Versioned serialization round trips preserve all semantic evidence.
- Explain fixtures cover disabled, semantic, deep, truncated, cancelled,
  redacted, and malicious-contribution refusal behavior.
- After V1-09, the canonical application supplies executable success, failure,
  correction, flow-inspection, and recovery scenarios from a current packed
  package through public entrypoints. Outputs normalize unstable values and
  documentation is sourced from verified files.
- Before V1 exit, a disposable private client proves the full open/edit/
  diagnose/regenerate/reload/repair/supersede/close lifecycle and cleanup.
- Feedback evidence measures edit/save to fresh and cleared consumer-visible
  state, including invalidation, generation, TypeScript refresh, Fadeno
  analysis, and publication. It makes no incremental bound claim.
- Public API and analyzer schema snapshots are added only when those surfaces
  become externally supported, not for the private V1 session.
