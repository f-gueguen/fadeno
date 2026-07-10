import { writeFileSync } from "node:fs";

import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

import { getMorphFixture } from "../fixtures/catalog.ts";

const fixture = getMorphFixture(
  process.env.FADENO_MORPH_FIXTURE ?? "seeded-preservation-control",
);

declare global {
  interface Window {
    __fadenoOriginalTarget: HTMLInputElement;
  }
}

async function attachJson(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
  const path = testInfo.outputPath(`${name}.json`);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  await testInfo.attach(name, { path, contentType: "application/json" });
}

async function captureState(page: Page) {
  return page.evaluate(() => {
    const target = document.querySelector<HTMLInputElement>("#target");
    if (!target) throw new Error("FADENO_MORPH_TARGET_MISSING");
    return {
      nodeIdentity: target === window.__fadenoOriginalTarget ? "original" : "replacement",
      state: {
        value: target.value,
        focused: document.activeElement === target,
        selectionStart: target.selectionStart,
        selectionEnd: target.selectionEnd,
      },
    };
  });
}

test(fixture.id, async ({ page }, testInfo) => {
  const engine = page.context().browser()?.browserType().name();
  if (!engine) throw new Error("FADENO_MORPH_BROWSER_IDENTITY_MISSING");
  const blockedRequests: string[] = [];
  await page.route(/^https?:\/\//u, async (route) => {
    blockedRequests.push(route.request().url());
    await route.abort("blockedbyclient");
  });
  await page.setContent(
    '<!doctype html><meta charset="utf-8"><main id="root"><label>Control <input id="target" value="server"></label></main>',
  );
  const target = page.locator("#target");
  await target.fill("dirty-client-value");
  await target.focus();
  await target.evaluate((element) =>
    (element as HTMLInputElement).setSelectionRange(2, 8),
  );
  await page.evaluate(() => {
    const target = document.querySelector<HTMLInputElement>("#target");
    if (!target) throw new Error("FADENO_MORPH_TARGET_MISSING");
    window.__fadenoOriginalTarget = target;
  });

  const before = await captureState(page);
  const operation = await page.evaluate((operationName) => {
    const original = window.__fadenoOriginalTarget;
    if (operationName === "insert-unrelated-sibling") {
      const sibling = document.createElement("aside");
      sibling.id = "inserted-sibling";
      sibling.textContent = "control";
      const root = document.querySelector("#root");
      if (!root) throw new Error("FADENO_MORPH_ROOT_MISSING");
      root.append(sibling);
      return {
        kind: operationName,
        completed: true,
        siblingInserted: document.querySelector("#inserted-sibling") === sibling,
        targetIdentityPreserved: document.querySelector("#target") === original,
      };
    }
    if (operationName === "replace-focused-control") {
      const replacement = original.cloneNode(true) as HTMLInputElement;
      replacement.value = "server";
      original.replaceWith(replacement);
      return {
        kind: operationName,
        completed: true,
        replacementCompleted: !original.isConnected && document.querySelector("#target") === replacement,
        targetIdentityChanged: replacement !== original,
        stateLossObserved:
          document.activeElement !== replacement || replacement.value !== "dirty-client-value",
      };
    }
    throw new Error(`FADENO_MORPH_UNKNOWN_OPERATION: ${operationName}`);
  }, fixture.operation);
  const after = await captureState(page);

  await attachJson(testInfo, "operation", { fixture: fixture.id, engine, ...operation });
  await attachJson(testInfo, "before-after", { fixture: fixture.id, engine, before, after });

  expect(blockedRequests, "FADENO_MORPH_EXTERNAL_REQUEST").toEqual([]);
  expect(operation.completed, "FADENO_MORPH_OPERATION_NOT_OBSERVED").toBe(true);
  if (fixture.kind === "passing-control") {
    expect(operation.siblingInserted, "FADENO_MORPH_INSERTION_NOT_OBSERVED").toBe(true);
    expect(operation.targetIdentityPreserved, "FADENO_MORPH_IDENTITY_CHANGED").toBe(true);
    expect(after, "FADENO_MORPH_PASSING_CONTROL_STATE_LOSS").toEqual(before);
    return;
  }

  expect(operation.replacementCompleted, "FADENO_MORPH_REPLACEMENT_NOT_OBSERVED").toBe(true);
  expect(operation.targetIdentityChanged, "FADENO_MORPH_REPLACEMENT_WAS_NOOP").toBe(true);
  expect(operation.stateLossObserved, "FADENO_MORPH_SEEDED_LOSS_NOT_OBSERVED").toBe(true);
  expect(after, fixture.diagnostic).toEqual(before);
});
