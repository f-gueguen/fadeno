# Node adapter smoke

This private integration example proves the first Fadeno package boundary. It
uses only the package's runtime-neutral `.` facade and Node-specific `./node`
facade. It does not provide routing, rendering, resources, actions, or the
supported framework development server yet.

From a clean repository checkout, run:

```sh
pnpm install --frozen-lockfile
pnpm check:v1-public-package
```

The check builds and packs the real workspace package, installs its tarball in
a temporary consumer outside the workspace, copies
[`src/index.ts`](src/index.ts) byte-for-byte, compiles it with NodeNext, and runs
the HTTP assertion. The linked source is the only editable example body.
