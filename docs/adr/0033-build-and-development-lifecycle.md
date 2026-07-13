# ADR 0033: Build and development lifecycle

- Status: Accepted
- Date: 2026-07-14
- Owners: Fadeno maintainers
- Related specifications: [Build and diagnostics](../spec/build-adapters-testing.md), [Compiler and analyzer](../spec/compiler-analyzer.md), [V1 plan](../roadmap/v1.md)
- Supersedes: None

## Context

ADR 0022 selected the command family and output roots, ADR 0032 fixed the
project-check contract, and B7D1 through B7D4 established retained analyzer,
compiler, transaction, and invalidation ownership. They intentionally did not
select a production entry, emit contract, development address, last-good
policy, or shutdown lifecycle. Implementing either remaining command without
those decisions would let build and development invent different generation,
diagnostic, and runtime policies.

B7D5 supplies private packed evidence before either command ships. It proves a
closed candidate grammar, derived compiler constraints, contained staged
output, structured compiler diagnostics, source/environment/runtime freshness,
loader-before-bootstrap ordering, isolated generations, last-good recovery,
and bounded shutdown state transitions. The evidence module is installed in
the package but is not exported and is not a second command implementation.

## Decision drivers

- One analyzer generation must own configuration, generated routes,
  diagnostics, compiler input, emitted output, and runtime activation.
- Stock TypeScript must remain authoritative for ordinary parsing, typing, and
  emission without parsing diagnostic prose.
- Failed, cancelled, stale, or superseded work must never partially replace
  `dist` or the active development generation.
- Development must not retain successive application module instances in the
  supervisor process.
- Runtime package code, generated route bindings, and application output must
  belong to one verified build identity.
- Human command behavior may become public while machine-readable output and
  the private analyzer schema remain gated.

## Decision

### Command grammar and ownership

The only accepted invocations are:

```text
fadeno build --project-root <path>
fadeno dev --project-root <path> --port <1..65535>
```

Flags may appear in either order after the command, but each mandatory flag
appears exactly once. There is no implicit current-directory root, host flag,
port zero, watch flag, output flag, mode flag, or machine-output flag. Unknown,
missing, duplicate, malformed, or extra input is usage failure.

The project root is resolved once against the command working directory. It
must be one ordinary non-symlink directory whose canonical identity remains
current. V1 does not support multi-root build or development ownership.
Configuration, URI normalization, containment, generated output, and redaction
use the same project authority as `fadeno check`.

### Compiler and environment generation

Each operation captures `.env`, then `.env.local`, then its inherited process
environment using ADR 0022. The resulting values and identity belong only to
that generation. A supervisor never mutates its own `process.env`; compiler and
runtime children receive an immutable generation-scoped environment.

V1 accepts one root `tsconfig.json` without `extends` or project references.
The effective build contract requires `ES2022`, `NodeNext` module and resolution,
root directory `.`, output directory `dist`, automatic JSX with the framework
JSX entry, TypeScript-extension rewrite, and isolated modules. `baseUrl`,
`paths`, plugins, `outFile`, declaration redirection, build-info ownership,
composite/incremental output, declaration-only output, source maps, and
`noEmit` are refused. Ordinary strictness, library, type-root discovery, and
other non-conflicting stock options remain compiler inputs.

The build owner derives the actual emit invocation and forcibly owns the stage
directory, no-check emit phase, no incremental state, and no source maps or
declarations. One stock compiler snapshot produces structured configuration,
global, syntactic, and semantic diagnostics. Only a clean snapshot permits a
stock no-check emission pass; behavior is never selected by parsing compiler
text or by rerunning a prose diagnostic command. Project inputs, environment,
compiler installation, framework runtime closure, and generated ownership are
rechecked after analysis and emission. Changed inputs make the operation stale.

### Production output and start

Build begins from one current diagnostic-free analyzer publication. It stages a
complete candidate under `.fadeno/build-stage/<operation>/`, never under the
active `dist`. The stage contains the compiled application, generated route
loader and binding, generated server bootstrap, declarations and manifests
owned by the current compiler work, and any later explicitly owned browser or
asset output. A versioned build manifest records hashes and ownership without
recording environment values or secrets.

After stage validation, atomic renames replace exactly one `dist` generation.
The previous generation remains a rollback owner until the candidate is fully
accepted. Failure before acceptance restores the previous generation; a first
build failure leaves no `dist`. Symlinks, external paths, mixed identities,
unknown files in owned transaction roots, and unresolved rollback or cleanup
state are refusals. Two clean builds with identical inputs produce identical
bytes.

The V1 production start contract, from the project root, is:

```text
FADENO_PORT=<1..65535> node --import ./dist/.fadeno/routes/loader.js ./dist/server/bootstrap.js
```

This decision extends the existing public raw Node adapter options with one
optional numeric `port`. Omission or zero retains the earlier ephemeral-port
behavior; the generated production bootstrap supplies its already validated
`1..65535` port. This is the same adapter startup path, not a second server API.

The bootstrap binds `127.0.0.1` only. Broader deployment address and trusted
proxy behavior remain unsupported until their own operational evidence exists.
The route loader must register before the bootstrap imports the generated route
specifier. The bootstrap verifies the build manifest and the bounded installed
closure reached through declared production, installed optional, and required
peer dependencies before dynamically importing the application handler and the
selected adapter. Root development dependencies and unrelated installed
packages are not runtime owners. Missing, stale, mixed, or changed runtime
dependencies fail before listening. Build output is not claimed to be
self-contained.

### Development lifecycle

Development binds only `127.0.0.1` at the explicit port. It prints readiness
only after the initial complete generation is listening:

```text
Fadeno development server ready at http://127.0.0.1:<port>.
```

One supervisor owns the operating-system watcher, B7D4 invalidation adapter,
retained project coordinator, candidate transactions, and child lifecycle. It
never imports application modules. Each accepted application generation runs
in a fresh restartable child with its own frozen environment and verified
runtime identity. Loader registration precedes handler import in every child.

Filesystem notifications are hints only. A bounded batch triggers the same
authoritative analyzer and compiler path as build. Newer work cancels or
supersedes obsolete candidate work. Direct, transitive, configuration,
deletion, rename, and ambiguous changes are resolved by current workspace
state, not notification names.

While a candidate has diagnostics, is cancelled, is stale, or fails before
switching, the last accepted child and output remain active. A clean candidate
enters a bounded switch: the prior child stops accepting work and drains, the
candidate output becomes current, and a fresh child binds the explicit port.
The switch may have a bounded interval with no listener; V1 does not promise
zero-downtime reload. Startup failure rolls output back and restarts the prior
generation before more candidate work is admitted. Requests and streams stay
with the child that accepted them and never migrate between generations.

The first termination signal stops watcher admission, cancels candidate work,
and begins graceful server and child drain with a fixed 5,000 ms deadline. A
second signal or deadline expiry force-terminates owned children, removes only
non-authoritative transaction state, and exits as an internal/forced failure.
Graceful shutdown waits for actual watcher, compiler, transaction, server, and
child close before success. Repeated close is idempotent.

### Diagnostics and exit statuses

Analyzer diagnostics retain their stable Fadeno codes, parameters, exact or
explicitly unknown ranges, related evidence, and correction intents. Stock
compiler failures are represented as structured build diagnostics containing
the numeric compiler code, category, project-relative source, exact offsets or
an explicit global-range reason, and human text. No behavior, correction, or
identity is inferred from that text.

Build renders one complete human diagnostic batch. Development replaces the
complete batch for each accepted diagnostic generation; a repair clears stale
diagnostics before reporting the new generation active. Expected diagnostics
do not stop a last-good development child. Unexpected failures are redacted and
carry an internal incident identity. Machine-readable command output and a
stable external diagnostic schema remain refused by DG-A0-02.

Exit statuses are:

- `0`: complete build success or graceful development shutdown;
- `1`: expected project, compiler, runtime-identity, address-in-use, or
  first-generation startup diagnostic;
- `2`: command usage failure;
- `3`: redacted unexpected failure, unresolved transaction/cleanup, repeated
  termination signal, or forced shutdown deadline.

## Alternatives considered

- Retain application modules in the supervisor: rejected because imports and
  process environment would cross generation boundaries and grow without a
  reliable unload contract.
- Use compiler CLI prose as the diagnostic protocol: rejected because message
  wording cannot own identity, ranges, or corrections.
- Publish a build/watch analyzer API: rejected because the commands need one
  internal policy source, not a stable external schema.
- Bind development to a wildcard address or choose port zero: rejected because
  the developer-visible origin would be implicit and network exposure would be
  surprising.
- Replace `dist` in place: rejected because partial output could mix analyzer,
  compiler, loader, and runtime generations.
- Promise uninterrupted reload: rejected because the selected adapter owns one
  listener and V1 has no justified proxy or socket-transfer layer.

## Consequences

- The build/development decision gate is resolved and leaves its ledger.
- B7D6 may implement only the production build/start half of this contract.
- B7D7 may add the real watcher and development server only after B7D6 proves
  the shared output/runtime path.
- The private decision modules and child remain unexported and may change while
  the public command behavior stays consistent with this ADR.
- Supported deployment addresses, machine output, public analyzer schemas,
  editor products, and registry identity remain separately gated.

## Validation

`pnpm check:v1-build-dev-decision` builds and packs the current framework,
installs it into a clean private consumer, and invokes only absolute installed
private module paths. It proves command and compiler refusal, environment
precedence, bounded runtime identity, structured same-snapshot diagnostics,
contained no-check emission, loader-before-bootstrap order, separate process
identities, generation freshness, diagnostic last-good preservation,
correction recovery, runtime-closure refusal, and graceful/forced shutdown
state transitions. B7D6 and B7D7 must add permanent public-entrypoint examples
for every user-observable command behavior before those commands are complete.
