import { expect, test } from "@playwright/test";
import type { Route } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ExtractionObservation, ExtractionProject } from "../contract.ts";
import { verifyAcceptedObservation } from "../accepted-proof.ts";
import {
  DOCUMENT_MODULE,
  EXTRACTION_ORIGIN,
  HANDLER_MODULE,
  RUNTIME_RESPONSES,
  SHARED_MODULE,
} from "../runtime-fixture.ts";

function pathOf(url: string): string {
  return new URL(url).pathname;
}

async function fulfill(route: Route): Promise<void> {
  const response = RUNTIME_RESPONSES.get(pathOf(route.request().url()));
  if (!response) return route.abort("blockedbyclient");
  await route.fulfill({
    status: 200,
    body: response.body,
    contentType: response.contentType,
    headers: { "cache-control": "no-store", "access-control-allow-origin": "*" },
  });
}

test("seeded-accepted-loading-control", async ({ browser, page }, testInfo) => {
  const engine = testInfo.project.name as ExtractionProject;
  const requests: string[] = [];
  let releaseHandler: (() => void) | undefined;
  let observeHandler: (() => void) | undefined;
  const handlerRequested = new Promise<void>((resolve) => { observeHandler = resolve; });
  const handlerGate = new Promise<void>((resolve) => { releaseHandler = resolve; });
  await page.route(`${EXTRACTION_ORIGIN}/**`, async (route) => {
    const path = pathOf(route.request().url());
    requests.push(path);
    if (path === "/handler.js") {
      observeHandler?.();
      await handlerGate;
    }
    await fulfill(route);
  });
  await page.goto(`${EXTRACTION_ORIGIN}/`);
  await expect(page.locator("#value")).toHaveText("0");
  const preTriggerRequests = [...requests];
  expect(preTriggerRequests).toEqual(["/", "/document.js"]);
  expect(DOCUMENT_MODULE).not.toContain("fadeno-handler-only-sentinel");

  await page.locator("#increment").click();
  await handlerRequested;
  const valueWhileHandlerBlocked = await page.locator("#value").textContent() ?? "";
  const firstStart = requests.length - 1;
  releaseHandler?.();
  await expect(page.locator("#value")).toHaveText("1");
  const valueAfterFirstTrigger = await page.locator("#value").textContent() ?? "";
  const firstTriggerRequests = requests.slice(firstStart);
  const beforeSecond = requests.length;
  await page.locator("#increment").click();
  await expect(page.locator("#value")).toHaveText("2");

  const noJavaScriptRequests: string[] = [];
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block" });
  const baseline = await context.newPage();
  await baseline.route(`${EXTRACTION_ORIGIN}/**`, async (route) => {
    noJavaScriptRequests.push(pathOf(route.request().url()));
    await fulfill(route);
  });
  await baseline.goto(`${EXTRACTION_ORIGIN}/`);
  const noJavaScriptValue = await baseline.locator("#value").textContent() ?? "";
  await context.close();

  const observation: ExtractionObservation = {
    schemaVersion: 1,
    engine,
    preTriggerRequests,
    firstTriggerRequests,
    secondTriggerRequests: requests.slice(beforeSecond),
    responseSources: {
      "/document.js": DOCUMENT_MODULE,
      "/handler.js": HANDLER_MODULE,
      "/shared.js": SHARED_MODULE,
    },
    valueWhileHandlerBlocked,
    valueAfterFirstTrigger,
    valueAfterSecondTrigger: await page.locator("#value").textContent() ?? "",
    noJavaScriptValue,
    noJavaScriptRequests,
  };
  verifyAcceptedObservation(observation);
  const outputRoot = process.env.FADENO_EXTRACTION_OUTPUT;
  if (!outputRoot) throw new Error("FADENO_EXTRACTION_OUTPUT is required");
  const observationRoot = join(outputRoot, "observations");
  mkdirSync(observationRoot, { recursive: true });
  writeFileSync(join(observationRoot, `${engine}.json`), `${JSON.stringify(observation, null, 2)}\n`);
  await testInfo.attach("accepted-observation", {
    body: Buffer.from(`${JSON.stringify(observation, null, 2)}\n`),
    contentType: "application/json",
  });
});
