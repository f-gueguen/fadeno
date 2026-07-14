# Native action and protected session threat model

This threat model accompanies ADR 0035 and the private V1-12 decision corpus.
It selects the boundary implemented by V1-13's public native action and
protected-session path. The schema and replay/session decision machinery remain
private, and this document does not extend support beyond one process.

## Assets and actors

Assets are authenticated user identity, authorization decisions, application
data, mutation ordering, form intent, session and proof keys, confidential
session values, uploaded bytes, resource freshness, redirect destinations, and
secret-safe diagnostics. Attackers may control request method, URL, headers,
origin, body framing, form names and values, files, filenames, media types,
cookies, proof envelopes, request timing, and repetition. An authenticated user
may attempt another user's mutation. Application callbacks may throw, stall,
partially mutate, return an unsafe redirect, or accidentally include submitted
values in an error.

## Trust boundaries and ownership

- The framework owns generated action endpoints and field names, proof issue
  and verification, parsing limits, replay consumption, upload cleanup,
  protected cookies, key selection, session rotation, redirect validation,
  revalidation entry, diagnostic identity, and redaction.
- The application owns the explicit authorization decision, mutation, stable
  expected-failure code, field/form validation text, and the instruction to
  rotate identity after a privilege change.
- The adapter owns canonical HTTPS origin, request cancellation, declared and
  observed body bytes, disconnect, and response header publication.
- Session keys are server-only environment inputs. Submitted values, files,
  cookies, proofs, and callback failures are untrusted data, never policy.

## Threats and controls

| Threat | Control | Executable evidence |
| --- | --- | --- |
| Cross-site mutation or logout | Exact HTTPS `Origin` equality before missing-cookie session publication, no `Referer` fallback, session- and form-instance-bound HMAC proof | `cross-origin`, cookie-less cross-origin, `invalid-proof`, cross-session proof |
| Stale or misrouted form | Proof binds action, route, application generation, session, issue time, and nonce | `wrong-route`, `stale-generation`, `expired-proof` |
| Captured request replay | Atomic consume before authorization; no unexpired eviction; bounded global/session ledgers | `replayed` and replay-limit checks |
| Decoder smuggling | Closed single-value descriptors; missing, malformed, duplicate, unexpected, counterfeit, and unsupported values fail closed | decoder corpus cases and counterfeit descriptor check |
| Body/file exhaustion | Declared and observed aggregate bytes, part/file counts, per-field/file/name/type/depth and processing limits | `oversized-body`, `boundary-timeout`, `hostile-upload` |
| Filesystem path injection | Original filename is bounded display data; no path construction; application receives copied bytes or contained handle | hostile upload and success filename assertion |
| Partial-upload leak | Framework owns idempotent cleanup in the complete terminal `finally` path | success and refused cleanup counters |
| Decode mistaken for authorization | Separate mandatory callback after complete boundary; denial and callback failure never invoke mutation | `unauthorized`, `authorization-failure`, cross-origin callback counters |
| Open redirect | Action completion accepts only normalized exact-origin HTTPS status 303; unsafe completion is refused and revalidated | native success and `unsafe-redirect` |
| Stale resources after mutation | Success and changed/unknown failure perform complete revalidation; unchanged expected failure explicitly does not | expected changed/unchanged and recovery fixtures |
| Session disclosure or forgery | AES-256-GCM with random nonce and authenticated cookie/version/key metadata; values never appear in evidence | round trip, tamper, serialization/redaction checks |
| Key rotation logout or downgrade | Active key encrypts/signs; bounded prior keys decrypt then reseal and verify only still-fresh keyed proofs; removed or unknown key fails closed | `session-prior-key`, prior-key proof, invalid-key checks |
| Session fixation | Fresh 32-byte session and CSRF identities plus required privilege-change rotation | `session-fixation` |
| Indefinite credential lifetime | Twelve-hour absolute expiry; ordinary renewal cannot extend it; expiry clears the cookie | `session-expired`, retained-identity assertions |
| Expiry during accepted callback completion | Buffered session mutation is discarded; a redacted deterministic failure revalidates through a fresh anonymous session instead of throwing past the adapter | action-runtime completion-expiry fixture |
| Cookie scope widening | `__Host-` name, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`, bounded pair | cookie and deletion assertions |
| Secret leakage through errors | Typed codes and phases select behavior; callback messages, submitted fields, file bytes, cookies, proofs, and keys are structurally absent | human/machine/flow fixtures and authorization-failure redaction |

## Boundary ordering and mutation invariant

No application callback is reachable until method, media type, exact origin,
route, current generation, session, proof, replay, fields, files, byte/count
limits, and processing duration are accepted. Replay is consumed before the
application authorization decision so a denied captured request cannot be
retried as a second mutation attempt. Denial and authorization failure skip
mutation. Upload cleanup runs for every outcome.

The private model receives already framed parts plus declared/observed parser
evidence; V1-13 places a bounded streaming body reader and capped
framing/parser boundary in front of the same decision. Parser refusal may occur
earlier but cannot publish a partial field,
retain a partial upload, invoke application code, or consume a proof after a
newer terminal outcome owns the request.

## Limits and denial of service

All framework-retained request state is bounded by ADR 0035. Replay admission
is constant-time until a ledger or session reaches its cap; expiry cleanup then
scans at most 4,096 live entries, and an earliest-expiry guard prevents repeated
full scans while nothing can expire. This is a bounded correctness-first V1
cost, not a throughput claim. Parsing and cryptography still consume CPU and memory up to
the accepted body/file/time limits. The adapter must apply request and
connection limits before an attacker can accumulate unbounded simultaneous
bodies. V1-13 performance evidence measures the complete native action path.

## Residual risks and unsupported deployments

- A valid stolen cookie remains a bearer credential until absolute expiry,
  deletion at the legitimate client, key removal, or later server-side
  revocation. The framework cannot undo endpoint compromise.
- The replay ledger is process-local. Multiple action-serving processes could
  accept the same proof and are outside V1 support.
- `SameSite=Lax` and origin/proof checks do not replace application
  authorization. Authorization logic can still be wrong and requires
  application tests.
- Application mutation may partially succeed before throwing. Conservative
  complete revalidation restores observable server truth but cannot roll back
  the application's storage transaction.
- Content-type claims and original filenames do not establish file safety.
  Applications must inspect content appropriate to their domain after the
  framework's structural limits pass.
- AES-GCM key material remains present in server process memory. V1 does not
  select hardware key custody or distributed key delivery.

Before public alpha, the complete external decoder surface must receive
fuzzing. Before stable release, independent security review must remediate all
known critical and high-severity findings.
