# my-fadeno-app

Install dependencies, then use the framework package's public commands:

```sh
pnpm install
pnpm check
pnpm test
pnpm dev
pnpm build
FADENO_PORT=3000 pnpm start
```

Create each immutable production release outside the project root:

```sh
fadeno deploy --project-root . --output ../releases/my-fadeno-app-001
```

The essential page, stylesheet, and production server work without client JavaScript.
