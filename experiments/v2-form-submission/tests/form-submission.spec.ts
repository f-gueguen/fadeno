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
  redirectAwayRuns: number;
  fragmentRedirectRuns: number;
  fragmentChainRuns: number;
  redirectChainRuns: number;
  uploadRedirectRuns: number;
  createRuns: number;
  updateRuns: number;
  deleteRuns: number;
  forbiddenRuns: number;
  projectPageRenders: number;
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
  currentTruth: string | undefined;
  status?: number;
  code?: string;
};

let application: Application;
let origin = "";
let backendClose: (() => Promise<void>) | undefined;
let proxy: HttpsServer | undefined;
let backendPort = 0;
let dropNextMutationResponse = false;
let dropNextPrivateGetResponse = false;
let holdNextPrivateGetResponse = false;
let holdNextPrivateGetPath: string | undefined;
let holdNextMutationResponse = false;
let releaseHeldResponse: (() => void) | undefined;
let delayedPrivateGetPath: string | undefined;
let delayedPrivateGetMilliseconds = 0;
let capturedRedirectGetResultId: string | undefined;
let rewriteNextPrivateGetResultId = false;
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
      currentTruth: typeof incoming.headers["x-fadeno-current-url"] === "string"
        ? incoming.headers["x-fadeno-current-url"]
        : undefined,
    };
    transportRequests.push(transportRecord);
    const dropMutation = dropNextMutationResponse
      && incoming.method === "POST"
      && incoming.headers.accept === mediaType;
    if (dropMutation) dropNextMutationResponse = false;
    const dropPrivateGet = dropNextPrivateGetResponse
      && incoming.method === "GET"
      && incoming.headers.accept === mediaType;
    if (dropPrivateGet) dropNextPrivateGetResponse = false;
    const drop = dropMutation || dropPrivateGet;
    const holdPrivateGet = holdNextPrivateGetResponse
      && incoming.method === "GET"
      && incoming.headers.accept === mediaType
      && transportRecord.path === (holdNextPrivateGetPath ?? "/projects");
    if (holdPrivateGet) {
      holdNextPrivateGetResponse = false;
      holdNextPrivateGetPath = undefined;
    }
    const holdMutation = holdNextMutationResponse
      && incoming.method === "POST"
      && incoming.headers.accept === mediaType;
    if (holdMutation) holdNextMutationResponse = false;
    const delay = incoming.method === "GET"
      && incoming.headers.accept === mediaType
      && transportRecord.path === delayedPrivateGetPath;
    const delayMilliseconds = delayedPrivateGetMilliseconds;
    if (delay) delayedPrivateGetPath = undefined;
    const captureRedirectResult = incoming.method === "GET"
      && incoming.headers.accept === mediaType
      && transportRecord.path === "/redirect-chain";
    const rewriteResult = rewriteNextPrivateGetResultId
      && incoming.method === "GET"
      && incoming.headers.accept === mediaType
      && transportRecord.path === "/projects";
    if (rewriteResult) rewriteNextPrivateGetResultId = false;
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
      if (holdPrivateGet || holdMutation) {
        const chunks: Buffer[] = [];
        upstreamResponse.on("data", (chunk: Buffer) => chunks.push(chunk));
        upstreamResponse.once("end", () => {
          releaseHeldResponse = () => {
            releaseHeldResponse = undefined;
            if (outgoing.destroyed) return;
            outgoing.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
            outgoing.end(Buffer.concat(chunks));
          };
        });
        return;
      }
      if (delay) {
        const chunks: Buffer[] = [];
        upstreamResponse.on("data", (chunk: Buffer) => chunks.push(chunk));
        upstreamResponse.once("end", () => {
          setTimeout(() => {
            if (outgoing.destroyed) return;
            outgoing.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
            outgoing.end(Buffer.concat(chunks));
          }, delayMilliseconds);
        });
        return;
      }
      if (captureRedirectResult || rewriteResult) {
        const chunks: Buffer[] = [];
        upstreamResponse.on("data", (chunk: Buffer) => chunks.push(chunk));
        upstreamResponse.once("end", () => {
          try {
            const decoded = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
            if (captureRedirectResult) {
              const resultId = decoded["resultId"];
              if (typeof resultId !== "string" || resultId.length === 0) throw new TypeError("FADENO_V2_REDIRECT_RESULT_CAPTURE");
              capturedRedirectGetResultId = resultId;
            }
            if (rewriteResult) {
              if (!capturedRedirectGetResultId) throw new Error("FADENO_V2_REDIRECT_RESULT_CAPTURE");
              decoded["resultId"] = capturedRedirectGetResultId;
            }
            const body = Buffer.from(JSON.stringify(decoded));
            outgoing.writeHead(upstreamResponse.statusCode ?? 502, {
              ...upstreamResponse.headers,
              "content-length": String(body.byteLength),
            });
            outgoing.end(body);
          } catch {
            outgoing.writeHead(502, {
              "cache-control": "no-store",
              "content-type": "text/plain; charset=utf-8",
            });
            outgoing.end("FADENO_V2_PROXY_TRANSFORM");
          }
        });
        return;
      }
      outgoing.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(outgoing);
    });
    outgoing.once("close", () => {
      if (!upstream.destroyed) upstream.destroy();
    });
    incoming.once("aborted", () => {
      if (!upstream.destroyed) upstream.destroy();
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
  dropNextPrivateGetResponse = false;
  holdNextPrivateGetResponse = false;
  holdNextPrivateGetPath = undefined;
  holdNextMutationResponse = false;
  releaseHeldResponse = undefined;
  delayedPrivateGetPath = undefined;
  delayedPrivateGetMilliseconds = 0;
  capturedRedirectGetResultId = undefined;
  rewriteNextPrivateGetResultId = false;
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
  await expect(page.locator(".project-title")).toHaveText("Thread Lab");
  const corrected = application.readApplicationState();
  expect({
    schema: "fadeno.example.form-submission-correction",
    version: 1,
    before: "ab",
    after: "Thread Lab",
    fieldErrorCleared: await page.locator('[id^="fadeno-error-"]').count() === 0,
    projectVisible: await page.locator(".project-title").filter({ hasText: "Thread Lab" }).count() === 1,
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
  expect(new URL(page.url()).pathname).toBe("/projects");
  await page.reload();
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  await expect(page.locator(".project-title")).toHaveText("Thread Lab");
});

test("completes authenticated create, read, update, and delete with exact revalidation", async ({ page }) => {
  await signIn(page);
  await page.locator("#title").fill("Thread Lab");
  await page.locator("#create-form button").click();
  await expect(page.locator(".project-title")).toHaveText("Thread Lab");

  await page.locator("#update-title").fill("Ordered Thread");
  await page.locator("#update-form button").click();
  await expect(page.locator(".project-title")).toHaveText("Ordered Thread");
  await expect(page.getByText("Thread Lab", { exact: true })).toHaveCount(0);

  await page.locator("#delete-form button").click();
  await expect(page.locator(".project-title")).toHaveCount(0);
  const state = application.readApplicationState();
  expect({
    schema: "fadeno.example.action-ordering-crud",
    version: 1,
    mutationRequests: privateMutations().length,
    redirectGetRequests: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/projects"
      && accept === mediaType).length,
    documentLoads: await page.evaluate(() => performance.getEntriesByType("navigation").length),
    projects: state.projects,
    signInRuns: state.signInRuns,
    createRuns: state.createRuns,
    updateRuns: state.updateRuns,
    deleteRuns: state.deleteRuns,
    projectPageRenders: state.projectPageRenders,
    staleTitlesAbsent: await page.getByText(/Thread/u).count() === 0,
  }).toEqual(expected("crud"));
});

test("refuses duplicate project identities before delete ownership becomes ambiguous", async ({ page }) => {
  await signIn(page);
  await page.locator("#title").fill("Thread Lab");
  await page.locator("#create-form button").click();
  await expect(page.locator(".project-title")).toHaveText("Thread Lab");

  await page.locator("#title").fill("Thread Lab");
  await page.locator("#create-form button").click();
  await expect(page.getByRole("alert")).toContainText("that title already exists");
  await expect(page.locator(".project-title")).toHaveText("Thread Lab");

  await page.locator("#title").fill("Other Thread");
  await page.locator("#create-form button").click();
  await expect(page.locator(".project-title")).toHaveText(["Thread Lab", "Other Thread"]);
  await page.locator("#update-title").fill("Other Thread");
  await page.locator("#update-form button").first().click();
  await expect(page.getByRole("alert")).toContainText("that title already exists");
  await expect(page.locator(".project-title")).toHaveText(["Thread Lab", "Other Thread"]);

  await page.locator("#delete-form button").first().click();
  await expect(page.locator(".project-title")).toHaveText(["Other Thread"]);
  const state = application.readApplicationState();
  expect({
    schema: "fadeno.example.action-ordering-duplicate-refusal",
    version: 1,
    projects: state.projects,
    mutationRequests: privateMutations().length,
    createRuns: state.createRuns,
    updateRuns: state.updateRuns,
    deleteRuns: state.deleteRuns,
    projectPageRenders: state.projectPageRenders,
    oneLogicalOwnerDeleted: state.projects.length === 1 && state.projects[0] === "Other Thread",
  }).toEqual(expected("duplicate"));
  expect(readFileSync(join(outputRoot, "expected-duplicate-human.txt"), "utf8")).toContain("kept project identity unambiguous");
});

test("serializes concurrent duplicate project creation at the mutation point", async ({ page }) => {
  await signIn(page);
  const secondPage = await page.context().newPage();
  await secondPage.goto(`${origin}/projects`);
  application.setMutationDelay(300);
  const mutationsBefore = privateMutations().length;
  await Promise.all([
    page.locator("#title").fill("Concurrent Thread"),
    secondPage.locator("#title").fill("Concurrent Thread"),
  ]);
  await Promise.all([
    page.locator("#create-form button").click(),
    secondPage.locator("#create-form button").click(),
  ]);
  await expect.poll(() => application.readApplicationState().projects).toEqual(["Concurrent Thread"]);
  await expect.poll(async () => await page.getByRole("alert").count()
    + await secondPage.getByRole("alert").count()).toBe(1);
  const state = application.readApplicationState();
  const duplicateRefusals = await page.getByRole("alert").count() + await secondPage.getByRole("alert").count();
  const visibleProjectDocuments = Number(await page.locator(".project-title").allTextContents().then((titles) =>
    titles.includes("Concurrent Thread")))
    + Number(await secondPage.locator(".project-title").allTextContents().then((titles) =>
      titles.includes("Concurrent Thread")));
  expect({
    schema: "fadeno.example.action-ordering-concurrent-identity",
    version: 1,
    projects: state.projects,
    mutationRequests: privateMutations().length - mutationsBefore,
    createRuns: state.createRuns,
    duplicateRefusals,
    visibleProjectDocuments,
    oneLogicalOwnerCreated: state.projects.length === 1 && state.projects[0] === "Concurrent Thread",
  }).toEqual(expected("concurrency"));
  expect(readFileSync(join(outputRoot, "expected-concurrency-human.txt"), "utf8")).toContain("one logical project owner");
  await secondPage.close();
});

test("suppresses a delayed redirect result after newer enhanced navigation wins", async ({ page }) => {
  await page.goto(`${origin}/projects`);
  await page.locator("#passcode").fill("example-owner");
  delayedPrivateGetPath = "/projects";
  delayedPrivateGetMilliseconds = 400;
  const mutationsBefore = privateMutations().length;
  await page.locator("#sign-in-form button").click();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects"
    && accept === mediaType).length).toBe(1);

  const redirectFlows = await page.evaluate(async () => {
    const modulePath: string = "/_fadeno/framework/internal/browser-navigation.js";
    const runtime = await import(modulePath) as Readonly<{ readPrivateFormSubmissionFlows(): readonly Record<string, unknown>[] }>;
    return runtime.readPrivateFormSubmissionFlows();
  });

  await page.locator("#sign-in-form").evaluate((form: HTMLFormElement) => form.reset());
  await page.getByRole("link", { name: "Search" }).click();
  await expect(page.locator("h1")).toHaveText("GET form navigation");
  await page.waitForTimeout(500);
  await expect(page.locator("h1")).toHaveText("GET form navigation");
  const state = application.readApplicationState();
  expect({
    schema: "fadeno.example.action-ordering-supersession",
    version: 1,
    mutationRequests: privateMutations().length - mutationsBefore,
    delayedRedirectGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/projects"
      && accept === mediaType).length,
    supersedingGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/"
      && accept === mediaType).length,
    supersedingNativeGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/"
      && accept !== mediaType).length,
    actionRuns: state.signInRuns,
    finalPath: new URL(page.url()).pathname,
    finalHeading: await page.locator("h1").textContent(),
    staleRedirectAbsent: await page.locator("#viewer").count() === 0,
    documentLoads: await page.evaluate(() => performance.getEntriesByType("navigation").length),
    redirectHandoffRecorded: redirectFlows.some((flow) => flow["operation"] === "mutation"
      && flow["outcome"] === "enhanced-redirect"),
    mutationRetrySkipped: redirectFlows.some((flow) => Array.isArray(flow["skipped"])
      && flow["skipped"].includes("mutation retry")),
  }).toEqual(expected("ordering"));
  expect(readFileSync(join(outputRoot, "expected-ordering-human.txt"), "utf8")).toContain("newer navigation remained visible");
});

test("refuses form edits made after redirect handoff, including control-attribute, inherited-disabled, option-identity, and optgroup-hierarchy changes", async ({ page }) => {
  const projectGets = (privateUpdate: boolean): number => transportRequests.filter(({ method, path, accept }) =>
    method === "GET" && path === "/projects" && (accept === mediaType) === privateUpdate).length;
  await page.goto(`${origin}/projects`);
  await page.locator("#passcode").fill("example-owner");
  await page.locator("#sign-in-form").evaluate((form) => {
    const fieldset = document.createElement("fieldset");
    fieldset.id = "handoff-fieldset";
    const select = document.createElement("select");
    select.id = "handoff-structure";
    const group = document.createElement("optgroup");
    group.id = "handoff-optgroup";
    const option = document.createElement("option");
    option.value = "stable";
    option.text = "Stable";
    option.selected = true;
    group.append(option);
    select.append(group);
    fieldset.append(select);
    const hierarchySelect = document.createElement("select");
    hierarchySelect.id = "handoff-hierarchy";
    const firstGroup = document.createElement("optgroup");
    firstGroup.id = "handoff-hierarchy-first";
    const secondGroup = document.createElement("optgroup");
    secondGroup.id = "handoff-hierarchy-second";
    const hierarchyOption = document.createElement("option");
    hierarchyOption.id = "handoff-hierarchy-option";
    hierarchyOption.value = "same";
    hierarchyOption.text = "Same";
    hierarchyOption.selected = true;
    firstGroup.append(hierarchyOption);
    hierarchySelect.append(firstGroup, secondGroup);
    form.append(fieldset, hierarchySelect);
  });
  delayedPrivateGetPath = "/projects";
  delayedPrivateGetMilliseconds = 400;
  const mutationsBefore = privateMutations().length;
  const privateGetsBefore = projectGets(true);
  const nativeGetsBefore = projectGets(false);
  await page.locator("#sign-in-form button").click();
  await expect.poll(() => projectGets(true)).toBe(privateGetsBefore + 1);
  await page.locator("#passcode").fill("edited-after-handoff");
  await page.locator("#passcode").evaluate((input) => {
    input.setAttribute("name", "changed-after-handoff");
    input.setAttribute("type", "text");
  });
  await page.locator("#handoff-fieldset").evaluate((fieldset: HTMLFieldSetElement) => { fieldset.disabled = true; });
  await page.locator("#handoff-optgroup").evaluate((group: HTMLOptGroupElement) => { group.disabled = true; });
  await page.locator("#handoff-structure option").evaluate((option) => option.replaceWith(option.cloneNode(true)));
  await page.locator("#handoff-hierarchy-option").evaluate((option) => {
    document.querySelector("#handoff-hierarchy-second")?.append(option);
  });
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const controlAttributesRecovered = await page.locator("#viewer").textContent() === "Signed in owner";
  const optionIdentityRecovered = controlAttributesRecovered;
  const inheritedDisabledRecovered = controlAttributesRecovered;
  const optgroupHierarchyRecovered = controlAttributesRecovered;
  const state = application.readApplicationState();
  expect({
    schema: "fadeno.example.action-ordering-handoff-edit-recovery",
    version: 1,
    mutationRequests: privateMutations().length - mutationsBefore,
    privateRedirectGets: projectGets(true) - privateGetsBefore,
    nativeCurrentTruthGets: projectGets(false) - nativeGetsBefore,
    signInRuns: state.signInRuns,
    submittedDocumentNotPublishedOverNewerEdit: await page.locator("#passcode").count() === 0,
    controlAttributesRecovered,
    optionIdentityRecovered,
    inheritedDisabledRecovered,
    optgroupHierarchyRecovered,
    currentTruthVisible: await page.locator("#viewer").textContent() === "Signed in owner",
  }).toEqual(expected("handoff-edit-recovery"));
  expect(readFileSync(join(outputRoot, "expected-handoff-edit-recovery-human.txt"), "utf8"))
    .toContain("post-handoff edit refused private publication");
});

test("inherits committed-mutation recovery when a newer GET supersedes the redirect", async ({ page }) => {
  await page.goto(`${origin}/projects`);
  await page.locator("#passcode").fill("example-owner");
  delayedPrivateGetPath = "/projects";
  delayedPrivateGetMilliseconds = 400;
  const mutationsBefore = privateMutations().length;
  const recoveryGetsBefore = transportRequests.filter(({ method, path }) => method === "GET" && path === "/projects").length;
  await page.locator("#sign-in-form button").click();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept === mediaType).length).toBe(1);
  dropNextPrivateGetResponse = true;
  await page.locator("#sign-in-form").evaluate((form: HTMLFormElement) => form.reset());
  await page.evaluate(() => globalThis.addEventListener("beforeunload", (event) => {
    event.preventDefault();
    event.returnValue = "keep committed current truth";
  }, { once: true }));
  const cancelledDeparture = page.waitForEvent("dialog");
  await page.getByRole("link", { name: "Search" }).click({ noWaitAfter: true });
  await (await cancelledDeparture).dismiss();
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const state = application.readApplicationState();
  expect({
    schema: "fadeno.example.action-ordering-supersession-recovery",
    version: 1,
    mutationRequests: privateMutations().length - mutationsBefore,
    supersedingPrivateGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/" && accept === mediaType).length,
    currentTruthGets: transportRequests.filter(({ method, path }) => method === "GET"
      && path === "/projects").length - recoveryGetsBefore,
    signInRuns: state.signInRuns,
    finalPath: new URL(page.url()).pathname,
    currentTruthVisible: await page.locator("#viewer").textContent() === "Signed in owner",
    mutationRetried: privateMutations().length - mutationsBefore > 1,
  }).toEqual(expected("supersession-recovery"));
  expect(readFileSync(join(outputRoot, "expected-supersession-recovery-human.txt"), "utf8"))
    .toContain("superseding GET retained mutation recovery ownership");
});

test("retains committed-mutation recovery when native activation supersedes the redirect", async ({ page }) => {
  await page.goto(`${origin}/projects`);
  await page.locator("#passcode").fill("example-owner");
  delayedPrivateGetPath = "/projects";
  delayedPrivateGetMilliseconds = 400;
  const mutationsBefore = privateMutations().length;
  const privateTruthBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept === mediaType).length;
  const nativeTruthBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length;
  await page.locator("#sign-in-form button").click();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept === mediaType).length).toBe(privateTruthBefore + 1);
  await page.evaluate(() => globalThis.addEventListener("beforeunload", (event) => {
    event.preventDefault();
    event.returnValue = "keep committed current truth";
  }, { once: true }));
  await page.locator("#redirect-away-passcode").fill("changed-after-handoff");
  const cancelledDeparture = page.waitForEvent("dialog");
  const activation = page.getByRole("link", { name: "Search" }).click({ noWaitAfter: true });
  await (await cancelledDeparture).dismiss();
  await activation;
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length).toBe(nativeTruthBefore + 1);
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const state = application.readApplicationState();
  expect({
    schema: "fadeno.example.action-ordering-native-supersession-recovery",
    version: 1,
    mutationRequests: privateMutations().length - mutationsBefore,
    privateRedirectGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/projects" && accept === mediaType).length - privateTruthBefore,
    nativeCurrentTruthGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/projects" && accept !== mediaType).length - nativeTruthBefore,
    nativeSupersedingGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/" && accept !== mediaType).length,
    signInRuns: state.signInRuns,
    finalPath: new URL(page.url()).pathname,
    currentTruthVisible: await page.locator("#viewer").textContent() === "Signed in owner",
    mutationRetried: privateMutations().length - mutationsBefore > 1,
  }).toEqual(expected("native-supersession-recovery"));
  expect(readFileSync(join(outputRoot, "expected-native-supersession-recovery-human.txt"), "utf8"))
    .toContain("native supersession retained mutation recovery ownership");
});

test("recovers committed truth when native activation has no document departure", async ({ page }) => {
  const projectGets = (privateUpdate: boolean): number => transportRequests.filter(({ method, path, accept }) =>
    method === "GET" && path === "/projects" && (accept === mediaType) === privateUpdate).length;
  await page.addInitScript(() => document.addEventListener("click", (event) => {
    if (sessionStorage.getItem("fadeno-stop-search-propagation") === "1"
      && event.target instanceof Element
      && event.target.closest("a")?.textContent === "Search") {
      event.stopPropagation();
    }
  }));
  const mutationsBefore = privateMutations().length;

  await page.goto(`${origin}/projects`);
  await page.locator("#passcode").fill("example-owner");
  holdNextPrivateGetResponse = true;
  const firstPrivateBefore = projectGets(true);
  const firstNativeBefore = projectGets(false);
  await page.locator("#sign-in-form button").click();
  await expect.poll(() => projectGets(true)).toBe(firstPrivateBefore + 1);
  await page.getByRole("link", { name: "Search" }).evaluate((link) => link.setAttribute("href", "/projects#native-recovery"));
  await page.getByRole("link", { name: "Search" }).click({ noWaitAfter: true });
  await expect.poll(() => projectGets(false)).toBe(firstNativeBefore + 1);
  await expect.poll(() => new URL(page.url()).hash).toBe("#native-recovery");
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const sameDocumentFragment = {
    privateRedirectGets: projectGets(true) - firstPrivateBefore,
    nativeCurrentTruthGets: projectGets(false) - firstNativeBefore,
    finalHash: new URL(page.url()).hash,
    freshCurrentTruthVisible: await page.locator("#viewer").textContent() === "Signed in owner",
  };

  await page.context().clearCookies();
  await page.goto(`${origin}/projects`);
  await page.locator("#passcode").fill("example-owner");
  holdNextPrivateGetResponse = true;
  const stoppedPrivateBefore = projectGets(true);
  const stoppedNativeBefore = projectGets(false);
  const stoppedGetsBefore = stoppedPrivateBefore + stoppedNativeBefore;
  const stoppedHistoryBefore = await page.evaluate(() => history.length);
  await page.locator("#sign-in-form button").click();
  await expect.poll(() => projectGets(true)).toBe(stoppedPrivateBefore + 1);
  await expect.poll(() => Boolean(releaseHeldResponse)).toBe(true);
  await page.getByRole("link", { name: "Search" }).evaluate((link) => link.setAttribute("href", "/projects#propagation-stopped"));
  await page.evaluate(() => sessionStorage.setItem("fadeno-stop-search-propagation", "1"));
  await page.evaluate(() => document.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a")?.textContent === "Search") {
      event.preventDefault();
    }
  }, { once: true }));
  await page.getByRole("link", { name: "Search" }).click({ noWaitAfter: true });
  releaseHeldResponse?.();
  await expect.poll(() => projectGets(true) + projectGets(false)).toBe(stoppedGetsBefore + 2);
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const stoppedPropagationRecovery = {
    redirectAndRecoveryGets: projectGets(true) + projectGets(false) - stoppedGetsBefore,
    historyEntries: await page.evaluate(() => history.length) - stoppedHistoryBefore,
    finalHash: new URL(page.url()).hash,
    freshCurrentTruthVisible: await page.locator("#viewer").textContent() === "Signed in owner",
  };

  await page.context().clearCookies();
  await page.goto(`${origin}/projects`);
  await page.locator("#passcode").fill("example-owner");
  holdNextPrivateGetResponse = true;
  const secondPrivateBefore = projectGets(true);
  const secondNativeBefore = projectGets(false);
  await page.locator("#sign-in-form button").click();
  await expect.poll(() => projectGets(true)).toBe(secondPrivateBefore + 1);
  await page.evaluate(() => document.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a")?.textContent === "Search") event.preventDefault();
  }, { once: true }));
  await page.getByRole("link", { name: "Search" }).click({ noWaitAfter: true });
  await expect.poll(() => projectGets(true) + projectGets(false))
    .toBe(secondPrivateBefore + secondNativeBefore + 2);
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const preventedActivation = {
    redirectAndRecoveryGets: projectGets(true) + projectGets(false) - secondPrivateBefore - secondNativeBefore,
    finalPath: new URL(page.url()).pathname,
    freshCurrentTruthVisible: await page.locator("#viewer").textContent() === "Signed in owner",
  };

  await page.context().clearCookies();
  await page.goto(`${origin}/projects`);
  await page.locator("#passcode").fill("example-owner");
  holdNextPrivateGetResponse = true;
  const policyPrivateBefore = projectGets(true);
  const policyNativeBefore = projectGets(false);
  await page.locator("#sign-in-form button").click();
  await expect.poll(() => projectGets(true)).toBe(policyPrivateBefore + 1);
  await expect.poll(() => Boolean(releaseHeldResponse)).toBe(true);
  await page.getByRole("link", { name: "Search" }).evaluate((link) => {
    link.setAttribute("href", "/projects#policy-protected");
    link.setAttribute("rel", "noreferrer");
  });
  await page.getByRole("link", { name: "Search" }).click({ noWaitAfter: true });
  await expect.poll(() => new URL(page.url()).hash).toBe("#policy-protected");
  releaseHeldResponse?.();
  await page.waitForTimeout(100);
  const policyProtectedFragment = {
    forcedNativeGets: projectGets(false) - policyNativeBefore,
    nativeFragmentSelected: new URL(page.url()).hash === "#policy-protected",
  };
  await page.goto(`${origin}/projects`);
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const crossDocumentProjectBefore = projectGets(true) + projectGets(false);
  const crossDocumentRootBefore = transportRequests.filter(({ method, path }) => method === "GET" && path === "/").length;
  const crossDocumentChainBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/redirect-chain" && accept === mediaType).length;
  holdNextPrivateGetResponse = true;
  holdNextPrivateGetPath = "/redirect-chain";
  await page.locator("#redirect-chain-form button").click();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/redirect-chain" && accept === mediaType).length).toBe(crossDocumentChainBefore + 1);
  await expect.poll(() => Boolean(releaseHeldResponse)).toBe(true);
  await page.getByRole("link", { name: "Search" }).evaluate((link) => {
    link.setAttribute("href", "/");
    link.setAttribute("rel", "noreferrer");
  });
  await page.evaluate(() => document.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a")?.textContent === "Search") event.preventDefault();
  }, { once: true }));
  await page.getByRole("link", { name: "Search" }).click({ noWaitAfter: true });
  releaseHeldResponse?.();
  await page.waitForTimeout(100);
  const crossDocumentPolicyProtected = {
    forcedRecoveryGets: projectGets(true) + projectGets(false) - crossDocumentProjectBefore
      + transportRequests.filter(({ method, path }) => method === "GET" && path === "/").length - crossDocumentRootBefore,
    finalPath: new URL(page.url()).pathname,
  };

  await page.context().clearCookies();
  await page.goto(`${origin}/projects`);
  await page.locator("#passcode").fill("example-owner");
  holdNextPrivateGetResponse = true;
  const lateDestinationPrivateBefore = projectGets(true);
  const lateDestinationRootBefore = transportRequests.filter(({ method, path }) => method === "GET" && path === "/").length;
  await page.locator("#sign-in-form button").click();
  await expect.poll(() => projectGets(true)).toBe(lateDestinationPrivateBefore + 1);
  await expect.poll(() => Boolean(releaseHeldResponse)).toBe(true);
  await page.getByRole("link", { name: "Search" }).evaluate((link) => {
    link.setAttribute("href", "/projects#captured-before-listeners");
    document.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("a") === link) {
        link.setAttribute("href", "/");
      }
    }, { once: true });
  });
  await page.getByRole("link", { name: "Search" }).click({ noWaitAfter: true });
  releaseHeldResponse?.();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/");
  await expect.poll(() => transportRequests.filter(({ method, path }) => method === "GET" && path === "/").length)
    .toBe(lateDestinationRootBefore + 1);
  const lateDestination = {
    privateRedirectGets: projectGets(true) - lateDestinationPrivateBefore,
    selectedNativeGets: transportRequests.filter(({ method, path }) => method === "GET" && path === "/").length
      - lateDestinationRootBefore,
    finalPath: new URL(page.url()).pathname,
  };

  await page.context().clearCookies();
  await page.goto(`${origin}/projects`);
  await page.locator("#passcode").fill("example-owner");
  holdNextPrivateGetResponse = true;
  const latePolicyPrivateBefore = projectGets(true);
  const latePolicyNativeBefore = projectGets(false);
  await page.locator("#sign-in-form button").click();
  await expect.poll(() => projectGets(true)).toBe(latePolicyPrivateBefore + 1);
  await expect.poll(() => Boolean(releaseHeldResponse)).toBe(true);
  await page.getByRole("link", { name: "Search" }).evaluate((link) => {
    link.setAttribute("href", "/projects#late-policy");
    document.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("a") === link) link.setAttribute("rel", "noreferrer");
    }, { once: true });
  });
  await page.getByRole("link", { name: "Search" }).click({ noWaitAfter: true });
  await expect.poll(() => new URL(page.url()).hash).toBe("#late-policy");
  releaseHeldResponse?.();
  await page.waitForTimeout(100);
  const latePolicyProtected = {
    forcedNativeGets: projectGets(false) - latePolicyNativeBefore,
    finalHash: new URL(page.url()).hash,
  };

  await page.context().clearCookies();
  await page.goto(`${origin}/projects`);
  await page.locator("#passcode").fill("example-owner");
  holdNextPrivateGetResponse = true;
  const separateContextPrivateBefore = projectGets(true);
  const separateContextNativeBefore = projectGets(false);
  await page.locator("#sign-in-form button").click();
  await expect.poll(() => projectGets(true)).toBe(separateContextPrivateBefore + 1);
  await expect.poll(() => Boolean(releaseHeldResponse)).toBe(true);
  await page.getByRole("link", { name: "Search" }).evaluate((link) => {
    link.setAttribute("href", "/");
    document.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("a") === link) link.setAttribute("target", "_blank");
    }, { once: true });
  });
  const popupPromise = page.context().waitForEvent("page");
  await page.getByRole("link", { name: "Search" }).click({ noWaitAfter: true });
  const popup = await popupPromise;
  await popup.close();
  releaseHeldResponse?.();
  await expect.poll(() => projectGets(true) + projectGets(false))
    .toBe(separateContextPrivateBefore + separateContextNativeBefore + 2);
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const separateContextRecovery = {
    redirectAndRecoveryGets: projectGets(true) + projectGets(false)
      - separateContextPrivateBefore - separateContextNativeBefore,
    finalPath: new URL(page.url()).pathname,
    freshCurrentTruthVisible: await page.locator("#viewer").textContent() === "Signed in owner",
  };
  const finalState = application.readApplicationState();
  expect({
    schema: "fadeno.example.action-ordering-native-no-departure-recovery",
    version: 1,
    mutationRequests: privateMutations().length - mutationsBefore,
    signInRuns: finalState.signInRuns,
    sameDocumentFragment,
    stoppedPropagationRecovery,
    preventedActivation,
    policyProtectedFragment,
    crossDocumentPolicyProtected,
    lateDestination,
    latePolicyProtected,
    separateContextRecovery,
    mutationRetried: privateMutations().length - mutationsBefore > 8,
  }).toEqual(expected("native-no-departure-recovery"));
  expect(readFileSync(join(outputRoot, "expected-native-no-departure-recovery-human.txt"), "utf8"))
    .toContain("native activation stayed in the document");
});

test("reloads a same-document native GET form that supersedes the redirect after late submit listeners and refuses unsafe destinations", async ({ page }) => {
  await signIn(page);
  const initialHistoryLength = await page.evaluate(() => history.length);
  const observeFormData = async (): Promise<void> => page.evaluate(() => {
    document.addEventListener("formdata", () => {
      const count = Number(sessionStorage.getItem("fadeno-native-formdata-count") ?? "0");
      sessionStorage.setItem("fadeno-native-formdata-count", String(count + 1));
    }, { once: true });
  });
  await observeFormData();
  holdNextPrivateGetResponse = true;
  holdNextPrivateGetPath = "/redirect-chain";
  const mutationsBefore = privateMutations().length;
  const redirectGetsBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/redirect-chain" && accept === mediaType).length;
  const nativeGetsBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length;
  await page.locator("#redirect-chain-form button").click();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/redirect-chain" && accept === mediaType).length).toBe(redirectGetsBefore + 1);
  await page.locator("#native-fragment-form button").click({ noWaitAfter: true });
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length).toBe(nativeGetsBefore + 1);
  await expect.poll(() => new URL(page.url()).hash).toBe("#details");
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  await page.goBack();
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  const backReturnedToFragmentFreeEntry = await page.locator("#viewer").textContent() === "Signed in owner";
  await page.goForward();
  await expect.poll(() => new URL(page.url()).hash).toBe("#details");

  holdNextPrivateGetResponse = true;
  holdNextPrivateGetPath = "/redirect-chain";
  await page.locator("#redirect-chain-form button").click();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/redirect-chain" && accept === mediaType).length).toBe(redirectGetsBefore + 2);
  await observeFormData();
  await page.locator("#native-fragment-form button").click({ noWaitAfter: true });
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length).toBe(nativeGetsBefore + 2);
  await expect.poll(() => new URL(page.url()).hash).toBe("#details");
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const nativeFragmentHistoryEntries = await page.evaluate(() => history.length) - initialHistoryLength;
  const sameHashRecovered = await page.locator("#viewer").textContent() === "Signed in owner";
  const finalHash = new URL(page.url()).hash;
  let recoveredNativeGets = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length - nativeGetsBefore;

  holdNextPrivateGetResponse = true;
  holdNextPrivateGetPath = "/redirect-chain";
  await page.locator("#redirect-chain-form button").click();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/redirect-chain" && accept === mediaType).length).toBe(redirectGetsBefore + 3);
  await observeFormData();
  await page.locator("#native-fragment-form").evaluate((form) => {
    const outside = document.createElement("input");
    outside.value = "browser-owned-dirty-state";
    document.body.append(outside);
    const control = document.createElement("input");
    control.name = "late";
    control.value = "before";
    form.append(control);
    document.addEventListener("submit", (event) => {
      if (event.target !== form) return;
      control.value = "after";
      form.setAttribute("action", "/projects#late-listener");
    }, { once: true });
  });
  await page.locator("#native-fragment-form button").click({ noWaitAfter: true });
  await expect.poll(() => new URL(page.url()).search).toBe("?late=after");
  await expect.poll(() => new URL(page.url()).hash).toBe("#late-listener");
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const nativeGetsAfterLateListener = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length;
  recoveredNativeGets += nativeGetsAfterLateListener - (nativeGetsBefore + recoveredNativeGets);
  const lateSubmitListenerDestination = `${new URL(page.url()).search}${new URL(page.url()).hash}`;

  await page.goto(`${origin}/projects`);
  holdNextPrivateGetResponse = true;
  holdNextPrivateGetPath = "/redirect-chain";
  await page.locator("#redirect-chain-form button").click();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/redirect-chain" && accept === mediaType).length).toBe(redirectGetsBefore + 4);
  await expect.poll(() => Boolean(releaseHeldResponse)).toBe(true);
  await observeFormData();
  const formDataBeforeUnsafeDestination = await page.evaluate(() => Number(sessionStorage.getItem("fadeno-native-formdata-count")));
  const nativeGetsBeforeUnsafeDestination = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length;
  await page.locator("#native-fragment-form").evaluate((form) => {
    form.setAttribute("action", "https://example.invalid/projects#details");
    document.addEventListener("submit", (event) => {
      if (event.target !== form) return;
      globalThis.addEventListener("submit", (activation) => {
        if (activation === event) activation.preventDefault();
      }, { once: true });
    }, { once: true });
  });
  await page.locator("#native-fragment-form button").click({ noWaitAfter: true });
  releaseHeldResponse?.();
  await page.waitForTimeout(100);
  const unsafeDestinationRecoveryRequests = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length - nativeGetsBeforeUnsafeDestination;
  expect(unsafeDestinationRecoveryRequests).toBeLessThanOrEqual(1);
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const unsafeDestinationFormDataEvents = await page.evaluate(() =>
    Number(sessionStorage.getItem("fadeno-native-formdata-count"))) - formDataBeforeUnsafeDestination;
  const state = application.readApplicationState();
  expect({
    schema: "fadeno.example.action-ordering-native-form-fragment-recovery",
    version: 1,
    mutationRequests: privateMutations().length - mutationsBefore,
    redirectGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/redirect-chain" && accept === mediaType).length - redirectGetsBefore,
    nativeCurrentTruthGets: recoveredNativeGets,
    redirectChainRuns: state.redirectChainRuns,
    formDataEvents: await page.evaluate(() => Number(sessionStorage.getItem("fadeno-native-formdata-count"))),
    lateSubmitListenerDestination,
    unsafeDestinationFormDataEvents,
    nativeFragmentHistoryEntries,
    backReturnedToFragmentFreeEntry,
    sameHashRecovered,
    finalHash,
    currentTruthVisible: await page.locator("#viewer").textContent() === "Signed in owner",
    mutationRetried: privateMutations().length - mutationsBefore > 4,
  }).toEqual(expected("native-form-fragment-recovery"));
  expect(readFileSync(join(outputRoot, "expected-native-form-fragment-recovery-human.txt"), "utf8"))
    .toContain("serialized successful controls once");
});

test("recovers committed truth when submit propagation stops or a late listener cancels before window finalization", async ({ page }) => {
  await page.addInitScript(() => document.addEventListener("submit", (event) => {
    if (sessionStorage.getItem("fadeno-stop-native-form-propagation") === "1"
      && event.target instanceof HTMLFormElement
      && event.target.id === "native-fragment-form") {
      event.stopPropagation();
    }
  }));
  await signIn(page);
  const mutationsBefore = privateMutations().length;
  const redirectGetsBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/redirect-chain" && accept === mediaType).length;
  const privateTruthBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept === mediaType).length;
  const nativeTruthBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length;
  holdNextPrivateGetResponse = true;
  holdNextPrivateGetPath = "/redirect-chain";
  await page.locator("#redirect-chain-form button").click();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/redirect-chain" && accept === mediaType).length).toBe(redirectGetsBefore + 1);
  await expect.poll(() => Boolean(releaseHeldResponse)).toBe(true);
  await page.evaluate(() => {
    sessionStorage.setItem("fadeno-stop-native-form-propagation", "1");
    sessionStorage.setItem("fadeno-stopped-submit-formdata-count", "0");
    document.addEventListener("formdata", () => {
      const count = Number(sessionStorage.getItem("fadeno-stopped-submit-formdata-count"));
      sessionStorage.setItem("fadeno-stopped-submit-formdata-count", String(count + 1));
    }, { once: true });
    document.addEventListener("submit", (event) => {
      if (event.target instanceof HTMLFormElement && event.target.id === "native-fragment-form") {
        event.preventDefault();
      }
    }, { once: true });
  });
  await page.locator("#native-fragment-form button").click({ noWaitAfter: true });
  releaseHeldResponse?.();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && ((path === "/redirect-chain" && accept === mediaType) || path === "/projects")).length)
    .toBe(redirectGetsBefore + privateTruthBefore + nativeTruthBefore + 2);
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const stoppedFormDataEvents = await page.evaluate(() => Number(sessionStorage.getItem("fadeno-stopped-submit-formdata-count")));
  const lateCancellationGetsBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && ((path === "/redirect-chain" && accept === mediaType) || path === "/projects")).length;
  holdNextPrivateGetResponse = true;
  holdNextPrivateGetPath = "/redirect-chain";
  await page.locator("#redirect-chain-form button").click();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/redirect-chain" && accept === mediaType).length).toBe(redirectGetsBefore + 2);
  await expect.poll(() => Boolean(releaseHeldResponse)).toBe(true);
  await page.evaluate(() => {
    sessionStorage.setItem("fadeno-stop-native-form-propagation", "0");
    sessionStorage.setItem("fadeno-late-cancelled-formdata-count", "0");
    document.addEventListener("formdata", () => {
      const count = Number(sessionStorage.getItem("fadeno-late-cancelled-formdata-count"));
      sessionStorage.setItem("fadeno-late-cancelled-formdata-count", String(count + 1));
    }, { once: true });
    document.addEventListener("submit", (event) => {
      if (event.target instanceof HTMLFormElement && event.target.id === "native-fragment-form") event.preventDefault();
    }, { once: true });
  });
  await page.locator("#native-fragment-form button").click({ noWaitAfter: true });
  releaseHeldResponse?.();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && ((path === "/redirect-chain" && accept === mediaType) || path === "/projects")).length)
    .toBe(lateCancellationGetsBefore + 2);
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const lateWindowCancellation = {
    redirectAndRecoveryGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && ((path === "/redirect-chain" && accept === mediaType) || path === "/projects")).length - lateCancellationGetsBefore,
    formDataEvents: await page.evaluate(() => Number(sessionStorage.getItem("fadeno-late-cancelled-formdata-count"))),
    currentTruthVisible: await page.locator("#viewer").textContent() === "Signed in owner",
  };
  const captureCancellationGetsBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && ((path === "/redirect-chain" && accept === mediaType) || path === "/projects")).length;
  holdNextPrivateGetResponse = true;
  holdNextPrivateGetPath = "/redirect-chain";
  await page.locator("#redirect-chain-form button").click();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/redirect-chain" && accept === mediaType).length).toBe(redirectGetsBefore + 3);
  await expect.poll(() => Boolean(releaseHeldResponse)).toBe(true);
  await page.evaluate(() => {
    sessionStorage.setItem("fadeno-capture-cancelled-formdata-count", "0");
    document.addEventListener("formdata", () => {
      const count = Number(sessionStorage.getItem("fadeno-capture-cancelled-formdata-count"));
      sessionStorage.setItem("fadeno-capture-cancelled-formdata-count", String(count + 1));
    }, { once: true });
    document.addEventListener("submit", (event) => {
      if (event.target instanceof HTMLFormElement && event.target.id === "native-fragment-form") event.preventDefault();
    }, { capture: true, once: true });
  });
  await page.locator("#native-fragment-form button").click({ noWaitAfter: true });
  releaseHeldResponse?.();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && ((path === "/redirect-chain" && accept === mediaType) || path === "/projects")).length)
    .toBe(captureCancellationGetsBefore + 2);
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const captureCancellation = {
    redirectAndRecoveryGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && ((path === "/redirect-chain" && accept === mediaType) || path === "/projects")).length
      - captureCancellationGetsBefore,
    formDataEvents: await page.evaluate(() => Number(sessionStorage.getItem("fadeno-capture-cancelled-formdata-count"))),
    currentTruthVisible: await page.locator("#viewer").textContent() === "Signed in owner",
  };
  const state = application.readApplicationState();
  expect({
    schema: "fadeno.example.action-ordering-submit-propagation-recovery",
    version: 1,
    mutationRequests: privateMutations().length - mutationsBefore,
    redirectAndRecoveryGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && ((path === "/redirect-chain" && accept === mediaType) || path === "/projects")).length
      - redirectGetsBefore - privateTruthBefore - nativeTruthBefore,
    formDataEvents: stoppedFormDataEvents,
    lateWindowCancellation,
    captureCancellation,
    redirectChainRuns: state.redirectChainRuns,
    finalHash: new URL(page.url()).hash,
    currentTruthVisible: await page.locator("#viewer").textContent() === "Signed in owner",
    mutationRetried: privateMutations().length - mutationsBefore > 3,
  }).toEqual(expected("submit-propagation-recovery"));
  expect(readFileSync(join(outputRoot, "expected-submit-propagation-recovery-human.txt"), "utf8"))
    .toContain("submit propagation stopped before window finalization");
});

test("uses the final same-context target selected by late submit listeners", async ({ page }) => {
  await signIn(page);
  const mutationsBefore = privateMutations().length;
  const redirectGetsBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/redirect-chain" && accept === mediaType).length;
  const projectGetsBefore = transportRequests.filter(({ method, path }) => method === "GET" && path === "/projects").length;
  const nativeTruthBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length;
  holdNextPrivateGetResponse = true;
  holdNextPrivateGetPath = "/redirect-chain";
  await page.locator("#redirect-chain-form button").click();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/redirect-chain" && accept === mediaType).length).toBe(redirectGetsBefore + 1);
  await expect.poll(() => Boolean(releaseHeldResponse)).toBe(true);
  await page.locator("#native-fragment-form").evaluate((form) => {
    form.setAttribute("target", "_blank");
    document.addEventListener("submit", (event) => {
      if (event.target === form) form.setAttribute("target", "_self");
    }, { once: true });
  });
  await page.locator("#native-fragment-form button").click({ noWaitAfter: true });
  releaseHeldResponse?.();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length).toBe(nativeTruthBefore + 1);
  await expect.poll(() => new URL(page.url()).hash).toBe("#details");
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");

  const externalContextGetsBefore = transportRequests.filter(({ method, path }) => method === "GET" && path === "/projects").length;
  const openerEpochBefore = await page.locator('meta[name="fadeno-document-epoch"]').getAttribute("content");
  holdNextPrivateGetResponse = true;
  holdNextPrivateGetPath = "/redirect-chain";
  await page.locator("#redirect-chain-form button").click();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/redirect-chain" && accept === mediaType).length).toBe(redirectGetsBefore + 2);
  await expect.poll(() => Boolean(releaseHeldResponse)).toBe(true);
  await page.locator("#native-fragment-form").evaluate((form) => document.addEventListener("submit", (event) => {
    if (event.target === form) form.setAttribute("target", "_blank");
  }, { once: true }));
  const popupPromise = page.waitForEvent("popup");
  await page.locator("#native-fragment-form button").click({ noWaitAfter: true });
  const popup = await popupPromise;
  releaseHeldResponse?.();
  await expect.poll(() => transportRequests.filter(({ method, path }) => method === "GET" && path === "/projects").length)
    .toBeGreaterThanOrEqual(externalContextGetsBefore + 2);
  await expect.poll(() => page.locator('meta[name="fadeno-document-epoch"]').getAttribute("content"))
    .not.toBe(openerEpochBefore);
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  await page.waitForTimeout(100);
  const externalContextProjectGets = transportRequests.filter(({ method, path }) => method === "GET" && path === "/projects").length
    - externalContextGetsBefore;
  expect(externalContextProjectGets).toBeLessThanOrEqual(3);
  const externalContextRecovery = {
    destinationAndRecoveryObserved: externalContextProjectGets >= 2,
    boundedProjectGets: externalContextProjectGets <= 3,
    browserOwnedDestinationLoaded: new URL(popup.url()).pathname === "/projects",
    openerCurrentTruthReplaced: await page.locator('meta[name="fadeno-document-epoch"]').getAttribute("content") !== openerEpochBefore,
    openerCurrentTruthVisible: await page.locator("#viewer").textContent() === "Signed in owner",
  };
  await popup.close();
  const state = application.readApplicationState();
  expect({
    schema: "fadeno.example.action-ordering-late-target-recovery",
    version: 1,
    mutationRequests: privateMutations().length - mutationsBefore,
    redirectGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/redirect-chain" && accept === mediaType).length - redirectGetsBefore,
    projectDocumentGetsAtLeastThree: transportRequests.filter(({ method, path }) => method === "GET" && path === "/projects").length
      - projectGetsBefore >= 3,
    projectDocumentGetsAtMostFour: transportRequests.filter(({ method, path }) => method === "GET" && path === "/projects").length
      - projectGetsBefore <= 4,
    externalContextRecovery,
    redirectChainRuns: state.redirectChainRuns,
    finalHash: new URL(page.url()).hash,
    currentTruthVisible: await page.locator("#viewer").textContent() === "Signed in owner",
    mutationRetried: privateMutations().length - mutationsBefore > 2,
  }).toEqual(expected("late-target-recovery"));
  expect(readFileSync(join(outputRoot, "expected-late-target-recovery-human.txt"), "utf8"))
    .toContain("late submit listener selected the current context");
});

test("retains current-truth recovery when a newer cancelled activation supersedes recovery GET", async ({ page }) => {
  await signIn(page);
  const mutationsBefore = privateMutations().length;
  const redirectGetsBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/redirect-chain" && accept === mediaType).length;
  const privateTruthBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept === mediaType).length;
  const nativeTruthBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length;
  holdNextPrivateGetResponse = true;
  holdNextPrivateGetPath = "/redirect-chain";
  await page.locator("#redirect-chain-form button").click();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/redirect-chain" && accept === mediaType).length).toBe(redirectGetsBefore + 1);
  await expect.poll(() => Boolean(releaseHeldResponse)).toBe(true);
  delayedPrivateGetPath = "/projects";
  delayedPrivateGetMilliseconds = 1_000;
  await page.evaluate(() => {
    document.addEventListener("mousedown", (event) => {
      if (event.target instanceof Element && event.target.closest("#native-fragment-form")) event.preventDefault();
    }, { once: true });
    document.addEventListener("submit", (event) => {
      if (event.target instanceof HTMLFormElement && event.target.id === "native-fragment-form") event.preventDefault();
    }, { capture: true, once: true });
  });
  await page.locator("#native-fragment-form button").click({ noWaitAfter: true });
  releaseHeldResponse?.();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept === mediaType).length).toBe(privateTruthBefore + 1);
  delayedPrivateGetPath = "/projects";
  delayedPrivateGetMilliseconds = 400;
  await page.evaluate(() => {
    document.addEventListener("mousedown", (event) => {
      if (event.target instanceof Element && event.target.closest("#native-fragment-form")) event.preventDefault();
    }, { once: true });
    document.addEventListener("submit", (event) => {
      if (event.target instanceof HTMLFormElement && event.target.id === "native-fragment-form") event.preventDefault();
    }, { capture: true, once: true });
  });
  await page.locator("#native-fragment-form button").click({ noWaitAfter: true });
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept === mediaType).length).toBe(privateTruthBefore + 2);
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const state = application.readApplicationState();
  expect({
    schema: "fadeno.example.action-ordering-recovery-supersession-continuity",
    version: 1,
    mutationRequests: privateMutations().length - mutationsBefore,
    redirectGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/redirect-chain" && accept === mediaType).length - redirectGetsBefore,
    privateCurrentTruthGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/projects" && accept === mediaType).length - privateTruthBefore,
    nativeCurrentTruthGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/projects" && accept !== mediaType).length - nativeTruthBefore,
    redirectChainRuns: state.redirectChainRuns,
    currentTruthVisible: await page.locator("#viewer").textContent() === "Signed in owner",
    mutationRetried: privateMutations().length - mutationsBefore > 1,
  }).toEqual(expected("recovery-supersession-continuity"));
  expect(readFileSync(join(outputRoot, "expected-recovery-supersession-continuity-human.txt"), "utf8"))
    .toContain("newer cancelled activation superseded an in-flight recovery GET");
});

test("retains the frozen handoff snapshot through interrupted-departure recovery", async ({ page }) => {
  await page.addInitScript(() => document.addEventListener("click", (event) => {
    if (sessionStorage.getItem("fadeno-stop-handoff-recovery-propagation") === "1"
      && event.target instanceof Element
      && event.target.closest("a")?.textContent === "Search") {
      event.stopPropagation();
    }
  }));
  await signIn(page);
  const mutationsBefore = privateMutations().length;
  const redirectGetsBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/redirect-chain" && accept === mediaType).length;
  const privateTruthBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept === mediaType).length;
  const nativeTruthBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length;
  delayedPrivateGetPath = "/redirect-chain";
  delayedPrivateGetMilliseconds = 1_000;
  await page.locator("#redirect-chain-form button").click();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/redirect-chain" && accept === mediaType).length).toBe(redirectGetsBefore + 1);
  holdNextPrivateGetResponse = true;
  holdNextPrivateGetPath = "/projects";
  await page.getByRole("link", { name: "Search" }).evaluate((link) => link.setAttribute("href", "/projects#handoff-recovery"));
  await page.evaluate(() => {
    sessionStorage.setItem("fadeno-stop-handoff-recovery-propagation", "1");
    document.addEventListener("mousedown", (event) => {
      if (event.target instanceof Element && event.target.closest("a")?.textContent === "Search") event.preventDefault();
    }, { once: true });
    document.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("a")?.textContent === "Search") event.preventDefault();
    }, { once: true });
  });
  await page.getByRole("link", { name: "Search" }).click({ noWaitAfter: true });
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept === mediaType).length).toBe(privateTruthBefore + 1);
  await expect.poll(() => Boolean(releaseHeldResponse)).toBe(true);
  await page.locator('#redirect-chain-form input[value="chain"]').evaluate((input: HTMLInputElement) => { input.value = "newer"; });
  releaseHeldResponse?.();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length).toBe(nativeTruthBefore + 1);
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const state = application.readApplicationState();
  expect({
    schema: "fadeno.example.action-ordering-recovery-handoff-preservation",
    version: 1,
    mutationRequests: privateMutations().length - mutationsBefore,
    redirectGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/redirect-chain" && accept === mediaType).length - redirectGetsBefore,
    privateCurrentTruthGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/projects" && accept === mediaType).length - privateTruthBefore,
    nativeCurrentTruthGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/projects" && accept !== mediaType).length - nativeTruthBefore,
    redirectChainRuns: state.redirectChainRuns,
    currentTruthVisible: await page.locator("#viewer").textContent() === "Signed in owner",
    mutationRetried: privateMutations().length - mutationsBefore > 1,
  }).toEqual(expected("recovery-handoff-preservation"));
  expect(readFileSync(join(outputRoot, "expected-recovery-handoff-preservation-human.txt"), "utf8"))
    .toContain("frozen handoff snapshot remained authoritative");
});

test("rolls back a cancelled pushed fragment reload before recovering current truth", async ({ page }) => {
  await signIn(page);
  const rollbackPage = await page.context().newPage();
  await rollbackPage.goto(origin);
  await rollbackPage.goto(`${origin}/projects`);
  await expect(rollbackPage.locator("#viewer")).toHaveText("Signed in owner");
  await expect.poll(async () => rollbackPage.evaluate(() => Boolean(Reflect.get(globalThis, "__fadenoExampleEnhancement"))))
    .toBe(true);
  const mutationsBefore = privateMutations().length;
  const redirectGetsBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/redirect-chain" && accept === mediaType).length;
  const privateTruthBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept === mediaType).length;
  const nativeTruthBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length;
  holdNextPrivateGetResponse = true;
  holdNextPrivateGetPath = "/redirect-chain";
  await rollbackPage.locator("#redirect-chain-form button").click();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/redirect-chain" && accept === mediaType).length).toBe(redirectGetsBefore + 1);
  await expect.poll(() => Boolean(releaseHeldResponse)).toBe(true);
  await rollbackPage.evaluate(() => globalThis.addEventListener("beforeunload", (event) => {
    event.preventDefault();
    event.returnValue = "cancel pushed fragment reload";
  }, { once: true }));
  const dialog = rollbackPage.waitForEvent("dialog");
  const activation = rollbackPage.locator("#native-fragment-form button").click({ noWaitAfter: true });
  await (await dialog).dismiss();
  await activation;
  releaseHeldResponse?.();
  await expect.poll(() => transportRequests.filter(({ method, path }) => method === "GET"
    && path === "/projects").length).toBe(privateTruthBefore + nativeTruthBefore + 1);
  await expect.poll(() => new URL(rollbackPage.url()).hash).toBe("");
  await expect(rollbackPage.locator("#viewer")).toHaveText("Signed in owner");
  const currentTruthVisible = await rollbackPage.locator("#viewer").textContent() === "Signed in owner";
  const finalHash = new URL(rollbackPage.url()).hash;
  await rollbackPage.goBack();
  await expect.poll(() => new URL(rollbackPage.url()).pathname).toBe("/");
  const state = application.readApplicationState();
  expect({
    schema: "fadeno.example.action-ordering-cancelled-fragment-push-recovery",
    version: 1,
    mutationRequests: privateMutations().length - mutationsBefore,
    redirectGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/redirect-chain" && accept === mediaType).length - redirectGetsBefore,
    currentTruthRecoveryGets: transportRequests.filter(({ method, path }) => method === "GET"
      && path === "/projects").length - privateTruthBefore - nativeTruthBefore,
    redirectChainRuns: state.redirectChainRuns,
    finalHashBeforeBack: finalHash,
    currentTruthVisible,
    backReachedPrecedingPage: new URL(rollbackPage.url()).pathname === "/",
    mutationRetried: privateMutations().length - mutationsBefore > 1,
  }).toEqual(expected("cancelled-fragment-push-recovery"));
  expect(readFileSync(join(outputRoot, "expected-cancelled-fragment-push-recovery-human.txt"), "utf8"))
    .toContain("cancelled pushed-fragment reload rolled back");
  await rollbackPage.close();
});

test("does not roll back a fragment push that failed before staging an entry", async ({ page }) => {
  await page.goto(`${origin}/projects`);
  const recoveryModes = await page.evaluate(async () => {
    const modulePath: string = "/_fadeno/framework/internal/browser-navigation.js";
    const runtime = await import(modulePath) as Readonly<{
      privateFragmentReloadRecoveryMode(
        stageDestination: "replace" | "push" | "none",
        pushedDestination: boolean,
      ): "rollback-staged-entry" | "repair-current-entry";
    }>;
    return {
      failedPush: runtime.privateFragmentReloadRecoveryMode("push", false),
      committedPush: runtime.privateFragmentReloadRecoveryMode("push", true),
      replacement: runtime.privateFragmentReloadRecoveryMode("replace", false),
    };
  });
  expect({
    schema: "fadeno.example.action-ordering-failed-fragment-push-recovery",
    version: 1,
    ...recoveryModes,
  }).toEqual(expected("failed-fragment-push-recovery"));
  expect(readFileSync(join(outputRoot, "expected-failed-fragment-push-recovery-human.txt"), "utf8"))
    .toContain("failed push created no entry to roll back");
});

test("refuses a submitted-control caret change made after redirect handoff", async ({ page }) => {
  await page.goto(`${origin}/projects`);
  await page.locator("#passcode").fill("example-owner");
  holdNextPrivateGetResponse = true;
  const mutationsBefore = privateMutations().length;
  const privateGetsBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept === mediaType).length;
  const nativeGetsBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length;
  await page.locator("#passcode").press("Enter");
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept === mediaType).length).toBe(privateGetsBefore + 1);
  await expect.poll(() => Boolean(releaseHeldResponse)).toBe(true);
  await page.locator("#passcode").evaluate((input: HTMLInputElement) => input.setSelectionRange(0, 1, "forward"));
  releaseHeldResponse?.();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length).toBe(nativeGetsBefore + 1);
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const state = application.readApplicationState();
  expect({
    schema: "fadeno.example.action-ordering-handoff-caret-recovery",
    version: 1,
    mutationRequests: privateMutations().length - mutationsBefore,
    privateRedirectGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/projects" && accept === mediaType).length - privateGetsBefore,
    nativeCurrentTruthGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/projects" && accept !== mediaType).length - nativeGetsBefore,
    signInRuns: state.signInRuns,
    newerCaretNotOverwritten: await page.locator("#passcode").count() === 0,
    currentTruthVisible: await page.locator("#viewer").textContent() === "Signed in owner",
  }).toEqual(expected("handoff-caret-recovery"));
  expect(readFileSync(join(outputRoot, "expected-handoff-caret-recovery-human.txt"), "utf8"))
    .toContain("newer caret selection refused private publication");
});

test("does not clear a newer submission pending owner after redirect handoff", async ({ page }) => {
  await page.goto(`${origin}/projects`);
  await page.locator("#passcode").fill("example-owner");
  holdNextPrivateGetResponse = true;
  const mutationsBefore = privateMutations().length;
  await page.locator("#sign-in-form button").click();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept === mediaType).length).toBe(1);
  holdNextMutationResponse = true;
  await page.locator("#sign-in-form button").click();
  await expect.poll(() => privateMutations().length - mutationsBefore).toBe(2);
  await expect.poll(() => Boolean(releaseHeldResponse)).toBe(true);
  await page.waitForTimeout(50);
  const newerPendingRetained = await page.locator("#sign-in-form").getAttribute("aria-busy") === "true";
  releaseHeldResponse?.();
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const state = application.readApplicationState();
  expect({
    schema: "fadeno.example.action-ordering-pending-handoff",
    version: 1,
    mutationRequests: privateMutations().length - mutationsBefore,
    signInRuns: state.signInRuns,
    newerPendingRetained,
    replayRefusedBeforeAction: state.signInRuns === 1,
    finalPath: new URL(page.url()).pathname,
  }).toEqual(expected("pending-handoff"));
  expect(readFileSync(join(outputRoot, "expected-pending-handoff-human.txt"), "utf8"))
    .toContain("newer submission kept pending ownership");
});

test("refuses a same-metadata file replacement made after redirect handoff", async ({ page }) => {
  await signIn(page);
  const installFile = async (contents: string): Promise<void> => page.locator("#handoff-upload").evaluate((input, value) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([value], "handoff.txt", { type: "text/plain", lastModified: 1_234 }));
    (input as HTMLInputElement).files = transfer.files;
  }, contents);
  await installFile("first");
  delayedPrivateGetPath = "/projects";
  delayedPrivateGetMilliseconds = 400;
  const mutationsBefore = privateMutations().length;
  const privateGetsBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept === mediaType).length;
  const nativeGetsBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length;
  await page.locator("#upload-redirect-form button").click();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept === mediaType).length).toBe(privateGetsBefore + 1);
  await installFile("other");
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length).toBe(nativeGetsBefore + 1);
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const state = application.readApplicationState();
  expect({
    schema: "fadeno.example.action-ordering-file-handoff-recovery",
    version: 1,
    mutationRequests: privateMutations().length - mutationsBefore,
    privateRedirectGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/projects" && accept === mediaType).length - privateGetsBefore,
    nativeCurrentTruthGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/projects" && accept !== mediaType).length - nativeGetsBefore,
    uploadRedirectRuns: state.uploadRedirectRuns,
    newerFileSelectionNotPrivatelyOverwritten: await page.locator("#handoff-upload").evaluate((input) =>
      (input as HTMLInputElement).files?.length === 0),
    currentTruthVisible: await page.locator("#viewer").textContent() === "Signed in owner",
  }).toEqual(expected("file-handoff-recovery"));
  expect(readFileSync(join(outputRoot, "expected-file-handoff-recovery-human.txt"), "utf8"))
    .toContain("same-metadata replacement refused private publication");
});

test("reloads same-resource fragment redirects instead of retaining stale markup", async ({ page }) => {
  await signIn(page);
  const mutationsBefore = privateMutations().length;
  const privateGetsBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept === mediaType).length;
  const nativeGetsBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length;
  await page.locator("#fragment-redirect-form").evaluate((form) => {
    const observer = new MutationObserver(() => {
      if (form.hasAttribute("aria-busy")) return;
      observer.disconnect();
      sessionStorage.setItem("fadeno-fragment-close-after-handoff", "1");
      const runtime = Reflect.get(globalThis, "__fadenoExampleEnhancement") as { close(): void };
      runtime.close();
    });
    observer.observe(form, { attributes: true, attributeFilter: ["aria-busy"] });
  });
  await page.locator("#fragment-redirect-form button").click({ noWaitAfter: true });
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length).toBe(nativeGetsBefore + 1);
  await expect.poll(() => new URL(page.url()).hash).toBe("#details");
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const cancelledClosePrivateBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept === mediaType).length;
  const cancelledCloseNativeBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length;
  await page.evaluate(() => globalThis.addEventListener("beforeunload", (event) => {
    const runtime = Reflect.get(globalThis, "__fadenoExampleEnhancement") as { close(): void };
    runtime.close();
    event.preventDefault();
    event.returnValue = "keep fresh fragment truth";
  }, { once: true }));
  const cancelledCloseDialog = page.waitForEvent("dialog");
  await page.locator("#fragment-redirect-form button").click({ noWaitAfter: true });
  await (await cancelledCloseDialog).dismiss();
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  await expect.poll(async () => page.evaluate(() => {
    const runtime = Reflect.get(globalThis, "__fadenoExampleEnhancement") as { state(): string };
    return runtime.state();
  }).catch(() => "navigating")).toBe("active");
  const cancelledCloseRecovery = {
    privateCurrentTruthGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/projects" && accept === mediaType).length - cancelledClosePrivateBefore,
    nativeDestinationGetsAtMostOne: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/projects" && accept !== mediaType).length - cancelledCloseNativeBefore <= 1,
    finalHash: new URL(page.url()).hash,
    currentTruthVisible: await page.locator("#viewer").textContent() === "Signed in owner",
    enhancementActive: true,
  };
  const nativeFragmentGetsBeforeEmpty = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length - nativeGetsBefore;
  // Begin the empty-delimiter case from a fresh server document so its proof is
  // independent from the deliberately interrupted mutation above.
  await page.reload();
  const emptyFragmentNativeBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length;
  await page.locator('#fragment-redirect-form input:not([name="__fadeno_proof"])').evaluate((input: HTMLInputElement) => {
    input.value = "empty-fragment";
  });
  await page.locator("#fragment-redirect-form button").click({ noWaitAfter: true });
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length).toBe(emptyFragmentNativeBefore + 1);
  await expect.poll(() => page.url().endsWith("#")).toBe(true);
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const emptyFragment = {
    nativeDestinationGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/projects" && accept !== mediaType).length - emptyFragmentNativeBefore,
    finalUrlEndsWithDelimiter: page.url().endsWith("#"),
    currentTruthVisible: await page.locator("#viewer").textContent() === "Signed in owner",
  };
  const historyFailureHandoff = await page.evaluate(async () => {
    const modulePath: string = "/_fadeno/framework/internal/browser-navigation.js";
    const runtime = await import(modulePath) as Readonly<{
      privateReloadFragmentDestination(
        owner: { href: string; replace(destination: string): void; reload(): void },
        destination: URL,
      ): void;
    }>;
    const calls: string[] = [];
    const owner = {
      href: `${location.origin}/projects`,
      replace(destination: string): void {
        this.href = destination;
        const selected = new URL(destination);
        calls.push(`replace:${selected.pathname}${selected.hash}`);
      },
      reload(): void {
        const selected = new URL(this.href);
        calls.push(`reload:${selected.pathname}${selected.hash}`);
      },
    };
    runtime.privateReloadFragmentDestination(owner, new URL("/projects#details", location.origin));
    const selected = new URL(owner.href);
    return { calls, finalUrl: `${selected.pathname}${selected.hash}` };
  });
  const state = application.readApplicationState();
  expect({
    schema: "fadeno.example.action-ordering-fragment-redirect",
    version: 1,
    mutationRequests: privateMutations().length - mutationsBefore,
    privateRedirectGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/projects" && accept === mediaType).length - privateGetsBefore,
    nativeDestinationGetsAtLeastTwo: nativeFragmentGetsBeforeEmpty + emptyFragment.nativeDestinationGets >= 2,
    nativeDestinationGetsAtMostThree: nativeFragmentGetsBeforeEmpty + emptyFragment.nativeDestinationGets <= 3,
    fragmentRedirectRuns: state.fragmentRedirectRuns,
    finalHash: new URL(page.url()).hash,
    emptyFragment,
    teardownFollowedHandoff: await page.evaluate(() => sessionStorage.getItem("fadeno-fragment-close-after-handoff") === "1"),
    cancelledCloseRecovery,
    freshCurrentTruthVisible: await page.locator("#viewer").textContent() === "Signed in owner",
    historyFailureHandoff,
  }).toEqual(expected("fragment-redirect"));
  expect(readFileSync(join(outputRoot, "expected-fragment-redirect-human.txt"), "utf8"))
    .toContain("explicit and empty fragment delimiters selected only with fresh native documents");
});

test("reloads same-resource fragments returned by the redirect GET", async ({ page }) => {
  await signIn(page);
  const mutationsBefore = privateMutations().length;
  const chainGetsBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/redirect-fragment-chain" && accept === mediaType).length;
  const nativeGetsBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length;
  await page.locator("#redirect-fragment-chain-form button").click({ noWaitAfter: true });
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length).toBe(nativeGetsBefore + 1);
  await expect.poll(() => new URL(page.url()).hash).toBe("#details");
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const state = application.readApplicationState();
  expect({
    schema: "fadeno.example.action-ordering-fragment-redirect-chain",
    version: 1,
    mutationRequests: privateMutations().length - mutationsBefore,
    redirectChainGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/redirect-fragment-chain" && accept === mediaType).length - chainGetsBefore,
    nativeDestinationGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/projects" && accept !== mediaType).length - nativeGetsBefore,
    fragmentChainRuns: state.fragmentChainRuns,
    finalHash: new URL(page.url()).hash,
    freshCurrentTruthVisible: await page.locator("#viewer").textContent() === "Signed in owner",
  }).toEqual(expected("fragment-redirect-chain"));
  expect(readFileSync(join(outputRoot, "expected-fragment-redirect-chain-human.txt"), "utf8"))
    .toContain("redirect GET fragment selected a fresh native document");
});

test("consumes a redirect GET result before following its redirect chain", async ({ page }) => {
  await signIn(page);
  const mutationsBefore = privateMutations().length;
  const chainGetsBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/redirect-chain" && accept === mediaType).length;
  const privateRecoveryGetsBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept === mediaType).length;
  const nativeRecoveryGetsBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length;
  rewriteNextPrivateGetResultId = true;
  await page.evaluate(() => globalThis.addEventListener("beforeunload", (event) => {
    event.preventDefault();
    event.returnValue = "inspect redirect result consumption";
  }, { once: true }));
  const cancelledRedirect = page.waitForEvent("dialog");
  await page.locator("#redirect-chain-form button").click({ noWaitAfter: true });
  await (await cancelledRedirect).dismiss();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects" && accept !== mediaType).length).toBe(nativeRecoveryGetsBefore + 1);
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const state = application.readApplicationState();
  expect({
    schema: "fadeno.example.action-ordering-redirect-get-consumption",
    version: 1,
    mutationRequests: privateMutations().length - mutationsBefore,
    redirectChainGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/redirect-chain" && accept === mediaType).length - chainGetsBefore,
    duplicatePrivateRecoveryGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/projects" && accept === mediaType).length - privateRecoveryGetsBefore,
    nativeCurrentTruthGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/projects" && accept !== mediaType).length - nativeRecoveryGetsBefore,
    capturedResultId: Boolean(capturedRedirectGetResultId),
    redirectChainRuns: state.redirectChainRuns,
    duplicateResultRefused: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/projects" && accept !== mediaType).length - nativeRecoveryGetsBefore === 1,
    currentTruthVisible: await page.locator("#viewer").textContent() === "Signed in owner",
  }).toEqual(expected("redirect-get-consumption"));
  expect(readFileSync(join(outputRoot, "expected-redirect-get-consumption-human.txt"), "utf8"))
    .toContain("redirect GET result consumed before the chain continued");
});

test("keeps one pending mutation, suppresses a duplicate, and clears pending state", async ({ page }) => {
  await signIn(page);
  const mutationsBeforePending = privateMutations().length;
  application.setMutationDelay(300);
  await page.locator("#title").fill("Pending project");
  await page.locator("#create-form button").click();
  await expect(page.locator("#create-form")).toHaveAttribute("aria-busy", "true");
  await page.locator("#create-form button").click();
  await expect(page.locator(".project-title")).toHaveText("Pending project");
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
  await expect(page.locator(".project-title")).toHaveText("Recovered once");
  const state = application.readApplicationState();
  const recoveredThroughGet = transportRequests.some(({ method, path, accept }) => method === "GET"
    && path === "/projects"
    && accept !== mediaType);
  expect({
    schema: "fadeno.example.form-submission-recovery",
    version: 1,
    mutationRequests: privateMutations().length - mutationsBefore,
    actionRuns: state.createRuns,
    projectVisibleAfterReload: await page.locator(".project-title").filter({ hasText: "Recovered once" }).count() === 1,
    pendingCleared: await page.locator("#create-form").getAttribute("aria-busy") !== "true",
    mutationRetried: privateMutations().length - mutationsBefore > 1,
    outcome: recoveredThroughGet ? "current-truth-reload" : "none",
  }).toEqual(expected("recovery"));
});

test("returns to the mutation page without overwriting the selected Back entry", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Search" }).click();
  await expect(page.locator("h1")).toHaveText("GET form navigation");
  await page.getByRole("link", { name: "Projects" }).click();
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");

  application.setMutationDelay(300);
  await page.locator("#title").fill("Interrupted traversal");
  const mutationsBefore = privateMutations().length;
  const currentTruthBefore = transportRequests.filter(({ method, path }) => method === "GET"
    && path === "/projects").length;
  await page.locator("#create-form button").click();
  await expect.poll(() => privateMutations().length).toBe(mutationsBefore + 1);
  await expect(page.locator("#create-form")).toHaveAttribute("aria-busy", "true");
  await page.evaluate(() => history.back());
  await expect.poll(() => transportRequests.filter(({ method, path }) => method === "GET"
    && path === "/projects").length).toBe(currentTruthBefore + 1);
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  await page.evaluate(() => history.back());
  await expect(page.locator("h1")).toHaveText("GET form navigation");

  const state = application.readApplicationState();
  expect({
    schema: "fadeno.example.form-submission-history-recovery",
    version: 1,
    mutationRequests: privateMutations().length - mutationsBefore,
    actionRuns: state.createRuns,
    projectAbsent: !state.projects.includes("Interrupted traversal"),
    currentTruthRequests: transportRequests.filter(({ method, path }) => method === "GET"
      && path === "/projects").length - currentTruthBefore,
    selectedEntryPreserved: new URL(page.url()).pathname === "/",
  }).toEqual(expected("history-recovery"));
});

test("records terminal redirect handoff and repairs cancelled recovery departures", async ({ page }) => {
  const installOneDepartureRefusal = async (): Promise<void> => page.evaluate(() => {
    globalThis.addEventListener("beforeunload", (event) => {
      event.preventDefault();
      event.returnValue = "keep the current document";
    }, { once: true });
  });
  const readFlows = async (): Promise<readonly Record<string, unknown>[]> => page.evaluate(async () => {
    const modulePath: string = "/_fadeno/framework/internal/browser-navigation.js";
    const runtime = await import(modulePath) as Readonly<{ readPrivateFormSubmissionFlows(): readonly Record<string, unknown>[] }>;
    return runtime.readPrivateFormSubmissionFlows();
  });

  await page.goto(`${origin}/projects`);
  await page.locator("#passcode").fill("example-owner");
  const redirectTruthBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects"
    && accept === mediaType).length;
  const documentLoadsBefore = await page.evaluate(() => performance.getEntriesByType("navigation").length);
  await page.locator("#sign-in-form button").click();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects"
    && accept === mediaType).length).toBe(redirectTruthBefore + 1);
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const redirectDestinationRequests = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects"
    && accept === mediaType).length - redirectTruthBefore;
  const redirectAvoidedDocumentReload = await page.evaluate(() => performance.getEntriesByType("navigation").length)
    === documentLoadsBefore;
  const signedInTruthVisible = await page.locator("#viewer").textContent() === "Signed in owner";
  const redirectFlows = await readFlows();

  await page.context().clearCookies();
  await page.goto(`${origin}/projects`);
  const failedRedirectFlowCount = (await readFlows()).length;
  await page.locator("#passcode").fill("example-owner");
  dropNextPrivateGetResponse = true;
  await installOneDepartureRefusal();
  const failedRedirectTruthBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects"
    && accept === mediaType).length;
  const failedRedirectDialog = page.waitForEvent("dialog");
  await page.locator("#sign-in-form button").click({ noWaitAfter: true });
  await (await failedRedirectDialog).dismiss();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects"
    && accept === mediaType).length).toBe(failedRedirectTruthBefore + 2);
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const failedRedirectFlows = (await readFlows()).slice(failedRedirectFlowCount);
  const failedRedirectRecoveryRequests = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects"
    && accept === mediaType).length - failedRedirectTruthBefore;
  const failedRedirectRecoveryVisible = await page.locator("#viewer").textContent() === "Signed in owner";

  await page.context().clearCookies();
  await page.goto(`${origin}/projects`);
  const recoveryFlowCount = (await readFlows()).length;
  await installOneDepartureRefusal();
  const recoveryTruthBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects"
    && accept === mediaType).length;
  const recoveryDialog = page.waitForEvent("dialog");
  await page.locator("#forbidden-form button").click({ noWaitAfter: true });
  await (await recoveryDialog).dismiss();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects"
    && accept === mediaType).length).toBe(recoveryTruthBefore + 1);
  await expect(page.locator("h1")).toHaveText("Protected forms");
  const recoveryFlows = (await readFlows()).slice(recoveryFlowCount);
  const state = application.readApplicationState();

  expect({
    schema: "fadeno.example.form-submission-terminal-flow",
    version: 1,
    redirectRecorded: redirectFlows.some((flow) => flow["operation"] === "mutation"
      && flow["status"] === "applied"
      && flow["outcome"] === "enhanced-redirect"),
    redirectDestinationRequests,
    redirectAvoidedDocumentReload,
    signedInTruthVisible,
    failedRedirectRecoveryRequests,
    failedRedirectRecoveryVisible,
    failedRedirectRecoveryRecorded: failedRedirectFlows.some((flow) => flow["code"] === "FADENO_FORM_MUTATION_CURRENT_TRUTH"
      && flow["outcome"] === "current-truth-reload"),
    terminalRecoveryRecorded: recoveryFlows.some((flow) => flow["code"] !== "FADENO_FORM_MUTATION_CURRENT_TRUTH"
      && flow["status"] === "refused"
      && flow["outcome"] === "current-truth-reload"),
    recoveryCancellationRecovered: recoveryFlows.some((flow) => flow["code"] === "FADENO_FORM_MUTATION_CURRENT_TRUTH"
      && flow["outcome"] === "current-truth-reload"),
    mutationRequests: privateMutations().length,
    signInRuns: state.signInRuns,
    forbiddenRuns: state.forbiddenRuns,
  }).toEqual(expected("terminal-flow"));
});

test("recovers committed current truth when close is cancelled during the redirect GET", async ({ page }) => {
  await page.goto(`${origin}/projects`);
  await page.locator("#passcode").fill("example-owner");
  delayedPrivateGetPath = "/projects";
  delayedPrivateGetMilliseconds = 400;
  const mutationsBefore = privateMutations().length;
  const redirectGetsBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects"
    && accept === mediaType).length;
  const nativeGetsBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects"
    && accept !== mediaType).length;
  await page.locator("#sign-in-form button").click();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects"
    && accept === mediaType).length).toBe(redirectGetsBefore + 1);
  await page.evaluate(() => globalThis.addEventListener("beforeunload", (event) => {
    event.preventDefault();
    event.returnValue = "keep the current document";
  }, { once: true }));
  const closeDialog = page.waitForEvent("dialog");
  const closeCall = page.evaluate(() => {
    const runtime = Reflect.get(globalThis, "__fadenoExampleEnhancement") as { close(): void };
    runtime.close();
  });
  await (await closeDialog).dismiss();
  await closeCall;
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects"
    && accept === mediaType).length).toBe(redirectGetsBefore + 2);
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const currentTruthVisible = await page.locator("#viewer").textContent() === "Signed in owner";
  const enhancementActiveAfterRecovery = await page.evaluate(() => {
    const runtime = Reflect.get(globalThis, "__fadenoExampleEnhancement") as { state(): string };
    return runtime.state() === "active";
  });
  const enhancedHomeGetsBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/"
    && accept === mediaType).length;
  const documentLoadsBefore = await page.evaluate(() => performance.getEntriesByType("navigation").length);
  await page.getByRole("link", { name: "Search" }).click();
  await expect(page.locator("h1")).toHaveText("GET form navigation");
  const state = application.readApplicationState();
  expect({
    schema: "fadeno.example.action-ordering-close-recovery",
    version: 1,
    mutationRequests: privateMutations().length - mutationsBefore,
    redirectGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/projects"
      && accept === mediaType).length - redirectGetsBefore,
    nativeCurrentTruthGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/projects"
      && accept !== mediaType).length - nativeGetsBefore,
    signInRuns: state.signInRuns,
    currentTruthVisible,
    enhancementActiveAfterRecovery,
    enhancedNavigationAfterRecovery: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/"
      && accept === mediaType).length - enhancedHomeGetsBefore,
    documentLoads: await page.evaluate(() => performance.getEntriesByType("navigation").length) - documentLoadsBefore,
  }).toEqual(expected("close-recovery"));
});

test("repairs a staged redirect URL before cancelled replacement recovery", async ({ page }) => {
  await page.goto(`${origin}/projects`);
  await page.locator("#redirect-away-passcode").fill("example-owner");
  const mutationsBefore = privateMutations().length;
  const redirectGetsBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/"
    && accept === mediaType).length;
  const recoveryGetsBefore = transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects"
    && accept === mediaType).length;
  await page.evaluate(() => {
    const body = document.body;
    const originalReplaceChildren = body.replaceChildren;
    body.replaceChildren = (..._nodes: (Node | string)[]): void => {
      body.replaceChildren = originalReplaceChildren;
      throw new Error("intentional post-selection commit failure");
    };
    globalThis.addEventListener("beforeunload", (event) => {
      event.preventDefault();
      event.returnValue = "keep the current document";
    }, { once: true });
  });
  const replacementDialog = page.waitForEvent("dialog");
  await page.locator("#redirect-away-form button").click({ noWaitAfter: true });
  await (await replacementDialog).dismiss();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/projects");
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/projects"
    && accept === mediaType).length).toBe(recoveryGetsBefore + 1);
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const state = application.readApplicationState();
  const flows = await page.evaluate(async () => {
    const modulePath: string = "/_fadeno/framework/internal/browser-navigation.js";
    const runtime = await import(modulePath) as Readonly<{ readPrivateFormSubmissionFlows(): readonly Record<string, unknown>[] }>;
    return runtime.readPrivateFormSubmissionFlows();
  });
  expect({
    schema: "fadeno.example.action-ordering-staged-recovery",
    version: 1,
    mutationRequests: privateMutations().length - mutationsBefore,
    redirectGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/"
      && accept === mediaType).length - redirectGetsBefore,
    recoveryGets: transportRequests.filter(({ method, path, accept }) => method === "GET"
      && path === "/projects"
      && accept === mediaType).length - recoveryGetsBefore,
    redirectAwayRuns: state.redirectAwayRuns,
    finalPath: new URL(page.url()).pathname,
    currentTruthVisible: await page.locator("#viewer").textContent() === "Signed in owner",
    recoveryRecorded: flows.some((flow) => flow["code"] === "FADENO_FORM_MUTATION_CURRENT_TRUTH"
      && flow["outcome"] === "current-truth-reload"),
  }).toEqual(expected("staged-recovery"));
});

test("repairs selected traversal URLs and retains recovery through unsafe traversal", async ({ page }) => {
  const projectGets = (): number => transportRequests.filter(({ method, path }) => method === "GET" && path === "/projects").length;
  const documentEpoch = (): Promise<string | null> => page.locator('meta[name="fadeno-document-epoch"]').getAttribute("content");
  const establishForwardEntry = async (unsafe: boolean): Promise<void> => {
    await page.getByRole("link", { name: "Search" }).click();
    await expect(page.locator("h1")).toHaveText("GET form navigation");
    if (unsafe) {
      await page.evaluate(() => {
        const spacer = document.createElement("div");
        spacer.style.height = "3000px";
        document.body.append(spacer);
        scrollTo(0, 200);
      });
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    }
    await page.goBack();
    await expect(page.locator("h1")).toHaveText("Project forms");
  };

  await signIn(page);
  await establishForwardEntry(false);
  holdNextPrivateGetResponse = true;
  holdNextPrivateGetPath = "/redirect-chain";
  const mutationsBefore = privateMutations().length;
  const safeGetsBefore = projectGets();
  const safeEpochBefore = await documentEpoch();
  await page.locator("#redirect-chain-form button").click();
  await expect.poll(() => transportRequests.some(({ method, path, accept }) => method === "GET"
    && path === "/redirect-chain" && accept === mediaType)).toBe(true);
  await page.evaluate(() => {
    const body = document.body;
    const originalReplaceChildren = body.replaceChildren;
    body.replaceChildren = (..._nodes: (Node | string)[]): void => {
      body.replaceChildren = originalReplaceChildren;
      throw new Error("intentional traversal commit failure");
    };
    globalThis.addEventListener("beforeunload", (event) => {
      event.preventDefault();
      event.returnValue = "keep committed current truth";
    }, { once: true });
  });
  const selectedCommitDialog = page.waitForEvent("dialog");
  await page.evaluate(() => history.forward());
  await (await selectedCommitDialog).dismiss();
  await expect.poll(() => documentEpoch()).not.toBe(safeEpochBefore);
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const selectedCommitFailure = {
    currentTruthReloaded: projectGets() > safeGetsBefore,
    finalPath: new URL(page.url()).pathname,
    currentTruthVisible: await page.locator("#viewer").textContent() === "Signed in owner",
  };

  await page.context().clearCookies();
  await signIn(page);
  await establishForwardEntry(true);
  holdNextPrivateGetResponse = true;
  holdNextPrivateGetPath = "/redirect-chain";
  const unsafeGetsBefore = projectGets();
  const unsafeEpochBefore = await documentEpoch();
  await page.locator("#redirect-chain-form button").click();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/redirect-chain" && accept === mediaType).length).toBe(2);
  await page.evaluate(() => globalThis.addEventListener("beforeunload", (event) => {
    event.preventDefault();
    event.returnValue = "keep committed current truth";
  }, { once: true }));
  const unsafeTraversalDialog = page.waitForEvent("dialog");
  await page.evaluate(() => history.forward());
  await (await unsafeTraversalDialog).dismiss();
  await expect.poll(() => documentEpoch()).not.toBe(unsafeEpochBefore);
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");

  await page.context().clearCookies();
  await signIn(page);
  holdNextPrivateGetResponse = true;
  holdNextPrivateGetPath = "/redirect-chain";
  const getFormTruthBefore = projectGets();
  await page.locator("#redirect-chain-form button").click();
  await expect.poll(() => transportRequests.filter(({ method, path, accept }) => method === "GET"
    && path === "/redirect-chain" && accept === mediaType).length).toBe(3);
  await page.evaluate(() => {
    const form = document.createElement("form");
    form.id = "inherited-get-form";
    form.method = "get";
    form.action = "/";
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Supersede with GET form";
    form.append(submit);
    document.body.prepend(form);
    const body = document.body;
    const originalReplaceChildren = body.replaceChildren;
    body.replaceChildren = (..._nodes: (Node | string)[]): void => {
      body.replaceChildren = originalReplaceChildren;
      throw new Error("intentional inherited GET form commit failure");
    };
    globalThis.addEventListener("beforeunload", (event) => {
      event.preventDefault();
      event.returnValue = "keep committed mutation truth";
    }, { once: true });
  });
  const getFormRecoveryDialog = page.waitForEvent("dialog");
  await page.locator("#inherited-get-form button").click({ noWaitAfter: true });
  await (await getFormRecoveryDialog).dismiss();
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const getFormPushFailure = {
    currentTruthReloaded: projectGets() > getFormTruthBefore,
    finalPath: new URL(page.url()).pathname,
    currentTruthVisible: await page.locator("#viewer").textContent() === "Signed in owner",
  };
  const state = application.readApplicationState();
  expect({
    schema: "fadeno.example.action-ordering-traversal-recovery",
    version: 1,
    mutationRequests: privateMutations().length - mutationsBefore,
    signInRuns: state.signInRuns,
    redirectChainRuns: state.redirectChainRuns,
    selectedCommitFailure,
    unsafeTraversal: {
      currentTruthReloaded: projectGets() > unsafeGetsBefore,
      finalPath: new URL(page.url()).pathname,
      currentTruthVisible: await page.locator("#viewer").textContent() === "Signed in owner",
    },
    getFormPushFailure,
    mutationRetried: privateMutations().length - mutationsBefore > 5,
  }).toEqual(expected("traversal-recovery"));
  expect(readFileSync(join(outputRoot, "expected-traversal-recovery-human.txt"), "utf8"))
    .toContain("selected and unsafe traversal cancellation repaired committed truth");
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
    const owner = document.createElement("form");
    owner.id = "other-form";
    document.body.append(owner);
    const input = document.createElement("input");
    input.setAttribute("form", owner.id);
    input.defaultValue = "before";
    input.value = "after";
    document.querySelector("#search-form")?.append(input);
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

test("preserves form privacy, focus ownership, and legal current-truth URLs", async ({ page }) => {
  await page.goto(origin);
  await expect.poll(async () => page.evaluate(() => Boolean(Reflect.get(globalThis, "__fadenoExampleEnhancement")))).toBe(true);
  requests.length = 0;
  transportRequests.length = 0;
  await page.locator("#search-form").evaluate((element) => element.setAttribute("rel", "noreferrer"));
  await page.locator("#search-form button").click();
  await expect(page.locator("h1")).toHaveText("Search result");
  const privateAfterNoreferrer = transportRequests.filter(({ accept }) => accept === mediaType).length;
  const noreferrerStayedNative = requests.some(({ method, path, privateUpdate }) => method === "GET"
    && path === "/search"
    && !privateUpdate);

  await page.goto(origin);
  await expect.poll(async () => page.evaluate(() => Boolean(Reflect.get(globalThis, "__fadenoExampleEnhancement")))).toBe(true);
  requests.length = 0;
  transportRequests.length = 0;
  await page.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>("#search-form");
    const submitter = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!form || !submitter) throw new Error("FADENO_V2_FORM_FOCUS_FIXTURE");
    const anchor = document.createElement("a");
    anchor.id = "unowned-focus";
    anchor.href = "#submit";
    anchor.textContent = "Submit while this link owns focus";
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      anchor.focus();
      form.requestSubmit(submitter);
    });
    form.addEventListener("submit", (event) => {
      sessionStorage.setItem("fadeno-example-submit-trusted", String(event.isTrusted));
    }, { capture: true });
    form.prepend(anchor);
  });
  const focusLoad = page.waitForEvent("load");
  await page.locator("#unowned-focus").click({ noWaitAfter: true });
  await focusLoad;
  await expect(page.locator("h1")).toHaveText("Search result");
  const unownedFocusSubmitTrusted = await page.evaluate(() => sessionStorage.getItem("fadeno-example-submit-trusted") === "true");
  const privateAfterUnownedFocus = transportRequests.filter(({ accept }) => accept === mediaType).length;

  transportRequests.length = 0;
  await page.goto(`${origin}/projects?filter=a,b`);
  await page.locator("#passcode").fill("example-owner");
  await page.locator("#sign-in-form button").click();
  await expect(page.locator("#viewer")).toHaveText("Signed in owner");
  const mutation = privateMutations().at(-1);
  expect({
    schema: "fadeno.example.form-submission-privacy",
    version: 1,
    noreferrerPrivateRequests: privateAfterNoreferrer,
    noreferrerStayedNative,
    unownedFocusSubmitTrusted,
    unownedFocusPrivateRequests: privateAfterUnownedFocus,
    commaCurrentTruthEncoded: mutation?.currentTruth?.includes("%2C") === true,
    commaActionRuns: application.readApplicationState().signInRuns,
  }).toEqual(expected("privacy"));
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
    expect(new URL(page.url()).search).toBe("?q=thread&flag=on&tag=alpha&tag=beta&choice=exact&notes=first%0D%0Asecond&submitter=search");
    expect(requests.some(({ method, path, privateUpdate }) => method === "GET" && path === "/search" && !privateUpdate)).toBe(true);

    await page.goto(`${origin}/projects`);
    await page.locator("#passcode").fill("example-owner");
    await page.locator("#sign-in-form button").click();
    await expect(page.locator("#viewer")).toHaveText("Signed in owner");
    expect(application.readApplicationState().signInRuns).toBe(1);
  });

  test("completes authenticated CRUD through native documents without JavaScript", async ({ page }) => {
    await page.goto(`${origin}/projects`);
    await page.locator("#passcode").fill("example-owner");
    await page.locator("#sign-in-form button").click();
    await page.locator("#title").fill("Native Thread");
    await page.locator("#create-form button").click();
    await expect(page.locator(".project-title")).toHaveText("Native Thread");
    await page.locator("#update-title").fill("Native Ordered Thread");
    await page.locator("#update-form button").click();
    await expect(page.locator(".project-title")).toHaveText("Native Ordered Thread");
    await page.locator("#delete-form button").click();
    await expect(page.locator(".project-title")).toHaveCount(0);
    const state = application.readApplicationState();
    expect({
      schema: "fadeno.example.action-ordering-native-crud",
      version: 1,
      privateRequests: transportRequests.filter(({ accept }) => accept === mediaType).length,
      projects: state.projects,
      signInRuns: state.signInRuns,
      createRuns: state.createRuns,
      updateRuns: state.updateRuns,
      deleteRuns: state.deleteRuns,
      staleOutputAbsent: await page.getByText(/Native/u).count() === 0,
    }).toEqual(expected("native-crud"));
  });
});
