# Revalidation fixtures

`workload.json` in the parent experiment is the review-approved fixture. It
locks six resources, nine input-bearing reads, equivalent/distinct identity
controls, 10,000 generated rows, success/error paths, and four exact unsafe
`keeps` resource/class bindings. Each sensor compares real observations of its
declared resource: changed task value, permission error transition, reordered
projects, or non-cacheable activity refusal. Authentication includes values
that diagnostics must never disclose.

`qualification-schedule.json` is the generated, sub-1-MiB H4 schedule: 10,000
cycle IDs, 8,056 fresh-state successful mutations, 1,944 denied actions, and a
seeded permutation of all nine reads per cycle. Its independent golden locks
the complete bytes, order stream, path counts, endpoints, and before/success
output digests.
