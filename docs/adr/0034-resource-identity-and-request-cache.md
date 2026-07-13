# ADR 0034: Resource identity and request cache

- Status: Accepted
- Date: 2026-07-14
- Owners: Fadeno maintainers
- Related specifications: [Data consistency](../spec/data-consistency.md), [Public model](../spec/public-model.md), [Compiler and analyzer](../spec/compiler-analyzer.md), [Security requirements](../security/requirements.md), [V1 plan](../roadmap/v1.md)
- Supersedes: None

## Context

ADRs 0005 and 0006 require server-owned reads, request deduplication, dependency
recording, and correctness-first revalidation. ADR 0020 accepts the H4 result
but deliberately leaves public resource identity, equivalent input, cache
scope, failure caching, and `keeps` syntax to the later resource decision.
Implementing V1-11
without those rules would let authorization, rendering, and revalidation assign
different meanings to the same read.

V1-10 supplies a private strict-TypeScript model. It proves equivalent and
distinct inputs, simultaneous reads, authorization isolation, expected and
unexpected failures, cancellation, bounded refusal, flow inspection, and
next-request recovery. The model is package-private evidence, not the V1-11
runtime and not an exported schema.

## Decision drivers

- Resource identity must survive refactoring without an application-maintained
  global string registry.
- Equivalent reads in one request must execute once, including while pending.
- A cached result must never cross an authorization or representation boundary
  accidentally.
- Key construction must be deterministic, bounded, side-effect free, and
  conservative for values it cannot represent exactly.
- Failures and cancellation must have one rendering and dependency meaning.
- Removing every revalidation optimization must preserve correctness.

## Decision

### Declaration, call, and provenance identity

V1 exposes one declaration shape and one page-context read shape:

```ts
const projects = defineResource({
  async read({ input, request, signal }) {
    return findProjects(request, input, signal);
  },
});

const value = await context.read(projects, { accountId: 7 });
```

The exact declaration object returned by `defineResource` is the authored
resource identity. It is opaque, immutable, server-zone-only, and distinct from
every other declaration even when implementations or inputs are equal. Reads
accept that declaration and one explicit input. There is no string lookup,
implicit argument tuple, ambient current resource, application key callback,
or alternate call form in V1.

The analyzer records the declaration's construction-time source origin and
module/transformation identity. Generated dependency and explanation artifacts
refer to that provenance identity while runtime request maps use the opaque
declaration identity. Applications do not author durable global resource IDs.
A new application generation constructs new runtime identities and cannot
reuse an older generation's request state.

The framework snapshots admitted input before cache lookup. The loader receives
that deeply frozen normalized structural snapshot, standard `Request`, and
request-owned `AbortSignal`; it never receives the caller's mutable object
identity. Non-enumerable and symbol properties are absent from both the key and
the loader-visible snapshot, so hidden state cannot alter a deduplicated read.
Ordinary storage, authorization, and representation inputs not present in the
explicit input remain safe because V1 cache ownership never crosses the
request.

### Equivalent input

V1 uses one closed, framework-owned structural input grammar: `null`, booleans,
finite numbers, strings, dense arrays, and ordinary or null-prototype objects
whose enumerable own string properties recursively contain that grammar.
Object property order is insignificant; array order is significant; `-0` and
`0` are equivalent. Type tags make strings, numbers, booleans, arrays, and
objects unambiguous.

Cycles, sparse arrays, enumerable accessors, enumerable non-index array
properties, inherited enumerable properties, custom prototypes, non-finite
numbers, `bigint`, functions, symbol values, and all other values outside the
grammar are refused before a dependency, cache entry, or loader call exists.
Non-enumerable and symbol-keyed properties are ignored and stripped from the
normalized snapshot. Refusal never invokes an accessor or application key
function. Lazy enumerable traversal stops at the entry budget before sorting;
the implementation also bounds depth, property-name bytes, total encoded-key
bytes, distinct reads, and total calls per request. Exact limits are
conformance-owned implementation limits and may only become more permissive
before 1.0.

### Request cache and concurrency

Each request owns a fresh two-level map keyed first by declaration identity and
then by canonical input. The framework records the dependency and installs the
loader promise before awaiting it. Equivalent simultaneous or later reads
therefore share exactly one pending or settled outcome. Distinct declaration
objects or distinct canonical inputs execute independently in deterministic
first-observed dependency order.

The request map memoizes values, expected failures, and unexpected failures.
Rerunning a failed read inside the same render could duplicate I/O or observe a
different state, so rejection does not evict the entry. Request completion
releases the complete map; a later request starts empty and can recover. Values
are not serialized merely to cache them, and their lifetime cannot exceed the
request. The key and entry-count limits bound framework-retained indexing;
application-returned value size remains application memory and response-budget
responsibility.

V1 accepts only request-local result caching. `shared`, `global`, persistent,
time-based, or otherwise cross-request cache policies are refused; omission is
equivalent to `request`. Consequently no V1 result cache needs an application
auth-partition callback, invalidation clock, stale policy, or representation
key. A later shared-cache proposal requires a new ADR, explicit opt-in, complete
authorization and representation partitioning, bounded storage, freshness,
eviction, invalidation, and isolation evidence.

### Failures, cancellation, and rendering

An expected resource failure is created by the framework's typed
`resourceError({ code, status })` capability and thrown by a loader. Its code is
an uppercase stable application identifier; its status is one of 400, 401, 403,
404, 409, 422, 429, or 503. The framework recognizes the branded capability,
not a lookalike object or parsed message. Expected failures remain application
outcomes and must not be reported as internal framework incidents.

Other thrown or rejected values are unexpected failures and retain the normal
redacted incident path. Both failure classes propagate from `context.read` to
the nearest applicable rendering boundary. If no local boundary owns the read,
the route error boundary owns it. A resource failure does not silently produce
a value, select a correction from prose, or create an automatic redirect.

The request signal owns underlying work shared by equivalent reads. Aborting it
prevents a new loader call, is passed to an active loader, suppresses a value
that completes after abort, and makes the shared operation reject as cancelled.
One consumer cannot independently cancel work still owned by the same request.
Dependencies are recorded for admitted attempted reads, including failures and
cancellation, but not for refused inputs.

### Revalidation and `keeps`

After a successful action, the correctness baseline reruns every resource
declaration used by the active page with each recorded input. The later action
declaration may contain `keeps: readonly ResourceDeclaration[]`; entries are
opaque declaration references, never strings, input keys, or predicate
callbacks. This fixes only the metadata boundary. DG-V1-05 still owns the
action container, invocation, form, session, origin, replay, and redirect
contracts.

`keeps` declares that an action cannot affect any input of the listed resource.
It is optional and removable. Development verification compares complete
post-action observations with the unoptimized correctness baseline. Value,
ordering, expected-error code/status, or cacheability changes make the
declaration unsafe. Comparison uses a bounded conservative structural grammar;
unsupported, over-budget, or non-cacheable results refuse the optimization.
Production correctness never depends on comparison or `keeps`.

### Analyzer and evidence boundary

The private analyzer owns resource declaration provenance, call relationships,
input refusal diagnostics, dependency facets, and unsafe-`keeps` diagnostics.
Runtime flow records may report observed calls, cache hits, failures,
cancellation, and revalidation outcomes. Static evidence must not predict those
runtime facts. Neither the private decision model nor its flow object is a
public API or stable transported schema.

## Alternatives considered

- Application-authored string IDs were rejected because collisions, renames,
  and registry maintenance would separate runtime identity from source
  provenance.
- Application key functions were rejected because purity, collision freedom,
  accessor behavior, and bounded execution could not be enforced reliably.
- Identity by raw serialization was rejected because property order, type
  ambiguity, unsupported values, and accessor execution make it unsafe.
- Evicting rejected promises was rejected because repeated reads could rerun
  I/O and observe inconsistent state inside one render.
- An opt-in shared cache was rejected for V1 because no demonstrated workflow
  justifies authorization partition, freshness, invalidation, and storage
  complexity. Request-local ownership remains the explicit safe policy.
- Input-specific `keeps` predicates were rejected because they would make
  correctness depend on application key logic and complicate conservative
  verification before the action contract exists.

## Consequences

- The resource decision gate is resolved, so V1-11 may implement the public
  resource runtime.
- Request-local promise memoization supplies deterministic concurrency and
  failure behavior without cross-user cache risk.
- Applications with richer keys must convert them explicitly to the supported
  structural input; V1 intentionally refuses custom key callbacks.
- V1 provides no cross-request result-cache performance feature.
- `keeps` remains advanced metadata and cannot make the baseline incorrect.
- V1-11 must integrate expected failures with renderer ownership without
  changing ordinary runtime exception reporting.

## Compatibility, rollback, and replacement

No package export changes in V1-10. The private model can be removed without
application migration. V1-11 is the first implementation of the accepted
surface and remains pre-1.0. Rolling back V1-11 removes resource execution; it
must not retain request maps, generated resource artifacts, or selective
revalidation state. A future shared cache or broader input grammar supersedes
this ADR explicitly and retains request-local behavior as the safe fallback.

## Validation

- `pnpm check:v1-resource-decision`
- `pnpm check:revalidation-qualification-evidence`
- `pnpm check:v1-package-boundary`
- `pnpm check`
- `pnpm ci:local`

The private decision check covers successful equivalent and distinct reads,
simultaneous promise ownership, tenant/authorization isolation, branded
expected failures, unexpected failures, cancellation, cross-request cache
refusal, accessor-safe malformed input, bounded keys, flow redaction, and stale
failure removal in a new request.
