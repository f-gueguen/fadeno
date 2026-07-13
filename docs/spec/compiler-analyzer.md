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
fields, the session-scoped operation identity, canonical root URI, contained
document path/URI ownership, B1 document/open-version correspondence, facet
bounds, and normalized ordering, then deeply freezes the result.
Serialize/deserialize/serialize is byte stable for accepted snapshots. Absent
facets, opaque unknown or newer facets, workspace and document identity,
ownership, completeness, interruption, and truncation survive round trips.
Alternate serialization or snapshot versions and malformed evidence are
refused. These numbers and interfaces remain private implementation contracts
under DG-A0-02.

## Invalidation, recomputation, and publication

Invalidation discovers the complete affected dependency closure before
recomputation. It records the cause for each affected item and produces one
deterministic work order. Direct and at least three-level transitive changes
must refresh every affected result. Unsupported cycles are refused explicitly.
Deletion or rename removes artifacts whose owner disappeared; configuration
and generated-artifact changes advance the workspace epoch independently from
document versions.

V1-DX-B3 represents this work as a private schema-v3 candidate graph derived
from the current B1 document snapshot. Every node has a namespaced identity,
one current document owner, a positive definition version, sorted dependency
identities, one independently versioned module/transformation identity, and a
bounded synchronous construction function. The graph permits at most 4,096
nodes, 256 dependencies per node, 4,096 generated artifacts, and 8,388,608
serialized snapshot bytes. Definitions
with duplicate or missing identities, owners outside the current document
snapshot, unknown dependencies, cycles, invalid artifact paths, duplicate
artifact identities or paths, lossy values, limit violations, or failed
construction are refused before graph state changes.

The graph compares complete immutable B1 document records, rather than caller
supplied dirty flags, with the records from its last accepted analysis. A
saved-revision, overlay, version, lifetime, text, owner, definition, or
configuration-epoch change therefore creates a direct invalidation reason.
Reverse dependency traversal derives the complete affected closure before any
construction runs. Dependency-first work order is a deterministic code-unit
topological sort. Each affected node records its direct document, definition,
configuration, or immediate dependency causes, so a multi-level causal chain
remains inspectable without flattening it into one root label. A refusal leaves
the prior definitions, results, fingerprints, generation, and snapshot object
unchanged.

Definition identity is the node owner, explicit definition version, sorted
dependencies, and module/transformation identity. Function allocation identity
is not semantic identity: reconstructing an equivalent private module callback
does not invalidate work. A module that changes construction semantics must
advance its definition or module version. Construction callbacks are pure
analyzer-module functions over source text and prior analyzer values; they do
not execute application behavior.

Configuration reload is a session-owned transition identified by a normalized
SHA-256 fingerprint. Every accepted reload, including a repeated fingerprint,
advances both the workspace and configuration epochs without changing document
versions. The next graph analysis invalidates every node for that configuration
epoch. The fingerprint identifies an ownership input and is not configuration
content.

Owner deletion removes its node results and every artifact no longer present
in the candidate graph. A rename is represented by the filesystem-backed B1
removal of the closed old owner, addition of the new owner, and one validated
next graph definition set. Stale old-owner results and artifacts disappear,
while new-owner provenance is constructed from the new canonical URI. A
surviving artifact identity may be replaced by its new owner in the candidate;
an artifact absent from the candidate is listed for deletion. B4 owns atomic
publication of these candidate replacements and deletions.

Removed-node evidence retains the node ID, prior owner URI, and whether the
definition was removed while its document remained or the owner document
disappeared. Removed-artifact evidence retains its ID, old path, and old owner
node. Changing an artifact path or owner while retaining its ID therefore
deletes the old owned location rather than treating the ID alone as fresh.

Every recomputed node normalizes its semantic value through the B2 bounded
plain-data contract. While a node constructs an artifact, the graph attaches
the primary source origin, transitive related origins, module and
transformation identity, artifact ID/path/node ownership, and both
source-to-artifact and artifact-to-source relations. The primary source range
for this B3 whole-document corpus is the exact code-unit range of the owner;
later semantic modules may narrow it during construction but may not reconstruct
required provenance afterward. Reused unaffected results keep their original
result generation, while recomputed results receive the new candidate
generation.

The schema-v3 candidate includes the requested `fadeno.graph` facet identity
and uses the same private serialization-envelope version as B2. Deserialization
revalidates the session-scoped operation ID, canonical contained root/document
and provenance URIs, sorted document versions and graph identities, exact
invalidation scalar types and causal references, normalized result/artifact
values, removal causes, artifact ownership, and the complete bidirectional
relation cross-product. Round trips preserve candidate generations,
invalidation causes, provenance, ownership, removals, completeness, and
truncation byte-for-byte. Malformed or over-budget transported evidence is
refused rather than cast into a trusted snapshot.

Recomputation publishes diagnostics, route manifests, generated declarations,
mappings, and deletions atomically for one workspace epoch. Diagnostic batches
use full-replacement semantics. No consumer can observe a partial mixture of
generations, and repairing an error removes its stale diagnostic instance.

V1-DX-B4 implements this boundary as one private schema-v4 in-memory
publication generation. A publication ticket captures session, operation,
workspace epoch, sorted document versions, requested facets, configuration
epoch/fingerprint, and single-root ownership before asynchronous materialization
begins. The B3 graph candidate, module-owned facet replacements, complete
artifact set, and owned deletion records are fully validated and frozen before
one reference replaces the prior published snapshot. Check/watch/build and
filesystem application remain B7 responsibilities.

Facet batches and artifact sets use full replacement. An empty diagnostic-like
facet removes all prior records for that namespace; an artifact absent from the
new complete set is no longer current, and its B3 deletion record retains the
old path and owner. Until the replacement reference is assigned, consumers see
the complete prior generation. They never observe a new facet beside old
artifacts or a new artifact set beside old facet records.

Each session permits one current publication ticket. Explicit cancellation,
an accepted document/configuration transition, or a newer ticket aborts the
materialization wait immediately even when module work ignores the abort
signal. A cancelled, stale, superseded, refused, or failed ticket returns
structured internal status and cannot advance the publication generation.
Before the final reference swap, the coordinator rechecks the captured session,
workspace epoch, document versions, root, configuration identity, requested
operation, and active-ticket ownership. Obsolete completion cannot overwrite a
newer publication.

The graph preview retains a private prepared candidate bound to its exact graph
baseline and authority identity. Final commit installs that already-constructed
candidate without invoking module construction a second time; a changed
baseline or authority refuses the commit as stale.

Graph preview is queued after the handle is returned, so immediate cancellation
or same-turn supersession prevents graph construction from starting. The graph
passes the abort signal into each bounded synchronous module-construction
callback and checks it before and after every affected node, so cancellation
stops deterministic recomputation before a downstream node begins. A callback
that subdivides its bounded work must inspect that signal between units; it
cannot perform application work or unbounded asynchronous work. Long-running
publication materialization is asynchronous, receives the abort signal, and is
raced against cancellation so an uncooperative promise cannot delay terminal
cancellation or supersession.
Complete lifecycle latency and cancellation timing are qualified in V1-DX-C.

Schema-v4 serialization embeds the strictly validated schema-v3 graph and
revalidates outer/graph identity equality, sorted requested facets,
independently versioned normalized facet contributions, the exact flattened
artifact/provenance set, deletion equality, completeness, and truncation. A
serialize/deserialize/serialize round trip is byte stable; malformed,
inconsistent, or over-budget transported publication evidence is refused.
These private generations do not stabilize an external schema.

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

ADR 0034 adds resource declarations and calls to that construction boundary.
The analyzer identifies an opaque `defineResource` declaration at its exact
source origin and relates each admitted `context.read` call to it without
inventing an application string ID. Unsupported or over-budget input shapes
produce structured framework refusal before dependency generation. Later
unsafe-`keeps` evidence refers to declaration provenance, while observed cache
hits, authorization outcomes, failures, cancellation, and revalidation remain
runtime records rather than static predictions.

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

V1-DX-B7A places route discovery and byte rendering behind one private project
authority. One project analysis loads the owned configuration, captures the
exact symlink-free route sources, synchronizes them into a retained analyzer
session, and publishes a complete in-memory route artifact plan. The plan owns
the seven correlated route outputs, their fixed `.fadeno/routes` paths, source
identity, bytes, hashes, and construction-time provenance. Planning never
creates or modifies `.fadeno`; filesystem application remains V1-DX-B7C.
The configuration value fingerprint and exact validated configuration-source
identity are tracked separately. A source-only configuration edit advances the
configuration epoch even when normalization produces the same value. A route
root change forgets sources that leave project ownership, including
still-existing former-root files, while preserving unrelated session documents
and unsaved overlays. Their graph nodes are removed as definition changes,
never fabricated filesystem deletion. Diagnostic locations name only the
currently managed configuration and route sources, while the private batch
identity retains the complete session document authority needed for freshness.
Immediately before publication, the authority revalidates the complete route
structure and source identity, including newly added entries that were absent
from the captured plan. A stale plan is refused. This analysis-time freshness
check does not authorize a later filesystem applicator to rediscover or rebuild
accepted bytes.

The same publication replaces the complete diagnostic facet and artifact set.
A page/handler ownership collision therefore publishes causal owner and route
diagnostics, review-only correction intent, skipped manifest work, and removal
of the previously current artifact set in one generation. Repair publishes an
empty diagnostic/correction replacement and restores the complete artifact
set. Semantic or explicitly activated deep route explanation is collected
later from that accepted publication and never reruns route discovery or
application behavior.

This authority is an internal module included in the packed implementation but
blocked from package deep imports. It adds no export, executable, command,
protocol, schema version, editor product, or public compatibility promise.
V1-DX-B7B owns the first packed project-check consumer, and V1-DX-B7C owns the
only transactional filesystem applicator.

V1-DX-B7B adds that first consumer as the single declared `fadeno` executable.
Its internal command driver parses only ADR 0032's explicit project-root and
semantic-explanation arguments, then delegates every configuration, route,
diagnostic, correction, artifact, and explanation decision to the B7A project
authority. Complete no-diagnostic route analysis writes a narrowly scoped human
success report to stdout. Expected project diagnostics, usage refusal, and
redacted internal failure use distinct exit codes and stderr reports. Human
causal and skipped-work lines render stable diagnostic codes rather than random
operation-instance identities.

The packed workflow hashes the freshly built package manifest, CLI, complete
relative internal module closure, installed configuration-parser package, and
the parser's selected platform executable. It verifies the clean installation
matches and mutation-tests the CLI, parser code, and parser executable identity
before scenarios run. Canonical
success, collision, correction guidance, semantic flow, and recovery execute
only through `node_modules/.bin/fadeno` and leave no project output. JSON and
other machine-output options remain usage errors; private analyzer transports
and DG-A0-02 are unchanged.

V1-DX-B7C gives the originating project analyzer the only private authority to
apply a route publication. Disk application accepts exactly the current,
complete, diagnostic-free set of seven `fadeno.routes` artifacts, with their
fixed IDs, paths, owner, UTF-8 bytes, hashes, and construction provenance. A
generic analyzer artifact or removal is never filesystem authority. In
particular, a diagnostic publication that removes the in-memory route plan
preserves the last accepted disk generation; repair applies a new complete set.

Application rechecks the current session, operation, workspace and
configuration epochs, document versions, configuration source, route structure,
and source bytes through the analyzer immediately before mutation and after
replacement. A newer analysis, transported snapshot, source/configuration edit,
new entry, deletion, rename, or ownership change makes the older application
authority unusable. The filesystem applicator validates and writes accepted
bytes but never discovers routes or renders an artifact.

The route directory transaction stages and validates a complete owned set,
backs up at most one validated previous generation, replaces the directory,
revalidates freshness, and cleans the backup. Exact reapplication is a zero-write
operation that preserves every mtime; partial per-file preservation is not
claimed. Portable replacement has a bounded interval between the backup and
replacement renames in which the `routes` directory is absent, but it never
exposes a mixed file generation. B7D3 serializes analyzer application and
compiler validation across that interval; later build and development consumers
must use the same retained boundary before claiming continuous usable state.

An actual operation failure restores the validated previous generation when
possible. If restore itself fails, the validated previous directory remains for
deterministic next-run recovery. A complete new output plus a retained previous
directory is conservatively resolved by restoring the previous accepted
generation and reapplying the current publication. Pending output is never
promoted. Recovery validates every candidate before mutation; ambiguous previous
generations and symlinked, partial, or unowned transaction debris fail closed
without deleting or guessing ownership.

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

V1-DX-B5 implements these semantics as the private independently versioned
`fadeno.diagnostics` facet. Diagnostic definitions own the only accepted code,
module, phase, parameter keys, parameter values, summary renderer, redaction,
and explanation mapping. Inputs cannot contribute free-form prose, stacks, or
arbitrary context. Instance, cause, correction, and skipped-work references are
same-batch, unique, acyclic, and canonically ordered. Locations are contained
project files with an exact bounded offset range or one explicit ownership
reason for a null range. The module rejects evidence that cannot prove those
facts rather than repairing it during deserialization.

This facet is a static analyzer record family. Existing build and runtime
exceptions remain separate and are not retrofitted or parsed to construct it.
Its version and fixtures are private evidence, not the compatibility-controlled
external diagnostic schema gated by DG-A0-02.

## Corrections

Structured corrections contain a stable internal fix ID, parameters, concrete
edits when safe, preferred status when applicable, `automatic` or `review`
safety, and the diagnostic instance IDs addressed. The analyzer constructs the
correction. A consumer may present or apply it but does not infer edits from a
message.

Position-dependent correction edits follow the document synchronization order.
A correction is refused as stale unless its document version, workspace epoch,
and ownership inputs still match.

B5 correction applicability captures the diagnostic publication's session,
operation, workspace and configuration epochs, complete document-version set,
root, configuration fingerprint, and document text lengths. Both automatic and
review-only intents are checked against the current publication operation and
authority before use, so full-batch replacement stales every prior intent even
when document and configuration state did not change. The only initial
automatic correction is a code-owned single-document configuration edit whose
expected old bytes, exact diagnostic range, and replacement bytes derive from
its validated parameters; the route-role
collision stays review-only because removing either owner would guess intent.
The analyzer prepares one already-validated sequential edit batch and the
document session applies it atomically. Repair makes the prior intent stale.

## Serialization and explanation

Snapshots, diagnostic batches, cached results, explanation records, and
transported artifacts are versioned. Round trips preserve diagnostic codes and
parameters, primary and related locations, causal edges, provenance, artifact
ownership, skipped-work reasons, completeness, redaction, and truncation.

The private B5 diagnostic codec uses exact keys, canonical ordering, same-batch
referential integrity, construction-time redaction, contained locations, and a
262,144-byte total bound. Serialize/deserialize/serialize is byte stable. The
generic facet transport preserves the resulting value, while consumers that
interpret diagnostics must use the module-owned codec rather than treating an
arbitrary facet object as a diagnostic batch.

Plan and explain data are lazy namespaced facets. Semantic detail is bounded;
forensic detail requires explicit activation and byte, record, depth, duration,
and child-event limits. Redaction happens before collection. Cancellation and
explicit truncation are observable. Contributions that exceed bounds, violate
redaction, or use unsupported versions are refused without corrupting the
snapshot. Explanation never re-executes application behavior and is never
required for correctness.

V1-DX-B6 implements explain as a separate private read-only operation bound to
the exact current publication and workspace/configuration authority. Disabled
mode does not invoke a collector. A newer explain supersedes prior work;
selecting disabled mode also supersedes and aborts prior explain work.
document, configuration, or publication work invalidates it; cancellation races
late asynchronous collection without changing graph, diagnostic, artifact, or
correction state. Deep collection requires an explicit activation flag and
explicitly bounded budgets. Duration expiry aborts the collection signal and
returns partial evidence; elapsed synchronous module work is measured before a
result may be accepted, while cooperative cancellation remains the module
boundary rather than hostile synchronous preemption. Collector failures,
including synchronous throws, become atomic refusals.

The first module-owned projector is the independently versioned
`fadeno.routes.explain` contribution. It derives semantic decisions, contained
source ownership, generated-artifact identity, skipped diagnostic work, and a
static outcome from immutable publication evidence. Deep mode additionally
projects construction transformation provenance. It never reads source text,
executes construction callbacks, or emits observed runtime facts. The generic
envelope remains open to later independently versioned module codecs rather
than enumerating future framework concepts.

The route projector requires a complete current diagnostic batch. A missing
batch is not treated as an empty batch, and the projector round-trips the B5
module codec before using it so forged partial or truncated evidence refuses.
Static route refusal derives from the
module-owned skipped manifest relationship rather than from the mere presence
of diagnostics, so later non-blocking diagnostics cannot silently change plan
policy. Explanation record IDs use deterministic local ordinals while original
graph and diagnostic identities remain structured fields; distinct valid owner
IDs therefore cannot collide through lossy display encoding. Complete module
contributions require one coherent decision and outcome, matching cause codes
and edges, and a skipped manifest relationship exactly when the static plan is
refused; transport mutations cannot independently rewrite those claims.

The route module owns exact record keys and the only initial static kinds:
decision, diagnostic cause, ownership, skipped work, static outcome, and deep forensic
provenance. Semantic mode refuses forensic records. Parent and causal
identities are deterministic, same-contribution, acyclic, and bounded. Budget
selection and depth include both parent and causal edges, so every retained
record retains its parent and causal evidence. Diagnostic codes come from the
structured diagnostic module's allowlist rather than arbitrary contribution
text. The projector receives the operation budgets and bounds record retention,
per-record artifact children, and encoded record bytes while constructing the
contribution; it does not first allocate the complete application-sized flow.
Any construction truncation remains explicit in the module contribution and
the common operation result. A module-owned witness records the limiting
dimension, limit, observed value, and retained value; transport reprocessing
requires that witness to be structurally consistent with the requested budget
and retained evidence, so empty record, depth, or child claims refuse. This
private codec is an integrity boundary for analyzer-produced data, not an
authentication scheme: a party that fabricates an entirely schema-conforming
witness is outside the trusted private transport contract. No public or
external compatibility claim follows from the fixture.
Diagnostic causes are projected in deterministic causal order rather than
diagnostic-key order, preserving valid forward causal references. Valid budget exhaustion retains only validated records and reports one explicit
`bytes`, `records`, `depth`, `children`, or `duration` truncation reason;
malformed or runtime-family evidence refuses atomically. Its private transport
uses exact envelope keys, an enforced pre-parse byte limit, and byte-stable
round trips. Allowed identifiers and diagnostic codes are validated through
their owning module rules rather than accepting arbitrary strings in an
otherwise allowed field.

The operation transport preserves analyzer and schema versions, operation,
session, workspace and configuration epochs, requested facet, complete
document-version set, root and configuration ownership, publication identity,
budgets, completeness, interruption, and truncation.
Complete, limit-truncated, duration-truncated, and interrupted results round
trip byte-stably. Deserialization reprocesses each module contribution under
the transported budgets and requires its module truncation to agree with the
common status; complete and partial evidence cannot be relabeled independently.
A contribution whose publication or detail identity differs
from the operation refuses atomically. Refusal codes are allowlisted and
workspace/document file URIs are exact, canonical, query-free, fragment-free,
and contained. The operation transport limit covers the maximum valid
publication identity and 4,096-document version set in addition to bounded
module evidence; a 4,097th document identity refuses. B6 accepts exactly the initial route
contribution. A small private descriptor registry dispatches requested
namespaces to their module-owned processor, identity matcher, and codec; unknown
or duplicate requests refuse before collection. Later modules register their
own descriptors and explicit requests rather than entering a closed central
record enumeration. The module-owned human
renderer and normalized machine fixture are derived from the same validated
success, refusal, and recovery contributions.

Private analyzer snapshots contain static facets only. Observed runtime
operation records use a separate record family and schema with independently
versioned module-owned contributions. The two families may be correlated
through stable operation or artifact identity only when the observed evidence
exists. Static analysis never reports an observed authorization result, request
order, stream timing, cancellation result, or browser outcome.

## Retained consumer sequencing

V1-DX-B7D delivers retained consumption in independently reviewable stages.
B7D1 establishes one private long-lived project owner around exactly one
analyzer session. Analysis admission returns a frozen private handle whose
monotonic request identity is allocated before work starts and remains
available when the result rejects. This coordinator identity is distinct from
the analyzer publication identity produced inside a successful analysis.

Accepted analysis and derived explanation operations execute in admission-order
FIFO with no overlap. A failed operation settles its own result but cannot
poison the queue or prevent later admitted work. Explanation admitted from the
current analysis before a later analysis drains first; an old explanation
requested after later analysis admission refuses as stale. Admitting analysis
immediately invalidates the prior synchronous B7C application capability, even
while the new analysis waits in the FIFO. Filesystem application itself is not
queued or made asynchronous in B7D1.

The coordinator lifecycle is `accepting` → `closing` → `closed`. Close stops
admission synchronously, invalidates derived capabilities, drains every already
admitted operation despite individual failure, and is idempotent. It does not
claim resource release because the current analyzer session owns no live
external handle.

B7D2 assigns every analysis admission a monotonic generation. Pending analysis
admissions collapse into one deterministic batch identified by its first and
latest request identities and admission count. A newer admission synchronously
supersedes a pending analysis and signals an active analysis before returning;
only the newest complete generation can regain application or explanation
ownership. Superseded or cancelled pending entries unlink from the FIFO in
constant time; the retained batch summary does not copy every request identity.
Explicit cancellation has a distinct terminal identity. An already
admitted explanation remains ordered before a later analysis and is not
cancelled merely because analysis became dirty.

The one coordinator still executes operations without overlap. Its drain owns
accepted queue work through result-continuation handoff, failure cleanup, and
close. Work admitted while the drain is active is either consumed by that drain
or schedules the next drain before idle is observable. Close refuses new
admission synchronously and waits until every earlier admission has published,
failed, cancelled, or been superseded.

Project document synchronization uses one private session reconcile transition.
It canonicalizes the complete desired and forgotten set, rejects duplicate
aliases, validates desired text against the authoritative files, checks exact
saved-revision ownership, and constructs the next document map from cloned
state. Project scanning owns saved records only; it never creates, adopts, or
rewrites an unsaved overlay. Only after every item passes does reconciliation
replace the map, advance one workspace epoch, and invalidate derived evidence
once. A still-existing former route-root owner may be forgotten only through
its exact managed saved revision; any open buffer on a desired or forgotten
path refuses the whole batch. Retained source text is therefore bounded to
current ownership rather than cumulative historical route roots.

Filesystem notifications are invalidation hints, not semantic facts. B7D4 must
coalesce contained hints, exclude owned output, and rescan through the same
project authority used by check and tests. Rename, duplicate, missing-name, and
overflow notifications cannot directly create or delete framework records.

B7D4 implements that boundary as a private tool-neutral invalidation adapter.
It accepts only `change` and `rename` notification kinds with a string path or
an explicitly missing name. A named path is normalized against the exact
project root, refused when external, malformed, or reached through a symlink,
and excluded when it belongs to `.fadeno` output or repository metadata.
Rename, missing-name, duplicate-alias, and precise-hint overflow state discard
path-level interpretation and request a complete workspace rescan. Exact
duplicate changes coalesce. None of these admissions creates, deletes, renames,
or otherwise mutates an analyzer record.

Accepted admissions form one immutable bounded batch containing only normalized
hints, rescan reasons, a full-workspace flag, and accepted-admission sequence
bounds. Raw notification identity remains separate, so excluded or refused
notifications cannot create gaps or ambiguity in batch ownership. A
private bounded debounce deadline moves after each admission but never beyond
the first admission's maximum delay. Its production clock is monotonic, and an
injected scheduler rollback is clamped to the last observed instant so accepted
work cannot be stranded. Pending paths, reasons, completion waiters,
and counters have explicit limits. Named paths have a per-path UTF-8 byte limit,
and retained normalized/raw path pairs share an aggregate byte budget. Exceeding
the aggregate budget discards precise hints and schedules a full authoritative
rescan; exceeding the per-path limit is refused before retention. A notification
received while refresh is active sets pending work for exactly one later batch;
the active B7D3 refresh is never overlapped or superseded by the adapter itself.
Completion and failure observers cannot control scheduling ownership.

Flush forces pending work through the same retained `refresh` operation and
settles only when the batch containing its target admission settles. Close is
idempotent: it cancels the timer, refuses pending flushes, cancels and drains the
active refresh, and closes the retained project authority. The adapter contains
no operating-system watcher, watcher selection, server, command, public schema,
or public package export.

B7D3 adds one private `refresh` operation to the retained analysis queue. One
coordinator item performs project analysis, begins a provisional B7C
route-directory transaction, runs stock compiler validation, rechecks the live
operation and exact analysis authority, and then either commits the generated
set or restores the prior accepted set before the item settles. The transaction
retains a validated previous generation, or an explicit first-generation empty
marker, until final acceptance. Its exact provisional bytes and rollback set or
empty marker are revalidated immediately before cleanup. A later admission, explicit cancellation,
compiler diagnostic, process failure, application failure, or close therefore
cannot accept the provisional route set. A rollback operation failure is retried
and retained as project-owned unresolved state; later work must recover it, and
close refuses instead of silently completing while an unaccepted generation is
visible.

Compiler validation uses the installed stock compiler asynchronously with the
project `tsconfig.json`, `--noEmit`, pretty output disabled, and incremental
output disabled. A first stock-compiler pass discovers and content-identifies
the exact resolved inputs. A second pass performs ordinary validation and must
retain the same input bytes and ownership identities. The compiler's own
resolved input listing is checked without
recreating its module graph: every local input must resolve inside the project,
while only the selected compiler package and exact installed package roots with
matching ordinary manifests are accepted outside it. An aggregate dependency
directory, store directory, or other ancestor never grants ownership. Every
non-empty successful input-list record is consumed exactly; whitespace is not
trimmed into a different path. Project-owned source symlinks, external includes
or imports, and a validator bound to another root are refused. The project root
and configuration must remain ordinary, symlink-free owned paths. A globally
bounded project-owned inventory, excluding dependency and repository metadata
directories, is traversed asynchronously with cancellation checks, actual-byte
accounting, file-stability checks, and bounded file streaming. Its digest must
be identical before and after the compiler child and is checked again
immediately before commit. Every exact resolved compiler input is independently
content-identified and rechecked before commit, including installed dependency
inputs, while the provisional transaction remains rollback-capable. Device,
inode, size, modification, and change identities are part of both input passes
and the final check, so a change-and-restore sequence cannot masquerade as one
stable validation generation. Installed
package traversal has one global raw-entry budget, bounded aggregate and
per-manifest bytes, cancellation checks, and identities for logical entries,
canonical roots, package names, and manifest content. Captured
output is bounded and never transported as diagnostic prose; only compiler
diagnostic numbers and an internal run identity survive a failure. Cancellation
requests termination, escalates if necessary, and waits for the actual child
close before rollback, later queue work, or analyzer close can complete.

Route transaction recovery never recursively deletes an authoritative current
or rollback generation. Atomic rename first restores or accepts one exact set;
only then may a displaced set be treated as non-authoritative garbage. Partial
garbage deletion is safe to retry, is distinguished from rollback identity on
restart, and remains retained lifecycle work until cleanup succeeds. The same
rollback backup protects an unchanged generation if its current bytes drift
between provisional application and final acceptance. Recovery ownership is
retained before restart recovery or staging begins; persistent failures in
either early phase therefore refuse close until the same owner or a later
process removes the exact transaction state. A contained ordinary pending
directory is always non-authoritative and may be displaced and removed even
when staging stopped before it acquired the complete artifact shape; symlink or
non-directory pending state still refuses.

An accepted compiler result binds its coordinator request and generation,
analyzer publication operation, provisional artifact source hash, compiler
version, validation inventory identity, and resolved-input identity. Framework
analysis remains authoritative for configuration, routes, generated ownership,
and framework diagnostics. The
stock compiler remains authoritative for ordinary direct and transitive module
refresh; Fadeno does not build a second application dependency graph. B7D4 is
still responsible for translating filesystem notifications into contained
admissions, and later server consumers must use the same accepted coordinator
generation.

These stages are private evidence. The B7D1 through B7D3 implementation is
included in packed internals and explicitly unavailable through package
exports. It adds no stable analyzer schema or editor product. ADR 0033 accepts
the exact build and development lifecycle. B7D6 implements build and B7D7
implements development through private retained consumers. Their private
packed evidence uses one structured stock-compiler snapshot, permits
emission only after a clean batch, and performs a separate no-check stock
emission into a contained stage. Source, environment, framework runtime,
compiler API, compiler binary, generated ownership, and output identities are
rechecked before acceptance. Application modules run only in isolated
generation children after route-loader registration; the retained analyzer
supervisor never imports them. Diagnostic, cancelled, stale, and
runtime-identity-refused candidates preserve the last accepted generation.
This adds no public analyzer schema or deep import.

B7D6's private build driver consumes one retained diagnostic-free refresh,
captures structured compiler diagnostics while provisional route ownership is
still current, and delegates clean emission to the isolated packed child. The
child reuses the retained compiler's bounded installed-package discovery rules
instead of accepting arbitrary external compiler inputs. A complete stage gains
only the build-owned bootstrap and manifest before one output identity is
atomically accepted or the prior `dist` is restored. The public surface is the
human `fadeno build` command and documented start invocation, not an analyzer or
build transport API. Runtime activation binds only the bounded installed graph
of declared production, installed optional, and required peer dependencies;
unrelated development packages are excluded. A prior `dist` or rollback tree
is authoritative only when its bounded manifest and exact owned file set
validate.

B7D7's private development supervisor implements the filesystem refresh target
without duplicating analyzer policy. Each operation requests the same retained
project refresh, captures structured compiler failure while provisional route
ownership is current, and asks the shared generation owner for one staged
candidate. The B7D4 adapter owns debounce, full-rescan ambiguity, dirty work,
and active cancellation; accepted notifications never become a second module
dependency graph. `.fadeno`, `dist`, and repository metadata cannot trigger an
output loop.

Only one complete current candidate may enter the bounded child switch. The
supervisor never imports application modules; a fresh child registers the
generated loader, verifies the accepted manifest and runtime closure, and then
imports the generated handler. Diagnostics and superseded work retain the
prior child and output. Repair publishes a complete clean generation, deletion
removes its former output, and a failed post-accept startup rolls output back
before restarting the previous child. Graceful or forced close owns watcher,
analyzer, compiler, transaction, server, and child settlement. This adds the
human `fadeno dev` command but no public analyzer API, stable machine schema,
or editor product.

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
- Retained-consumer fixtures prove same-turn bursts, active supersession,
  explicit cancellation, exact terminal identity, failure recovery, result
  handoff, pre-close drain, and no operation overlap without timing sleeps.
- Atomic reconcile fixtures rotate across three still-existing route roots,
  prove exact current-document retention, and preserve the prior snapshot and
  epoch across duplicate alias, symlink, stale revision, text mismatch, and
  desired/forgotten open-owner refusal.
- Retained compiler fixtures use the stock compiler over direct and ordinary
  three-edge transitive modules, cover deletion and rename failure and recovery, preserve
  exact prior route bytes across diagnostic/process/cancel/supersede/close and
  first-generation refusal, reject configuration ownership and post-validation
  ordinary-source drift, recover a transient rollback failure before settlement,
  refuse external include/import, source-symlink and mismatched-root ownership,
  reject exact-input whitespace ambiguity and broad dependency-root aliases,
  recheck changed dependency content, package mapping, and manifests during
  validation and before commit, reject change-and-restore input mutation, bound
  globally discovered project and installed
  package entries plus manifest bytes,
  isolate observer re-entry/failure, detect output mutation and bounded-output
  overflow, cancel inventory before child spawn, prove forced termination and
  failed spawn, await every child close, and prove stock compilation leaves no
  compiler output or transaction debris. Transaction fixtures corrupt an
  unchanged provisional generation, partially delete displaced garbage, retain
  failures that occur before application returns, persistently fail staging and
  restart recovery before a transaction handle exists, refuse close while
  recovery, rollback, or cleanup remains unresolved, and prove restart recovery
  preserves one exact accepted generation.
- Filesystem invalidation fixtures use a deterministic scheduler to prove
  debounce and maximum delay, exact duplicates, duplicate aliases, distinct
  notification/admission identity, exact duplicate-event counts, per-path and
  aggregate byte bounds, bounded hint overflow, clock rollback, event-during-work dirty
  ownership, no lost wakeup, output and
  repository exclusion, external/malformed/symlink refusal, rename and
  missing-name full rescans, observer isolation, idempotent close, and no timer
  or retained-work leak. A real canonical application fixture proves direct
  change, compiler failure with last-good preservation, recovery, deletion,
  rename, configuration epoch, and packed-private inaccessibility.
- Build/development decision fixtures use a current packed package to prove
  exact command and compiler refusal, generation-scoped environment precedence,
  bounded framework/compiler/runtime identity, structured exact/global
  diagnostics, contained clean emission, loader-before-bootstrap refusal and
  success, distinct child identities, last-good failure, diagnostic repair,
  stale runtime refusal, and graceful/deadline/repeated-signal shutdown states.
- The packed development fixture uses the canonical application and installed
  executable to prove initial readiness, direct/transitive/configuration/
  rename/deletion/burst refresh, last-good compiler diagnostics, repair and
  stale-artifact removal, complete normalized flow/recovery evidence, graceful
  shutdown, active-stream repeated-signal force, occupied-address refusal, and
  usage refusal.
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
