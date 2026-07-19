# First-alpha candidate adoption guide

- From: No released Fadeno version
- To: `0.1.0-alpha.1`
- Affected package: `@fadeno/framework`
- Release tag: [`v0.1.0-alpha.1`](https://github.com/f-gueguen/fadeno/releases/tag/v0.1.0-alpha.1)
- Changesets: `.changeset/early-fadeno-alpha.md` and reviewed A0-09 intent
- Changelog: [`packages/framework/CHANGELOG.md`](../../packages/framework/CHANGELOG.md#010-alpha0)
- Executable application: `examples/v1-app`

This is the release-checkpoint adoption guide required before the first alpha.
It is not a compatibility migration between released versions: no Fadeno
package had been published before this version. The immutable `0.1.0-alpha.0`
source release stopped before registry upload; `0.1.0-alpha.1` corrects only
that transport evidence. A0-10 binds these release links
to the mechanically generated version without changing the reviewed workflow.

## Who is affected

Only collaborators using an unpublished private-preview checkout or tarball
need to move work. There is no released project population to upgrade. A new
application should use the exact public creation workflow after publication
rather than copy repository internals.

## Adopt the first public boundary

1. Keep application syntax as standard TypeScript and JSX.
2. Import only `@fadeno/framework`, `@fadeno/framework/node`, and
   `@fadeno/framework/jsx-runtime`. Remove private or filesystem-deep imports.
3. Create a clean reference project with
   `fadeno create --project-root ./my-fadeno-app`, then install its pinned
   dependencies.
4. Compare application-owned route, resource, action, session, CSS, and test
   code with the executed canonical application instead of copying generated
   `.fadeno/` or `dist/` output.
5. Run `pnpm test`, `pnpm check`, and `pnpm build` in the project.
6. Exercise `pnpm dev`, production `pnpm start`, and the documented immutable
   `fadeno deploy` workflow with an exact HTTPS origin and protected-session
   keyring where actions are present.

The successful command transcript is owned by
`examples/v1-app/expected/independent-workflow.txt`. Deliberate route,
configuration, compiler, action, resource, test, and deployment failures live
under `examples/v1-app/scenarios/`; their executed correction, flow, recovery,
and stale-removal outputs are checked by the named A0 gates.

## Verification

From the Fadeno source tag, run:

```sh
pnpm check:v1-independent-workflow
pnpm check:a0-create
pnpm check:a0-test
pnpm check:a0-deploy
pnpm check:a0-alpha-qualification
```

These commands rebuild and pack the exact release package, install consumers through
public entrypoints, assert success and deliberate failure behavior, repair the
source, and prove stale diagnostics or artifacts disappear. Public registry
verification repeats the workflow from `@fadeno/framework@0.1.0-alpha.1`.

## Known alpha limitations

- Independent newcomer and assistive-technology usability are unqualified.
- There is no supported editor product or public analyzer schema.
- Native actions and protected sessions have one process owner.
- Browser enhancement is V2 work and islands are V3 work.
- The alpha is experimental and not production-supported.

## Rollback

Before publication, return to the exact prior source commit and its matching
unpublished tarball. Do not mix generated artifacts between commits. After
publication, pin the prior immutable prerelease or publish a corrected newer
prerelease; never replace an existing package version or Git tag.
