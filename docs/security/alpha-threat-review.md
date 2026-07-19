# First-alpha threat review

Status: **A0-09 candidate qualification**

This review closes the complete first-alpha trust-boundary inventory. It does
not replace the rendering, streaming, action/session, deployment, or release
threat models. It verifies that those owning documents and their executable
gates cover every supported public input boundary in the current package.

## Result

The current `@fadeno/framework` tarball is qualified as an experimental alpha
candidate when every gate in
[`evidence/a0/qualification/alpha-candidate.json`](../../evidence/a0/qualification/alpha-candidate.json)
passes against the same source. No known critical or high-severity issue is
left open in the reviewed first-alpha boundary. This is a maintainer-operated
qualification, not the independent security review required before stable
release.

The review discovered and repaired three malformed-input classification gaps:

- an unmatched UTF‑16 surrogate in an unsaved configuration source is now
  refused as `FADENO_CONFIG_SYNTAX` before entering the compiler bridge;
- invalid UTF-8 environment-file bytes refuse before precedence is applied;
- invalid UTF-8, percent-decoded form bytes, or malformed multipart form bytes
  are now refused as `FADENO_ACTION_BODY` instead of reaching application code
  or appearing as an internal framework failure.

These outcomes are exercised by `pnpm check:a0-decoder-fuzz` and are part of the
checked normalized result, not prose-only claims.

## Complete supported boundary inventory

| Boundary | Untrusted or externally controlled input | Owning controls and evidence |
| --- | --- | --- |
| Public command and filesystem ownership | Command arguments, project roots, output paths, names, links, existing files | Closed command grammars, containment, symlink refusal, exclusive missing-target claims, rollback; decoder fuzz plus `check:v1-toolchain`, `check:a0-create`, and `check:a0-deploy` |
| Configuration and environment | `fadeno.config.ts`, unsaved configuration text, `.env` lines, process values | Static non-executing configuration grammar, well-formed text, exact precedence, redaction; decoder fuzz plus `check:v1-toolchain` |
| Routes and generated ownership | Route filenames, pathname encodings, generated manifest bytes, source changes | Portable names, closed segments, manifest semantics, exact hashes, freshness and transactional replacement; decoder fuzz plus `check:v1-routing` and `check:v1-analyzer-workflow` |
| HTTP adapter | Request target, method, headers, body stream, disconnect, response headers | Listener-derived authority, target refusal, Web `Request` construction, cancellation, backpressure and graceful drain; decoder fuzz plus `check:v1-adapter` |
| Native actions and uploads | Generated endpoint/query, media type, body framing, UTF-8, fields, proof, files, names, callbacks, redirect, replay | Exact origin, bounded streaming parser, closed fields, proof and replay owner, authorization-before-mutation, cleanup, same-origin 303 and redaction; decoder fuzz plus `check:v1-action-session-decision` and `check:v1-action-runtime` |
| Protected sessions | Keyring environment, cookie header/envelope, encrypted values, expiry and rotation | Bounded active-first keys, authenticated encryption, host-only cookie, absolute expiry, privilege rotation and invalid-cookie clearing; decoder fuzz plus action/session gates |
| Rendering and raw authority | Dynamic text/attributes/URLs, JSX structure, explicit raw content, callback failures | Contextual encoding, refused sinks, authenticated raw capability, CSP correlation and safe failure projection; `check:v1-rendering-security`, `check:v1-renderer`, and three-browser `check:v1-running-example` |
| Resources and application values | Resource inputs, expected failures, application loader values | Bounded structural normalization, request-only ownership, no cross-request cache, cancellation, cleanup, typed failures and redaction; `check:v1-resource-decision`, `check:v1-resources`, and the packed application |
| Build, package, release, and deployment artifacts | Source/compiler inputs, lockfile, package metadata, generated files, deployment environment, retained prior release | Exact input/output identity, frozen install, lifecycle-script refusal, SBOM, provenance guard, source-free immutable deployment and unchanged-directory rollback; `check:v1-independent-workflow`, `check:a0-release`, and `check:a0-deploy` |

Private analyzer serialization is not a supported external input or public
schema. It nevertheless has strict size/version/key validation, round-trip and
mutation evidence under the private analyzer gates. Deep imports remain
refused, and this review creates no editor product or analyzer compatibility
promise. Browser patch and island protocols do not exist in the alpha and are
therefore not hidden decoder surfaces.

## Bounded deterministic fuzz result

`pnpm check:a0-decoder-fuzz` builds and packs the current package and runs the
exact production decoders twice in fresh child processes with a fixed seed and a
30-second process deadline. The checked corpus covers 2,360 cases over fourteen
surfaces:

1. adapter request targets;
2. pathnames through a generated application handler;
3. unsaved configuration sources;
4. configuration file bytes;
5. environment file bytes through file ownership and precedence capture;
6. build and development command arguments;
7. check command arguments;
8. create command arguments;
9. deploy command arguments;
10. generated route manifests;
11. complete session Cookie headers;
12. generated action endpoints and their exact query set;
13. serialized action proofs;
14. action bodies, media types, percent-decoded text, and valid multipart file
    decoding.

Every surface has at least one accepted and one refused control. Every input is
bounded: the over-limit Cookie-header control is at most 16,385 bytes and every
other surface is at most 4,096 bytes. Every outcome is classified, the two
complete result documents must be byte-identical, and a submitted secret canary
must never appear in action responses. The normalized checked output is
[`decoder-fuzz.json`](../../evidence/a0/security/decoder-fuzz.json). Mutation
tests refuse missing controls, surface reordering, a changed seed, an
unexpected outcome, an input over the bound, nondeterministic replay, or an
observed leak.

## Residual risks and non-claims

- The native action replay and protected-session owner supports one serving
  process. Multi-process ownership remains deferred.
- A stolen valid session cookie remains a bearer credential until expiry,
  deletion, or key removal.
- Application authorization and storage transaction correctness remain
  application responsibilities. Complete revalidation cannot undo a partially
  committed external mutation.
- Uploaded names and media types are display claims; applications must inspect
  content appropriate to their domain.
- Explicit raw HTML and application-rendered secrets remain auditable
  application authority, not something contextual encoding can make safe.
- Existing performance evidence keeps its recorded narrow or baseline-only
  conclusions. This review introduces no incremental, server, or browser
  performance bound.
- Independent newcomer, assistive-technology, and independent stable-security
  qualification remain unproven. No editor product or public analyzer schema
  is supported.

## Rollback

Before publication, reverting the A0-09 squash commit restores the prior
unpublished seed and removes the alpha-candidate claim. After publication, a
fault is corrected with a new immutable prerelease; an existing version or tag
is never replaced. Deployment rollback restarts an unchanged prior release
directory and never treats a failed candidate as accepted bytes.
