# Independent Fadeno workflow task packet

This packet is for an independent participant using only the supplied packed
artifact and public repository documentation. Do not use private implementation
notes or maintainer coaching. Record every started task, including refusal or
abandonment, and classify any assistance.

The facilitator supplies one literal `<SOURCE_COMMIT>`, one local
`<PACKAGE_TARBALL>`, and its literal `<PACKAGE_SHA256>` on the packet cover
sheet. Verify the digest before starting. Use a new empty working directory.
Do not include names, contact details, secrets, absolute paths, unrelated
command history, environment values, or precise timestamps in the retained
observation.

Perform these tasks in order:

1. **Install and create.** In the empty directory run `pnpm init`, install
   `<PACKAGE_TARBALL>` as a development dependency, then run
   `pnpm exec fadeno create --project-root ./my-fadeno-app`. Enter the created
   application, install the same `<PACKAGE_TARBALL>` there, and use only its
   README and public documentation from this point onward.
2. **Application-test failure and recovery.** Run `pnpm test`. In
   `test/application.test.tsx`, replace only
   `/Your Fadeno application is running/u` with
   `/This text is deliberately absent/u`. Run `pnpm test`, use its human and
   TAP failure to identify the mismatch, restore the original expression, run
   `pnpm test` again, and confirm the old failure is absent.
3. **Successful flow explanation.** Run
   `pnpm exec fadeno check --project-root . --explain`. Describe the route,
   source ownership, decision, skipped work, and observable outcome that the
   command actually reports. Do not infer runtime events from this output.
4. **Route failure and recovery.** Create `src/routes/handler.ts` with exactly
   `export function GET(): Response { return new Response("collision"); }` and
   a final newline. Run `pnpm check`, identify the route-role diagnostic and
   review-only correction, delete only that new file, rerun `pnpm check`, and
   confirm the collision diagnostic is absent.
5. **Failed flow explanation and recovery.** Recreate the exact
   `src/routes/handler.ts` from task 4. Run
   `pnpm exec fadeno check --project-root . --explain`; record its decision,
   causes, both owners, skipped publication, and refusal outcome. Delete the
   handler, rerun the same explained check, and confirm the stale failure flow
   and diagnostic are both absent.
6. **Configuration failure and recovery.** In `fadeno.config.ts`, replace only
   `defineConfig({ routes: { root: "src/routes" } })` with
   `defineConfig({ routes: "src/routes" })`. Run `pnpm check`, identify the
   configuration refusal, restore the exact original expression, rerun
   `pnpm check`, and confirm the accepted configuration is current.
7. **Generation failure and stale-output recovery.** Run `pnpm build` once.
   Create `src/build-scenario.ts` with exactly
   `export const buildScenarioValue: number = "invalid";` and a final newline.
   Run `pnpm build` and confirm failure preserves the prior accepted `dist`.
   Replace `"invalid"` with `1`, rebuild, and confirm
   `dist/src/build-scenario.js` exists. Delete `src/build-scenario.ts`, rebuild,
   and confirm that generated file is gone.
8. **Development run.** Run `pnpm dev`, wait for its ready message, load the
   printed loopback home-page URL, confirm the page content and stylesheet, and
   stop the command normally.
9. **Production build.** Run `pnpm build` as a standalone task, inspect the
   accepted manifest and output, then run the documented production start with
   the required runtime configuration. Confirm GET `/` succeeds and stop the
   command normally.
10. **Immutable deployment and recovery.** Create a missing release outside the
    project with
    `pnpm exec fadeno deploy --project-root . --output ../releases/my-fadeno-app-001`.
    Follow the public runtime configuration and HTTPS health procedure. Start
    once without the required runtime configuration and retain the safe
    refusal; then start the unchanged release correctly, confirm GET `/`, and
    stop it normally. Corrupt only a disposable candidate, confirm it is not
    selected over the retained healthy release, and recover with a new missing
    release directory.
11. **Missing workflow report.** Record the single most important missing or
    confusing workflow, including whether an editor-specific product would
    have changed the outcome.

Use only `completed`, `refused`, or `abandoned` for task outcome and only
`none`, `public-documentation`, or `facilitator-intervention` for assistance.
Facilitator intervention is retained and cannot be relabeled as independent
success.

The retained attempt record must use the exact versioned shape frozen by
`task-packet.json`. Repository-relative evidence artifact references may be
retained; participant filesystem paths may not. Every artifact reference must
include its SHA-256. Free-text observations are redacted before retention and
are limited to 2,048 UTF-8 bytes.
