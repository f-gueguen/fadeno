# ADR 0045: Private update protocol and conservative scroll refusal

- Status: Accepted
- Date: 2026-07-19
- Owners: Fadeno maintainers
- Related specifications: [Navigation and patching](../spec/navigation-patching-preservation.md), [Protocol requirements](../spec/protocol-requirements.md), [Progressive enhancement](../spec/progressive-enhancement.md), [Forms and actions](../spec/forms-actions-sessions.md), [Security requirements](../security/requirements.md), [V2 plan](../roadmap/v2.md)
- Supersedes: None

## Context

ADR 0014 found that bounded structural reuse preserved the locked focus,
selection, dirty-control, top-layer, media, and identity cases, but did not
preserve numeric document or element scroll when preceding layout changed.
DG-V2-01 therefore blocked browser enhancement until one decision owned patch
identity, scroll, ordering, redirects, errors, recovery, cache policy, limits,
and version negotiation. The native V1 action round trip also requires that a
lost or malformed enhanced response never repeats an uncertain mutation.

V2-01 supplies a strict TypeScript decision model, a versioned accepted and
refused corpus, and three-engine scroll controls. These are private evidence
for later implementation slices. They are not a supported browser runtime or
stable wire surface.

## Decision drivers

- Native navigation and form submission remain the correctness and recovery
  baseline.
- A late, duplicated, misrouted, cross-generation, or cross-document result
  must not change the current document.
- The first implementation must not depend on unproven numeric scroll repair.
- Action redirects, authorization context, replay ownership, and same-origin
  rules must remain those of the accepted server outcome.
- Protocol decoding must be bounded and fail closed without reflecting
  transported HTML, credentials, or submitted values in diagnostics.
- Rolling or mismatched browser/server generations need deterministic recovery
  without public compatibility promises.

## Decision

### Envelope and identity

V2 uses one **private exact-version envelope** identified by
`fadeno.private.update` and version `1`. Every result binds the current
application generation, document epoch, operation ID, monotonic sequence,
operation kind, operation-owned normalized request URL, and single-use result
ID. Document outcomes additionally carry one server-owned structural root
identity. Applications do not author CSS
selectors, commands, operation IDs, result IDs, or protocol records.

Only a result matching the current operation may apply. Document and
expected-error outcome URLs must exactly match the operation's normalized URL;
route changes remain typed redirects. A newer navigation
supersedes cancellable older navigation work; late and differently sequenced
results are refused. An already consumed result ID is a duplicate and is
refused. A state-changing request is never inferred from a navigation result,
and an enhanced mutation remains protected by the native action proof and
server replay owner.

The private fixture envelope is evidence code. V2-02 owns the production codec,
V2-03 owns projection from real server outcomes, and V2-01A separately decides
the browser package entrypoint. This ADR does not add a package export and is
**not a stable public protocol**. Any external consumer requires a later ADR,
demonstrated consumer, compatibility policy, and conformance evidence.

### Outcomes, redirects, and errors

The closed outcome set is document, expected error, redirect, and recovery.
Document and expected-error outcomes carry a same-origin URL, bounded title,
server-owned root identity and markup, and the scroll classification. Expected
errors use an uppercase structured code; behavior never parses prose.

Redirects are typed and exact same-origin HTTPS in deployed contexts, with
exact same-origin HTTP admitted only for the trustworthy `localhost`,
`127.0.0.1`, and `[::1]` loopback development hosts. Navigation may retain the
framework's accepted `303`, `307`, or `308` result. A mutation redirect is
exactly `303`, HTTPS, free of URL credentials, and exact same-origin, matching
ADR 0035 even when the development document itself uses loopback HTTP. An
unsafe destination or status is refused without exposing it in the decision
result.

### Scroll boundary

V2 selects ADR 0014's conservative refusal/replacement option rather than
numeric scroll management. An in-place result may apply only when both relevant
document-preceding and element-preceding layout are **proven unaffected**.
When either boundary is **affected or unknown**, the in-place result is refused
before mutation and recovery requests current server truth through the native
path. Later evidence may supersede this choice with explicit scroll management;
node reuse alone cannot do so.

The V2-01 controls exercise document refusal, element refusal, and one
proven-unaffected acceptance in Chromium, Firefox, and WebKit. They prove the
selected admission boundary, not complete navigation or reconciliation, which
remain owned by later V2 slices.

### Cache, limits, compatibility, and recovery

Every update is `no-store` at both transport boundaries and in the private
envelope. The consumer requires a `no-store` fetch mode and an observed
`Cache-Control` response directive containing `no-store`; a body claim alone
cannot establish this policy. Response directives are parsed without treating
commas or `no-store` text inside quoted extension values as separate
directives. No protocol result, expected error,
authorization-bearing projection, or failure is reused across requests.
Ordinary native HTTP caching remains outside this private channel. A later
prefetch or shared-cache policy requires separate ownership and isolation
evidence.

The v1 boundary limits encoded input to 2 MiB, 4,096 structural records, depth
16, and 50 milliseconds of boundary processing. Identities are at most 128
UTF-8 bytes, URLs 8 KiB, titles 4 KiB, and transported root markup 2 MiB. V2-02
must measure raw bytes, record count, depth, and duration independently rather
than trusting fields inside the message. Every measurement must be a
nonnegative safe integer before its maximum is evaluated.

Unknown fields, malformed shape, unsupported older or newer versions, invalid
identity, limit exhaustion, cache drift, unsafe URL, generation/document/
operation mismatch, duplicates, and unsafe scroll all fail closed before any
document mutation. Before a navigation request commits, refusal leaves or
returns to native navigation. After commitment, and for every uncertain
mutation, recovery performs a safe GET to **reload current server truth** and
**never resubmits** the mutation. Application-generation mismatch uses the same
recovery and provides rolling-deploy rollback without accepting mixed versions.

## Alternatives considered

- Restore numeric scroll after every patch: rejected because ADR 0014's locked
  evidence did not qualify anchoring, focus, user movement, nested scrollers,
  or accessibility interactions for that policy.
- Accept affected layout and rely on browser scroll anchoring: rejected because
  the K0 evidence observed the same failure class in all three engines.
- Apply any response with a newer sequence: rejected because server-supplied
  ordering cannot replace client-owned current-operation identity and would
  make duplicated mutation outcomes ambiguous.
- Cache private update results by URL: rejected because authorization,
  document epoch, operation identity, expected failures, and current server
  truth make reuse unsafe without a separately proven cache owner.
- Publish the fixture schema: rejected because neither a browser entrypoint nor
  an external consumer exists yet.

## Consequences

- DG-V2-01 is resolved and V2-01A becomes the remaining decision prerequisite
  before V2-02 implementation.
- Early enhancement may refuse more often, including every uncertain
  layout-affecting boundary; the native path remains valid.
- Later projection and reconciliation code must preserve the exact identity,
  no-store, same-origin, ordering, limit, and recovery rules or supersede this
  ADR explicitly.
- Diagnostics may expose stable refusal codes and non-sensitive causal IDs but
  never transported markup, credentials, cookies, or submitted form values.
- Release impact is none: this decision adds no package behavior or Changeset.

## Validation

`pnpm check:v2-patch-protocol` type-checks the private model, decodes and replays
the versioned corpus, rejects fixture-schema mutations, checks inclusive and
exceeded limits, malicious object shapes, redaction, serialization round trips,
and runs the scroll admission controls in Chromium, Firefox, and WebKit.
`pnpm check:v2-plan`, decision, ledger, model, documentation, and full local CI
keep the resolved gate and private boundary aligned.
