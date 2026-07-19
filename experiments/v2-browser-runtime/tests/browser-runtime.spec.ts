import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

const root = process.cwd();
const outputRoot = join(root, "output/v2-browser-runtime");
const siteRoot = join(outputRoot, "site");
const render = JSON.parse(readFileSync(join(outputRoot, "render.json"), "utf8")) as {
  html: string;
  contentSecurityPolicy: string;
  rollbackHtml: string;
  rollbackContentSecurityPolicy: string;
};
const expectedSuccess = JSON.parse(readFileSync(join(outputRoot, "expected-success.json"), "utf8")) as Record<string, unknown>;

let server: Server;
let origin = "";

function send(response: import("node:http").ServerResponse, status: number, contentType: string, body: string, csp?: string): void {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    ...(csp ? { "content-security-policy": csp } : {}),
  });
  response.end(body);
}

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname === "/") return send(response, 200, "text/html; charset=utf-8", render.html, render.contentSecurityPolicy);
    if (pathname === "/wrong-nonce") {
      return send(response, 200, "text/html; charset=utf-8", render.html.replace(/nonce="[A-Za-z0-9_-]+"/u, 'nonce="wrong"'), render.contentSecurityPolicy);
    }
    if (pathname === "/missing-nonce") {
      return send(response, 200, "text/html; charset=utf-8", render.html.replace(/ nonce="[A-Za-z0-9_-]+"/u, ""), render.contentSecurityPolicy);
    }
    if (pathname === "/blocked-module") {
      return send(response, 200, "text/html; charset=utf-8", render.html.replace("/_fadeno/browser-entry.js", "/_fadeno/missing-entry.js"), render.contentSecurityPolicy);
    }
    if (pathname === "/rollback") return send(response, 200, "text/html; charset=utf-8", render.rollbackHtml, render.rollbackContentSecurityPolicy);
    if (pathname === "/native-next") return send(response, 200, "text/plain; charset=utf-8", "native link destination");
    if (pathname === "/native-submit") return send(response, 200, "text/plain; charset=utf-8", `native form ${new URL(request.url ?? "/", "http://localhost").searchParams.get("value") ?? ""}`);
    if (pathname.startsWith("/_fadeno/") && pathname !== "/_fadeno/missing-entry.js") {
      try {
        return send(response, 200, "text/javascript; charset=utf-8", readFileSync(join(siteRoot, pathname), "utf8"));
      } catch {
        return send(response, 404, "text/plain; charset=utf-8", "not found");
      }
    }
    return send(response, 404, "text/plain; charset=utf-8", "not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("FADENO_V2_BROWSER_RUNTIME_SERVER");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

test("loads the current packed browser artifact through the renderer nonce", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Reflect.get(globalThis, Symbol.for("fadeno.example.browser-runtime")) !== undefined);
  const state = await page.evaluate(() => Reflect.get(globalThis, Symbol.for("fadeno.example.browser-runtime")) as unknown);
  expect({
    schema: "fadeno.example.browser-runtime",
    version: 1,
    module: "loaded",
    ...(state as object),
    nativeLink: await page.locator("#native-link").isVisible(),
    nativeForm: await page.locator("#native-form").isVisible(),
  }).toEqual(expectedSuccess);
  expect(await page.locator('script[type="module"]').count()).toBe(1);
});

for (const path of ["/wrong-nonce", "/missing-nonce", "/blocked-module"] as const) {
  test(`keeps native controls when ${path.slice(1).replaceAll("-", " ")}`, async ({ page }) => {
    await page.goto(`${origin}${path}`);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => Reflect.get(globalThis, Symbol.for("fadeno.example.browser-runtime")))).toBeUndefined();
    await expect(page.locator("#native-link")).toBeVisible();
    await expect(page.locator("#native-form")).toBeVisible();
  });
}

test("keeps native navigation and form submission with JavaScript disabled", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto(origin);
    await page.locator("#native-link").click();
    await expect(page.locator("body")).toHaveText("native link destination");
    await page.goto(origin);
    await page.locator("#native-form button").click();
    await expect(page.locator("body")).toHaveText("native form native");
  } finally {
    await context.close();
  }
});

test("rollback emits no browser artifact and restores script-none policy", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/_fadeno/")) requests.push(request.url()); });
  const response = await page.goto(`${origin}/rollback`);
  expect(response?.headers()["content-security-policy"]).toContain("script-src 'none'");
  expect(requests).toEqual([]);
  await expect(page.locator("#native-link")).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(globalThis, Symbol.for("fadeno.example.browser-runtime")))).toBeUndefined();
});
