# Morph experiment

- Hypothesis: H1 — browser-state-preserving server updates.
- Harness slice: K0-02.
- Qualification slice: K0-04.
- Commands:
  - `pnpm experiment:morph -- --list` lists the private fixture inventory without
    importing Playwright or launching browsers.
  - `pnpm experiment:morph` runs the passing control in Chromium, Firefox, and
    WebKit.
  - `pnpm experiment:morph -- --verify-harness` proves both the passing control
    and the intended seeded failure in all three engines.

K0-02 owns the data-oriented fixture API, three-engine runner, seeded harness
failure, reference preflight, and verified failure artifacts. K0-03 owns the private candidate;
K0-04 owns the complete corpus and immutable results. All runs use the central
[contract](../contract/README.md), [reference environment](../reference-environment.json),
and thresholds in the [K0 plan](../../docs/roadmap/k0.md).

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

No structural update candidate, qualification result, result manifest, public
export, or package boundary exists in K0-02.
