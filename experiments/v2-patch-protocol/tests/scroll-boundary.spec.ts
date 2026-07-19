import { expect, test } from "@playwright/test";

import { decidePrivateScrollBoundary } from "../../../scripts/lib/v2-patch-protocol.ts";
import type { PrivateScrollBoundaryDecision, PrivateScrollBoundaryInput } from "../../../scripts/lib/v2-patch-protocol.ts";

const browserDecision = (
  page: import("@playwright/test").Page,
  input: PrivateScrollBoundaryInput,
): Promise<PrivateScrollBoundaryDecision> => page.evaluate<PrivateScrollBoundaryDecision, PrivateScrollBoundaryInput>(
  decidePrivateScrollBoundary,
  input,
);

test.beforeEach(async ({ page }) => {
  const blockedRequests: string[] = [];
  page.on("request", (request) => {
    if (/^https?:/u.test(request.url())) blockedRequests.push(request.url());
  });
  await page.setContent(`<!doctype html>
    <meta charset="utf-8">
    <style>
      body { margin: 0; }
      #before { height: 1600px; }
      #after { height: 2400px; }
      #scroller { height: 240px; overflow: auto; }
      #scroller-before { height: 900px; }
      #scroller-after { height: 1200px; }
    </style>
    <div id="before"></div>
    <main id="root">Current server truth</main>
    <div id="after"></div>
    <section id="scroller"><div id="scroller-before"></div><div id="scroller-root">Current nested truth</div><div id="scroller-after"></div></section>`);
  expect(blockedRequests).toEqual([]);
});

test("refuses document-preceding layout before mutation", async ({ page }) => {
  await page.evaluate(() => window.scrollTo(0, 1_200));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(1_200);
  const before = await page.evaluate(() => ({ scroll: window.scrollY, html: document.body.innerHTML }));
  const result = await browserDecision(page, {
    documentPrecedingLayout: "affected",
    elementPrecedingLayout: "unaffected",
  });
  if (result.decision === "apply") {
    await page.evaluate(() => {
      const insertion = document.createElement("div");
      insertion.style.height = "400px";
      document.querySelector("#root")?.before(insertion);
    });
  }
  expect(result).toEqual({ decision: "refuse", code: "FADENO_UPDATE_SCROLL_BOUNDARY", cause: "document-layout" });
  expect(await page.evaluate(() => ({ scroll: window.scrollY, html: document.body.innerHTML }))).toEqual(before);
});

test("refuses element-preceding layout before mutation", async ({ page }) => {
  await page.locator("#scroller").evaluate((element) => { element.scrollTop = 700; });
  await expect.poll(() => page.locator("#scroller").evaluate((element) => element.scrollTop)).toBe(700);
  const before = await page.locator("#scroller").evaluate((element) => ({ scroll: element.scrollTop, html: element.innerHTML }));
  const result = await browserDecision(page, {
    documentPrecedingLayout: "unaffected",
    elementPrecedingLayout: "affected",
  });
  if (result.decision === "apply") {
    await page.locator("#scroller-root").evaluate((element) => {
      const insertion = document.createElement("div");
      insertion.style.height = "300px";
      element.before(insertion);
    });
  }
  expect(result).toEqual({ decision: "refuse", code: "FADENO_UPDATE_SCROLL_BOUNDARY", cause: "element-layout" });
  expect(await page.locator("#scroller").evaluate((element) => ({ scroll: element.scrollTop, html: element.innerHTML }))).toEqual(before);
});

test("admits only a proven-unaffected boundary", async ({ page }) => {
  await page.evaluate(() => window.scrollTo(0, 1_200));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(1_200);
  const before = await page.evaluate(() => window.scrollY);
  const result = await browserDecision(page, {
    documentPrecedingLayout: "unaffected",
    elementPrecedingLayout: "unaffected",
  });
  if (result.decision === "apply") {
    await page.evaluate(() => {
      const insertion = document.createElement("p");
      insertion.id = "safe-update";
      insertion.textContent = "Server-owned update after the relevant viewport";
      document.querySelector("#after")?.append(insertion);
    });
  }
  expect(result).toEqual({ decision: "apply", code: "FADENO_UPDATE_SCROLL_SAFE", cause: "proven-unaffected" });
  await expect(page.locator("#safe-update")).toHaveCount(1);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
});
