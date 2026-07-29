import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { request as requestHttp } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const arguments_ = process.argv.slice(2);

function option(name: string): string | undefined {
  const index = arguments_.indexOf(name);
  return index === -1 ? undefined : arguments_[index + 1];
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return 4443;
  if (!/^\d+$/u.test(value)) throw new TypeError("FADENO_DEMO_PORT");
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new TypeError("FADENO_DEMO_PORT");
  return port;
}

async function reservePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("FADENO_DEMO_BACKEND_PORT");
  await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  return address.port;
}

let projectRoot = resolve(option("--project-root") ?? `${root}/examples/v1-app`);
const requestedPort = parsePort(option("--port"));
const noBuild = arguments_.includes("--no-build");
let temporaryRoot: string | undefined;

function createTemporaryRoot(): string {
  const supplied = process.env["FADENO_DEMO_TEMPORARY_ROOT"];
  if (supplied === undefined) return mkdtempSync(join(tmpdir(), "fadeno-demo-"));
  let candidate: string;
  try {
    candidate = realpathSync(supplied);
  } catch {
    throw new TypeError("FADENO_DEMO_TEMPORARY_ROOT");
  }
  const temporaryDirectory = realpathSync(tmpdir());
  if (!candidate.startsWith(`${temporaryDirectory}/fadeno-demo-check-`)
    || readdirSync(candidate).length !== 0) {
    throw new TypeError("FADENO_DEMO_TEMPORARY_ROOT");
  }
  return candidate;
}

if (!noBuild) {
  temporaryRoot = createTemporaryRoot();
  try {
    const packedApplication = join(temporaryRoot, "application");
    const tarballs = join(temporaryRoot, "tarballs");
    mkdirSync(tarballs);
    execFileSync("pnpm", ["--filter", "@fadeno/framework", "build"], { cwd: root, stdio: "inherit" });
    execFileSync("pnpm", ["pack", "--pack-destination", tarballs], { cwd: join(root, "packages/framework"), stdio: "ignore" });
    cpSync(projectRoot, packedApplication, {
      recursive: true,
      filter: (source) => !source.includes("/scenarios") && !source.includes("/.fadeno") && !source.includes("/dist") && !source.includes("/node_modules"),
    });
    cpSync(
      join(projectRoot, "scenarios/evaluator-demo"),
      join(packedApplication, "scenarios/evaluator-demo"),
      { recursive: true },
    );
    const tarball = join(tarballs, readdirSync(tarballs).find((name) => name.endsWith(".tgz")) ?? "missing.tgz");
    const packagePath = join(packedApplication, "package.json");
    const packageDocument = JSON.parse(readFileSync(packagePath, "utf8")) as { dependencies: Record<string, string> };
    packageDocument.dependencies["@fadeno/framework"] = `file:${tarball}`;
    writeFileSync(packagePath, `${JSON.stringify(packageDocument, null, 2)}\n`);
    execFileSync("pnpm", ["install", "--offline", "--ignore-scripts"], { cwd: packedApplication, stdio: "ignore" });
    const linkedFramework = join(packedApplication, "node_modules/@fadeno/framework");
    const retainedFramework = join(temporaryRoot, "installed-framework");
    cpSync(realpathSync(linkedFramework), retainedFramework, { recursive: true, dereference: true });
    rmSync(linkedFramework, { recursive: true, force: true });
    cpSync(retainedFramework, linkedFramework, { recursive: true, dereference: true });
    execFileSync("pnpm", ["build"], { cwd: packedApplication, stdio: "inherit" });
    execFileSync(process.execPath, [
      "--no-warnings",
      "--experimental-strip-types",
      "scripts/prepare-evaluator-router.ts",
    ], { cwd: packedApplication, stdio: "inherit" });
    execFileSync("pnpm", ["exec", "tsc", "-p", "scenarios/evaluator-demo/tsconfig.json"], {
      cwd: packedApplication,
      stdio: "inherit",
    });
    const demoSite = join(packedApplication, ".fadeno/demo-site");
    mkdirSync(join(demoSite, "_fadeno/framework"), { recursive: true });
    cpSync(
      join(packedApplication, "node_modules/@fadeno/framework/dist"),
      join(demoSite, "_fadeno/framework"),
      { recursive: true },
    );
    const browserEntry = readFileSync(
      join(packedApplication, ".fadeno/demo-dist/scenarios/evaluator-demo/browser-entry.js"),
      "utf8",
    ).replace('from "@fadeno/framework/browser"', 'from "./framework/browser.js"');
    if (browserEntry.includes("@fadeno/framework")) throw new Error("FADENO_DEMO_BROWSER_LINK");
    writeFileSync(join(demoSite, "_fadeno/browser-entry.js"), browserEntry);
    projectRoot = packedApplication;
  } catch (error) {
    rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

const frontendReservation = requestedPort === 0 ? await reservePort() : requestedPort;
const backendPort = await reservePort();
const origin = `https://127.0.0.1:${frontendReservation}`;
const sessionKeysBefore = process.env["FADENO_SESSION_KEYS"];
let child: ReturnType<typeof spawn> | undefined;
let childError = "";
let closeBackend: () => Promise<void>;

if (noBuild) {
  child = spawn(process.execPath, ["--import", "./dist/.fadeno/routes/loader.js", "./dist/server/bootstrap.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      FADENO_ORIGIN: origin,
      FADENO_PORT: String(backendPort),
      FADENO_SESSION_KEYS: `demo:${randomBytes(32).toString("base64url")}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let childOutput = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { childOutput += chunk; });
  child.stderr.on("data", (chunk: string) => { childError += chunk; });
  await new Promise<void>((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error(`FADENO_DEMO_START_TIMEOUT\n${childError}`)), 15_000);
    const inspect = (): void => {
      if (!childOutput.includes(`Fadeno production server ready at http://127.0.0.1:${backendPort}.`)) return;
      clearTimeout(timeout);
      resolvePromise();
    };
    child?.stdout.on("data", inspect);
    child?.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`FADENO_DEMO_START_EXIT:${code}\n${childError}`));
    });
  });
  closeBackend = () => new Promise<void>((resolvePromise) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolvePromise();
      return;
    }
    child.once("exit", () => resolvePromise());
    child.kill("SIGTERM");
  });
} else {
  process.env["FADENO_SESSION_KEYS"] = `demo:${randomBytes(32).toString("base64url")}`;
  await import(pathToFileURL(join(projectRoot, "dist/.fadeno/routes/loader.js")).href);
  const application = await import(pathToFileURL(
    join(projectRoot, ".fadeno/demo-dist/.fadeno/demo-source/application.js"),
  ).href) as Readonly<{
    applicationGeneration: string;
    handler(request: Request): Response | Promise<Response>;
    listenNodeHttp(options: Readonly<{
      handler(request: Request): Response | Promise<Response>;
      hostname: string;
      port: number;
      canonicalOrigin: string;
      applicationGeneration: string;
    }>): Promise<Readonly<{ close(): Promise<void> }>>;
  }>;
  const demoSite = resolve(projectRoot, ".fadeno/demo-site");
  const handler = (request: Request): Response | Promise<Response> => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/_fadeno/")) return application.handler(request);
    const asset = resolve(demoSite, `.${url.pathname}`);
    if (!asset.startsWith(`${demoSite}/`)) return new Response("not found", { status: 404 });
    try {
      return new Response(readFileSync(asset), {
        headers: {
          "cache-control": "no-store",
          "content-type": "text/javascript; charset=utf-8",
        },
      });
    } catch {
      return new Response("not found", { status: 404 });
    }
  };
  const backend = await application.listenNodeHttp({
    handler,
    hostname: "127.0.0.1",
    port: backendPort,
    canonicalOrigin: origin,
    applicationGeneration: application.applicationGeneration,
  });
  closeBackend = backend.close;
}

const proxy = createHttpsServer({
  key: readFileSync(`${root}/scripts/fixtures/v1-example-tls-key.pem`),
  cert: readFileSync(`${root}/scripts/fixtures/v1-example-tls-cert.pem`),
}, (request, response) => {
  const upstream = requestHttp({
    hostname: "127.0.0.1",
    port: backendPort,
    path: request.url,
    method: request.method,
    headers: { ...request.headers, "x-fadeno-demo-https": "1" },
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.once("error", (error) => response.destroy(error));
  request.pipe(upstream);
});

await new Promise<void>((resolvePromise, reject) => {
  proxy.once("error", reject);
  proxy.listen(frontendReservation, "127.0.0.1", resolvePromise);
});

const address = proxy.address();
if (!address || typeof address === "string") throw new Error("FADENO_DEMO_FRONTEND_ADDRESS");
const publicOrigin = `https://127.0.0.1:${address.port}`;
console.log(`Fadeno secure demo ready at ${publicOrigin}.`);
console.log("The certificate is self-signed for this local demonstration; continue only for this loopback address.");

let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await new Promise<void>((resolvePromise) => proxy.close(() => resolvePromise()));
  await closeBackend();
  if (sessionKeysBefore === undefined) delete process.env["FADENO_SESSION_KEYS"];
  else process.env["FADENO_SESSION_KEYS"] = sessionKeysBefore;
  if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
}

await new Promise<void>((resolvePromise, reject) => {
  const stop = (): void => { void close().then(resolvePromise, reject); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  child?.once("exit", (code) => {
    if (closing) return;
    void close().then(() => reject(new Error(`FADENO_DEMO_RUNTIME_EXIT:${code}\n${childError}`)), reject);
  });
});
