# Revalidation tests

The K0-09 checks execute the private benchmark twice, require byte-equivalent
reports, assert six request executions from nine reads, deduplicate equivalent
inputs without conflating distinct inputs, prove successful and denied action
behavior, and compare default/selective rendered task outcomes. Negative
controls require stale rendered output, unsupported/cyclic values, malformed
reports, and unsafe resource/class bindings to fail. All four unsafe-`keeps`
sensors use their declared resources and produce sensitive-value-safe
diagnostics. K0-10 owns randomized qualification cycles and performance/memory
evidence.
