# Experiments

Kill-risk experiments are private evidence. They do not establish public
framework behavior, package boundaries, or supported environments.

The [v1 contract](contract/README.md) owns manifest shape, strict parsing,
artifact integrity, directory rules, and the reference environment. The
[registry](registry.json) lists exactly the four experiments approved by the K0
plan. `pnpm experiment:all --list` renders that registry deterministically;
plain `pnpm experiment:all` refuses until later slices provide real harnesses.

Every result lives at `results/<run-id>/manifest.json`, is written once from a
clean source commit, and records locked inputs, observed environment, raw
measurements, failures, redaction, artifact hashes, and conclusion. Harnesses
must create result directories exclusively and publish a manifest by atomic
rename; they never overwrite an attempt.

The accepted reference environment is [recorded here](reference-environment.json).
Mutable GitHub host facts are captured for every run. A preflight deviation
classifies the run as non-reference before measurement; it is never hidden by a
summary or retry.
