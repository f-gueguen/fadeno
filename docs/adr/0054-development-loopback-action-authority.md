# ADR 0054: Development loopback action authority

- Status: Accepted
- Date: 2026-08-26
- Owners: Fadeno maintainers
- Related specifications: [Forms, actions, redirects, cookies, and sessions](../spec/forms-actions-sessions.md), [Build, adapters, and testing](../spec/build-adapters-testing.md), [Security requirements](../security/requirements.md)
- Supersedes: None

## Context

`fadeno dev` owns an HTTP listener on `127.0.0.1`, but its generated child used
a synthetic HTTPS action origin. Documents remained readable while a native
POST from the advertised listener carried a different `Origin` and was refused.
An inherited `FADENO_ORIGIN` could create the same split with any external host.

## Decision drivers

- The advertised development listener and action authority must be identical.
- The exception must remain limited to trustworthy loopback development.
- Production HTTPS and enhanced mutation controls must not weaken.

## Decision

Development owns one authority: `http://127.0.0.1:<port>`. The child derives it
from the selected listener port and does not inherit or accept a
`FADENO_ORIGIN` override.

The native action and redirect boundaries accept an exact, uncredentialed
HTTPS origin or an exact HTTP loopback origin on `127.0.0.1`, `localhost`, or
`[::1]`. Exact `Origin` equality, proof, replay, authorization, session, upload,
and redirect controls remain unchanged. Arbitrary HTTP origins remain refused.
Production bootstrap and deployment still require the operator-owned external
HTTPS `FADENO_ORIGIN`. Enhanced mutation transport remains HTTPS-only under ADR
0051.

Packed development evidence must prove that handlers observe the advertised
listener authority, a cross-origin native POST is refused, a same-origin native
POST succeeds, and a conflicting inherited origin cannot change that result.

## Alternatives considered

- Keep a synthetic HTTPS action owner over an HTTP listener: rejected because
  the browser's exact `Origin` can never match it.
- Honor a development `FADENO_ORIGIN` override: rejected because the development
  command, not an external proxy, owns and advertises the listener.
- Admit arbitrary HTTP origins: rejected because only trustworthy local
  development needs the exception.

## Consequences

Loopback development can execute native actions against the URL it advertises.
The shared protected-origin predicate prevents constructor, execution, and
redirect policy drift. Production HTTPS and enhanced-mutation requirements do
not change.

## Validation

`pnpm check:v1-development` exercises the packed listener authority, conflicting
environment input, cross-origin refusal, and successful same-origin native POST.
`pnpm check:v1-action-runtime` and `pnpm check:v1-action-session-decision` retain
the production origin, redirect, proof, session, and refusal corpus.
