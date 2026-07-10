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
  - `pnpm experiment:morph -- --ci` runs the exact 20-repetition K0-04 matrix
    from a clean source commit and writes a unique non-overwriting raw run.
  - `pnpm experiment:morph -- --qualify` runs the exact 100-repetition matrix
    in the frozen reference environment and atomically publishes a validated
    v1 result manifest.

K0-02 owns the data-oriented fixture API, three-engine runner, seeded harness
failure, reference preflight, and verified failure artifacts. K0-03 owns one
private candidate; K0-04 owns the complete corpus and immutable results. All
runs use the central [contract](../contract/README.md),
[reference environment](../reference-environment.json), and thresholds in the
[K0 plan](../../docs/roadmap/k0.md).

## K0-04 locked corpus boundary

The typed K0-04 corpus and its checked JSON projection cover focused input,
textarea, and contenteditable selection/caret; dirty text, checkbox, radio,
select, and real file controls; disclosure, modal and non-modal dialog,
popover, playing and paused local media, document and element scroll, mounted
island identity, structural insertion/removal/reorder, and declared
replacement. Each case is paired with one explicit private structural
operation. The exact matrix is three engines by every case by ordinals 1–20 in
CI and 1–100 in reference qualification, with no retries.

This is structural-preservation evidence only. K0-04 does not label identical
in-page calls as navigation or action evidence and does not claim native
equivalence, history, request ordering, recovery, transport, protocol, browser
support, or resolution of DG-V2-01. Those obligations remain open for later
gates.

K0-04 extends the same private candidate only for this locked corpus. The root
and every candidate-owned descendant use a unique nonempty HTML `id`; current
identities remain unique across the whole document. Reused elements keep the
same element kind and parent identity, while keyed siblings may be inserted,
removed, or reordered and declared same-kind non-opaque leaves may be
replaced. Nested native elements are limited to the reviewed allowlist;
`fadeno-island` is an opaque reused leaf; media is limited to the hashed local
WAV data URL; event, style, executable, and external-resource attributes are
refused.

The complete current/incoming identity, kind, attribute, content, replacement,
parent, desired-node, and child-order plan is validated before the first DOM
write. The candidate never reads or restores focus, selection, values, checked
state, files, open/top-layer state, media time/playback, or scroll. Independent
runtime instrumentation treats any state setter, restoration method, transient
state event, object replacement, ancestor replacement, lifecycle disconnect,
external request, runtime error, or unhandled rejection as qualification
failure.

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

At the K0-03 exit this private rule did not cover nested reconciliation,
insertion, removal, reorder, or H1 qualification; K0-04 owns that subsequent
private evidence. Neither slice creates a selector protocol, public identity
contract, transport, ordering/recovery mechanism, protocol version, or
resolution of DG-V2-01.

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
