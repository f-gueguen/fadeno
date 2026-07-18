import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, parse, relative, resolve, sep } from "node:path";

export interface ProjectCreateCommandResult {
  readonly exitCode: 0 | 1 | 2 | 3;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ProjectCreateCommandContext {
  readonly cwd: string;
  readonly packageVersion?: string;
  readonly beforeWrite?: (path: string, index: number) => void;
}

export interface ProjectCreateTemplateFile {
  readonly path: string;
  readonly contents: string;
}

const usage = "FADENO_CREATE_USAGE: fadeno create --project-root <path>\n";
const packageNamePattern = /^[a-z][a-z0-9-]{0,63}$/u;

function packageVersion(): string {
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: unknown };
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest.version)) {
    throw new TypeError("FADENO_CREATE_PACKAGE_VERSION");
  }
  return manifest.version;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function lines(...values: readonly string[]): string {
  return `${values.join("\n")}\n`;
}

export function createProjectTemplate(name: string, frameworkVersion: string): readonly ProjectCreateTemplateFile[] {
  const files: ProjectCreateTemplateFile[] = [
    {
      path: ".gitignore",
      contents: lines(".fadeno/", "dist/", "node_modules/"),
    },
    {
      path: "README.md",
      contents: lines(
        `# ${name}`,
        "",
        "Install dependencies, then use the framework package's public commands:",
        "",
        "```sh",
        "pnpm install",
        "pnpm check",
        "pnpm test",
        "pnpm dev",
        "pnpm build",
        "FADENO_PORT=3000 pnpm start",
        "```",
        "",
        "The essential page, stylesheet, and production server work without client JavaScript.",
      ),
    },
    {
      path: "fadeno.config.ts",
      contents: lines(
        'import { defineConfig } from "@fadeno/framework";',
        "",
        'export default defineConfig({ routes: { root: "src/routes" } });',
      ),
    },
    {
      path: "package.json",
      contents: json({
        name,
        version: "0.0.0",
        private: true,
        type: "module",
        packageManager: "pnpm@11.7.0",
        scripts: {
          check: "fadeno check --project-root .",
          test: "node --input-type=module --eval \"import { rm } from 'node:fs/promises'; await rm('.fadeno/test', { force: true, recursive: true });\" && tsc -p tsconfig.test.json && node --test --test-reporter=spec .fadeno/test/test/application.test.js",
          build: "fadeno build --project-root .",
          dev: "fadeno dev --project-root . --port 4173",
          start: "node --import ./dist/.fadeno/routes/loader.js ./dist/server/bootstrap.js",
        },
        dependencies: { "@fadeno/framework": frameworkVersion },
        devDependencies: { "@types/node": "22.20.1", typescript: "7.0.2" },
      }),
    },
    {
      path: "src/routes/layout.tsx",
      contents: lines(
        'import type { Layout } from "@fadeno/framework";',
        "",
        "const layout: Layout = ({ children }) => (",
        '  <html lang="en">',
        "    <head>",
        `      <title>${name}</title>`,
        '      <link href="/styles" rel="stylesheet" type="text/css" />',
        "    </head>",
        '    <body class="app-shell">',
        '      <header class="site-header">',
        '        <nav aria-label="Primary" class="primary-nav"><a href="/">Home</a></nav>',
        "      </header>",
        '      <main class="page-content">{children}</main>',
        '      <footer class="site-footer">Rendered by Fadeno</footer>',
        "    </body>",
        "  </html>",
        ");",
        "",
        "export default layout;",
      ),
    },
    {
      path: "src/routes/not-found.tsx",
      contents: lines(
        'import type { NotFoundPage } from "@fadeno/framework";',
        "",
        "const notFoundPage: NotFoundPage = () => (",
        '  <section aria-labelledby="missing-heading">',
        '    <h1 id="missing-heading">Page not found</h1>',
        '    <a href="/">Return home</a>',
        "  </section>",
        ");",
        "",
        "export default notFoundPage;",
      ),
    },
    {
      path: "src/routes/page.tsx",
      contents: lines(
        'import type { Page } from "@fadeno/framework";',
        "",
        "const page: Page = () => (",
        '  <section aria-labelledby="welcome-heading" class="hero-card">',
        '    <h1 id="welcome-heading">Your Fadeno application is running</h1>',
        "    <p>This routed document is rendered and streamed by the server.</p>",
        "    <p>It remains usable without client JavaScript.</p>",
        "  </section>",
        ");",
        "",
        "export default page;",
      ),
    },
    {
      path: "src/routes/styles/handler.ts",
      contents: lines(
        'import type { Handler } from "@fadeno/framework";',
        'import { applicationStyles } from "../../styles.ts";',
        "",
        "const handler: Handler = () => new Response(applicationStyles, {",
        "  headers: {",
        '    "cache-control": "public, max-age=300",',
        '    "content-type": "text/css; charset=utf-8",',
        "  },",
        "});",
        "",
        "export default handler;",
      ),
    },
    {
      path: "src/styles.ts",
      contents: lines(
        "export const applicationStyles = `",
        ":root {",
        "  color-scheme: light dark;",
        "  font-family: ui-sans-serif, system-ui, sans-serif;",
        "}",
        "",
        "* { box-sizing: border-box; }",
        "body.app-shell { margin: 0; min-height: 100vh; line-height: 1.6; }",
        ".primary-nav, .page-content, .site-footer { width: min(60rem, calc(100% - 2rem)); margin-inline: auto; }",
        ".site-header, .site-footer { padding-block: 1rem; background: #18233a; color: #fff; }",
        ".page-content { padding-block: 3rem; }",
        ".hero-card { padding: 2rem; border: 1px solid #cbd3e1; border-radius: 1rem; }",
        "a:focus-visible { outline: 3px solid #d45d00; outline-offset: 3px; }",
        "`.trimStart();",
      ),
    },
    {
      path: "test/application.test.tsx",
      contents: lines(
        'import assert from "node:assert/strict";',
        'import test from "node:test";',
        'import { notFound, renderRoute } from "@fadeno/framework";',
        'import layout from "../src/routes/layout.tsx";',
        'import notFoundPage from "../src/routes/not-found.tsx";',
        'import page from "../src/routes/page.tsx";',
        'import stylesheet from "../src/routes/styles/handler.ts";',
        "",
        'test("renders the application document through the production renderer", async () => {',
        "  const response = await renderRoute({",
        '    request: new Request("https://app.example/"),',
        "    parameters: {},",
        "    page,",
        "    layouts: [layout],",
        "    notFound: notFoundPage,",
        "  });",
        "  assert.equal(response.status, 200);",
        "  assert.match(await response.text(), /Your Fadeno application is running/u);",
        "});",
        "",
        'test("renders the application not-found document", async () => {',
        "  const response = await renderRoute({",
        '    request: new Request("https://app.example/missing"),',
        "    parameters: {},",
        "    page: () => notFound(),",
        "    layouts: [layout],",
        "    notFound: notFoundPage,",
        "  });",
        "  assert.equal(response.status, 404);",
        "  assert.match(await response.text(), /Page not found/u);",
        "});",
        "",
        'test("serves the application stylesheet through its raw handler", async () => {',
        '  const response = await stylesheet(new Request("https://app.example/styles"));',
        "  assert.equal(response.status, 200);",
        '  assert.equal(response.headers.get("content-type"), "text/css; charset=utf-8");',
        "  assert.match(await response.text(), /\\.hero-card/u);",
        "});",
      ),
    },
    {
      path: "tsconfig.json",
      contents: json({
        compilerOptions: {
          target: "ES2022",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          module: "NodeNext",
          moduleResolution: "NodeNext",
          rootDir: ".",
          outDir: "dist",
          strict: true,
          noUncheckedIndexedAccess: true,
          exactOptionalPropertyTypes: true,
          verbatimModuleSyntax: true,
          isolatedModules: true,
          allowImportingTsExtensions: true,
          rewriteRelativeImportExtensions: true,
          jsx: "react-jsx",
          jsxImportSource: "@fadeno/framework",
          types: ["node"],
        },
        include: ["src/**/*.ts", "src/**/*.tsx", ".fadeno/routes/*.ts"],
      }),
    },
    {
      path: "tsconfig.test.json",
      contents: json({
        extends: "./tsconfig.json",
        compilerOptions: {
          rootDir: ".",
          outDir: ".fadeno/test",
        },
        include: ["src/**/*.ts", "src/**/*.tsx", "test/**/*.ts", "test/**/*.tsx"],
      }),
    },
  ];
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return Object.freeze(files.map((file) => Object.freeze(file)));
}

function missing(path: string): boolean {
  try {
    lstatSync(path);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

function isOrdinarySymlinkFreeDirectory(path: string): boolean {
  const root = parse(path).root;
  let current = root;
  const rootEntry = lstatSync(current);
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) return false;
  for (const component of relative(root, path).split(sep).filter(Boolean)) {
    current = join(current, component);
    const entry = lstatSync(current);
    if (!entry.isDirectory() || entry.isSymbolicLink()) return false;
  }
  return true;
}

function refusal(code: string, message: string): ProjectCreateCommandResult {
  return Object.freeze({ exitCode: 1 as const, stdout: "", stderr: `${code}: ${message}\n` });
}

export function runProjectCreateCommand(
  arguments_: readonly string[],
  context: ProjectCreateCommandContext,
): ProjectCreateCommandResult {
  if (!Array.isArray(arguments_)
    || arguments_.length !== 3
    || arguments_[0] !== "create"
    || arguments_[1] !== "--project-root"
    || !arguments_[2]
    || typeof context.cwd !== "string") {
    return Object.freeze({ exitCode: 2 as const, stdout: "", stderr: usage });
  }
  const unresolvedTarget = resolve(context.cwd, arguments_[2]);
  const name = basename(unresolvedTarget);
  if (!packageNamePattern.test(name)) {
    return refusal("FADENO_CREATE_NAME", "Project directory name must be a lowercase package name.");
  }
  let target: string;
  try {
    target = resolve(realpathSync.native(context.cwd), arguments_[2]);
  } catch {
    return refusal("FADENO_CREATE_PARENT", "Project parent and ancestors must be ordinary non-symlink directories.");
  }
  const parent = dirname(target);
  try {
    if (!isOrdinarySymlinkFreeDirectory(parent)) {
      return refusal("FADENO_CREATE_PARENT", "Project parent and ancestors must be ordinary non-symlink directories.");
    }
  } catch {
    return refusal("FADENO_CREATE_PARENT", "Project parent and ancestors must be ordinary non-symlink directories.");
  }
  if (!missing(target)) return refusal("FADENO_CREATE_TARGET_EXISTS", "Project target must not already exist.");

  let claimed = false;
  try {
    const version = context.packageVersion ?? packageVersion();
    const files = createProjectTemplate(name, version);
    for (const file of files) {
      const absolute = resolve(target, file.path);
      const containment = relative(target, absolute);
      if (containment === "" || containment.startsWith("..") || containment.includes("\\")) {
        throw new TypeError("FADENO_CREATE_TEMPLATE_PATH");
      }
    }
    mkdirSync(target);
    claimed = true;
    for (const [index, file] of files.entries()) {
      const path = join(target, file.path);
      mkdirSync(dirname(path), { recursive: true });
      context.beforeWrite?.(path, index);
      writeFileSync(path, file.contents, { encoding: "utf8", flag: "wx", mode: 0o644 });
    }
    return Object.freeze({
      exitCode: 0 as const,
      stdout: `Created Fadeno project at ${target}.\nNext: cd ${target} && pnpm install && pnpm check\n`,
      stderr: "",
    });
  } catch {
    if (claimed) {
      try {
        rmSync(target, { recursive: true, force: true });
      } catch {
        return Object.freeze({
          exitCode: 3 as const,
          stdout: "",
          stderr: "FADENO_CREATE_CLEANUP: Project creation failed and owned cleanup did not complete.\n",
        });
      }
    }
    return refusal("FADENO_CREATE_FILESYSTEM", "Project creation failed and no target was accepted.");
  }
}
