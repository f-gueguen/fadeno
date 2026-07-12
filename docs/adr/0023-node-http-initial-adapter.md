# ADR 0023: Node HTTP as the initial adapter

- Status: Accepted
- Date: 2026-07-12
- Owners: Fadeno maintainers
- Related specifications: [Build, adapters, and testing](../spec/build-adapters-testing.md), [Security requirements](../security/requirements.md)
- Supersedes: None

## Context

Fadeno's server core is defined in terms of standard `Request`, `Response`, and
Web Streams, but V1 needs one owned runtime translation before it can create a
package or running example. The choice must demonstrate request and response
streaming, backpressure, disconnect cancellation, header and cookie fidelity,
and graceful shutdown without silently defining renderer boundaries or action
security policy.

## Decision drivers

- Use stable platform APIs without adding a runtime dependency.
- Preserve the Web-standard core boundary fixed by ADR 0008.
- Make absent security and transport capabilities explicit rather than
  approximating them.
- Prove the declared minimum runtime, not only the maintainer's newer host.
- Keep the feasibility code private until package ownership is decided.

## Decision

Select Node.js built-in `node:http` as Fadeno's first adapter target. The
adapter minimum is Node 22.17.0, the Node 22 release in which the built-in
Node-to-Web stream bridge used for request bodies is stable. A runtime below
that version fails before the listener starts.

The adapter translates an incoming Node request into a standard `Request` and
passes it to a handler of the private shape
`(request: Request) => Response | Promise<Response>`. The returned standard
`Response` is written without pre-buffering. Writes respect Node backpressure,
and client disconnect cancels the response Web Stream and aborts the request
signal. Successfully completed keep-alive requests are not retroactively
aborted.

Request URL authority comes from the actual listener address, not `Host` or
forwarded headers. Only origin-form request targets are accepted by the private
prototype. Trusted-proxy interpretation is false and remains absent until an
explicit policy owns it.

The closed capability declaration is:

- standard Web `Request` and `Response`: yes;
- streamed request bodies: yes;
- streamed response bodies with backpressure: yes;
- disconnect cancellation: yes;
- response trailers: no;
- adapter-enforced request-size limit: none;
- trusted proxy headers: no;
- graceful shutdown: drain active responses and refuse new connections, with
  no adapter deadline or force-close policy.

Body, field, file, action, origin, CSRF, and timeout policies remain owned by
their later V1 decisions. Stream boundary nesting, response commitment, and
renderer timeout behavior also remain undecided. This ADR creates no public
package, config field, registry, or support-matrix claim.

## Alternatives considered

- Node 22.14.0: rejected because its Node-to-Web stream bridge is still marked
  experimental. The repository and selected adapter now share Node 22.17.0 as
  their minimum so the canonical check cannot claim a lower working engine.
- Buffer request or response bodies: rejected because it would make streaming
  and cancellation claims false.
- Implement a manual Node-to-Web request stream: rejected because the stable
  runtime bridge is smaller and owns backpressure behavior at the platform
  boundary.
- Select several runtimes: rejected because V1 needs one maintained adapter and
  the shared conformance surface must be established before breadth.
- Add shutdown deadlines or forced connection termination: rejected because
  those semantics belong to the later streaming and timeout decision.

## Consequences

- V1 package-boundary work can use one concrete adapter consumer.
- Repository tooling and the adapter now share Node 22.17.0 as their minimum;
  the adapter is also checked independently on that exact runtime.
- Deployments needing adapter-level request limits, trusted proxies, trailers,
  or forced shutdown cannot claim those capabilities.
- The private prototype can be removed and this decision superseded without a
  public compatibility migration if later package evidence rejects it.

## Validation

`pnpm check:v1-adapter` type-checks the private adapter strictly and exercises
request and response translation, explicit URL authority, origin-form refusal,
delayed request streaming, early response flush, slow-reader backpressure,
headers, independent `Set-Cookie` values, disconnect cancellation, successful
keep-alive completion, aborted uploads, active-response drain, new-connection
refusal, and idle keep-alive shutdown.

`pnpm check:v1-adapter:minimum` repeats that suite in the digest-pinned Node
22.17.0 image with networking disabled and the repository mounted read-only.
This is feasibility evidence, not yet the shared public adapter conformance or
a support-matrix entry.
