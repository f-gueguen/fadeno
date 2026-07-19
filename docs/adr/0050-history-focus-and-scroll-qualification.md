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
marker, private state version, and nonnegative finite document-scroll record.
It installs manual browser scroll restoration while active and restores the
previous browser setting on close. Application-owned, malformed, unsupported,
or preservation-unsafe entries are not interpreted; traversal reloads the
selected current URL so URL and document cannot diverge.

Each owned entry records the current document scroll position as it changes.
Any observed nonzero element scroll marks that entry as unsafe for enhanced
restoration. A new eligible link may depart from a scrolled document after all
other V2-04 preservation checks pass: the outgoing entry is recorded, the new
entry is committed at document scroll `(0, 0)`, and the destination heading or
main landmark receives focus with scroll prevention. This matches ordinary
cross-document navigation without attempting to preserve outgoing scroll in
the new document.

Back or forward traversal is enhanced only when the selected owned entry has
zero document scroll and no observed element-scroll ownership. Nonzero document
scroll, any element-scroll ownership, malformed state, or an unowned entry
reloads the selected URL. This is an explicit conservative refusal: restoring a
numeric position into newly rendered content is not treated as proof that the
preceding layout is unchanged. V2-08 remains responsible for broader structural
preservation. After that current-truth reload, an exact supported runtime-owned
entry may resume enhancement; an application-owned, malformed, or unsupported
entry still refuses runtime ownership.

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
newest-only publication. A late response cannot commit document, history,
focus, selection, or scroll after a newer click or traversal. Flow evidence
records stable ownership and refusal causes without URLs, selected text,
history payloads, markup, or user data.

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
  to an unqualified scrolled entry uses a current-URL reload.
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
element-scroll restoration refusal, unowned-state recovery, normal/reduced-
motion no-animation behavior, normalized flow output, rollback, and stale-result
removal. `pnpm ci:local` retains every prior native and release gate.
