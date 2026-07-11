# ADR 0014: Narrow structural preservation around scroll-affecting layout

- Status: Accepted
- Date: 2026-07-11
- Owners: Fadeno maintainers
- Related specifications: [Navigation and patching](../spec/navigation-patching-preservation.md), [Progressive enhancement](../spec/progressive-enhancement.md), [K0 plan](../roadmap/k0.md)
- Supersedes: None

## Context

H1 proposed that server-derived structural HTML updates could preserve browser,
user, and island-owned state. K0-04 locked 18 target-relative insertion,
removal, reorder, and intentional-replacement cases before qualification. The
threshold required 20 CI and 100 qualification repetitions in Chromium,
Firefox, and WebKit with no retries or engine exclusions.

The exact source commit
[`5888bbf`](https://github.com/f-gueguen/fadeno/commit/5888bbff175bedf61c85bbeaed90dc927a55a593)
completed both reference profiles in
[hosted run 29136167687](https://github.com/f-gueguen/fadeno/actions/runs/29136167687).
Every engine passed 16 cases in every repetition, including focus, selection,
caret, dirty controls, disclosure/top-layer state, playing and paused media,
island lifecycle, and intentional replacement. Every engine failed every
`document-scroll-reorder` and `element-scroll-insert` repetition: layout moved
the numeric scroll position and emitted the corresponding scroll event.

## Decision drivers

- Results must not move the locked preservation threshold.
- A useful structural mechanism must not imply a broader scroll guarantee than
  its evidence supports.
- Browser-specific exclusions would complicate support without changing the
  cross-engine result.
- V2 still needs an explicit patch, ordering, recovery, and scroll policy under
  DG-V2-01.

## Decision

H1 is **narrowed**. Stable structural identity and bounded keyed reconciliation
are viable private implementation ingredients for the 16 passing preservation
classes. They are not sufficient by themselves to preserve exact document or
element scroll when an update changes layout before the viewport or before
content inside the scroller.

No browser is excluded. V2 may proceed only after DG-V2-01 chooses and qualifies
one of these explicit boundaries:

1. manage affected scroll positions as a declared update responsibility, with
   native-equivalence, focus, anchoring, and accessibility evidence; or
2. refuse or replace updates whose patch boundary can change relevant preceding
   document/scroller layout.

The private K0 candidate, identity rules, and patch shape are evidence code, not
a public protocol or V1 API. The checked failure signature makes CI successful
only when every engine and ordinal matches these two accepted failure classes;
any missing, additional, or differently classified failure remains a gate
failure.

## Alternatives considered

- Declare H1 passed and restore scroll after every patch: rejected because the
  locked candidate intentionally did not inspect or restore browser state, and
  the required cross-flow policy is unresolved.
- Remove or weaken the two scroll cases: rejected because results cannot change
  their own threshold.
- Exclude one engine: rejected because all three engines produced the same
  result.
- Pivot entirely away from structural reuse: rejected because all other locked
  preservation classes and intentional-replacement controls completed exactly.

## Consequences

- PATCH-01 remains a V2 mechanism gated by DG-V2-01, not a V1 commitment.
- V2 planning must budget explicit scroll-boundary fixtures and cannot infer
  exact scroll preservation from node reuse alone.
- The passing focus, control, top-layer, media, and island evidence may guide a
  later private implementation, but does not publish browser support by itself.
- Qualification manifests retain a failed experiment conclusion while the job
  succeeds only for the accepted narrow signature.

## Validation

The 20-repetition reference matrix completed 1,080 cells with 960 passes and
120 accepted scroll failures. The 100-repetition reference matrix completed
5,400 cells with 4,800 passes and 600 accepted scroll failures. All 360
intentional-replacement controls completed. Portable records, independently
classified failures, summaries, screenshots, error contexts, and trace-bound
diagnostics are retained by the hosted run. A final accepted-signature run
published the [validated immutable manifest](../../experiments/morph/results/20260711T022119Z-5888bbf-a1/manifest.json),
which is pinned with its complete portable run directory.
