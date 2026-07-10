# Experiment contract v1

K0-01 defines evidence containers, not experiment mechanisms or favorable
results.

## Schemas

- `v1/reference-environment.schema.json` validates the accepted host,
  container, toolchain, browser, storage, power, load, preflight, and source
  record.
- `v1/experiment-registry.schema.json` validates registry structure and bounds.
- `v1/result-manifest.schema.json` validates bounded, versioned result
  manifests with no unknown properties.

Schemas use JSON Schema 2020-12, stable local identities, strict Ajv validation,
and no network-loaded references. `scripts/check-experiment-contract.mjs`
self-validates every schema before compiling it.

## Authority and projections

The accepted K0 plan owns roadmap slices and hypotheses.
`experiments/registry.json` is the single machine-readable authority for each
experiment's identity and current `planned`, `available`, or `qualified` state;
the project-model check cross-validates it against that plan. Directory
presence, package scripts, and aggregate CLI output are checked projections of
the registry and never infer readiness independently.

JSON schemas own document structure and bounds. The shared contract library
owns only cross-document semantics, strict JSON decoding, contained filesystem
resolution, and artifact integrity. The MCR verifier separately owns the
external network/digest boundary. Ajv strictness and compilation live in one
shared adapter consumed by all three check entrypoints.

## Input boundary

Contract JSON is at most 1 MiB, fatal UTF-8, and BOM-free. Parsing rejects
duplicate keys, prototype-shaped keys, malformed or truncated JSON, and
non-finite tokens before schema validation. Relative paths reject absolute,
backslash, empty, dot, and parent segments. Artifact verification resolves
symlinks beneath the result root and checks recorded byte length and SHA-256.

Strings, arrays, numeric values, attempts, repetitions, failures, and artifacts
are bounded. Manifest failures and summaries follow `fadeno-no-secrets-v1` and
must not contain credentials, cookies, authorization values, session values, or
sensitive submitted fields.

The pinned Playwright container runs only project-owned local fixtures. K0-01
records that its root execution disables the Chromium sandbox; untrusted or
external pages are forbidden. A future need for untrusted browsing must change
the reference environment and enable a reviewed non-root/seccomp policy first.

## Command contract

- `pnpm --silent experiment:all --list` exits `0`, writes one lexically ordered JSON
  document plus a final newline to stdout, and writes nothing to stderr.
- `pnpm --silent experiment:all` exits `2` before side effects with diagnostic
  `FADENO_K0_001` while no execution harness exists.
- An unsupported argument passed to the underlying script exits `64` before
  side effects with diagnostic
  `FADENO_K0_002`.
- A malformed or empty registry exits `65` before side effects with diagnostic
  `FADENO_K0_003`; it never degrades to an empty successful run.

The non-silent pnpm aliases have the same command behavior but pnpm may add its
own lifecycle line to the output.

K0-01 intentionally contains no fake harness. Later harness slices add their
own root command and executable evidence without weakening this refusal.

## Reference image verification

`pnpm check:reference-image` performs an explicit network check that the named
MCR tag still resolves to the recorded index, linux/amd64 platform, and config
digests. It is required when accepting or changing the reference image but is
not part of the offline repository check.

## Result publication

Result writers introduced by later slices create a unique attempt directory,
write artifacts and a temporary manifest, validate the complete tree, then
atomically rename the manifest into place. Existing attempts and manifests are
never replaced. A go, narrow, or pivot decision belongs in the qualification
ADR; the raw manifest conclusion is only pass, fail, or inconclusive.
