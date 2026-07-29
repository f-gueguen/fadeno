# V1 running application

This is the canonical first running Fadeno application. Its tracked TSX routes
are analyzed and built through the installed `fadeno` executable. A complete
candidate is compiled outside `dist`, verified, and then replaces the prior
accepted build as one generation. The generated bootstrap verifies the build
manifest and installed runtime before it imports application behavior.

## Run the complete demonstration

From the repository root, after the standard `pnpm install`, run one command:

```sh
pnpm demo
```

The command builds the current framework and application, starts the generated
production server behind a local HTTPS boundary, and prints the URL. The local
certificate is self-signed and valid only for the displayed loopback address;
the launcher states that boundary before you continue in the browser. Use the
visible passcode `example-owner` in the Projects laboratory. Stop the launcher
with Ctrl-C.

For a certificate-free look at the document, routing, resources, and failure
labs, run `pnpm demo:read-only`. That loopback HTTP mode deliberately hides
mutation controls because protected actions require an exact HTTPS origin.
The application explains the same boundary in its Projects page.

The primary navigation now exposes Overview, Routing, Resources, Projects, and
Evidence. The request-thread interface shows only facts owned by the current
application response. Build, analyzer, security, and browser-lifecycle claims
remain separately labeled reproducible evidence; the UI does not present them
as live request telemetry.

After installing the packed framework, the demonstrated production workflow is:

```sh
pnpm build
FADENO_PORT=3000 \
FADENO_ORIGIN=https://app.example \
FADENO_SESSION_KEYS='active:<32-byte-base64url-key>' \
pnpm start
```

Create each production release as a new immutable directory outside the
application project:

```sh
fadeno deploy --project-root . --output ../releases/v1-app-001
```

The deployment gate verifies that the release contains only the accepted
build, its production dependency closure, and a runtime-only package manifest.
It starts the release behind the scenario's same-host HTTPS boundary, checks
GET `/`, stops with `SIGTERM`, rejects missing or insecure runtime
configuration, restarts an unchanged prior release after a corrupted candidate,
and proves the corrected release contains neither stale route output nor stale
diagnostics. Run the complete packed sequence with:

```sh
pnpm check:a0-deploy
```

The demonstrated development workflow is:

```sh
pnpm dev
```

The built-in development listener remains the loopback HTTP contract fixed by
ADR 0033. It supplies an ephemeral process-owned session key so applications
that declare actions can start and render. Native mutation submission remains
fail-closed on that listener because ADR 0035 requires an exact HTTPS origin;
the packed HTTPS CRUD qualification is the current action workflow. V1-14 owns
the independently usable development guidance rather than weakening this
security boundary.

It prints `Fadeno development server ready at http://127.0.0.1:4173.` only
after a complete verified generation is accepting requests. The permanent
`development-lifecycle` scenario is executed by `pnpm check:v1-development`
and proves direct and transitive reloads, diagnostic last-good behavior,
recovery, artifact cleanup, and graceful shutdown.

Run the verified application, failure, flow, and recovery evidence with:

```sh
pnpm check:v1-running-example
```

Run the optional enhanced-form qualification with:

```sh
pnpm check:v2-form-submission
```

That gate packs the current framework, installs it into a clean consumer, and
runs the same public GET and protected POST forms over HTTPS in Chromium,
Firefox, and WebKit. It proves exact successful controls, session-cookie
rotation, expected validation, correction, pending cleanup, duplicate
suppression, origin and authorization refusal, redacted ownership evidence,
and current-truth recovery after a response is lost without sending the
mutation again. The forms also complete with JavaScript disabled. The primary
application remains native in this slice; its Evidence page names this
reproducible qualification instead of presenting private flow data as live UI.
V2-07 owns the complete enhanced authenticated workflow.

Run that complete V2-07 action-ordering workflow with:

```sh
pnpm check:v2-action-ordering
```

The current-packed three-browser scenario signs in and then creates, reads,
updates, and deletes project data through the same public forms as the native
application. It proves that complete server revalidation finishes before an
action redirect hands its destination to a fresh cancellable GET, that the POST
runs once, and that a delayed redirect cannot overwrite a newer enhanced
navigation. Closing that GET, cancelling native recovery after a staged URL,
losing its response, editing or moving a focused caret after handoff, and
superseding it with another failed enhanced or native GET all recover committed current truth without
repeating POST. An older redirect cleanup cannot clear a newer submission's
pending indicator. Replacing a selected upload with a same-metadata `File` after
handoff also refuses private publication. A direct or redirect-chain
handoff whose encoded control snapshot exceeds its byte or structural limits
loads current truth instead of issuing an unobservable redirect destination.
If the redirect GET itself returns a current-truth recovery outcome, that
result is consumed and the mutation is not repeated.
An otherwise safe direct or redirect-chain
same-resource fragment redirect starts a real native reload before teardown can
strand its staged URL, retains
the intended fragment if history staging fails, and recovers current truth when
a superseding native activation remains in the document. Selected and unsafe
history traversals repair the displayed URL before recovering committed truth.
A same-document native GET form that supersedes pending redirect work also
loads a fresh fragment-bearing current-truth document instead of retaining
stale markup. If its submit event stops before the window finalizer and a later
listener prevents departure, current truth still recovers without serializing
the form. A same-context form already hidden from the finalizer is refused
while it remains cancelable. When propagation stops only after runtime
observation and the browser selects a same-document fragment, the browser's
single successful-control object supplies the final destination instead.
The same recovery happens when the submit reaches the window only
after a later document listener cancelled it, or was already cancelled before
the runtime document listener. A retained `dialog` submission recovers without
departure, while a late change from `dialog` to GET follows the final native
destination. Observation uses final privacy state and the browser-owned
`FormData` object after all listeners, accepts image submitters on that native
path, and closes before a later microtask constructs an unrelated snapshot.
Cancellation registered by a later
`beforeunload` listener or `onbeforeunload` assignment is still
observed. An observable ineligible same-context cross-document form or link is
refused before its request while committed recovery is pending; no timeout
races a slow request or claims to detect a response that creates no document.
A modified-primary or middle-button click and a later target change into a separate browsing
context leaves that destination native while the opener recovers current truth.
The automated middle-button proof runs only where the headless browser driver
emits a trusted auxiliary activation; an engine-specific fixture records the
unavailable driver capability explicitly instead of synthesizing browser trust.
An initially eligible or policy-protected link is not finalized until later
document listeners finish, so their cancellation and final link attributes
remain authoritative. If propagation stops after a late fragment change, the
browser's selected history entry is not staged a second time.
If a second cancelled activation supersedes an in-flight recovery GET, the new
GET retains recovery ownership and still clears stale markup. Delayed native
recovery remains attached when a newer enhanced operation takes ownership, so
obsolete work neither overwrites that operation nor abandons committed truth.
Explicit and
empty fragment delimiters both force a fresh native document. If its
pushed-fragment reload is cancelled, rollback happens before
recovery so Back reaches the preceding page without a duplicate stop. That
rollback remains an owned operation until its exact traversal arrives; a newer
activation supersedes it and obsolete rollback completion cannot overwrite the
newer destination. An unrelated selected entry cannot impersonate rollback
completion and reloads natively. Fragment staging also verifies the exact
generated state, URL, history length, and push provenance before claiming
ownership, including hooks that mutate the supplied state. Handoff
also detects untracked form-associated custom controls, checkbox indeterminate
state, exact control-ancestry
changes, and disabled-state changes inherited from `fieldset` and `optgroup`,
exact optgroup hierarchy, and stays authoritative through interrupted-departure
recovery. Control count, text-node traversal, record count, and aggregate UTF-8
bytes are bounded before values are serialized; oversized control or option
text produces a tested `FADENO_UPDATE_LIMIT` refusal, refreshes current truth,
and does not issue an unobservable redirect that could return no document. A GET form with no successful
controls preserves both the empty query and explicit empty-fragment delimiters,
and a final `formdata` routing refusal retains its single observed controls
construction even while committed recovery is active. Programmatic `FormData`
construction during submit dispatch cannot hide the later browser-owned entry
list, and direct recovery removes its departure observers. The handoff also
tracks option parents inside customizable select wrappers. An initial
same-resource action redirect pushes its native destination so Back retains the
pre-submit entry; if cancelled teardown cannot reacquire scroll ownership, a
native current-truth replacement starts before close. A failed fragment push repairs the current entry without traversing
Back; if that repair is blocked, native current-truth replacement prevents the
staged fragment URL from surviving. The same replacement applies when a
cancelled cross-resource traversal cannot repair its selected URL. Late listeners may select the current form target. Link recovery re-reads
the destination, target, download state, and privacy directives after document
listeners; an initially external, later external, or already-cancelled trusted
activation cannot leave obsolete redirect work publishing in the current
document. Explicit link and form privacy remains browser-owned for same-document,
cross-document, and external-context destinations.
A redirect GET result cannot be reused after its redirect chain
begins. Concurrent
equal-title creates leave one logical project owner, and the single stable
update and delete forms do not bind failures through mutable list ordinals. The
deliberate validation error retains its tested correction; JavaScript-disabled
CRUD retains the same final server state. Normalized CRUD, ordering, refusal,
and recovery results live beside the scenario source under
`scenarios/form-submission/expected/`.

The application uses native external CSS only. The root layout links `/styles`,
and `src/routes/styles/handler.ts` serves `src/styles.ts` through the public
typed handler boundary. `pnpm check:a0-css` verifies that contract and its
permanent evidence inventory. The packed running-example gate additionally
proves computed styles, focus visibility, and reduced-motion source in
Chromium, Firefox, and WebKit with JavaScript disabled. The deliberate
`scenarios/css-boundary/` fixture records the inline-style type failure,
runtime refusals, class-and-stylesheet correction, flow ownership, recovery,
and stale-artifact removal without making the primary application unbuildable.

That gate installs the current packed framework into two clean consumers and
requires byte-identical builds. It starts the generated production bootstrap,
exercises the routed application, seeds the compiler failure under
`scenarios/build-compiler-error/`, and proves an initial failure leaves no
`dist`. Later failure, input-drift, concurrent-build, runtime-import, and
rollback scenarios must preserve the accepted output. The gate also kills a
builder, recovers its ownership lock, performs a production-only reinstall,
starts successfully without development dependencies, applies the tracked
correction, and proves an output disappears after its source owner is deleted.
Human and normalized manifest evidence is read from `expected/`; flow and
recovery evidence is read from the scenario's `expected/` directory.

The `/projects` route is the authenticated CRUD example. Its public
declarations live in `src/projects.ts`; the route uses ordinary typed TSX forms
and receives only a read-only session view. The packed example signs in,
rotates the protected session, refuses invalid sign-in and project input,
uploads a bounded text file, creates, reads, updates, and deletes a project,
refuses a replayed proof, keeps a refused password out of returned HTML, scopes
repeated-row validation to the submitted form, and proves complete revalidation
removes stale errors and stale project output. Chromium, Firefox, and WebKit
execute that workflow over HTTPS with JavaScript disabled. Human failure output lives in
`expected/action-failure.txt`; normalized diagnostic, correction, flow, and
recovery records live under `scenarios/action-lifecycle/expected/`.

The home route now performs two concurrent reads with equivalent structural
inputs and refuses to render unless they share one request-owned result. The
same packed server is then called with two authorization identities to prove
that a later request cannot reuse the earlier request's value. The
`resource-failure` route throws the typed expected 404 from
`src/resources/projects.ts`, while the `resource-recovery` route proves a
memoized 503 disappears with its completed request and succeeds on the next
request. Their human output lives in `expected/resource-*.txt`.

`scenarios/resource-lifecycle/expected/` contains the normalized request-flow,
input-refusal, expected-failure, unsafe-`keeps` correction, and recovery
records. `pnpm check:v1-resources` derives each record from runtime behavior;
`pnpm check:v1-running-example` derives the HTTP failure and recovery records
from the current packed application. The primary application remains buildable
because the deliberate failures are request-selected routes rather than
compile-time errors.

Run the packed human project-check workflow with:

```sh
pnpm check:v1-analyzer-workflow
```

That gate fresh-builds and packs the framework, verifies the installed CLI
closure identity, invokes the installed `fadeno` executable, and asserts the
tracked human outputs in `expected/check-success.txt`,
`expected/check-success-explain.txt`, `expected/check-collision.txt`, and
`expected/check-collision-explain.txt`. The recovery run must equal the success
output and leave neither `.fadeno` nor `dist` behind.

The deliberate route-role collision lives under `scenarios/`; it never makes
the primary application unbuildable. Its analyzer diagnostic preserves the last
accepted disk generation, and the recovery run proves stale route bytes are
removed only after a repaired complete publication is accepted.
