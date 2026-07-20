import { readFileSync } from "node:fs";
import { request as requestHttp } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "@playwright/test";

const root = process.cwd();
const outputRoot = join(root, "output/v2-form-submission");
const consumer = join(outputRoot, "consumer");
const site = join(outputRoot, "site");
const mediaType = "application/vnd.fadeno.private-update+json; version=1";
const expected = (name: string): unknown => JSON.parse(readFileSync(join(outputRoot, `expected-${name}.json`), "utf8")) as unknown;

type ApplicationState = Readonly<{
  projects: readonly string[];
  searchRequests: number;
  signInRuns: number;
  createRuns: number;
  forbiddenRuns: number;
}>;
type Application = Readonly<{
  applicationGeneration: string;
  handler(request: Request): Response | Promise<Response>;
  resetApplicationState(): void;
  setMutationDelay(milliseconds: number): void;
  readApplicationState(): ApplicationState;
}>;
type NodeModule = Readonly<{
  listenNodeHttp(options: Readonly<{
    handler: Application["handler"];
    hostname: string;
    port: number;
    canonicalOrigin: string;
    applicationGeneration: string;
  }>): Promise<Readonly<{ origin: string; close(): Promise<void> }>>;
}>;
type RequestRecord = Readonly<{
  method: string;
  path: string;
  privateUpdate: boolean;
  origin: string | null;
  cookie: string | null;
}>;
type TransportRecord = {
  method: string;
  path: string;
  accept: string | undefined;
  origin: string | undefined;
  status?: number;
  code?: string;
};

let application: Application;
let origin = "";
let backendClose: (() => Promise<void>) | undefined;
let proxy: HttpsServer | undefined;
let backendPort = 0;
let dropNextMutationResponse = false;
const requests: RequestRecord[] = [];
const transportRequests: TransportRecord[] = [];
const previousSessionKeys = process.env["FADENO_SESSION_KEYS"];

function privateMutations(): TransportRecord[] {
  return transportRequests.filter(({ method, accept }) => method === "POST" && accept === mediaType);
}

async function closeProxy(): Promise<void> {
  if (!proxy) return;
  const owner = proxy;
  proxy = undefined;
  await new Promise<void>((resolve, reject) => owner.close((error) => error ? reject(error) : resolve()));
}

test.beforeAll(async () => {
  process.env["FADENO_SESSION_KEYS"] = `form:${Buffer.alloc(32, 51).toString("base64url")}`;
  application = await import(pathToFileURL(join(consumer, "dist/application.js")).href) as Application;
  const node = await import(pathToFileURL(join(consumer, "node_modules/@fadeno/framework/dist/node.js")).href) as NodeModule;

  proxy = createHttpsServer({
    key: readFileSync(join(root, "scripts/fixtures/v1-example-tls-key.pem")),
    cert: readFileSync(join(root, "scripts/fixtures/v1-example-tls-cert.pem")),
  }, (incoming, outgoing) => {
    const transportRecord: TransportRecord = {
      method: incoming.method ?? "GET",
      path: new URL(incoming.url ?? "/", "https://example.invalid").pathname,
      accept: incoming.headers.accept,
      origin: incoming.headers.origin,
    };
    transportRequests.push(transportRecord);
    const drop = dropNextMutationResponse
      && incoming.method === "POST"
      && incoming.headers.accept === mediaType;
    if (drop) dropNextMutationResponse = false;
    const upstream = requestHttp({
      hostname: "127.0.0.1",
      port: backendPort,
      path: incoming.url,
      method: incoming.method,
      headers: incoming.headers,
    }, (upstreamResponse) => {
      if (upstreamResponse.statusCode !== undefined) transportRecord.status = upstreamResponse.statusCode;
      const code = upstreamResponse.headers["x-fadeno-update-code"];
      if (typeof code === "string") transportRecord.code = code;
      if (drop) {
        outgoing.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        outgoing.flushHeaders();
        upstreamResponse.once("data", (chunk: Buffer) => {
          upstreamResponse.resume();
          outgoing.write(chunk.subarray(0, Math.min(chunk.byteLength, 8)), () => {
            outgoing.destroy(new Error("intentional response loss"));
          });
        });
        return;
      }
      outgoing.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(outgoing);
    });
    upstream.once("error", (error) => outgoing.destroy(error));
    incoming.pipe(upstream);
  });
  await new Promise<void>((resolve, reject) => {
    proxy?.once("error", reject);
    proxy?.listen(0, "127.0.0.1", resolve);
  });
  const address = proxy.address();
  if (!address || typeof address === "string") throw new Error("FADENO_V2_FORM_PROXY_ADDRESS");
  origin = `https://127.0.0.1:${address.port}`;

  const handler: Application["handler"] = async (request) => {
    const url = new URL(request.url);
    requests.push(Object.freeze({
      method: request.method,
      path: url.pathname,
      privateUpdate: request.headers.get("accept") === mediaType,
      origin: request.headers.get("origin"),
      cookie: request.headers.get("cookie"),
    }));
    if (url.pathname.startsWith("/_fadeno/")) {
      try {
        return new Response(readFileSync(join(site, url.pathname), "utf8"), {
          headers: { "cache-control": "no-store", "content-type": "text/javascript; charset=utf-8" },
        });
      } catch {
        return new Response("not found", { status: 404 });
      }
    }
    return application.handler(request);
  };
  const backend = await node.listenNodeHttp({
    handler,
    hostname: "127.0.0.1",
    port: 0,
    canonicalOrigin: origin,
    applicationGeneration: application.applicationGeneration,
  });
  backendPort = Number(new URL(backend.origin).port);
  backendClose = backend.close;
});

test.afterAll(async () => {
  await closeProxy();
  await backendClose?.();
  if (previousSessionKeys === undefined) delete process.env["FADENO_SESSION_KEYS"];
  else process.env["FADENO_SESSION_KEYS"] = previousSessionKeys;
});

test.beforeEach(() => {
  application.resetApplicationState();
  requests.length = 0;
  transportRequests.length = 0;
  dropNextMutationResponse = false;
});

async function signIn(page: import("@playwright/test").Page): Promise<void> {
  await page.goto(`${origin}/projects`);
  await page.locator("#passcode").fill("example-owner");
  await page.locator("#sign-in-form button").click();
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  await expect.poll(async () => page.evaluate(() => Boolean(Reflect.get(globalThis, "__fadenoExampleEnhancement")))).toBe(true);
}

test("submits exact successful controls through one enhanced GET navigation", async ({ page }) => {
  await page.goto(origin);
  await page.locator("#search-form button").click();
  await expect(page.locator("h1")).toHaveText("Search result");
  const result = {
    schema: "fadeno.example.form-submission-success",
    version: 1,
    path: new URL(page.url()).pathname,
    query: await page.locator("#search-query").textContent(),
    heading: await page.locator("h1").textContent(),
    method: await page.locator("#search-method").textContent(),
    privateRequests: requests.filter(({ method, path, privateUpdate }) => method === "GET" && path === "/search" && privateUpdate).length,
    documentLoads: await page.evaluate(() => performance.getEntriesByType("navigation").length),
  };
  expect(result).toEqual(expected("success"));
  expect(new URL(page.url()).search).not.toContain("discarded");
  expect(application.readApplicationState().searchRequests).toBe(1);
});

test("renders validation, correction, revalidation, and redacted ownership evidence", async ({ page }) => {
  await signIn(page);
  const mutationsBeforeValidation = privateMutations().length;
  await page.locator("#create-form button").click();
  await expect.poll(() => privateMutations().length).toBe(mutationsBeforeValidation + 1);
  await expect.poll(() => privateMutations().at(-1)).toMatchObject({ status: 200 });
  await expect(page.getByRole("alert")).toContainText("The project was not created.");
  const failed = application.readApplicationState();
  expect({
    schema: "fadeno.example.form-submission-failure",
    version: 1,
    code: "PROJECT_TITLE_SHORT",
    formError: await page.getByRole("alert").textContent(),
    fieldError: await page.locator('[id^="fadeno-error-"]').textContent(),
    preservedTitle: await page.locator("#title").inputValue(),
    actionRuns: failed.createRuns,
    projectCount: failed.projects.length,
  }).toEqual(expected("failure"));
  expect(readFileSync(join(outputRoot, "expected-failure-human.txt"), "utf8")).toContain("marked the exact field");

  await page.locator("#title").fill("Thread Lab");
  await page.locator("#create-form button").click();
  await expect(page.locator("#projects li")).toHaveText("Thread Lab");
  const corrected = application.readApplicationState();
  expect({
    schema: "fadeno.example.form-submission-correction",
    version: 1,
    before: "ab",
    after: "Thread Lab",
    fieldErrorCleared: await page.locator('[id^="fadeno-error-"]').count() === 0,
    projectVisible: await page.locator("#projects li").filter({ hasText: "Thread Lab" }).count() === 1,
    actionRuns: corrected.createRuns,
    projectCount: corrected.projects.length,
  }).toEqual(expected("correction"));

  const flow = await page.evaluate(async () => {
    const modulePath: string = "/_fadeno/framework/internal/browser-navigation.js";
    const runtime = await import(modulePath) as Readonly<{ readPrivateFormSubmissionFlows(): readonly Record<string, unknown>[] }>;
    return runtime.readPrivateFormSubmissionFlows().at(-1);
  });
  expect({
    schema: flow?.["schema"],
    version: flow?.["version"],
    status: flow?.["status"],
    code: flow?.["code"],
    operation: flow?.["operation"],
    redaction: flow?.["redaction"],
    outcome: flow?.["outcome"],
    browserOwns: (flow?.["ownership"] as { browser?: unknown } | undefined)?.browser,
    serverOwns: (flow?.["ownership"] as { server?: unknown } | undefined)?.server,
    mutationRetrySkipped: Array.isArray(flow?.["skipped"]) && flow["skipped"].includes("mutation retry"),
    secretAbsent: !JSON.stringify(flow).includes("secret-form-canary"),
  }).toEqual(expected("flow"));
});

test("keeps one pending mutation, suppresses a duplicate, and clears pending state", async ({ page }) => {
  await signIn(page);
  const mutationsBeforePending = privateMutations().length;
  application.setMutationDelay(300);
  await page.locator("#title").fill("Pending project");
  await page.locator("#create-form button").click();
  await expect(page.locator("#create-form")).toHaveAttribute("aria-busy", "true");
  await page.locator("#create-form button").click();
  await expect(page.locator("#projects li")).toHaveText("Pending project");
  await expect(page.locator("#create-form")).not.toHaveAttribute("aria-busy", "true");
  expect(privateMutations().length - mutationsBeforePending).toBe(1);
  expect(application.readApplicationState().createRuns).toBe(1);
});

test("reloads current truth after uncertain delivery without repeating the mutation", async ({ page }) => {
  await signIn(page);
  await page.locator("#title").fill("Recovered once");
  const mutationsBefore = privateMutations().length;
  dropNextMutationResponse = true;
  await page.locator("#create-form button").click();
  await expect(page.locator("#projects li")).toHaveText("Recovered once");
  const state = application.readApplicationState();
  const recoveredThroughGet = transportRequests.some(({ method, path, accept }) => method === "GET"
    && path === "/projects"
    && accept !== mediaType);
  expect({
    schema: "fadeno.example.form-submission-recovery",
    version: 1,
    mutationRequests: privateMutations().length - mutationsBefore,
    actionRuns: state.createRuns,
    projectVisibleAfterReload: await page.locator("#projects li").filter({ hasText: "Recovered once" }).count() === 1,
    pendingCleared: await page.locator("#create-form").getAttribute("aria-busy") !== "true",
    mutationRetried: privateMutations().length - mutationsBefore > 1,
    outcome: recoveredThroughGet ? "current-truth-reload" : "none",
  }).toEqual(expected("recovery"));
});

test("refuses invalid origin, forbidden authorization, and unsupported enhancement boundaries", async ({ page }) => {
  await page.goto(`${origin}/projects`);
  const action = await page.locator("#sign-in-form").getAttribute("action");
  const epoch = await page.locator('meta[name="fadeno-document-epoch"]').getAttribute("content");
  if (!action || !epoch) throw new Error("FADENO_V2_FORM_SECURITY_FIXTURE");
  const response = await page.request.post(new URL(action, origin).href, {
    headers: {
      accept: mediaType,
      origin: "https://outside.invalid",
      "x-fadeno-current-url": `${origin}/projects`,
      "x-fadeno-document-epoch": epoch,
      "x-fadeno-operation-id": "action:security-check",
      "x-fadeno-operation-sequence": "1",
    },
  });
  const originRefusalCode = response.headers()["x-fadeno-update-code"];

  const forbiddenReload = page.waitForEvent("load");
  await page.locator("#forbidden-form button").click();
  await expect.poll(() => privateMutations().length).toBeGreaterThanOrEqual(2);
  await forbiddenReload;
  await expect(page.locator("h1")).toHaveText("Protected forms");
  const forbiddenActionRuns = application.readApplicationState().forbiddenRuns;

  requests.length = 0;
  await page.goto(origin);
  await page.locator("#search-form").evaluate((form) => {
    form.setAttribute("method", "post");
    form.setAttribute("enctype", "text/plain");
    form.setAttribute("action", "/ordinary");
  });
  await page.locator("#search-form button").click();
  await page.waitForLoadState();
  const unsupportedFormPrivateRequests = requests.filter(({ privateUpdate }) => privateUpdate).length;

  requests.length = 0;
  transportRequests.length = 0;
  await page.goto(origin);
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.defaultValue = "before";
    input.value = "after";
    document.body.append(input);
  });
  await page.locator("#search-form button").click();
  await expect(page.locator("h1")).toHaveText("Search result");
  const preservationPrivateRequests = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/search"
    && accept === mediaType).length;

  expect({
    schema: "fadeno.example.form-submission-security",
    version: 1,
    originRefusalCode,
    originRefusalStatus: response.status(),
    forbiddenActionRuns,
    unsupportedFormPrivateRequests,
    preservationPrivateRequests,
    crossUserActionRuns: 0,
    oversizedActionRuns: 0,
    secretAbsent: true,
  }).toEqual(expected("security"));
});

test("rejects cross-user proof reuse and oversized fields before action execution", async ({ page, browser }) => {
  await signIn(page);
  const form = await page.locator("#create-form").evaluate((element) => {
    const owner = element as HTMLFormElement;
    const proof = owner.querySelector<HTMLInputElement>('input[name="__fadeno_proof"]');
    const title = owner.querySelector<HTMLInputElement>("#title");
    const submitter = owner.querySelector<HTMLButtonElement>('button[type="submit"]');
    const epoch = document.querySelector<HTMLMetaElement>('meta[name="fadeno-document-epoch"]');
    return {
      action: owner.action,
      proof: proof?.value,
      titleName: title?.name,
      intentName: submitter?.name,
      epoch: epoch?.content,
    };
  });
  if (!form.proof || !form.titleName || !form.intentName || !form.epoch) {
    throw new Error("FADENO_V2_FORM_PROTECTED_FIXTURE");
  }
  const headers = (operation: string): Record<string, string> => ({
    accept: mediaType,
    origin,
    "x-fadeno-current-url": `${origin}/projects`,
    "x-fadeno-document-epoch": form.epoch ?? "",
    "x-fadeno-operation-id": operation,
    "x-fadeno-operation-sequence": "1",
  });
  const body = (title: string): Record<string, string> => ({
    __fadeno_proof: form.proof ?? "",
    [form.titleName ?? ""]: title,
    [form.intentName ?? ""]: "create",
  });

  const foreign = await browser.newContext({ ignoreHTTPSErrors: true });
  const foreignResponse = await foreign.request.post(form.action, {
    form: body("Foreign project"),
    headers: headers("action:foreign-session"),
  });
  const foreignText = await foreignResponse.text();
  await foreign.close();
  expect(foreignResponse.ok()).toBe(false);
  const crossUserActionRuns = application.readApplicationState().createRuns;

  const oversizedResponse = await page.request.post(form.action, {
    form: body("x".repeat(129)),
    headers: headers("action:oversized-field"),
  });
  const oversizedText = await oversizedResponse.text();
  expect(oversizedResponse.ok()).toBe(false);
  const oversizedActionRuns = application.readApplicationState().createRuns;
  expect({
    schema: "fadeno.example.form-submission-security",
    version: 1,
    originRefusalCode: "FADENO_UPDATE_REQUEST_ORIGIN",
    originRefusalStatus: 403,
    forbiddenActionRuns: 0,
    unsupportedFormPrivateRequests: 0,
    preservationPrivateRequests: 0,
    crossUserActionRuns,
    oversizedActionRuns,
    secretAbsent: !`${foreignText}${oversizedText}`.includes(form.proof),
  }).toEqual(expected("security"));
});

test("tears down a pending mutation through one current-truth recovery", async ({ page }) => {
  await signIn(page);
  application.setMutationDelay(300);
  await page.locator("#title").fill("Cancelled project");
  const mutationsBefore = privateMutations().length;
  const requestsBefore = transportRequests.length;
  await page.locator("#create-form button").click();
  await expect(page.locator("#create-form")).toHaveAttribute("aria-busy", "true");
  const reloaded = page.waitForEvent("load");
  await page.evaluate(() => {
    const runtime = Reflect.get(globalThis, "__fadenoExampleEnhancement") as { close(): void };
    runtime.close();
  });
  await reloaded;
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  await expect.poll(async () => page.evaluate(() => Boolean(Reflect.get(globalThis, "__fadenoExampleEnhancement")))).toBe(true);
  const after = application.readApplicationState();
  const laterRequests = transportRequests.slice(requestsBefore);
  expect({
    schema: "fadeno.example.form-submission-teardown",
    version: 1,
    mutationRequests: privateMutations().length - mutationsBefore,
    actionRuns: after.createRuns,
    projectAbsent: !after.projects.includes("Cancelled project"),
    reloadedCurrentTruth: laterRequests.some(({ method, path, accept }) => method === "GET"
      && path === "/projects"
      && accept !== mediaType),
    replacementRuntimeActive: await page.evaluate(() => Boolean(Reflect.get(globalThis, "__fadenoExampleEnhancement"))),
  }).toEqual(expected("teardown"));
});

test.describe("native fallback", () => {
  test.use({ javaScriptEnabled: false });

  test("keeps GET controls and protected actions usable without JavaScript", async ({ page }) => {
    await page.goto(origin);
    await page.locator("#search-form button").click();
    await expect(page.locator("h1")).toHaveText("Search result");
    expect(new URL(page.url()).search).toBe("?q=thread&flag=on&tag=alpha&tag=beta&choice=exact&submitter=search");
    expect(requests.some(({ method, path, privateUpdate }) => method === "GET" && path === "/search" && !privateUpdate)).toBe(true);

    await page.goto(`${origin}/projects`);
    await page.locator("#passcode").fill("example-owner");
    await page.locator("#sign-in-form button").click();
    await expect(page.locator("#viewer")).toHaveText("Signed in owner");
    expect(application.readApplicationState().signInRuns).toBe(1);
  });
});
