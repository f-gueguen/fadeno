import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "@playwright/test";

const root = process.cwd();
const outputRoot = join(root, "output/v2-link-navigation");
const consumer = join(outputRoot, "consumer");
const site = join(outputRoot, "site");
const expected = (name: string): unknown => JSON.parse(readFileSync(join(outputRoot, `expected-${name}.json`), "utf8")) as unknown;

type Application = Readonly<{
  applicationGeneration: string;
  handler(request: Request): Response | Promise<Response>;
}>;
type NodeModule = Readonly<{
  listenNodeHttp(options: Readonly<{ handler: Application["handler"]; hostname: string; port: number; applicationGeneration: string }>): Promise<Readonly<{ origin: string; close(): Promise<void> }>>;
}>;

let origin = "";
let closeServer: (() => Promise<void>) | undefined;
const requests: { path: string; enhanced: boolean; cookie: string | null }[] = [];

test.beforeAll(async () => {
  const application = await import(pathToFileURL(join(consumer, "dist/application.js")).href) as Application;
  const node = await import(pathToFileURL(join(consumer, "node_modules/@fadeno/framework/dist/node.js")).href) as NodeModule;
  const handler: Application["handler"] = async (request) => {
    const url = new URL(request.url);
    requests.push({
      path: url.pathname,
      enhanced: request.headers.get("accept") === "application/vnd.fadeno.private-update+json; version=1",
      cookie: request.headers.get("cookie"),
    });
    if (url.pathname.startsWith("/_fadeno/")) {
      try {
        const body = readFileSync(join(site, url.pathname), "utf8");
        return new Response(body, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" } });
      } catch {
        return new Response("not found", { status: 404 });
      }
    }
    return application.handler(request);
  };
  const server = await node.listenNodeHttp({
    handler,
    hostname: "127.0.0.1",
    port: 0,
    applicationGeneration: application.applicationGeneration,
  });
  origin = server.origin;
  closeServer = server.close;
});

test.afterAll(async () => closeServer?.());
test.beforeEach(() => { requests.length = 0; });

test("enhances one safe link with document, title, URL, history, and focus", async ({ page }) => {
  await page.goto(origin);
  expect(await page.evaluate(() => history.state)).toEqual({ "fadeno.private.navigation.v1": true });
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  const result = {
    schema: "fadeno.example.link-navigation-success",
    version: 1,
    heading: await page.locator("h1").textContent(),
    title: await page.title(),
    path: new URL(page.url()).pathname,
    documentLoads: await page.evaluate(() => performance.getEntriesByType("navigation").length),
    focus: await page.evaluate(() => document.activeElement?.tagName),
  };
  expect(requests.filter(({ path }) => path === "/next")).toEqual([{ path: "/next", enhanced: true, cookie: null }]);
  expect(result).toEqual(expected("success"));
});

test("keeps unsafe browser-owned state native before request ownership", async ({ page }) => {
  await page.goto(origin);
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.defaultValue = "before";
    input.value = "after";
    document.body.append(input);
  });
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  expect(requests.some(({ path, enhanced }) => path === "/next" && !enhanced)).toBe(true);
  expect(expected("refusal")).toEqual({
    schema: "fadeno.example.link-navigation-refusal",
    version: 1,
    code: "FADENO_LINK_PRESERVATION_NATIVE",
    cause: "dirty control remained browser-owned",
    outcome: "native-navigation",
  });
  expect(readFileSync(join(outputRoot, "expected-refusal-human.txt"), "utf8").trim()).toContain("kept the link native");
});

test("cancels obsolete work and applies only the latest result", async ({ page }) => {
  await page.goto(origin);
  await page.locator("#slow-link").click();
  await page.waitForTimeout(50);
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  await page.waitForTimeout(600);
  const recovery = {
    schema: "fadeno.example.link-navigation-recovery",
    version: 1,
    cancelledHeadingAbsent: await page.getByRole("heading", { name: "Slow" }).count() === 0,
    latestHeading: await page.locator("h1").textContent(),
    unprojectableOutcome: "native-navigation",
    staleUpdateApplied: await page.getByRole("heading", { name: "Slow" }).count() !== 0,
  };
  expect(recovery).toEqual(expected("recovery"));
});

test("uses native recovery when the server cannot project an outcome", async ({ page }) => {
  await page.goto(origin);
  await page.locator("#recovery-link").click();
  await expect(page.locator("h1")).toHaveText("Native recovery");
  expect(requests.filter(({ path }) => path === "/unprojectable").map(({ enhanced }) => enhanced)).toEqual([true, false]);
  expect(await page.locator(`meta[name="fadeno-document-epoch"]`).count()).toBe(0);
});

test("retains target, download, modifier, and fragment browser behavior", async ({ page, context }) => {
  await page.goto(origin);
  const popupPromise = context.waitForEvent("page");
  await page.locator("#target-link").click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  expect(new URL(popup.url()).pathname).toBe("/target");
  await popup.close();

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#download-link").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("example.txt");

  const modifierPagePromise = context.waitForEvent("page");
  await page.locator("#next-link").click({ modifiers: ["ControlOrMeta"] });
  const modifierPage = await modifierPagePromise;
  await modifierPage.waitForURL(`${origin}/next`);
  expect(new URL(modifierPage.url()).pathname).toBe("/next");
  await modifierPage.close();

  await page.locator("#fragment-link").click();
  expect(new URL(page.url()).hash).toBe("#details");
  expect(requests.filter(({ path }) => path === "/next" || path === "/target" || path === "/download").every(({ enhanced }) => !enhanced)).toBe(true);
});

test("refuses hostile links and unqualified preservation boundaries before interception", async ({ page }) => {
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const modulePath: string = "/_fadeno/framework/internal/browser-navigation.js";
    const runtime = await import(modulePath) as Readonly<{
      privateLinkPreservationSafe(anchor?: HTMLAnchorElement): boolean;
      privateSafeLinkDestination(anchor: HTMLAnchorElement): URL | undefined;
    }>;
    const classify = (href: string, attributes: Record<string, string> = {}): boolean => {
      const anchor = document.createElement("a");
      anchor.href = href;
      for (const [name, value] of Object.entries(attributes)) anchor.setAttribute(name, value);
      return runtime.privateSafeLinkDestination(anchor) !== undefined;
    };
    const state = (markup: string, prepare?: () => void): boolean => {
      document.body.insertAdjacentHTML("beforeend", markup);
      prepare?.();
      const safe = runtime.privateLinkPreservationSafe();
      document.body.lastElementChild?.remove();
      return safe;
    };
    const text = document.createTextNode("selected text");
    const paragraph = document.createElement("p");
    paragraph.append(text);
    document.body.append(paragraph);
    const selection = document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(text);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const selectionSafe = runtime.privateLinkPreservationSafe();
    selection?.removeAllRanges();
    paragraph.remove();
    return {
      links: {
        external: classify("https://outside.invalid/path"),
        credentials: classify(`${location.protocol}//user@${location.host}/next`),
        scheme: classify("mailto:test@example.invalid"),
        target: classify("/next", { target: "_blank" }),
        download: classify("/next", { download: "file" }),
        fragment: classify("#details"),
        crossDocumentFragment: classify("/next#details"),
      },
      state: {
        disclosure: state("<details open><summary>Open</summary></details>"),
        topLayer: state("<dialog open>Open</dialog>"),
        media: state("<video></video>"),
        island: state("<div data-fadeno-island></div>"),
        contentEditable: state('<div contenteditable="true"></div>'),
        selection: selectionSafe,
        elementScroll: state('<textarea rows="1">first\nsecond\nthird</textarea>', () => { const element = document.body.lastElementChild; if (element) element.scrollTop = 10; }),
      },
    };
  });
  expect(result).toEqual({
    links: { external: false, credentials: false, scheme: false, target: false, download: false, fragment: false, crossDocumentFragment: false },
    state: { disclosure: false, topLayer: false, media: false, island: false, contentEditable: false, selection: false, elementScroll: false },
  });
});

test("supports enhanced back and forward traversal", async ({ page }) => {
  await page.goto(origin);
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  await page.goBack();
  await expect(page.locator("h1")).toHaveText("Home");
  await page.goForward();
  await expect(page.locator("h1")).toHaveText("Next");
  expect(requests.filter(({ path, enhanced }) => enhanced && (path === "/" || path === "/next")).length).toBeGreaterThanOrEqual(3);
});

test("keeps request ownership, hostile correlations, limits, and logs isolated", async () => {
  const privateRequest = (owner: string, operation: string): Promise<Response> => fetch(`${origin}/owner`, { headers: {
    accept: "application/vnd.fadeno.private-update+json; version=1",
    cookie: `owner=${owner}`,
    "x-fadeno-current-url": `${origin}/`,
    "x-fadeno-document-epoch": `document-${owner}`,
    "x-fadeno-operation-id": operation,
    "x-fadeno-operation-sequence": "1",
  } });
  const first = await privateRequest("first", "owner-first");
  const second = await privateRequest("second", "owner-second");
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(first.headers.get("cache-control")).toContain("no-store");
  expect(second.headers.get("cache-control")).toContain("no-store");
  const firstBody = await first.text();
  const secondBody = await second.text();
  expect(firstBody).toContain("owner=first");
  expect(firstBody).not.toContain("owner=second");
  expect(secondBody).toContain("owner=second");
  expect(secondBody).not.toContain("owner=first");

  const secret = "secret-correlation-value";
  const hostile = await fetch(`${origin}/owner`, { headers: {
    accept: "application/vnd.fadeno.private-update+json; version=1",
    "x-fadeno-current-url": `https://outside.invalid/${secret}`,
    "x-fadeno-document-epoch": "document-hostile",
    "x-fadeno-operation-id": "owner-hostile",
    "x-fadeno-operation-sequence": "1",
  } });
  expect(hostile.status).toBe(400);
  expect(hostile.headers.get("x-fadeno-update-code")).toBe("FADENO_UPDATE_REQUEST_SCHEMA");
  expect(`${[...hostile.headers].map(([name, value]) => `${name}:${value}`).join("\n")}\n${await hostile.text()}`).not.toContain(secret);

  const oversized = await fetch(`${origin}/owner`, { headers: {
    accept: "application/vnd.fadeno.private-update+json; version=1",
    "x-fadeno-current-url": `${origin}/`,
    "x-fadeno-document-epoch": "document-limit",
    "x-fadeno-operation-id": `owner-${"x".repeat(256)}`,
    "x-fadeno-operation-sequence": "1",
  } });
  expect(oversized.status).toBe(400);
  expect(oversized.headers.get("x-fadeno-update-code")).toBe("FADENO_UPDATE_REQUEST_SCHEMA");
});

test("admits a typed redirect and reaches its same-origin destination", async ({ page }) => {
  await page.goto(origin);
  await page.locator("#redirect-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  expect(new URL(page.url()).pathname).toBe("/next");
  expect(requests.filter(({ path }) => path === "/redirect").map(({ enhanced }) => enhanced)).toEqual([true]);
  expect(requests.filter(({ path }) => path === "/next").map(({ enhanced }) => enhanced)).toEqual([false]);
});

test("retains normalized flow evidence without exposing a public schema", async ({ page }) => {
  await page.goto(origin);
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  const actual = await page.evaluate(async () => {
    const modulePath: string = "/_fadeno/framework/internal/browser-navigation.js";
    const runtime = await import(modulePath) as Readonly<{
      readPrivateLinkNavigationFlows(): readonly unknown[];
    }>;
    return runtime.readPrivateLinkNavigationFlows().at(-1);
  });
  expect(actual).toEqual(expected("flow"));
  expect(actual).toEqual({
    schema: "fadeno.private.link-navigation-flow",
    version: 1,
    status: "applied",
    code: "FADENO_UPDATE_DOCUMENT",
    redaction: "applied",
    decisions: [
      "eligible same-origin GET acquired browser operation ownership",
      "exact native server response was projected once",
      "current generation, epoch, operation, URL, cache, and result were admitted",
      "document, title, URL, history, and focus committed",
    ],
    ownership: {
      browser: ["activation", "operation", "history", "focus"],
      server: ["authorization", "route", "resources", "rendered outcome"],
    },
    skipped: ["form interception", "general state reconciliation", "transported script execution"],
    outcome: "enhanced-document",
  });
});
