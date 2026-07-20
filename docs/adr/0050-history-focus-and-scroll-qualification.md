# ADR 0050: History, focus, and conservative scroll qualification

- Status: Accepted
- Date: 2026-07-20
- Owners: Fadeno maintainers
- Related specifications: [Navigation and patching](../spec/navigation-patching-preservation.md), [Progressive enhancement](../spec/progressive-enhancement.md), [Security requirements](../security/requirements.md)
- Supersedes: None

## Context

ADR 0049 owns ordinary same-origin link activation and proves a first complete
enhanced document transition. Its deliberately narrow predicate refuses every
nonzero document or element scroll position and its back/forward coverage does
not yet qualify entry restoration, selection rules, or reduced-motion behavior.
V2-05 must make those browser-owned outcomes exact before forms or structural
reconciliation acquire authority.

## Decision drivers

- Keep URL, document, history, focus, selection, and scroll mutually current.
- Never let a same-document history traversal expose the prior document under a
  newly selected URL.
- Preserve the native top-of-document outcome for a new cross-document link.
- Retain native current-truth recovery when exact scroll restoration is not
  proven safe by the accepted layout boundary.
- Do not allocate animation or transition work when no transition is required.
- Keep history records private, bounded, closed, and unable to grant server
  authorization or update admission.

## Decision

The browser runtime owns only history entries that carry its exact private
marker, private state version, the active bounded chain identity, a bounded entry identity, and nonnegative finite
document-scroll record. It installs manual browser scroll restoration while
active, verifies the browser reads that owner back as `manual`, and restores the previous browser setting on close or page departure. If initial history
ownership cannot be recorded, startup also restores the prior setting and
returns the exact original History API functions and native ownership. History
wrapper installation is itself guarded: partial installation restores every
method it replaced and declines enhancement without throwing. A non-trustworthy origin or missing secure random
identity generator declines ownership before creating an identity. Application-owned, foreign-chain, malformed, unsupported, or
preservation-unsafe entries are not interpreted; traversal reloads the selected
current URL so URL and document cannot diverge.

Each owned entry starts with the current document scroll position. The first
observed nonzero document or element scroll makes that entry monotonically
unsafe for enhanced restoration. Returning to zero and a forced final flush
cannot erase that evidence, so later scroll events do not keep rewriting
history. An eligible click performs guarded flushes before interception and
immediately before document commit. If either history write is refused or
rate-limited, further writes stop and the link remains native. A new
eligible link may depart from a scrolled document after all other V2-04
preservation checks pass: the document scroller is not misclassified as element
scroll, the outgoing entry is recorded, the destination history entry is
created before its viewport resets to document scroll `(0, 0)`, and the
destination heading or main landmark receives focus
with scroll prevention. This matches ordinary cross-document navigation without
attempting to preserve outgoing scroll in the new document. The final commit
checks the actual viewport reached `(0, 0)` rather than trusting the scroll call.

The active runtime keeps a bounded registry of the exact entry state and URL it
created. A marker and chain identity alone do not grant ownership: an entry
copied by application code, a repeated selected identity without an observed
runtime traversal, or a changed registered state reloads current server truth.
Every actual runtime start, including a restart after close in the same
document, re-keys the selected entry to a fresh runtime session before it can
enter that registry; serialized fields are not positive ownership proof. A
same-document restart conservatively retains already-recorded nonzero document
or element-scroll evidence, while a newly loaded document derives its initial
scroll evidence from that document's live layout.
Registry overflow is fail-closed. Application calls to `pushState` and
`replaceState` are distinguished from guarded runtime writes and make the exact
resulting entry and URL application-owned, including a byte-for-byte or same-URL
copy. That refusal survives reload and every explicit restart in the same
document without granting a copied marker ownership. Recovery consumes only
the exact selected session, entry, and URL record; another application-owned
record at the same URL remains refused. A later document may
resume only after re-keying the selected entry. Persistence reads and writes
share the bounded 8,192-byte current-URL class. Recorded element-scroll
ownership also keeps a new link native after the live element returns to zero,
including when first observed while a request is pending or after document
scroll was already recorded.

Back or forward traversal is enhanced only when the selected owned entry has
zero document scroll and no observed element-scroll ownership. Nonzero document
scroll, any element-scroll ownership, malformed state, or an unowned entry
reloads the selected URL. This is an explicit conservative refusal: restoring a
numeric position into newly rendered content is not treated as proof that the
preceding layout is unchanged. V2-08 remains responsible for broader structural
preservation. After that current-truth reload, an exact supported runtime-owned
entry may resume enhancement; an application-owned, malformed, or unsupported
entry still refuses runtime ownership. Before initiating native recovery, the
runtime restores the scroll-restoration mode that existed before enhancement,
so a restarted runtime does not mistake its predecessor's `manual` mode for the
browser's original setting.

A non-collapsed selection, caret or focused control with unresolved ownership,
dirty control, disclosure/top-layer state, media, client-owned identity, and
nonzero element scroll still refuse before interception and before commit. A
collapsed document selection may be discarded by an accepted cross-document
navigation, as native navigation discards the old document. Direct load does
not move focus. An accepted enhanced transition focuses exactly one new primary
heading or main landmark; it adds a private temporary focus marker and does not
scroll that target into view.

V2-05 introduces no animation, view-transition, or delayed commit. Therefore
normal and reduced-motion preferences execute the same correctness path and
allocate no transition work. A later optional transition requires a separate
decision and must retain this no-animation reduced-motion baseline.

Traversal supersession uses ADR 0049's existing operation cancellation and
newest-only publication. A newly selected traversal cancels its predecessor
before any early native-recovery decision, so an obsolete response cannot race
that recovery. A refused same-context link, including a fragment, and a still-
native same-context form submission cancel any pending enhanced request. When
that request is a traversal, they also repair its selected slot before native
activation continues. Listening for the form
submission does not intercept or enhance it. Scroll-write suppression remains
owned by the newest traversal until that traversal finishes; an older
traversal's cleanup cannot release it, including while delayed native recovery
is queued. Every entry has a bounded private identity; `popstate` inspects the
still-present outgoing document and conservatively marks its displayed identity
unsafe. The displayed identity changes only after a successful document commit,
not when an intermediate traversal merely selects another entry. If the bounded
unsafe-identity tracker fills, every later traversal reloads rather than
forgetting an older unsafe entry. A bounded per-session, entry, and URL refusal
record retains unsafe or application-owned evidence across runtime restart;
malformed, unavailable, or overflowing persistence is itself fail-closed. A
current-truth reload re-keys and clears only the exact recovered unsafe entry,
so a different supported entry can resume enhancement. Scroll
that occurs while traversal work is pending marks the still-displayed entry,
cancels the pending response, and queues the same native recovery after a
bounded 50-millisecond supersession window. A newer traversal replaces that
queued recovery; otherwise it cannot wait for the obsolete response.
The source URL, complete exact private state, and active ownership are captured
for both links and traversals and revalidated after asynchronous work and
immediately before commit. A forced pre-interception scroll flush is followed by
a fresh source-state read, so the request owns the state that was actually
written rather than a stale pre-flush copy. Rollback focus is captured from the
same immediately precommit document shape that is cloned for rollback.
These rules cover scroll changes whose event has not yet been delivered,
application state replacement during a request, and multi-entry traversal. A
late response cannot commit document, history, focus, selection, or scroll after
a newer click or traversal. A newer eligible link supersedes an ordinary
pending link and remains enhanced; an activation that fails eligibility remains
native after aborting the older work. Closing the runtime while a traversal is pending
restores native scroll ownership and reloads the already selected current URL;
it cannot leave that URL paired with the previously displayed document. If the
user cancels that reload, the selected slot is repaired to the displayed
document's trusted URL before teardown finishes, after which the closed runtime
leaves activation fully native. If
an ordinary link request is pending, close aborts it before completing teardown.
If
destination history selection succeeds but a later document, focus, scroll, or
final history-provenance or runtime-lifecycle check fails, native recovery does not append a duplicate
destination. A newly pushed selection is rolled back before native navigation
reselects it, including every additional entry synchronously pushed by
application code during the failed commit. Pushes made after an already selected
traversal are also rolled back before that selected entry is replaced in place;
one Back
traversal still reaches the prior document. Document and history postconditions
share one rollback boundary, and local rollback failure cannot erase the
selected-destination classification.
If a user cancels the native reload requested for an unsafe traversal, the
still-running document repairs the selected history slot to a fresh private
entry at the displayed document's trusted URL, reacquires manual restoration,
records the refusal, and resumes enhancement; it never leaves the selected
destination URL paired with old markup. Cancellation detection covers both
`preventDefault()` and legacy non-empty `returnValue` confirmation requests.
The same trusted displayed-truth repair applies when a post-selection commit
failure rolls the document back and the user cancels its native replacement.
That document rollback reinserts the actual precommit document nodes and
restores the exact previously focused node within the restored body before
cancellation can retain it, preserving node identity, listeners, and
application-owned properties rather than only cloned markup.
It also applies when a preselection native fallback is cancelled, so the active
runtime reacquires manual restoration instead of continuing under mixed
ownership.
Flow evidence
records stable ownership and refusal causes without URLs, selected text,
history payloads, markup, or user data.

Same-context supersession resolves `_self`, `_parent`, `_top`, and the current
named browsing context against the actual window rather than a closed string
list. Links carrying an explicit referrer policy or `noreferrer` remain native
until their request privacy is qualified. The last traversal precommit check
reads live document and element scroll without writing the already selected
destination state, and only the actual `document.scrollingElement` is excluded
from element ownership; an independently scrollable root element remains an
element owner. Runtime History wrappers preserve and restore the exact original
own-property descriptors, while an unobserved native push is rejected through
history-length provenance rather than treated as runtime-created. Canceled
departure repair carries prior monotonic unsafe-scroll evidence to its fresh
entry. A persisted-page failure to reacquire verified manual restoration closes
enhancement so later traversal stays native.

## Alternatives considered

- Restore every recorded numeric scroll position after fresh rendering:
  rejected because a number does not prove unchanged preceding layout.
- Leave automatic browser restoration enabled beside runtime commits: rejected
  because browser and framework writes could race.
- Ignore unowned `popstate` entries: rejected because URL and rendered document
  could then describe different routes.
- Add transitions while qualifying reduced motion: rejected because animation
  is not required for correctness and has no accepted product owner.

## Consequences

- Links can safely leave a document after document scrolling, while returning
  to an unqualified scrolled entry uses a current-URL reload. That recovery
  guarantees current URL and document truth, not a pixel position; the runtime
  never applies its recorded refusal number to a potentially changed layout.
- Zero-scroll owned entries receive deterministic enhanced traversal, focus,
  title, URL, and newest-only behavior.
- Element-scroll and unknown-layout cases remain native/refused rather than
  receiving approximate restoration.
- The private history shape may still change before an external consumer is
  accepted; no public schema or editor surface is introduced.
- The additive prerelease behavior requires one pending minor Changeset.

## Validation

`pnpm check:v2-history-focus-scroll` must use the current packed framework and
canonical application in Chromium, Firefox, and WebKit. It proves direct load,
push, zero-scroll back/forward replacement, rapid traversal cancellation,
destination focus without focus-induced scroll, collapsed-selection disposal,
non-collapsed-selection refusal, scrolled-origin departure, nonzero document and
element-scroll restoration refusal, actual top-scroll postconditions, foreign-chain and unowned-state recovery,
recorded, combined document/element, and pending element-scroll link refusal, cloned-entry and same-URL
application-copy recovery before and after repeated reload and re-keying, exact same-URL recovery-record consumption,
manual-restoration readback refusal, long-URL persistence, per-entry recovery resumption,
post-history commit, focus-time history mutation, multi-push rollback, and rollback failure without duplicate entries, cancelled-
reload, close-time reload, post-selection fallback, and preselection fallback repair, returnValue-only cancellation,
ordinary-link source mutation, ordinary close cancellation, delayed-recovery and pending-traversal eligible-click, refused-fragment, and native-form supersession,
ordinary-request/native-fragment supersession, guarded History-wrapper installation, post-close same-document re-keying,
exact descriptor restoration, referrer-policy refusal, current-context target resolution, unobserved native-push refusal,
post-flush source refresh, live traversal-scroll refusal, independently scrollable-root ownership, unsafe repair carry-forward,
persisted-page restoration failure, exact precommit focused-node identity recovery, focus-time close recovery, and traversal-push rollback,
secure-environment refusal and resumed enhancement, normal/reduced-
motion no-animation behavior, normalized flow output, rollback, and stale-result
removal. `pnpm ci:local` retains every prior native and release gate.
