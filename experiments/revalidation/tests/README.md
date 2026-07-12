# Revalidation tests

The K0-09 checks execute the private benchmark twice, require byte-equivalent
reports, assert six request executions from nine reads, deduplicate equivalent
inputs while proving distinct inputs produce both a separate execution and a
distinct observable value, prove successful and denied action
behavior, and compare default/selective rendered task outcomes. Negative
controls require stale rendered output, unsupported, cyclic, sparse, symbol,
and non-enumerable values, malformed
reports, and unsafe resource/class bindings to fail. All four unsafe-`keeps`
sensors use their declared resources and produce sensitive-value-safe
diagnostics. K0-10B owns the full qualification run and immutable
correctness/performance/memory evidence.

K0-10A additionally locks and checks the H4-only environment, all qualification
schemas, schedule reconstruction, paired runner, independent raw-evidence
derivation, monotonic attempt retention, canonical remote and exact source/input
hashes, complete host/Docker identity, complete-output paired timing evidence,
and a GC/RSS memory phase that runs before retained correctness/latency arrays.
The independent verifier rescans and relinks every retained artifact; negative
controls cover coordinated identity/hash tampering, JSON-formatted secrets,
denied-action state mutation, and schema-valid product failures that must remain
PIVOT evidence. K0-10B additionally validates the complete 12-attempt sequence,
first-complete selection, and immutable GO projection.
