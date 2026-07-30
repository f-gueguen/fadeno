# ADR 0053: Bounded private structural reconciliation

- Status: Accepted
- Date: 2026-07-29
- Owners: Fadeno maintainers
- Related specifications: [Navigation and patching](../spec/navigation-patching-preservation.md), [Progressive enhancement](../spec/progressive-enhancement.md), [Protocol requirements](../spec/protocol-requirements.md), [Browser update threat model](../security/browser-update-threat-model.md)
- Supersedes: None

## Context

ADR 0014 establishes that stable keyed reuse preserved sixteen locked focus,
selection, caret, dirty-control, disclosure/top-layer, media, island, and
declared-replacement classes in Chromium, Firefox, and WebKit. It also
establishes that node reuse did not preserve numeric document or element scroll
when preceding layout changed. ADR 0045 therefore accepts only a
proven-unaffected scroll boundary, while ADRs 0049 through 0052 keep every
unqualified browser-owned state on the native path before V2-08.

V2-08 must connect that evidence to the existing link and action document
commit owner. It cannot create application selector commands, infer identity
from unstable array position, publish the private update envelope, or weaken
the native link and form baseline.

## Decision drivers

- Preserve accepted browser-owned state by retaining the same DOM objects,
  without reading and replaying values, files, focus, selection, top-layer, or
  media state.
- Validate the complete current and incoming structure before the first DOM
  write.
- Keep ambiguous, unsupported, stale, scrolled, or partially owned documents on
  the existing native recovery path.
- Share one commit, history, rollback, cancellation, and recovery owner between
  complete-document and reconciled outcomes.
- Keep structural evidence private until a demonstrated application authoring
  need justifies a stable identity or replacement API.

## Decision

### Private keyed boundary

The browser runtime may reconcile exactly one current and incoming HTML `main`
root when both roots have the same unique, nonempty standard `id`. Every element
inside that root must also have a unique, nonempty standard `id`, except for the
renderer-owned hidden action-proof input. That one generated control receives
an internal identity derived from its uniquely identified parent form and exact
reserved field name; the complete derived identity remains inside the same
byte limit, and applications cannot author that reserved field. Current
standard identities must be unique across the complete current document, and
incoming identities must be unique within the inert incoming root. Position is
never an identity fallback.

The standard `id` is a conservative private admission input, not a selector
command or a promise that a particular application node will be reused.
Application results never name a target selector, operation, move, insertion,
or removal. Missing identities, duplicate or document-conflicting identities,
different reused element kinds or parents, unsupported elements or attributes,
and over-limit trees refuse before mutation. A page without this complete
boundary retains the existing complete-document commit when no browser-owned
state needs reconciliation, and otherwise remains native.

V2-08 initially retains the exact K0 surface plus the bounded link/form
elements needed to drive its real navigation and action conformance. The plan
is limited to 4,096 records, depth 16, and 128 UTF-8 bytes per identity. Scripts,
event attributes, foreign namespaces, unsupported form controls, executable
URLs, application-authored unkeyed descendants, duplicate renderer-owned proof
controls, and ambiguous custom elements refuse. A future broader HTML surface
requires new executable evidence; it is not inferred from successful handling
of the locked corpus. The renderer's existing deny-by-default policy adds only
`media-src data:` so the locked local audio fixture can execute without a
network owner; reconciliation still accepts only bounded WAV data sources.

### Reuse, insertion, removal, and replacement

For a shared identity, current and incoming namespace, local name, parent
identity, state-owned content, input type, media source, and opaque future
island content and attributes must satisfy the bounded equality rules. The
current node is then reused. Incoming-only identities create inert same-kind
nodes, and current-only identities are removed only when disconnecting them
cannot disturb browser- or application-owned state.

The reconciler owns an explicit private declared-replacement set for
same-identity leaf controls. That set is supplied only by framework-owned
conformance and later compiler/render construction evidence; it is not read
from application attributes, transported selector commands, diagnostic prose,
or a public API. Ordinary production projection supplies no replacement unless
an accepted framework owner declares one. A distinct incoming identity remains
the normal server-owned way to replace output without retaining old identity.

Reused inputs, textareas, selects, contenteditable leaves, disclosures,
dialogs, popovers, media, and future island sentinels keep their exact DOM
objects. The reconciler does not assign values, checked state, selected files,
focus, selection, caret, open/top-layer state, playback state, or scroll.
Removing or moving a live top-layer owner, changing a retained focus owner's
class ancestry, and state-owned leaf content, media, or island ownership
changes refuse rather than being overwritten.

### Atomic plan and commit

The complete identity map, supported surface, attribute plan, text plan,
replacement set, desired-node map, parent relation, child order, and rollback
snapshot are prepared before history selection or the first DOM write. The
existing document commit then owns history selection, document metadata, head
and shell updates, structural commit, focus choice, top-scroll postcondition,
and result publication as one operation.

When the active element is a reused node and is not the activated link,
reconciliation retains that exact focus owner and any selection or caret
naturally attached to it. An activated link releases focus to the destination.
The destination heading or main remains the normal target; a retained modal
dialog becomes the target when its top-layer ownership makes outside focus
invalid. Focus ownership, live control properties, and the prepared current
tree are rechecked after history selection and before any document-shell or
body write. Closed disclosures and dialogs remain reconciliation owners because
their missing reflected `open` attribute can itself be user-owned state. Any
write or postcondition failure restores the prior attributes, text, child
order, shell, history selection, focus, selection, and scroll as far as the
bounded current document permits, then enters the existing native recovery
path. An uncertain committed mutation reloads current server truth and never
repeats the POST.

### Eligibility and scroll

Link and form pre-interception checks may admit dirty controls,
disclosure/top-layer state, media, focus, selection, caret, and future island
identity only when the complete current keyed boundary preflights and owns
those nodes. The same predicate and incoming plan are rechecked after response
admission and before commit. An action is not intercepted when its current
document cannot satisfy that preflight.

V2-08 does not restore numeric scroll. A forward link or form update may retain
the V2-05-qualified behavior that records a nonzero origin entry as unsafe and
commits the destination at the exact top boundary; this is not scroll
preservation. Any nonzero element scroll and every transported affected or
unknown element preceding-layout classification remain native refusal
boundaries. The two locked scroll cases therefore retain their exact
non-preservation conclusions: document scroll resets through the qualified top
commit, while element scroll follows native current-truth recovery.

### Contract status

The reconciler, identity map, replacement set, result record, and causal flow
remain private package internals. No export, application syntax, public
protocol, public analyzer facet, or editor surface is added. V2-09 may qualify
the canonical application against this behavior but cannot stabilize the
mechanism without a separate decision and demonstrated consumer need.

## Alternatives considered

- Reuse nodes by array position: rejected because insertion and reorder make
  position unstable and ADR 0014 requires structural identity.
- Restore every browser state property after replacement: rejected because
  files, top-layer ownership, media, custom-element lifecycle, selection, and
  island state are not safely reconstructible.
- Manage numeric scroll after structural writes: rejected because the locked
  evidence did not qualify anchoring, nested scrollers, user movement, focus,
  or accessibility interactions.
- Publish a key or replacement API now: rejected because the current private
  corpus does not establish an application authoring contract.
- Reconcile arbitrary HTML and rely on rollback: rejected because unsupported
  elements, attributes, scripts, lifecycle callbacks, and network owners would
  expand the trust boundary without evidence.

## Consequences

- Eligible keyed documents preserve the accepted browser-owned state classes
  across link and action outcomes.
- Unkeyed and unsupported documents continue to work through complete-document
  enhancement or native navigation; reconciliation is not required for
  correctness.
- V2-08 may refuse more often than a general morphing library, especially for
  any current scroll owner or unsupported surface.
- Package behavior changes additively during prerelease and require exactly one
  pending Changeset.

## Validation

`pnpm check:v2-reconciliation` must build the current package, exercise the
private preflight and rollback boundaries, and run every locked K0 preservation
case as both navigation- and action-driven work in Chromium, Firefox, and
WebKit. It retains normalized success, deliberate refusal, human correction,
causal ownership flow, current-truth recovery, and cleanup evidence. The locked
document-scroll case must prove the qualified top reset without claiming
numeric preservation; the locked element-scroll case remains an explicit
native refusal. `pnpm ci:local` retains every prior native, package, security,
browser, and release gate.
