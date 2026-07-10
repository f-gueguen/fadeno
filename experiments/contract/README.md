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
and no network-loaded references. `scripts/check-experiment-contract.ts`
self-validates every schema before compiling it.

## Authority and projections

The accepted K0 plan owns roadmap slices and hypotheses.
`experiments/registry.json` is the single machine-readable authority for each
experiment's identity and current `planned` or `available` state; the
project-model check cross-validates it against that plan. K0-01 deliberately
does not admit a `qualified` state: the first qualification slice must add a
checked manifest-and-decision evidence gate before that transition exists. Directory
presence, package scripts, and aggregate CLI output are checked projections of
the registry and never infer readiness independently.

JSON schemas own document structure and bounds. The shared contract library
owns only cross-document semantics, strict JSON decoding, contained filesystem
resolution, and artifact integrity. The MCR verifier separately owns the
external network/digest boundary. Ajv strictness and compilation live in one
shared adapter consumed by all three check entrypoints.

## Input boundary

Contract JSON is at most 1 MiB, fatal UTF-8, BOM-free, and at most 128 levels
deep. Parsing rejects duplicate keys, prototype-shaped keys, malformed or
truncated JSON, and non-finite tokens before schema validation. Relative paths reject absolute,
backslash, empty, dot, and parent segments. Artifact verification resolves
symlinks beneath the result root and checks recorded byte length and SHA-256.

Strings, arrays, numeric values, attempts, repetitions, failures, and artifacts
are bounded. Manifest writers must redact credentials and sensitive submitted
fields before serialization. The validator then applies the defense-in-depth
`fadeno-no-secrets-v1` scan to every manifest string and rejects high-signal
authorization, bearer, cookie, password, token, session, private-key, GitHub
token, and AWS access-key shapes; the policy never treats that scan as a
substitute for writer-side allowlisting and redaction.

The pinned Playwright container runs only project-owned local fixtures. K0-01
records that its root execution disables the Chromium sandbox; untrusted or
external pages are forbidden. A future need for untrusted browsing must change
the reference environment and enable a reviewed non-root/seccomp policy first.

## Command contract

- `pnpm --silent experiment:all -- --list` exits `0`, writes one lexically
  ordered JSON document plus a final newline to stdout, and writes nothing to
  stderr. The separator-less `--list` form is accepted for compatibility.
- `pnpm --silent experiment:all` exits `2` before side effects with diagnostic
  `FADENO_K0_001` until all four private harnesses exist. Individual available
  harnesses run through their own root commands.
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
digests. It hashes all three raw registry responses rather than trusting headers
alone. The tag is provenance only: `container.runtimeImage`, qualified by the
linux/amd64 platform digest, is the only normative execution identity. The
network check is required when accepting or changing the reference image but
is not part of the offline repository check.

Reference classification is derived, not asserted: provider, runner identity,
architecture, advertised hardware, free storage, background-load thresholds,
the fixed acceptance reason, and a pre-start preflight no more than 60 seconds
old must all match the reference record. A deviation can still be recorded, but
only as `non-reference`.

## Result publication

Result writers introduced by later slices create a unique attempt directory,
write artifacts and a temporary manifest, validate the complete tree, then
atomically rename the manifest into place. Existing attempts and manifests are
never replaced. The run ID is bound to start time, source commit, and attempt;
the command is bound to the experiment registry; dependency-lock and dataset
hashes are backed by immutable copied artifacts; and a passed result must carry
measurements and artifacts. Publication validation resolves the source commit
as an ancestor of `HEAD` and compares the copied lock (bounded to 4 MiB) with
`pnpm-lock.yaml` at that exact commit, so CI checkouts retain full Git history.
A go, narrow, or pivot decision belongs in the qualification
ADR; the raw manifest conclusion is only pass, fail, or inconclusive.
