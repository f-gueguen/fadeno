# ADR 0047: Initial browser runtime and private transport

- Status: Accepted
- Date: 2026-07-20
- Owners: Fadeno maintainers
- Related specifications: [Progressive enhancement](../spec/progressive-enhancement.md), [Navigation and patching](../spec/navigation-patching-preservation.md), [Build, adapters, and testing](../spec/build-adapters-testing.md)
- Supersedes: None

## Context

ADR 0046 accepts one browser-only facade in the existing framework package,
and ADR 0045 fixes the first private update-decision boundary. V2-02 must now
make those decisions executable without beginning navigation interception or
creating another routing, rendering, authorization, or release owner.

The first runtime also needs an operational rollback. If the generated module
is absent, blocked, incompatible, or unable to start, the already-rendered
document must retain complete native links and forms.

## Decision drivers

- Make startup explicit and observable without import side effects.
- Keep browser code unreachable from the neutral and Node graphs.
- Reuse renderer-owned CSP nonce authority without weakening policy.
- Measure untrusted transport bytes and structure instead of trusting claims.
- Keep the update envelope private until a supported external consumer exists.
- Preserve one same-version framework and application-build identity.

## Decision

`@fadeno/framework/browser` exports exactly `startBrowserEnhancement`,
`BrowserEnhancement`, and `BrowserEnhancementState`. Importing the facade does
not start work or mutate global state. `startBrowserEnhancement()` requires a
browser document, returns the existing active handle when called repeatedly,
and permits idempotent `close()` followed by a fresh start. The initial handle
owns no link, form, history, focus, patch, or application state.

Generated route execution may provide one generated-only `browserModule`
path. The renderer accepts only a root-relative same-origin path without a
fragment, emits one external `type="module"` script into the document head or
body, and uses the same request nonce selected by the existing streaming
lifecycle.
No module request is emitted when the generated input is absent. Application
source does not author private browser paths, and ordinary renderer elements
do not gain a general script sink.

The application browser entry statically imports the public browser facade.
Its build/link step maps that public import to the browser files from the same
packed framework artifact. Browser and server bytes therefore retain one
framework package version and one application build owner.

The private update encoder accepts only the exact ADR 0045 envelope. The byte
consumer uses fatal UTF-8 decoding and independently measures raw byte length,
every JSON value as one structural record, maximum JSON depth, and elapsed
boundary duration. It checks cancellation before and after decode, validates
the closed envelope, and publishes only a structured decision plus metrics.
It never returns transported markup, identities, credentials, or failure
prose. Unknown shape, malformed encoding, older or newer version, limit,
cache, origin, generation, document, operation, duplicate, cancellation, and
unsafe-scroll results fail closed with no document mutation and no mutation
resubmission.

The update encoder, decoder, metrics, and envelope remain private package
internals. The public browser facade contains no update schema. V2-03 owns
server outcome projection, and V2-04 owns the first link interception.

## Alternatives considered

- Start during import: rejected because resolution would unexpectedly acquire
  document ownership and make testing and teardown ambiguous.
- Inline the browser runtime: rejected because it would weaken the external
  artifact, CSP, package-version, and application-build boundaries.
- Let application code choose arbitrary script URLs: rejected because the
  generated application owns the one browser artifact path.
- Trust size or timing fields in the envelope: rejected because untrusted
  input cannot measure itself.
- Export the update decoder: rejected because no supported external consumer
  or compatibility evidence exists.
- Begin interception in this slice: rejected because projection, ordering,
  preservation, and mutation uncertainty remain separately gated.

## Consequences

- The package gains one additive prerelease public subpath and one pending
  minor Changeset.
- The first runtime is usable only as an explicit optional bootstrap; it does
  not yet make navigation faster or change page behavior.
- Blocking JavaScript, rejecting the nonce, failing the module request, or
  rolling back module emission leaves native controls authoritative.
- Removing the public facade later requires a versioned compatibility
  decision. The private update shape may still change within prerelease work.
- No public analyzer, editor, protocol, or second package is introduced.

## Validation

`pnpm check:v2-browser-runtime` builds and packs the current framework,
installs it into a clean consumer, compiles through public entrypoints, renders
the generated module with the real nonce policy, and executes startup,
idempotency, close/restart, wrong nonce, missing nonce, missing artifact,
JavaScript-disabled native link/form, environment refusal, and rollback cases
in Chromium, Firefox, and WebKit.

`pnpm check:v2-patch-protocol` additionally exercises exact envelope encoding,
fatal byte decoding, independent byte/depth/record/duration measurements,
cancellation, cross-generation isolation, redacted decisions, malformed input,
and command-shaped extension refusal. `pnpm check:v1-public-package`,
`pnpm check:v1-rendering-security`, `pnpm check:v1-renderer`, and
`pnpm ci:local` retain package, renderer, security, and complete repository
authority.
