# Revalidation experiment

- Hypothesis: H4 — correctness-first revalidation viability.
- Harness slice: K0-09.
- Qualification capability slice: K0-10A.
- Exact-source execution slice: K0-10B.
- Command: `pnpm experiment:revalidation -- --list` prints the locked private
  workload contract without executing qualification cycles.
- Capability command: `pnpm experiment:revalidation -- --verify-qualification`
  verifies the H4 environment, schedule, runner, proof, and launcher.
- Result command: `pnpm experiment:revalidation -- --qualify` independently
  verifies all retained attempts and the immutable H4 GO result.

`app/`, `fixtures/`, `tests/`, and `results/` are reserved by the K0 plan.
K0-09 owns the private CRUD benchmark and unsafe-`keeps` controls; K0-10 owns
qualification capability; K0-10B owns immutable attempts and the H4 decision.
Qualification uses the shared [evidence contract](../contract/README.md), the
distinct H4-only [reference environment](reference-environment.json), and the
thresholds in the [K0 plan](../../docs/roadmap/k0.md).

Exact merged source `51594a8` produced 11 retained environmental INCONCLUSIVE
attempts before attempt 12 became the first complete reference-valid run. The
[immutable result](results/qualification-result.json) accepts correctness-first
revalidation; public resource/cache/action/`keeps` syntax remains gated.

K0-09's deterministic workload is a private evidence ABI. Resource IDs,
typed resource inputs, comparison tags, authentication records, and the
selective baseline are not public V1 syntax or exports. Equivalent inputs are
canonicalized for request-local identity; unsupported input/result values are
conservatively refused rather than compared through lossy serialization.
