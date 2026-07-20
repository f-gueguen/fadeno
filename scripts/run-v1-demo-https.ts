import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { request as requestHttp } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

if (!noBuild) {
  temporaryRoot = mkdtempSync(join(tmpdir(), "fadeno-demo-"));
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
    const tarball = join(tarballs, readdirSync(tarballs).find((name) => name.endsWith(".tgz")) ?? "missing.tgz");
    const packagePath = join(packedApplication, "package.json");
    const packageDocument = JSON.parse(readFileSync(packagePath, "utf8")) as { dependencies: Record<string, string> };
    packageDocument.dependencies["@fadeno/framework"] = `file:${tarball}`;
    writeFileSync(packagePath, `${JSON.stringify(packageDocument, null, 2)}\n`);
    execFileSync("pnpm", ["install", "--offline", "--ignore-scripts"], { cwd: packedApplication, stdio: "ignore" });
    execFileSync("pnpm", ["build"], { cwd: packedApplication, stdio: "inherit" });
    projectRoot = packedApplication;
  } catch (error) {
    rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

const frontendReservation = requestedPort === 0 ? await reservePort() : requestedPort;
const backendPort = await reservePort();
const origin = `https://127.0.0.1:${frontendReservation}`;
const child = spawn(process.execPath, ["--import", "./dist/.fadeno/routes/loader.js", "./dist/server/bootstrap.js"], {
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
let childError = "";
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
  child.stdout.on("data", inspect);
  child.once("exit", (code) => {
    clearTimeout(timeout);
    reject(new Error(`FADENO_DEMO_START_EXIT:${code}\n${childError}`));
  });
});

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
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise<void>((resolvePromise) => {
      child.once("exit", () => resolvePromise());
      child.kill("SIGTERM");
    });
  }
  if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
}

await new Promise<void>((resolvePromise, reject) => {
  const stop = (): void => { void close().then(resolvePromise, reject); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  child.once("exit", (code) => {
    if (closing) return;
    void close().then(() => reject(new Error(`FADENO_DEMO_RUNTIME_EXIT:${code}\n${childError}`)), reject);
  });
});
