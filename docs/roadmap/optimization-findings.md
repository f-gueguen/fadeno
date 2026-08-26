# Optimization findings and implementation milestone

Status: implementation candidate  
Research source: independent ten-wave Ox Alpha search completed 2026-08-26  
Source commit: `ea734d0b2556fe7c094069f5e6fb05001c9cb846`  
Affected features: `DX-01`, `CLI-01`, `WEB-01`, `WEB-02`, `DATA-01`,
`DATA-02`, `PATCH-01`, `PERF-01`, `REL-01`

## Purpose

This report converts the optimization search into reviewable implementation
slices. It does not make unimplemented behavior current, cross an open decision
gate, or treat a microbenchmark as a public performance guarantee. Each slice
must preserve the applicable project invariants and prove an observable outcome
instead of pinning an internal implementation shape.

The research ran 10 waves of five logical slots. It used 88 fresh model
sessions including 38 retries, accepted 22 valid reports, and consolidated 147
claims. Final classification was 31 validated, 22 independently rediscovered,
41 partially validated, 9 refuted, 8 invariant conflicts, 13 requiring an ADR,
9 decision-gated, 5 compatibility changes, 4 requiring external evidence, and
5 inconclusive. The append-only research ledger SHA-256 was
`6312492ec9e0437e18ab15a0c5280a11c8608c28d369eee7b7fb0de04ed37a57`.

## Implementation order

| Order | Finding | State | Smallest useful change | Behavior-level proof |
| ---: | --- | --- | --- | --- |
| 1 | Align the local Node pin with the enforced `>=22.17` engine floor | implemented | Update the pin and enforce one repository-wide runtime floor | Reject a fixture whose pin is below the declared engine minimum; accept the repository values |
| 2 | Execute source and generated route matchers against one corpus | implemented | Reuse the accepted routing cases for both shipped matcher forms | Assert identical route identity and parameters for accepted cases and identical refusal for malformed or unmatched paths |
| 3 | Replace interpreted multipart candidate scans with native byte search | implemented | Use `Buffer.indexOf` at the existing Node-owned boundary | Differentially compare full parser outcomes across overlaps, suffixes, malformed framing, limits, and randomized bodies |
| 4 | Incrementally drain discarded redirect revalidation bodies | implemented | Read and discard chunks without materializing a contiguous body | Prove complete resource execution, backpressure consumption, late-error propagation, cancellation, and redirect outcome |
| 5 | Remove duplicate composite check executions | implemented | Delete the repeated documentation-source, documentation, and public-package invocations | Instrument the check graph and prove each required gate runs exactly once while failure order remains deterministic |
| 6 | Diagnose unknown CLI commands directly | implemented | Reject unknown commands before command-specific usage | Invoke a typo and assert the unknown token, non-zero status, no unrelated command execution, and actionable usage |
| 7 | Make development action authority match the actual listener origin | implemented | Derive or validate one canonical development origin | Prove GET remains usable and same-origin protected POST succeeds for the advertised listener while cross-origin POST refuses |
| 8 | Report unexpected browser boundary child failures | implemented | Observe only failures outside authored cancellation and timeout | Prove unexpected rejection is reported once while expected abort, timeout, supersession, and teardown remain silent |
| 9 | Materialize pre-header request failures as HTTP responses | ready | Emit the owned `400` or `500` before closing the socket | Send malformed and failing requests and assert status/body/redaction while post-header failure retains stream ownership |
| 10 | Load only the selected CLI command module | ready | Replace eager command imports with direct selected imports | Prove every command still works, an unselected module sentinel is untouched, and diagnostics are unchanged |
| 11 | Bound stalled response progress and shutdown | decision required | Add progress-aware write bounds and grace-limited connection escalation | Prove progressing streams survive, stalled clients cannot block close forever, late writes stop, and no owner remains |
| 12 | Memoize exact effective configuration parsing | experiment ready | Add a small bounded cache below freshness checks, keyed by project root and exact effective text | Prove saved and unsaved changes invalidate, diagnostics remain byte-equivalent, eviction is bounded, and projects do not cross |
| 13 | Retain safe unchanged head nodes during reconciliation | ADR required | Reuse only nodes whose accepted semantics are explicitly stable | Three-engine tests must prove stylesheet continuity, script policy, CSP nonce freshness, CSSOM behavior, rollback, and refusal |
| 14 | Replace nested package-manager check wrappers with a direct driver | experiment ready | Execute the same ordered scripts in one process owner before considering parallelism | Byte-compare command order, output, exit status, cleanup, and compound-script semantics for success and failure |
| 15 | Remove TypeScript from the production hard dependency closure | compatibility decision required | Move compiler ownership to the creating application or an accepted optional boundary | Pack/install tests must prove check/build/dev for created and existing consumers, production install, SBOM, and missing-compiler diagnostics |
| 16 | Index radio groups during browser reconciliation | blocked by exact-key proof | Index by live form object or identity/null plus name only after mutation-safe semantics are proven | Three-engine differential tests must cover duplicate form IDs, reassociation, DOM moves, live dirtiness, rollback, and refusal |

## Measured evidence

- Multipart absent-marker scanning on an adversarial 8 MiB body with a 70-byte
  marker fell from a 656.824 ms median to 6.685 ms across the research probe,
  a 98.98% reduction. One thousand byte-search differential cases returned the
  same offsets. Full-parser equivalence remains the implementation gate.
- Incremental draining of a synthetic 64 MiB response avoided the contiguous
  `arrayBuffer()` accumulation and completed in 2.75 ms versus 66.26 ms in the
  probe. The implementation must rethrow late stream errors and must not cancel
  rendering early.
- Selecting only the CLI module needed by `create` reduced fresh-process import
  median from 67.304 ms to 31.448 ms over 25 samples. This is a startup
  observation, not an accepted public budget.
- Configuration parsing cost 46.41–51.29 ms, with a 48.25 ms median, in the
  research fixture. Cache admission is allowed only after exact saved/open
  overlay invalidation is proven.
- The root check surface contains 76 top-level and 84 recursively counted
  package-manager wrappers. Fresh process startup showed a 242.55 ms median
  excess over the Node floor. The estimated aggregate saving remains partial
  until complete output and failure equivalence is demonstrated.
- Replacing the same no-store stylesheet five times caused five requests and
  measured unstyled windows of 102.5–104.9 ms. Head retention remains an ADR
  item because script execution, CSSOM state, CSP nonce freshness, and rollback
  are observable contracts.

## Rejected approaches

These mechanisms must not be reintroduced without new evidence:

- A radio-group key with one shared “unmapped form” bucket is semantically
  incorrect.
- A post-rename ownership token cannot prevent or repair POSIX destination
  clobber.
- Error mapping or a janitor does not turn rename into a no-clobber publish
  primitive.
- The approximately 29 Playwright waits are not one class of positive settle
  delay; many are explicit race or negative-observation windows.
- `Content-Length` preallocation does not remove the mandatory copy from
  streamed chunks and reserves attacker-declared memory early.

## Milestone rules

1. Implement in the order above unless a prerequisite or active project slice
   blocks the next item.
2. Start with a failing invariant-level test where practical. Never assert a
   helper name, import layout, or chosen data structure.
3. After a slice passes its focused tests, independently review the touched
   area for unnecessary TypeScript architecture and real asymptotic problems.
   Keep only evidence-backed fixes; prefer deletion, inlining, and direct
   control flow.
4. Commit each accepted slice independently with its tests and required
   authority updates. Do not mix speculative cleanup.
5. Run every affected traceability command, then `pnpm check`. Run
   `pnpm ci:local` on the exact final clean commit before merge readiness.
6. Decision-gated, ADR-gated, compatibility-changing, and external-evidence
   items remain report entries until their project-law prerequisites are met.

## Compatibility and rollback

Orders 1–10 are intended to preserve current public behavior. Orders 11–16 may
alter lifecycle, reconciliation, tooling, or package contracts and therefore
retain their named gates. Every implementation slice must remain independently
revertible. Removing the slice must restore the preceding behavior without
requiring migration of application state or retained artifacts.
