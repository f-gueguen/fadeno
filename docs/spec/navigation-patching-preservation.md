# Navigation, patching, and preservation

Enhanced navigation is an alternate delivery path for the same server-owned
application outcome. It does not create a second routing, action, or state
model.

## Native equivalence

1. An enhanced link targets the same URL, method, authorization context, and
   history outcome as its native navigation.
2. An enhanced form submits the same successful controls and receives the same
   validation, action, redirect, and revalidation outcome as its native form.
3. Enhancement code intercepts only when it can safely own the request. Before
   interception or after recoverable failure, the browser path remains valid.
4. A mutation whose delivery state is uncertain is never blindly repeated as a
   fallback. Recovery first determines or requests current server truth.

## Request lifecycle

- Pending state is associated with the initiating navigation or form and is
  cleared on completion, cancellation, redirect, fallback, or teardown.
- Prefetch work is cancellable and cannot acquire mutation authority.
- Superseded navigation work is cancelled when safe. A late response cannot
  overwrite a newer accepted URL or document state.
- History entries, back/forward navigation, URL state, title, focus, and scroll
  follow browser semantics defined by conformance fixtures.
- Optional navigation transitions cannot delay correctness, trap focus, or
  ignore reduced-motion preferences.

## Semantic update model

Server-derived updates identify structurally owned output rather than accepting
application selector commands. Navigation, action completion, and later live
data share render, ordering, recovery, and preservation semantics, but their
transport envelopes may differ.

The experimental patch format stays private through K0 and V1. DG-V2-01 is the
only path to an external versioned protocol.

## Preservation contract

An update preserves state not owned by the server result:

- focused element, text selection, and caret;
- dirty form controls unless the accepted result explicitly resets them;
- disclosure, dialog, and popover state;
- media playback state;
- relevant document and element scroll position;
- mounted island identity, lifecycle, and local state.

Structural identity must not depend on unstable array position alone. An
intentional replacement is explicit and independently testable. A preservation
failure is correctness failure, not cosmetic variance.

ADR 0014 narrows the structural mechanism: node reuse alone does not preserve
exact numeric scroll when layout changes before the document viewport or before
content inside a scroller. Until DG-V2-01 qualifies an explicit management
policy, an enhanced update must refuse or replace any patch boundary that can
affect that preceding layout. This restriction does not weaken the native
fallback or imply that K0's private identity format is public.

## Ordering, errors, and recovery

1. Messages contain sufficient request and structural identity to reject stale,
   duplicate, misrouted, or unsupported results.
2. Unknown required fields, invalid identity, unsupported protocol version, and
   oversized content fail closed.
3. Redirects and expected failures have typed protocol outcomes; executable
   strings are never evaluated.
4. After protocol desynchronization, the client can recover through a normal
   request for current server truth.
5. Development diagnostics explain which resource, action, or navigation
   caused an update without exposing protected data.

## Narrowed H1 result and V2 conformance

K0-04 established cross-engine structural viability for focus/selection/caret,
dirty controls, disclosure/top-layer state, media, island identity, and declared
replacement. It did not establish layout-affecting document or element scroll.
The following V2 obligations therefore remain prospective requirements, not
claims supported by the K0 candidate.

- Chromium, Firefox, and WebKit run the complete preservation corpus for both
  navigation- and action-driven updates.
- Ordering fixtures permute, duplicate, delay, cancel, and corrupt responses.
- Native and enhanced flows end with the same URL, server data, field errors,
  and accessible document state.
- Keyboard, focus, reduced-motion, and screen-reader review accompanies
  automated accessibility checks.
- Network interruption before, during, and after a mutation demonstrates a
  non-duplicating recovery path.
