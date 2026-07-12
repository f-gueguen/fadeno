# Revalidation fixtures

`workload.json` in the parent experiment is the review-approved fixture. It
locks six resources, nine reads, 10,000 generated rows, success/error paths,
and four unsafe `keeps` classes: value, expected-error, ordering, and
non-cacheable refusal. Authentication includes a canary that diagnostics must
never disclose.
