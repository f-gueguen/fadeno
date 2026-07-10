# Morph experiment

- Hypothesis: H1 — browser-state-preserving server updates.
- Harness slice: K0-02.
- Candidate slice: K0-03.
- Qualification slice: K0-04.
- Commands:
  - `pnpm experiment:morph -- --list` lists the private fixture inventory without
    importing Playwright or launching browsers.
  - `pnpm experiment:morph` runs the passing control in Chromium, Firefox, and
    WebKit.
  - `pnpm experiment:morph -- --verify-harness` proves both the passing control
    and the intended seeded failure in all three engines.
  - `pnpm experiment:morph -- --fixture intentional-replacement` runs the K0-03
    candidate-backed reuse and declared-replacement control.

K0-02 owns the data-oriented fixture API, three-engine runner, seeded harness
failure, reference preflight, and verified failure artifacts. K0-03 owns one
private candidate; K0-04 owns the complete corpus and immutable results. All
runs use the central [contract](../contract/README.md),
[reference environment](../reference-environment.json), and thresholds in the
[K0 plan](../../docs/roadmap/k0.md).

## K0-03 entry contract

The candidate is a disposable private TypeScript module in this directory.
Its input contains one inert replacement-HTML string, one explicit update-root
identity, and a set of explicitly declared replacement identities. For this
slice only, structural identity is the unique, nonempty standard HTML `id` on
the root and each of its direct element children. Every current identity must
also be unique across the document; incoming identities are unique within the
inert root. Current and incoming roots must expose the same exact identity order
and element kinds. Position is never an identity fallback.

K0-03 accepts only the controlled native surface exercised by the proof: an
HTML `main` root with direct HTML `input` and `output` children, using only
`id`, `class`, `aria-label`, and `value` attributes. Reused leaf content must be
identical; changed light-DOM content requires declared same-kind replacement.
Custom elements, resource/event attributes, and broader element kinds refuse
before mutation rather than implying general support.

The implementation validates the complete current identity map, inert incoming
identity map, and replacement subset before its first DOM write. Missing,
duplicate, ambiguous, nested, undeclared, or unobserved identities refuse the
whole input without changing markup, node references, focus, value, or
selection. Unsupported tree shapes are refused rather than generalized. This
prevalidation guarantee is not a transactional rollback claim for arbitrary
page scripts or mutation-time side effects; those environments are outside the
narrow K0-03 surface and require later evidence.

The `intentional-replacement` control must exercise both candidate paths in one
patch: the root and dirty focused input are the exact reused objects, the input
keeps its state, and a second declared element is a distinct replacement whose
original is disconnected. Candidate-produced reused/replaced identity evidence
is checked against independent DOM observations in Chromium, Firefox, and
WebKit. The existing K0-02 controls remain independent harness-integrity
evidence.
Reference CI retains their failure artifacts separately before running and
retaining the K0-03 candidate evidence.

This private rule is not a selector protocol, public identity contract, or
resolution of DG-V2-01. It does not cover nested reconciliation, insertion,
removal, reorder, transport, ordering, recovery, protocol versioning, or H1
qualification; K0-04 and later decision gates own those questions.

The passing control inserts an unrelated sibling and proves focused dirty-input
identity and state survive. The seeded failure replaces that input, proves the
replacement occurred, and must fail with `FADENO_MORPH_STATE_LOSS`. Its
machine report must contain exactly one intended failure per engine plus a
nonempty trace, screenshot, operation record, and before/after state record.

All pages use `page.setContent`; HTTP(S) requests are aborted, service workers
are blocked, downloads are disabled, and no credentials are seeded because
failure media captures page state. Host deviations produce non-reference
reports, while Playwright/browser mismatches or missing engines fail the run.
The digest-qualified reference CI job must classify itself `reference`.

K0-02 introduced no structural update candidate, qualification result, result
manifest, public export, or package boundary. K0-03 adds only the private
candidate described above and still adds no qualification result, public
export, or package boundary.
