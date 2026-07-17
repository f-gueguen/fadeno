import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { request as requestHttp } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createNetServer } from "node:net";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, firefox, webkit, type BrowserType } from "@playwright/test";

import { renderRoute, unsafeHtml, type Handler, type RenderChild } from "../packages/framework/src/index.ts";
import { formatAnalyzerDiagnosticBatchHuman } from "../packages/framework/src/internal/analyzer-diagnostics.ts";
import { PrivateProjectAnalyzer } from "../packages/framework/src/internal/analyzer-project.ts";
import { listenNodeHttp } from "../packages/framework/src/internal/node-http.ts";
import { createFrameworkExecutableNode } from "../packages/framework/src/internal/render-node.ts";
import { renderDocument } from "../packages/framework/src/internal/renderer.ts";
import { jsx, jsxs } from "../packages/framework/src/jsx-runtime.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = join(root, "packages/framework");
const exampleRoot = join(root, "examples/v1-app");

function run(command: string, arguments_: readonly string[], cwd: string): string {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`FADENO_V1_EXAMPLE_COMMAND:${command}:${result.status ?? result.signal}\n${result.stdout}\n${result.stderr}`);
  return `${result.stdout}${result.stderr}`;
}

function runResult(command: string, arguments_: readonly string[], cwd: string): Readonly<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  return Object.freeze({ status: result.status, stdout: result.stdout, stderr: result.stderr });
}

function runFadeno(command: string, arguments_: readonly string[], cwd: string): ReturnType<typeof runResult> {
  const publicBinTarget = realpathSync(join(command, "../../fadeno-framework-internal/dist/cli.js"));
  return runResult(process.execPath, [publicBinTarget, ...arguments_], cwd);
}

function treeIdentity(root: string, directory = root, records: string[] = []): string {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) treeIdentity(root, path, records);
    else if (entry.isFile()) {
      records.push(`${path.slice(root.length + 1).split("\\").join("/")}\0${createHash("sha256").update(readFileSync(path)).digest("hex")}`);
    } else {
      throw new Error("FADENO_V1_EXAMPLE_OUTPUT_OWNERSHIP");
    }
  }
  return createHash("sha256").update(records.join("\n")).digest("hex");
}

function treeContains(root: string, needle: string, directory = root): boolean {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (treeContains(root, needle, path)) return true;
    } else if (entry.isFile() && readFileSync(path).includes(Buffer.from(needle))) {
      return true;
    }
  }
  return false;
}

function expected(path: string): string {
  return readFileSync(join(exampleRoot, "scenarios/route-role-collision/expected", path), "utf8");
}

async function verifyFailureAndRecovery(temporaryRoot: string): Promise<void> {
  const scenarioRoot = join(exampleRoot, "scenarios/route-role-collision");
  const project = join(temporaryRoot, "scenario");
  mkdirSync(join(project, "src/routes"), { recursive: true });
  cpSync(join(scenarioRoot, "after/src/routes"), join(project, "src/routes"), { recursive: true });
  writeFileSync(join(project, "fadeno.config.ts"), "export default { routes: { root: 'src/routes' } };\n");
  const analyzer = new PrivateProjectAnalyzer(project);
  (await analyzer.analyze().result).apply();
  mkdirSync(join(project, "src/routes/old"));
  writeFileSync(join(project, "src/routes/old/page.tsx"), "export default function Old(): string { return 'old'; }\n");
  (await analyzer.analyze().result).apply();
  cpSync(join(scenarioRoot, "before/src/routes/handler.ts"), join(project, "src/routes/handler.ts"));
  const collision = await analyzer.analyze().result;
  assert.throws(() => collision.apply(), /FADENO_ANALYZER_APPLICATION_DIAGNOSTIC/u);
  assert.equal(formatAnalyzerDiagnosticBatchHuman(collision.diagnostics), readFileSync(join(exampleRoot, "expected/check-collision.txt"), "utf8"));
  const retained = JSON.parse(readFileSync(join(project, ".fadeno/routes/manifest.json"), "utf8")) as { routes: readonly { id: string }[] };
  assert.deepEqual(retained.routes.map(({ id }) => id), ["/", "/old"]);

  rmSync(join(project, "src/routes/handler.ts"));
  rmSync(join(project, "src/routes/old"), { recursive: true });
  const repairedAnalysis = await analyzer.analyze().result;
  repairedAnalysis.apply();
  const repaired = JSON.parse(readFileSync(join(project, ".fadeno/routes/manifest.json"), "utf8")) as { routes: readonly { id: string }[] };
  assert.deepEqual(repaired.routes.map(({ id }) => id), ["/"]);
  const applicationBytes = readFileSync(join(project, ".fadeno/routes/app.ts"), "utf8");
  assert.doesNotMatch(applicationBytes, /\/old|old\/page/u);
  const manifestDocument = JSON.parse(readFileSync(join(project, ".fadeno/routes/manifest.json"), "utf8")) as {
    generation: { sourceSha256: string };
  };
  const owner = JSON.parse(readFileSync(join(project, ".fadeno/routes/owner.json"), "utf8")) as {
    sourceSha256: string;
    files: readonly { path: string; sha256: string }[];
  };
  assert.equal(owner.sourceSha256, manifestDocument.generation.sourceSha256);
  assert.deepEqual(owner.files.map(({ path }) => path).sort(), ["app.ts", "index.d.ts", "index.js", "loader.ts", "manifest.json", "virtual.ts"]);
  for (const file of owner.files) {
    assert.equal(createHash("sha256").update(readFileSync(join(project, ".fadeno/routes", file.path))).digest("hex"), file.sha256);
  }
  assert.equal(expected("flow.json"), `${JSON.stringify({
    schemaVersion: 1,
    scenario: "route-role-collision",
    decision: "refuse-ambiguous-route-owner",
    causes: ["page-and-handler-share-one-route-directory"],
    ownership: { route: "/", sources: ["src/routes/handler.ts", "src/routes/page.tsx"] },
    skippedWork: ["manifest-publication", "application-binding-publication"],
    observableOutcome: collision.diagnostics.diagnostics.at(-1)?.code,
  }, null, 2)}\n`);
  assert.equal(expected("recovery.json"), `${JSON.stringify({
    schemaVersion: 1,
    scenario: "route-role-collision",
    correction: "remove-the-conflicting-handler",
    staleDiagnosticRemoved: true,
    staleArtifactsRemoved: true,
    publishedRouteIds: repaired.routes.map(({ id }) => id),
  }, null, 2)}\n`);
}

async function reservePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("FADENO_V1_EXAMPLE_PORT");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForPath(path: string): Promise<void> {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    if (existsSync(path)) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`FADENO_V1_EXAMPLE_WAIT:${path}`);
}

const exampleSessionKeys = `example:${Buffer.alloc(32, 19).toString("base64url")}`;

async function startServer(
  project: string,
  canonicalOrigin = "https://app.example",
): Promise<{ origin: string; output(): string; stop(): Promise<void> }> {
  const port = await reservePort();
  const child = spawn(process.execPath, ["--import", "./dist/.fadeno/routes/loader.js", "./dist/server/bootstrap.js"], {
    cwd: project,
    env: {
      ...process.env,
      FADENO_PORT: String(port),
      FADENO_ORIGIN: canonicalOrigin,
      FADENO_SESSION_KEYS: exampleSessionKeys,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  let output = "";
  const origin = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`FADENO_V1_EXAMPLE_START_TIMEOUT\n${stderr}`)), 10_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      const line = output.split("\n").find((value) => value.startsWith("Fadeno production server ready at "));
      if (!line) return;
      clearTimeout(timeout);
      const match = /^Fadeno production server ready at (http:\/\/127\.0\.0\.1:[0-9]+)\.$/u.exec(line);
      if (match?.[1]) resolve(match[1]);
      else reject(new Error("FADENO_V1_EXAMPLE_START_OUTPUT"));
    });
    child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`FADENO_V1_EXAMPLE_START_EXIT:${code}\n${stderr}`)); });
  });
  return {
    origin,
    output: () => output,
    stop: () => new Promise<void>((resolve, reject) => {
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`FADENO_V1_EXAMPLE_STOP:${code}\n${stderr}`)));
      child.kill("SIGTERM");
    }),
  };
}

async function startSecureServer(project: string): Promise<{
  origin: string;
  output(): string;
  stop(): Promise<void>;
}> {
  const port = await reservePort();
  const origin = `https://127.0.0.1:${port}`;
  const backend = await startServer(project, origin);
  const proxy = createHttpsServer({
    key: readFileSync(join(root, "scripts/fixtures/v1-example-tls-key.pem")),
    cert: readFileSync(join(root, "scripts/fixtures/v1-example-tls-cert.pem")),
  }, (request, response) => {
    const upstream = requestHttp(new URL(request.url ?? "/", backend.origin), {
      method: request.method,
      headers: request.headers,
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.once("error", (error) => response.destroy(error));
    request.pipe(upstream);
  });
  await new Promise<void>((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(port, "127.0.0.1", resolve);
  });
  return Object.freeze({
    origin,
    output: backend.output,
    async stop() {
      await new Promise<void>((resolve, reject) => proxy.close((error) => error ? reject(error) : resolve()));
      await backend.stop();
    },
  });
}

const browserTypes = { chromium, firefox, webkit } satisfies Readonly<Record<string, BrowserType>>;

async function verifyParsedApplication(origin: string): Promise<void> {
  for (const [name, browserType] of Object.entries(browserTypes)) {
    const browser = await browserType.launch({ headless: true });
    try {
      const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: "light" });
      const page = await context.newPage();
      const response = await page.goto(origin);
      assert.equal(response?.status(), 200, `${name}: home status`);
      const stylesheet = await context.request.get(`${origin}/styles`);
      assert.equal(stylesheet.status(), 200, `${name}: stylesheet status`);
      assert.equal(stylesheet.headers()["content-type"], "text/css; charset=utf-8", `${name}: stylesheet content type`);
      assert.equal(stylesheet.headers()["cache-control"], "public, max-age=300", `${name}: stylesheet cache control`);
      assert.match(await stylesheet.text(), /@media \(prefers-reduced-motion: reduce\)/u, `${name}: reduced-motion rule`);
      assert.equal(await page.locator('link[rel="stylesheet"][href="/styles"]').count(), 1, `${name}: stylesheet link`);
      assert.equal(await page.locator("h1").textContent(), "First running Fadeno application", `${name}: heading`);
      assert.equal(await page.getByText("Equivalent resource reads shared one request result.").count(), 1, `${name}: resource result`);
      assert.equal(await page.locator("nav[aria-label='Primary'] a").count(), 2, `${name}: navigation`);
      assert.equal(await page.locator("main section").count(), 1, `${name}: semantic main`);
      assert.equal(await page.locator("footer").textContent(), "Rendered by the V1 framework", `${name}: footer`);
      assert.equal(await page.locator("script").count(), 0, `${name}: ordinary page script count`);
      const homeLink = page.locator("nav[aria-label='Primary'] a").nth(0);
      const greetingLink = page.locator("nav[aria-label='Primary'] a").nth(1);
      assert.deepEqual(await page.evaluate(() => {
        const body = getComputedStyle(document.body);
        const navigation = getComputedStyle(document.querySelector("nav") as HTMLElement);
        const main = getComputedStyle(document.querySelector("main") as HTMLElement);
        const hero = getComputedStyle(document.querySelector(".hero-card") as HTMLElement);
        return {
          bodyBackground: body.backgroundColor,
          navigationDisplay: navigation.display,
          mainWidth: main.width,
          heroBackground: hero.backgroundColor,
        };
      }), {
        bodyBackground: "rgb(244, 246, 251)",
        navigationDisplay: "flex",
        mainWidth: "960px",
        heroBackground: "rgb(255, 255, 255)",
      }, `${name}: native CSS computed styles`);
      await homeLink.focus();
      assert.equal(await homeLink.evaluate((element) => element === element.ownerDocument.activeElement), true, `${name}: first navigation target focusable`);
      assert.deepEqual(await homeLink.evaluate((element) => {
        const style = getComputedStyle(element);
        return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
      }), { outlineStyle: "solid", outlineWidth: "3px" }, `${name}: visible focus style`);
      await greetingLink.focus();
      const [keyboardNavigation] = await Promise.all([
        page.waitForNavigation(),
        page.keyboard.press("Enter"),
      ]);
      assert.equal(keyboardNavigation?.status(), 200, `${name}: keyboard link activation status`);
      assert.equal(await page.locator("h1").textContent(), "Hello Fadeno", `${name}: keyboard link activation target`);
      await context.close();
    } finally {
      await browser.close();
    }
  }
}

function cspDocument(child: RenderChild): RenderChild {
  return jsxs("html", {
    lang: "en",
    children: [jsx("head", { children: jsx("title", { children: "CSP proof" }) }), jsx("body", { children: child })],
  });
}

async function verifyCspEnforcement(): Promise<void> {
  const handler: Handler = (request) => {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/nonce") {
      return renderDocument(cspDocument(createFrameworkExecutableNode("globalThis.__fadenoNonceExecuted = true;")), {
        request,
        frameworkExecutable: true,
      });
    }
    if (pathname === "/raw") {
      return renderDocument(cspDocument(unsafeHtml("<script>globalThis.__fadenoRawExecuted = true;</script>", {
        reason: "Deliberate CSP refusal fixture",
      })), { request });
    }
    if (pathname === "/wrong") {
      return renderDocument(cspDocument(unsafeHtml("<script nonce=\"wrong\">globalThis.__fadenoWrongExecuted = true;</script>", {
        reason: "Deliberate wrong nonce fixture",
      })), { request });
    }
    return new Response("missing", { status: 404 });
  };
  const server = await listenNodeHttp({ handler });
  try {
    for (const [name, browserType] of Object.entries(browserTypes)) {
      const browser = await browserType.launch({ headless: true });
      try {
        const page = await browser.newPage();
        const nonceResponse = await page.goto(`${server.origin}/nonce`);
        assert.equal(nonceResponse?.status(), 200, `${name}: nonce status`);
        assert.equal(await page.evaluate(() => Reflect.get(globalThis, "__fadenoNonceExecuted")), true, `${name}: matching nonce`);
        const nonce = await page.locator("script").evaluate((element) => (element as HTMLScriptElement).nonce);
        assert.ok(nonce, `${name}: nonce attribute`);
        assert.match(nonceResponse?.headers()["content-security-policy"] ?? "", new RegExp(`script-src 'nonce-${nonce}'`, "u"));

        const rawResponse = await page.goto(`${server.origin}/raw`);
        assert.equal(rawResponse?.status(), 200, `${name}: raw status`);
        assert.equal(await page.evaluate(() => Reflect.get(globalThis, "__fadenoRawExecuted")), undefined, `${name}: raw script blocked`);

        const wrongResponse = await page.goto(`${server.origin}/wrong`);
        assert.equal(wrongResponse?.status(), 200, `${name}: wrong nonce status`);
        assert.equal(await page.evaluate(() => Reflect.get(globalThis, "__fadenoWrongExecuted")), undefined, `${name}: wrong nonce blocked`);
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.close();
  }
}

async function verifyFailureObservation(): Promise<void> {
  const reports: Array<{
    incidentId: string;
    phase: string;
    code: string;
    projection: Readonly<Record<string, unknown>>;
    cause: unknown;
  }> = [];
  const handler: Handler = (request) => {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/pre") {
      return renderRoute({
        request,
        parameters: Object.freeze({}),
        layouts: [],
        page: () => { throw new Error("private pre-publication detail"); },
      });
    }
    return renderRoute({
      request,
      parameters: Object.freeze({}),
      layouts: [],
      page: () => cspDocument(jsx(async () => { throw new Error("private post-publication detail"); }, {})),
    });
  };
  const server = await listenNodeHttp({
    handler,
    failureObserver(report) {
      reports.push(report);
      throw new Error("deliberate reporter failure");
    },
  });
  try {
    const pre = await fetch(`${server.origin}/pre?secret=hidden`);
    assert.equal(pre.status, 500);
    const preBody = await pre.text();
    assert.doesNotMatch(preBody, /private pre-publication detail|secret=hidden/u);
    assert.match(preBody, new RegExp(`Incident ${reports[0]?.incidentId ?? "missing"}`, "u"));

    await assert.rejects(async () => {
      const post = await fetch(`${server.origin}/post`);
      assert.equal(post.status, 200);
      await post.text();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(reports.length, 2);
    assert.equal(reports[0]?.phase, "pre-publication");
    assert.equal(reports[0]?.code, "FADENO_RENDER_UNEXPECTED");
    assert.equal((reports[0]?.cause as Error).message, "private pre-publication detail");
    assert.deepEqual(reports[0]?.projection["request"], { url: `${server.origin}/pre` });
    assert.equal(reports[1]?.phase, "post-publication");
    assert.equal(reports[1]?.code, "FADENO_RENDER_LATE_UNEXPECTED");
    assert.equal((reports[1]?.cause as Error).message, "private post-publication detail");
    assert.notEqual(reports[0]?.incidentId, reports[1]?.incidentId);
  } finally {
    await server.close();
  }
}

async function verifyAuthenticatedCrud(project: string): Promise<void> {
  const server = await startSecureServer(project);
  try {
    for (const [browserName, browserType] of Object.entries(browserTypes)) {
      const browser = await browserType.launch({ headless: true });
      try {
        const context = await browser.newContext({ javaScriptEnabled: false, ignoreHTTPSErrors: true });
        const page = await context.newPage();
        const initial = await page.goto(`${server.origin}/projects`);
        assert.equal(initial?.status(), 200, `${browserName}: initial projects status`);
        assert.equal(await page.locator("script").count(), 0, `${browserName}: CRUD script count`);
        assert.equal(await page.getByText("Sign in before changing projects.").count(), 1, `${browserName}: signed-out view`);
        const anonymousCookie = (await context.cookies(server.origin)).find(({ name }) => name === "__Host-fadeno-session");
        assert.ok(anonymousCookie, `${browserName}: anonymous protected session`);
        assert.equal(anonymousCookie.httpOnly, true, `${browserName}: session is HttpOnly`);
        assert.equal(anonymousCookie.secure, true, `${browserName}: session is Secure`);

        await page.getByLabel("Example owner passcode").fill("incorrect");
        const [refusedSignIn] = await Promise.all([
          page.waitForNavigation(),
          page.getByRole("button", { name: "Sign in" }).click(),
        ]);
        assert.equal(refusedSignIn?.status(), 200, `${browserName}: sign-in correction status`);
        assert.equal(await page.getByRole("alert").getByText("Sign-in was refused.").count(), 1);
        assert.equal(await page.getByText("Use the example owner passcode.").count(), 1);
        assert.equal(await page.getByLabel("Example owner passcode").getAttribute("value"), null, `${browserName}: password not restored`);
        assert.doesNotMatch(await page.content(), /incorrect/u, `${browserName}: refused credential not reflected`);

        await page.getByLabel("Example owner passcode").fill("example-owner");
        const [acceptedSignIn] = await Promise.all([
          page.waitForNavigation(),
          page.getByRole("button", { name: "Sign in" }).click(),
        ]);
        assert.equal(acceptedSignIn?.status(), 200, `${browserName}: sign-in redirect target`);
        assert.equal(page.url(), `${server.origin}/projects`);
        assert.equal(await page.getByText("Signed in as the example owner.").count(), 1);
        assert.equal(await page.getByText("Sign-in was refused.").count(), 0, `${browserName}: stale sign-in failure removed`);
        const ownerCookie = (await context.cookies(server.origin)).find(({ name }) => name === "__Host-fadeno-session");
        assert.ok(ownerCookie, `${browserName}: owner protected session`);
        assert.notEqual(ownerCookie.value, anonymousCookie.value, `${browserName}: authentication rotates the session`);

        await page.getByLabel("Title", { exact: true }).fill("   ");
        const [invalidCreate] = await Promise.all([
          page.waitForNavigation(),
          page.getByRole("button", { name: "Create project" }).click(),
        ]);
        assert.equal(invalidCreate?.status(), 200, `${browserName}: create validation status`);
        const humanFailure = readFileSync(join(exampleRoot, "expected/action-failure.txt"), "utf8").trim().split("\n");
        assert.equal(await page.getByRole("alert").getByText(humanFailure[0] ?? "missing").count(), 1);
        assert.equal(await page.getByText(humanFailure[1] ?? "missing").count(), 1);
        const invalidTitle = page.getByLabel("Title", { exact: true });
        assert.equal(await invalidTitle.getAttribute("aria-invalid"), "true");
        const describedBy = await invalidTitle.getAttribute("aria-describedby");
        assert.ok(describedBy, `${browserName}: invalid title describes its error`);
        assert.equal(await page.locator(`#${describedBy}`).textContent(), humanFailure[1], `${browserName}: described error text`);
        assert.equal(await page.locator("#project-list > li").count(), 1, `${browserName}: invalid create has no mutation`);

        const createForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Create project" }) });
        const action = await createForm.getAttribute("action");
        const proof = await createForm.locator('input[name="__fadeno_proof"]').getAttribute("value");
        const titleName = await createForm.getByLabel("Title", { exact: true }).getAttribute("name");
        const attachmentName = await createForm.getByLabel("Text attachment").getAttribute("name");
        assert.ok(action && proof && titleName && attachmentName);
        await createForm.getByLabel("Title", { exact: true }).fill("Browser project");
        await createForm.getByLabel("Text attachment").setInputFiles({
          name: "notes.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("hello world"),
        });
        const [created] = await Promise.all([
          page.waitForNavigation(),
          createForm.getByRole("button", { name: "Create project" }).click(),
        ]);
        assert.equal(created?.status(), 200, `${browserName}: create redirect target`);
        assert.equal(await page.getByText("The project was not created.").count(), 0, `${browserName}: stale create failure removed`);
        assert.equal(await page.getByText("Browser project", { exact: true }).count(), 1);
        assert.equal(await page.getByText("notes.txt (11 bytes)", { exact: true }).count(), 1);
        assert.equal(await page.locator("#project-list > li").count(), 2);

        const replay = await context.request.post(new URL(action, server.origin).href, {
          headers: { origin: server.origin },
          multipart: {
            __fadeno_proof: proof,
            [titleName]: "Browser project",
            [attachmentName]: { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello world") },
          },
        });
        assert.equal(replay.status(), 409, `${browserName}: consumed proof replay`);
        assert.match(await replay.text(), /FADENO_ACTION_REPLAY/u);
        await page.reload();
        assert.equal(await page.locator("#project-list > li").count(), 2, `${browserName}: replay did not duplicate mutation`);

        let createdItem = page.locator("#project-list > li").filter({ hasText: "Browser project" });
        const updateForm = createdItem.locator("form").filter({ has: page.getByRole("button", { name: "Update project" }) });
        await updateForm.getByLabel("New title").fill("Updated browser project");
        const [updated] = await Promise.all([
          page.waitForNavigation(),
          updateForm.getByRole("button", { name: "Update project" }).click(),
        ]);
        assert.equal(updated?.status(), 200, `${browserName}: update redirect target`);
        assert.equal(await page.getByText("Updated browser project", { exact: true }).count(), 1);
        assert.equal(await page.getByText("Browser project", { exact: true }).count(), 0, `${browserName}: stale read removed`);

        createdItem = page.locator("#project-list > li").filter({ hasText: "Updated browser project" });
        let deleteForm = createdItem.locator("form").filter({ has: page.getByRole("button", { name: "Delete project" }) });
        assert.equal(await deleteForm.getByLabel("Confirm deletion").getAttribute("value"), "on", `${browserName}: checkbox wire value normalized`);
        const [invalidDelete] = await Promise.all([
          page.waitForNavigation(),
          deleteForm.getByRole("button", { name: "Delete project" }).click(),
        ]);
        assert.equal(invalidDelete?.status(), 200, `${browserName}: delete validation status`);
        assert.equal(await page.getByRole("alert").getByText("The project was not deleted.").count(), 1);
        createdItem = page.locator("#project-list > li").filter({ hasText: "Updated browser project" });
        const firstItem = page.locator("#project-list > li").filter({ hasText: "First project" });
        assert.equal(await createdItem.getByLabel("Confirm deletion").getAttribute("aria-invalid"), "true");
        assert.equal(await firstItem.getByLabel("Confirm deletion").getAttribute("aria-invalid"), null, `${browserName}: failure scoped to submitted row`);
        assert.equal(await page.locator("#project-list > li").count(), 2, `${browserName}: refused delete has no mutation`);

        deleteForm = createdItem.locator("form").filter({ has: page.getByRole("button", { name: "Delete project" }) });
        const confirmation = deleteForm.getByLabel("Confirm deletion");
        await confirmation.focus();
        await page.keyboard.press("Space");
        assert.equal(await confirmation.isChecked(), true, `${browserName}: keyboard checkbox activation`);
        const [deleted] = await Promise.all([
          page.waitForNavigation(),
          deleteForm.getByRole("button", { name: "Delete project" }).click(),
        ]);
        assert.equal(deleted?.status(), 200, `${browserName}: delete redirect target`);
        assert.equal(await page.locator("#project-list > li").count(), 1);
        assert.equal(await page.getByText("Updated browser project", { exact: true }).count(), 0, `${browserName}: deleted result removed`);

        const expectedDirectory = join(exampleRoot, "scenarios/action-lifecycle/expected");
        assert.equal(readFileSync(join(expectedDirectory, "diagnostic.json"), "utf8"), `${JSON.stringify({
          schemaVersion: 1,
          scenario: "authenticated-crud-validation",
          code: "PROJECT_TITLE_REQUIRED",
          status: invalidCreate?.status(),
          field: "title",
          formError: humanFailure[0],
          fieldError: humanFailure[1],
          safeSubmittedValuePreserved: true,
        }, null, 2)}\n`);
        assert.equal(readFileSync(join(expectedDirectory, "correction-before.json"), "utf8"), `${JSON.stringify({
          schemaVersion: 1,
          scenario: "authenticated-sign-in",
          submittedPasscode: "<redacted-invalid-value>",
          result: "SIGN_IN_REFUSED",
        }, null, 2)}\n`);
        assert.equal(readFileSync(join(expectedDirectory, "correction-after.json"), "utf8"), `${JSON.stringify({
          schemaVersion: 1,
          scenario: "authenticated-sign-in",
          submittedPasscode: "<redacted-corrected-value>",
          result: "authenticated-session-rotated",
        }, null, 2)}\n`);
        assert.equal(readFileSync(join(expectedDirectory, "flow.json"), "utf8"), `${JSON.stringify({
          schemaVersion: 1,
          scenario: "authenticated-crud",
          decisions: ["authenticate", "validate", "create", "refuse-replay", "update", "delete"],
          causes: ["generated-proof", "owner-session", "complete-revalidation"],
          ownership: { route: "/projects", resource: "projectCollection", actions: ["signIn", "createProject", "updateProject", "deleteProject"] },
          skippedWork: ["replayed-mutation", "client-javascript"],
          observableOutcome: "created-updated-deleted",
        }, null, 2)}\n`);
        assert.equal(readFileSync(join(expectedDirectory, "recovery.json"), "utf8"), `${JSON.stringify({
          schemaVersion: 1,
          scenario: "authenticated-crud-recovery",
          staleSignInFailureRemoved: true,
          staleCreateFailureRemoved: true,
          staleProjectReadRemovedAfterUpdate: true,
          deletedProjectRemovedAfterRevalidation: true,
          replayCreatedNoDuplicate: true,
        }, null, 2)}\n`);
        await context.close();
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.stop();
  }
}

async function verifyApplication(temporaryRoot: string): Promise<void> {
  const project = join(temporaryRoot, "application");
  cpSync(exampleRoot, project, { recursive: true, filter: (source) => !source.includes("/scenarios") && !source.includes("/.fadeno") && !source.includes("/dist") && !source.includes("/node_modules") });
  const tarballs = join(temporaryRoot, "tarballs");
  mkdirSync(tarballs);
  run("pnpm", ["--filter", "fadeno-framework-internal", "build"], root);
  run("pnpm", ["pack", "--pack-destination", tarballs], packageRoot);
  const tarball = join(tarballs, readdirSync(tarballs).find((name) => name.endsWith(".tgz")) ?? "missing.tgz");
  assert.ok(existsSync(tarball));
  const packageJson = JSON.parse(readFileSync(join(project, "package.json"), "utf8")) as { dependencies: Record<string, string> };
  packageJson.dependencies["fadeno-framework-internal"] = `file:${tarball}`;
  writeFileSync(join(project, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  run("pnpm", ["install", "--offline", "--ignore-scripts"], project);
  const secretCanary = "FADENO_BUILD_SECRET_CANARY_47c50877";
  writeFileSync(join(project, ".env"), `APPLICATION_SECRET=${secretCanary}\n`);
  const build = join(project, "node_modules", ".bin", "fadeno");
  const buildArguments = ["build", "--project-root", project] as const;
  mkdirSync(join(project, "dist"));
  writeFileSync(join(project, "dist/unowned.txt"), "not a Fadeno build\n");
  const unownedOutput = runFadeno(build, buildArguments, project);
  assert.deepEqual(unownedOutput, { status: 1, stdout: "", stderr: "FADENO_BUILD_OUTPUT_OWNERSHIP\n" });
  assert.equal(readFileSync(join(project, "dist/unowned.txt"), "utf8"), "not a Fadeno build\n");
  rmSync(join(project, "dist"), { recursive: true });
  const buildScenario = join(exampleRoot, "scenarios/build-compiler-error");
  const scenarioSource = join(project, "src/build-scenario.ts");
  cpSync(join(buildScenario, "before/src/build-scenario.ts"), scenarioSource);
  const firstGenerationFailure = runFadeno(build, buildArguments, project);
  assert.deepEqual(firstGenerationFailure, {
    status: 1,
    stdout: "",
    stderr: readFileSync(join(exampleRoot, "expected/build-typescript-error.txt"), "utf8"),
  });
  assert.equal(existsSync(join(project, "dist")), false);
  rmSync(scenarioSource);

  const redactionSource = join(project, "src/redaction-diagnostic.ts");
  writeFileSync(redactionSource, `const expected: "safe" = "${secretCanary}";\nimport ${JSON.stringify(join(temporaryRoot, "external-secret-module"))};\nvoid expected;\n`);
  const redactedFailure = runFadeno(build, buildArguments, project);
  assert.equal(redactedFailure.status, 1);
  assert.match(redactedFailure.stderr, /FADENO_BUILD_TYPESCRIPT/u);
  assert.doesNotMatch(redactedFailure.stderr, new RegExp(secretCanary, "u"));
  assert.equal(redactedFailure.stderr.includes(temporaryRoot), false);
  assert.doesNotMatch(redactedFailure.stderr, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u);
  assert.equal(existsSync(join(project, "dist")), false);
  rmSync(redactionSource);

  const firstBuild = runFadeno(build, buildArguments, project);
  assert.deepEqual(firstBuild, {
    status: 0,
    stdout: readFileSync(join(exampleRoot, "expected/build-success.txt"), "utf8"),
    stderr: "",
  });
  assert.equal(
    readdirSync(join(project, ".fadeno")).some((name) => name.startsWith("build-request-")),
    false,
    "bounded generation request files are removed after the synchronous compiler path",
  );
  const acceptedIdentity = treeIdentity(join(project, "dist"));
  const acceptedManifest = readFileSync(join(project, "dist/.fadeno/build-manifest.json"), "utf8");
  assert.equal(treeContains(join(project, "dist"), secretCanary), false);

  const cssScenario = join(exampleRoot, "scenarios/css-boundary");
  const cssRoute = join(project, "src/routes/css-boundary");
  mkdirSync(cssRoute);
  cpSync(join(cssScenario, "before/src/routes/css-boundary/page.tsx"), join(cssRoute, "page.tsx"));
  const cssFailure = runFadeno(build, buildArguments, project);
  assert.equal(cssFailure.status, 1);
  assert.equal(cssFailure.stdout, "");
  assert.equal(
    cssFailure.stderr,
    readFileSync(join(cssScenario, "expected/diagnostic-human.txt"), "utf8"),
  );
  assert.equal(treeIdentity(join(project, "dist")), acceptedIdentity);

  const runtimeCssRefusal = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    [
      'import { jsx } from "fadeno-framework-internal/jsx-runtime";',
      "const results = [];",
      'for (const [name, invoke] of [["inline-attribute", () => jsx("p", { style: "color: red", children: "refused" })], ["style-element", () => jsx("style", { children: "p { color: red; }" })]]) {',
      "  try { invoke(); results.push({ name, code: \"unexpected-acceptance\" }); }",
      "  catch (error) { results.push({ name, code: error instanceof Error ? error.message : \"unknown-error\" }); }",
      "}",
      "process.stdout.write(JSON.stringify(results));",
    ].join("\n"),
  ], { cwd: project, encoding: "utf8" });
  assert.equal(runtimeCssRefusal.status, 0, runtimeCssRefusal.stderr);
  assert.equal(runtimeCssRefusal.stderr, "");
  const runtimeCodes = JSON.parse(runtimeCssRefusal.stdout) as readonly Readonly<{ name: string; code: string }>[];
  assert.deepEqual(runtimeCodes, [
    { name: "inline-attribute", code: "FADENO_RENDER_STYLE_ATTRIBUTE" },
    { name: "style-element", code: "FADENO_RENDER_STYLE_CHILDREN" },
  ]);
  const typeCode = /\bTS\d+\b/u.exec(cssFailure.stderr)?.[0] ?? "missing";
  assert.equal(
    readFileSync(join(cssScenario, "expected/diagnostic.json"), "utf8"),
    `${JSON.stringify({
      schemaVersion: 1,
      scenario: "inline-css-refusal",
      typeCode,
      runtimeCodes,
      correction: "replace inline CSS with class and an external stylesheet",
    }, null, 2)}\n`,
  );

  cpSync(join(cssScenario, "after/src/routes/css-boundary/page.tsx"), join(cssRoute, "page.tsx"));
  const correctedCssBuild = runFadeno(build, buildArguments, project);
  assert.equal(correctedCssBuild.status, 0, correctedCssBuild.stderr);
  assert.doesNotMatch(`${correctedCssBuild.stdout}${correctedCssBuild.stderr}`, /TS\d+|FADENO_RENDER_STYLE/u);
  assert.equal(existsSync(join(project, "dist/src/routes/css-boundary/page.js")), true);
  assert.equal(
    readFileSync(join(cssScenario, "expected/correction-before.json"), "utf8"),
    `${JSON.stringify({ schemaVersion: 1, mechanism: "inline-style-attribute", accepted: false }, null, 2)}\n`,
  );
  assert.equal(
    readFileSync(join(cssScenario, "expected/correction-after.json"), "utf8"),
    `${JSON.stringify({ schemaVersion: 1, mechanism: "class-and-external-stylesheet", accepted: true }, null, 2)}\n`,
  );
  assert.equal(
    readFileSync(join(cssScenario, "expected/flow.json"), "utf8"),
    `${JSON.stringify({
      schemaVersion: 1,
      scenario: "native-css-boundary",
      decisions: ["refuse-inline-css", "serve-external-stylesheet", "apply-class-selector"],
      causes: ["closed-jsx-sinks", "contextual-css-security", "native-css-sufficiency"],
      ownership: { document: "src/routes/layout.tsx", stylesheet: "src/routes/styles/handler.ts", styles: "src/styles.ts" },
      skippedWork: ["scoped-css-compilation", "runtime-style-injection", "client-javascript"],
      observableOutcome: "styled-server-document",
    }, null, 2)}\n`,
  );
  rmSync(cssRoute, { recursive: true });
  const cssCleanupBuild = runFadeno(build, buildArguments, project);
  assert.deepEqual(cssCleanupBuild, firstBuild);
  assert.equal(existsSync(join(project, "dist/src/routes/css-boundary/page.js")), false);
  assert.equal(
    readFileSync(join(cssScenario, "expected/recovery.json"), "utf8"),
    `${JSON.stringify({
      schemaVersion: 1,
      scenario: "native-css-correction-and-cleanup",
      staleDiagnosticRemoved: true,
      correctedArtifactPublished: true,
      sourceOwnerRemoved: true,
      staleArtifactRemoved: true,
    }, null, 2)}\n`,
  );

  const secondBuild = runFadeno(build, buildArguments, project);
  assert.deepEqual(secondBuild, firstBuild);
  assert.equal(treeIdentity(join(project, "dist")), acceptedIdentity);
  assert.equal(readFileSync(join(project, "dist/.fadeno/build-manifest.json"), "utf8"), acceptedManifest);

  const cleanProject = join(temporaryRoot, "application-clean-copy");
  cpSync(exampleRoot, cleanProject, { recursive: true, filter: (source) => !source.includes("/scenarios") && !source.includes("/.fadeno") && !source.includes("/dist") && !source.includes("/node_modules") });
  const cleanPackageJson = JSON.parse(readFileSync(join(cleanProject, "package.json"), "utf8")) as { dependencies: Record<string, string> };
  cleanPackageJson.dependencies["fadeno-framework-internal"] = `file:${tarball}`;
  writeFileSync(join(cleanProject, "package.json"), `${JSON.stringify(cleanPackageJson, null, 2)}\n`);
  writeFileSync(join(cleanProject, ".env"), `APPLICATION_SECRET=${secretCanary}\n`);
  run("pnpm", ["install", "--offline", "--ignore-scripts"], cleanProject);
  const cleanBuild = runFadeno(join(cleanProject, "node_modules/.bin/fadeno"), ["build", "--project-root", cleanProject], cleanProject);
  assert.deepEqual(cleanBuild, firstBuild);
  const cleanManifest = readFileSync(join(cleanProject, "dist/.fadeno/build-manifest.json"), "utf8");
  const firstManifestDocument = JSON.parse(acceptedManifest) as Record<string, unknown>;
  const cleanManifestDocument = JSON.parse(cleanManifest) as Record<string, unknown>;
  const manifestDifferences = Object.keys(firstManifestDocument).filter((key) =>
    JSON.stringify(firstManifestDocument[key]) !== JSON.stringify(cleanManifestDocument[key]),
  );
  assert.equal(
    treeIdentity(join(cleanProject, "dist")),
    acceptedIdentity,
    `clean-copy output differs in manifest fields: ${manifestDifferences.join(", ")}`,
  );

  const fabricatedRollback = join(project, ".fadeno/build-stage/rollback");
  cpSync(join(project, "dist"), fabricatedRollback, { recursive: true });
  const fabricatedManifestPath = join(fabricatedRollback, ".fadeno/build-manifest.json");
  const fabricatedManifest = JSON.parse(readFileSync(fabricatedManifestPath, "utf8")) as Record<string, unknown>;
  const dummyFileSha256 = createHash("sha256").update("").digest("hex");
  fabricatedManifest["runtime"] = {
    schemaVersion: 1,
    files: [{ path: "dummy.js", bytes: 0, sha256: dummyFileSha256 }],
    sha256: createHash("sha256").update(`${["dummy.js", "0", dummyFileSha256].join("\0")}\n`).digest("hex"),
  };
  writeFileSync(fabricatedManifestPath, `${JSON.stringify(fabricatedManifest, null, 2)}\n`);
  const rollbackRefusal = runFadeno(build, buildArguments, project);
  assert.equal(rollbackRefusal.status, 3);
  assert.equal(rollbackRefusal.stdout, "");
  assert.match(rollbackRefusal.stderr, /^FADENO_BUILD_INTERNAL: Production build could not complete\.\n  incident: [a-f0-9-]+\n$/u);
  assert.equal(treeIdentity(join(project, "dist")), acceptedIdentity);
  rmSync(fabricatedRollback, { recursive: true });

  const installedFramework = realpathSync(join(project, "node_modules", "fadeno-framework-internal"));
  const privateBuild = await import(pathToFileURL(join(installedFramework, "dist/internal/project-build.js")).href) as {
    runProjectBuildCommand(
      arguments_: readonly string[],
      context: Readonly<{ cwd: string; beforeAcceptStage(stageRoot: string): void }>,
    ): Promise<Readonly<{ exitCode: number; stdout: string; stderr: string }>>;
  };
  const transactionFailure = await privateBuild.runProjectBuildCommand(buildArguments, {
    cwd: project,
    beforeAcceptStage(stageRoot) {
      writeFileSync(join(stageRoot, "server/bootstrap.js"), "mutated candidate\n");
    },
  });
  assert.deepEqual(transactionFailure, { exitCode: 1, stdout: "", stderr: "FADENO_BUILD_OUTPUT_STALE\n" });
  assert.equal(treeIdentity(join(project, "dist")), acceptedIdentity);
  assert.equal(readFileSync(join(project, "dist/.fadeno/build-manifest.json"), "utf8"), acceptedManifest);

  const assertPostHookRefusal = async (
    expectedCode: string,
    mutate: () => () => void,
  ): Promise<void> => {
    let restore: (() => void) | null = null;
    const result = await privateBuild.runProjectBuildCommand(buildArguments, {
      cwd: project,
      beforeAcceptStage() { restore = mutate(); },
    });
    restore?.();
    assert.deepEqual(result, { exitCode: 1, stdout: "", stderr: `${expectedCode}\n` });
    assert.equal(treeIdentity(join(project, "dist")), acceptedIdentity);
    assert.equal(readFileSync(join(project, "dist/.fadeno/build-manifest.json"), "utf8"), acceptedManifest);
  };

  const pagePath = join(project, "src/routes/page.tsx");
  const pageBeforeHook = readFileSync(pagePath);
  await assertPostHookRefusal("FADENO_BUILD_INPUT_STALE", () => {
    writeFileSync(pagePath, Buffer.concat([pageBeforeHook, Buffer.from("\n// post-hook source drift\n")]));
    return () => writeFileSync(pagePath, pageBeforeHook);
  });

  const addedSource = join(project, "src/post-hook-addition.ts");
  await assertPostHookRefusal("FADENO_BUILD_INPUT_STALE", () => {
    writeFileSync(addedSource, "export const postHookAddition = true;\n");
    return () => rmSync(addedSource);
  });

  const configurationPath = join(project, "fadeno.config.ts");
  const configurationBeforeHook = readFileSync(configurationPath);
  await assertPostHookRefusal("FADENO_BUILD_INPUT_STALE", () => {
    writeFileSync(configurationPath, Buffer.concat([
      configurationBeforeHook,
      Buffer.from("\n// post-hook configuration drift\n"),
    ]));
    return () => writeFileSync(configurationPath, configurationBeforeHook);
  });

  const environmentPath = join(project, ".env");
  const environmentBeforeHook = readFileSync(environmentPath);
  await assertPostHookRefusal("FADENO_BUILD_ENVIRONMENT", () => {
    writeFileSync(environmentPath, Buffer.concat([environmentBeforeHook, Buffer.from("POST_HOOK=changed\n")]));
    return () => writeFileSync(environmentPath, environmentBeforeHook);
  });

  const externalCompilerInput = join(project, "node_modules/@types/node/globals.d.ts");
  const externalCompilerBeforeHook = readFileSync(externalCompilerInput);
  await assertPostHookRefusal("FADENO_BUILD_INPUT_STALE", () => {
    writeFileSync(externalCompilerInput, Buffer.concat([externalCompilerBeforeHook, Buffer.from("\n// external compiler drift\n")]));
    return () => writeFileSync(externalCompilerInput, externalCompilerBeforeHook);
  });

  const frameworkRuntimePath = join(project, "node_modules/fadeno-framework-internal/README.md");
  const frameworkRuntimeBeforeHook = readFileSync(frameworkRuntimePath);
  await assertPostHookRefusal("FADENO_BUILD_RUNTIME_IDENTITY", () => {
    writeFileSync(frameworkRuntimePath, Buffer.concat([frameworkRuntimeBeforeHook, Buffer.from("\npost-hook runtime drift\n")]));
    return () => writeFileSync(frameworkRuntimePath, frameworkRuntimeBeforeHook);
  });

  const lockMarker = join(temporaryRoot, "build-lock-held");
  const heldBuildSource = [
    'import { existsSync, writeFileSync } from "node:fs";',
    `import { runProjectBuildCommand } from ${JSON.stringify(pathToFileURL(join(installedFramework, "dist/internal/project-build.js")).href)};`,
    `await runProjectBuildCommand(${JSON.stringify(buildArguments)}, {`,
    `  cwd: ${JSON.stringify(project)},`,
    `  beforeAcceptStage() { writeFileSync(${JSON.stringify(lockMarker)}, "held\\n"); const wait = new Int32Array(new SharedArrayBuffer(4)); while (true) Atomics.wait(wait, 0, 0, 1000); },`,
    "});",
  ].join("\n");
  const heldBuild = spawn(process.execPath, ["--input-type=module", "--eval", heldBuildSource], {
    cwd: project,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForPath(lockMarker);
    const concurrentBuild = runFadeno(build, buildArguments, project);
    assert.deepEqual(concurrentBuild, { status: 1, stdout: "", stderr: "FADENO_BUILD_CONCURRENT\n" });
    const exited = new Promise<void>((resolve) => heldBuild.once("exit", () => resolve()));
    assert.equal(heldBuild.kill("SIGKILL"), true);
    await exited;
    const crashRecovery = runFadeno(build, buildArguments, project);
    assert.deepEqual(crashRecovery, firstBuild);
    assert.equal(treeIdentity(join(project, "dist")), acceptedIdentity);
  } finally {
    if (heldBuild.exitCode === null && heldBuild.signalCode === null) heldBuild.kill("SIGKILL");
  }

  cpSync(join(buildScenario, "before/src/build-scenario.ts"), scenarioSource);
  const failedBuild = runFadeno(build, buildArguments, project);
  assert.deepEqual(failedBuild, {
    status: 1,
    stdout: "",
    stderr: readFileSync(join(exampleRoot, "expected/build-typescript-error.txt"), "utf8"),
  });
  assert.equal(treeIdentity(join(project, "dist")), acceptedIdentity);
  assert.equal(readFileSync(join(project, "dist/.fadeno/build-manifest.json"), "utf8"), acceptedManifest);
  assert.equal(readFileSync(join(buildScenario, "expected/flow.json"), "utf8"), `${JSON.stringify({
    schemaVersion: 1,
    scenario: "build-compiler-error",
    decision: "refuse-compiler-diagnostic",
    causes: ["TS2322"],
    ownership: { acceptedOutput: "dist", candidateOutput: ".fadeno/build-stage/generation-1" },
    skippedWork: ["dist-replacement", "production-start"],
    observableOutcome: "last-good-build-preserved",
  }, null, 2)}\n`);

  cpSync(join(buildScenario, "after/src/build-scenario.ts"), scenarioSource);
  const recoveredBuild = runFadeno(build, buildArguments, project);
  assert.equal(recoveredBuild.status, 0, recoveredBuild.stderr);
  assert.equal(recoveredBuild.stderr, "");
  assert.equal(recoveredBuild.stdout.includes("TS2322"), false);
  assert.equal(existsSync(join(project, "dist/src/build-scenario.js")), true);
  rmSync(scenarioSource);
  const cleanupBuild = runFadeno(build, buildArguments, project);
  assert.deepEqual(cleanupBuild, firstBuild);
  assert.equal(existsSync(join(project, "dist/src/build-scenario.js")), false);
  assert.equal(readFileSync(join(buildScenario, "expected/recovery.json"), "utf8"), `${JSON.stringify({
    schemaVersion: 1,
    scenario: "build-compiler-error",
    correction: "replace-the-invalid-value-with-a-number",
    staleDiagnosticRemoved: true,
    lastGoodBuildPreservedDuringFailure: true,
    correctedArtifactPublished: true,
    staleArtifactRemovedAfterOwnerDeletion: true,
  }, null, 2)}\n`);

  const runtimeFixtureName = "fadeno-runtime-fixture";
  const runtimeFixtureRoot = join(project, "node_modules", runtimeFixtureName);
  mkdirSync(runtimeFixtureRoot);
  writeFileSync(join(runtimeFixtureRoot, "package.json"), `${JSON.stringify({
    name: runtimeFixtureName,
    version: "1.0.0",
    type: "module",
    exports: "./index.js",
    types: "./index.d.ts",
  }, null, 2)}\n`);
  writeFileSync(join(runtimeFixtureRoot, "index.js"), "export const runtimeFixture = 'declared';\n");
  writeFileSync(join(runtimeFixtureRoot, "index.d.ts"), "export declare const runtimeFixture: string;\n");
  const packageBeforeRuntimeFixture = readFileSync(join(project, "package.json"));
  const pageBeforeRuntimeFixture = readFileSync(pagePath);
  writeFileSync(pagePath, `import { runtimeFixture } from ${JSON.stringify(runtimeFixtureName)};\nvoid runtimeFixture;\n${pageBeforeRuntimeFixture.toString("utf8")}`);
  const developmentOnlyPackage = JSON.parse(packageBeforeRuntimeFixture.toString("utf8")) as {
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  developmentOnlyPackage.devDependencies ??= {};
  developmentOnlyPackage.devDependencies[runtimeFixtureName] = "1.0.0";
  writeFileSync(join(project, "package.json"), `${JSON.stringify(developmentOnlyPackage, null, 2)}\n`);
  const undeclaredRuntime = runFadeno(build, buildArguments, project);
  assert.deepEqual(undeclaredRuntime, { status: 1, stdout: "", stderr: "FADENO_BUILD_RUNTIME_IMPORT\n" });
  assert.equal(treeIdentity(join(project, "dist")), acceptedIdentity);

  writeFileSync(pagePath, `import { runtimeFixture } from "../../node_modules/${runtimeFixtureName}/index.js";\nvoid runtimeFixture;\n${pageBeforeRuntimeFixture.toString("utf8")}`);
  const relativeRuntimeEscape = runFadeno(build, buildArguments, project);
  assert.deepEqual(relativeRuntimeEscape, { status: 1, stdout: "", stderr: "FADENO_BUILD_RUNTIME_IMPORT\n" });
  assert.equal(treeIdentity(join(project, "dist")), acceptedIdentity);

  delete developmentOnlyPackage.devDependencies[runtimeFixtureName];
  developmentOnlyPackage.peerDependencies = { [runtimeFixtureName]: "1.0.0" };
  writeFileSync(join(project, "package.json"), `${JSON.stringify(developmentOnlyPackage, null, 2)}\n`);
  writeFileSync(pagePath, `import { runtimeFixture } from ${JSON.stringify(runtimeFixtureName)};\nconst keywordProperty = { import: 1 };\nvoid runtimeFixture;\nvoid keywordProperty;\n${pageBeforeRuntimeFixture.toString("utf8")}`);
  const declaredPeerBuild = runFadeno(build, buildArguments, project);
  assert.equal(declaredPeerBuild.status, 0, declaredPeerBuild.stderr);
  const peerManifest = JSON.parse(readFileSync(join(project, "dist/.fadeno/build-manifest.json"), "utf8")) as {
    dependencies: readonly { name: string }[];
  };
  assert.equal(peerManifest.dependencies.some(({ name }) => name === runtimeFixtureName), true);
  const peerServer = await startServer(project);
  await peerServer.stop();

  writeFileSync(join(project, "package.json"), packageBeforeRuntimeFixture);
  writeFileSync(pagePath, pageBeforeRuntimeFixture);
  rmSync(runtimeFixtureRoot, { recursive: true });
  const runtimeFixtureCleanup = runFadeno(build, buildArguments, project);
  assert.deepEqual(runtimeFixtureCleanup, firstBuild);
  assert.equal(treeIdentity(join(project, "dist")), acceptedIdentity);

  const manifest = JSON.parse(readFileSync(join(project, "dist/.fadeno/build-manifest.json"), "utf8")) as {
    schemaVersion: number;
    compilerVersion: string;
    artifacts: number;
    files: readonly { path: string }[];
    runtime: { schemaVersion: number; files: readonly unknown[]; sha256: string };
    dependencies: readonly { name: string; identity: { files: readonly unknown[]; sha256: string } }[];
  };
  assert.equal(readFileSync(join(exampleRoot, "expected/build-manifest-normalized.json"), "utf8"), `${JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    compilerVersion: manifest.compilerVersion,
    artifacts: manifest.artifacts,
    files: manifest.files.map(({ path }) => path),
    runtime: {
      schemaVersion: manifest.runtime.schemaVersion,
      files: manifest.runtime.files.length > 0 ? "<verified-files>" : "<missing-files>",
      sha256: /^[a-f0-9]{64}$/u.test(manifest.runtime.sha256) ? "<verified-sha256>" : "<invalid-sha256>",
    },
    dependencies: manifest.dependencies.map(({ name, identity }) => ({
      name: name.startsWith("@typescript/typescript-") ? "<platform-compiler-package>" : name,
      files: identity.files.length > 0 ? "<verified-files>" : "<missing-files>",
      sha256: /^[a-f0-9]{64}$/u.test(identity.sha256) ? "<verified-sha256>" : "<invalid-sha256>",
    })).sort((left, right) => left.name.localeCompare(right.name)),
  }, null, 2)}\n`);

  const refusalPort = await reservePort();
  const withoutLoader = runResult(process.execPath, ["./dist/server/bootstrap.js"], project);
  assert.notEqual(withoutLoader.status, 0);
  assert.match(`${withoutLoader.stdout}${withoutLoader.stderr}`, /FADENO_BUILD_RUNTIME_PORT/u);
  const invalidPort = spawnSync(process.execPath, ["--import", "./dist/.fadeno/routes/loader.js", "./dist/server/bootstrap.js"], {
    cwd: project,
    env: { ...process.env, FADENO_PORT: "0" },
    encoding: "utf8",
  });
  assert.notEqual(invalidPort.status, 0);
  assert.match(`${invalidPort.stdout}${invalidPort.stderr}`, /FADENO_BUILD_RUNTIME_PORT/u);

  const manifestPath = join(project, "dist/.fadeno/build-manifest.json");
  const manifestBytes = readFileSync(manifestPath);
  try {
    writeFileSync(manifestPath, Buffer.concat([manifestBytes, Buffer.alloc(4 * 1024 * 1024, 32)]));
    const oversizedManifest = spawnSync(process.execPath, ["--import", "./dist/.fadeno/routes/loader.js", "./dist/server/bootstrap.js"], {
      cwd: project,
      env: { ...process.env, FADENO_PORT: String(refusalPort) },
      encoding: "utf8",
    });
    assert.notEqual(oversizedManifest.status, 0);
    assert.match(`${oversizedManifest.stdout}${oversizedManifest.stderr}`, /FADENO_BUILD_RUNTIME_MANIFEST/u);
    assert.doesNotMatch(oversizedManifest.stdout, /production server ready/u);
  } finally {
    writeFileSync(manifestPath, manifestBytes);
  }

  const runtimeReadme = join(project, "node_modules", "fadeno-framework-internal", "README.md");
  const runtimeReadmeBytes = readFileSync(runtimeReadme);
  try {
    writeFileSync(runtimeReadme, Buffer.concat([runtimeReadmeBytes, Buffer.from("\nmutation\n")]));
    const staleRuntime = spawnSync(process.execPath, ["--import", "./dist/.fadeno/routes/loader.js", "./dist/server/bootstrap.js"], {
      cwd: project,
      env: { ...process.env, FADENO_PORT: String(refusalPort) },
      encoding: "utf8",
    });
    assert.notEqual(staleRuntime.status, 0);
    assert.match(`${staleRuntime.stdout}${staleRuntime.stderr}`, /FADENO_BUILD_RUNTIME_IDENTITY/u);
    assert.doesNotMatch(staleRuntime.stdout, /production server ready/u);
  } finally {
    writeFileSync(runtimeReadme, runtimeReadmeBytes);
  }

  const dependencyReadme = join(project, "node_modules", "typescript", "README.md");
  const dependencyReadmeBytes = readFileSync(dependencyReadme);
  try {
    writeFileSync(dependencyReadme, Buffer.concat([dependencyReadmeBytes, Buffer.from("\nmutation\n")]));
    const staleDependency = spawnSync(process.execPath, ["--import", "./dist/.fadeno/routes/loader.js", "./dist/server/bootstrap.js"], {
      cwd: project,
      env: { ...process.env, FADENO_PORT: String(refusalPort) },
      encoding: "utf8",
    });
    assert.notEqual(staleDependency.status, 0);
    assert.match(`${staleDependency.stdout}${staleDependency.stderr}`, /FADENO_BUILD_RUNTIME_IDENTITY/u);
    assert.doesNotMatch(staleDependency.stdout, /production server ready/u);
  } finally {
    writeFileSync(dependencyReadme, dependencyReadmeBytes);
  }

  const unrelatedDevelopmentReadme = join(project, "node_modules", "@types/node/README.md");
  const unrelatedDevelopmentBytes = readFileSync(unrelatedDevelopmentReadme);
  try {
    writeFileSync(unrelatedDevelopmentReadme, Buffer.concat([unrelatedDevelopmentBytes, Buffer.from("\nunrelated mutation\n")]));
    const developmentMutationServer = await startServer(project);
    await developmentMutationServer.stop();
  } finally {
    writeFileSync(unrelatedDevelopmentReadme, unrelatedDevelopmentBytes);
  }

  run("pnpm", ["install", "--prod", "--offline", "--ignore-scripts"], project);
  assert.equal(existsSync(join(project, "node_modules/@types/node")), false);

  const missingLoader = spawnSync(process.execPath, ["./dist/server/bootstrap.js"], {
    cwd: project,
    env: { ...process.env, FADENO_PORT: String(refusalPort) },
    encoding: "utf8",
  });
  assert.notEqual(missingLoader.status, 0);
  assert.match(`${missingLoader.stdout}${missingLoader.stderr}`, /FADENO_BUILD_RUNTIME_INTERNAL/u);
  assert.doesNotMatch(`${missingLoader.stdout}${missingLoader.stderr}`, new RegExp(project.replaceAll("/", "\\/"), "u"));
  assert.doesNotMatch(missingLoader.stdout, /production server ready/u);

  const server = await startServer(project);
  try {
    const home = await fetch(server.origin);
    const homeBody = await home.text();
    assert.equal(home.status, 200);
    assert.match(homeBody, /^<!doctype html><html lang="en">/u);
    assert.match(homeBody, /<nav aria-label="Primary" class="primary-nav">/u);
    assert.match(homeBody, /First running Fadeno application/u);
    assert.match(homeBody, /href="\/hello\/Reader"/u);
    for (const line of readFileSync(join(exampleRoot, "expected/resource-success.txt"), "utf8").trim().split("\n")) {
      assert.match(homeBody, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    }
    assert.match(home.headers.get("content-security-policy") ?? "", /script-src 'none'/u);
    assert.match(home.headers.get("content-security-policy") ?? "", /style-src 'self'/u);

    const tenantAlpha = await fetch(server.origin, { headers: { authorization: "Bearer example-tenant-alpha" } });
    const tenantAlphaBody = await tenantAlpha.text();
    assert.equal(tenantAlpha.status, 200);
    assert.match(tenantAlphaBody, /Project 7 is ready for tenant-alpha\./u);
    assert.doesNotMatch(tenantAlphaBody, /example-tenant-alpha|tenant-beta/u);

    const tenantBeta = await fetch(server.origin, { headers: { authorization: "Bearer example-tenant-beta" } });
    const tenantBetaBody = await tenantBeta.text();
    assert.equal(tenantBeta.status, 200);
    assert.match(tenantBetaBody, /Project 7 is ready for tenant-beta\./u);
    assert.doesNotMatch(tenantBetaBody, /example-tenant-beta|tenant-alpha/u);

    const greeting = await fetch(`${server.origin}/hello/%3CReader%3E`);
    assert.equal(greeting.status, 200);
    assert.match(await greeting.text(), /Hello &lt;Reader&gt;/u);

    const missing = await fetch(`${server.origin}/missing`);
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /Page not found/u);

    const adminMissing = await fetch(`${server.origin}/admin/missing`);
    assert.equal(adminMissing.status, 404);
    const adminMissingBody = await adminMissing.text();
    assert.match(adminMissingBody, /Administration/u);
    assert.match(adminMissingBody, /Administrative page not found/u);
    assert.doesNotMatch(adminMissingBody, /Shop page not found/u);

    const shopMissing = await fetch(`${server.origin}/shop/missing`);
    assert.equal(shopMissing.status, 404);
    const shopMissingBody = await shopMissing.text();
    assert.match(shopMissingBody, /Shop page not found/u);
    assert.doesNotMatch(shopMissingBody, /Administrative page not found/u);

    const redirect = await fetch(`${server.origin}/moved`, { redirect: "manual" });
    assert.equal(redirect.status, 303);
    assert.equal(redirect.headers.get("location"), "/hello/Redirected");

    const reportsBeforeExpectedFailure = server.output().split("\n").filter((line) => line.startsWith("{")).length;
    const resourceFailure = await fetch(`${server.origin}/resource-failure`);
    const resourceFailureBody = await resourceFailure.text();
    assert.equal(resourceFailure.status, 404);
    const expectedResourceFailure = readFileSync(join(exampleRoot, "expected/resource-failure.txt"), "utf8").trim().split("\n");
    assert.equal(resourceFailureBody.includes(`>${expectedResourceFailure[0]}<`), true);
    assert.equal(resourceFailureBody.includes(`>${expectedResourceFailure[1]}<`), true);
    assert.equal(server.output().split("\n").filter((line) => line.startsWith("{")).length, reportsBeforeExpectedFailure);
    const expectedResourceFailureEvidence = {
      schemaVersion: 1,
      scenario: "expected-resource-failure",
      code: "PROJECT_NOT_FOUND",
      status: resourceFailure.status,
      boundary: "route-error-page",
      internalIncidentReported: false,
      redaction: "application-code-only",
    };
    assert.equal(
      readFileSync(join(exampleRoot, "scenarios/resource-lifecycle/expected/expected-failure.json"), "utf8"),
      `${JSON.stringify(expectedResourceFailureEvidence, null, 2)}\n`,
    );

    const recoveryFailure = await fetch(`${server.origin}/resource-recovery`);
    const recoveryFailureBody = await recoveryFailure.text();
    const expectedRecovery = readFileSync(join(exampleRoot, "expected/resource-recovery.txt"), "utf8").trim().split("\n");
    assert.equal(recoveryFailure.status, 503);
    assert.equal(recoveryFailureBody.includes(`>${expectedRecovery[0]}<`), true);
    assert.equal(recoveryFailureBody.includes(`>${expectedRecovery[1]}<`), true);
    const recoverySuccess = await fetch(`${server.origin}/resource-recovery`);
    const recoverySuccessBody = await recoverySuccess.text();
    assert.equal(recoverySuccess.status, 200);
    assert.equal(recoverySuccessBody.includes(`>${expectedRecovery[2]}<`), true);
    assert.equal(recoverySuccessBody.includes(`>${expectedRecovery[3]}<`), true);
    assert.doesNotMatch(recoverySuccessBody, /PROJECT_TEMPORARILY_UNAVAILABLE/u);
    assert.equal(
      readFileSync(join(exampleRoot, "scenarios/resource-lifecycle/expected/recovery.json"), "utf8"),
      `${JSON.stringify({
        schemaVersion: 1,
        scenario: "resource-request-recovery",
        firstStatus: recoveryFailure.status,
        secondStatus: recoverySuccess.status,
        staleExpectedFailureRemoved: !recoverySuccessBody.includes("PROJECT_TEMPORARILY_UNAVAILABLE"),
        staleResourceResultRemoved: true,
        crossRequestCacheUsed: false,
      }, null, 2)}\n`,
    );

    const failure = await fetch(`${server.origin}/failure`);
    assert.equal(failure.status, 500);
    const failureBody = await failure.text();
    assert.match(failureBody, /The page could not be rendered/u);
    assert.doesNotMatch(failureBody, /private failure details/u);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const failureEvent = server.output().split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((event) => event["event"] === "framework-failure");
    assert.ok(failureEvent);
    const incidentId = /Incident ([a-f0-9-]+)/u.exec(failureBody)?.[1];
    assert.equal(failureEvent["incidentId"], incidentId);
    const normalizedFailure = {
      ...failureEvent,
      incidentId: "<incident>",
      projection: {
        ...(failureEvent["projection"] as Record<string, unknown>),
        request: { url: "<origin>/failure" },
      },
    };
    assert.equal(
      readFileSync(join(exampleRoot, "expected/failure-report.json"), "utf8"),
      `${JSON.stringify(normalizedFailure, null, 2)}\n`,
    );

    const raw = await fetch(`${server.origin}/raw`);
    assert.equal(raw.status, 200);
    assert.equal(await raw.text(), "raw:/raw");

    await verifyParsedApplication(server.origin);
  } finally {
    await server.stop();
  }
  await verifyAuthenticatedCrud(project);
  assert.equal(
    readFileSync(join(exampleRoot, "expected/accessibility-baseline.json"), "utf8"),
    `${JSON.stringify({
      schemaVersion: 1,
      scenario: "native-accessibility-baseline",
      browserEngines: Object.keys(browserTypes),
      javaScriptEnabled: false,
      checks: [
        "semantic-landmarks",
        "keyboard-link-activation",
        "label-association",
        "validation-error-association",
        "keyboard-checkbox-activation",
      ],
      deferred: ["assistive-technology-review-before-stable-release"],
    }, null, 2)}\n`,
  );
  assert.equal(
    readFileSync(join(exampleRoot, "expected/css-baseline.json"), "utf8"),
    `${JSON.stringify({
      schemaVersion: 1,
      scenario: "native-external-css",
      browserEngines: Object.keys(browserTypes),
      javaScriptEnabled: false,
      stylesheet: { route: "/styles", contentType: "text/css; charset=utf-8", cacheControl: "public, max-age=300" },
      checks: ["external-stylesheet-link", "application-class-styling", "visible-focus-outline", "reduced-motion-rule"],
      scopedCssCompiler: "deferred",
    }, null, 2)}\n`,
  );
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "fadeno-v1-running-example-"));
try {
  await verifyFailureAndRecovery(temporaryRoot);
  await verifyApplication(temporaryRoot);
  await verifyCspEnforcement();
  await verifyFailureObservation();
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("V1 running example passed (packed routes, outcomes, diagnostics, flow, recovery)");
