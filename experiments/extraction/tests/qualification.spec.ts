import { expect, test } from "@playwright/test";
import type { Response, Route } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { EXTRACTION_PROJECTS } from "../contract.ts";
import type { ExtractionProject } from "../contract.ts";
import { EXTRACTION_ACCEPTED_CLASSES } from "../fixtures/catalog.ts";
import { EXTRACTION_IDENTITY_CASES } from "../qualification-contract.ts";
import {
  expectedInteractionState,
  verifyExtractionQualificationObservation,
} from "../qualification-proof.ts";
import type {
  ExtractionQualificationObservation,
  GeneratedInventory,
  InteractionState,
} from "../qualification-proof.ts";

const ORIGIN = "https://extraction-qualification.invalid";

const adapters = {
  toggle: {
    html: '<button id="trigger" aria-expanded="false">Toggle</button><div id="panel" hidden>Panel</div>',
    invoke: 'loaded.handler(document.querySelector("#trigger"), document.querySelector("#panel"));',
    snapshot: '({ expanded: document.querySelector("#trigger").getAttribute("aria-expanded") === "true", hidden: document.querySelector("#panel").hidden })',
  },
  disclosure: {
    html: '<button id="trigger">Disclosure</button><details id="details"><summary>Summary</summary>Body</details>',
    invoke: 'loaded.handler(document.querySelector("#details"));',
    snapshot: '({ open: document.querySelector("#details").open })',
  },
  tabs: {
    html: '<button id="trigger">Select next tab</button><button id="tab-a" aria-controls="panel-a">A</button><button id="tab-b" aria-controls="panel-b">B</button><div id="panel-a">A panel</div><div id="panel-b" hidden>B panel</div>',
    invoke: 'loaded.handler(document.querySelector(ordinal % 2 === 1 ? "#tab-b" : "#tab-a"), [document.querySelector("#panel-a"), document.querySelector("#panel-b")]);',
    snapshot: '({ selected: document.querySelector("#panel-a").hidden ? "panel-b" : "panel-a", panelAHidden: document.querySelector("#panel-a").hidden, panelBHidden: document.querySelector("#panel-b").hidden })',
  },
  menu: {
    html: '<button id="trigger" aria-expanded="false">Menu</button><div id="menu" hidden>Items</div>',
    invoke: 'loaded.handler(document.querySelector("#trigger"), document.querySelector("#menu"));',
    snapshot: '({ expanded: document.querySelector("#trigger").getAttribute("aria-expanded") === "true", hidden: document.querySelector("#menu").hidden })',
  },
  "local-counter": {
    html: '<button id="trigger">Increment</button><output id="output">0</output>',
    invoke: 'loaded.handler(document.querySelector("#output"), ordinal);',
    snapshot: '({ value: Number(document.querySelector("#output").value) })',
  },
} as const;

function documentModule(
  fixtureId: (typeof EXTRACTION_ACCEPTED_CLASSES)[number],
): string {
  const adapter = adapters[fixtureId];
  return [
    `const snapshot = () => ${adapter.snapshot};`,
    'const trigger = document.querySelector("#trigger");',
    "let modulePromise;",
    "let initialHandler;",
    "let ordinal = 0;",
    "let effects = 0;",
    "globalThis.__fadenoTriggerNode = trigger;",
    "trigger.addEventListener(\"click\", async () => {",
    "  ordinal += 1;",
    "  const before = snapshot();",
    `  const loaded = await (modulePromise ??= import("/handlers/${fixtureId}.js"));`,
    "  initialHandler ??= loaded.handler;",
    `  ${adapter.invoke}`,
    "  effects += 1;",
    "  globalThis.__fadenoLast = {",
    "    ordinal, before, after: snapshot(), effects,",
    "    handlerIdentity: loaded.handlerIdentity,",
    "    handlerReferenceStable: initialHandler === loaded.handler,",
    "    moduleEvaluations: globalThis.__fadenoExtractionModuleEvaluations ?? 0,",
    "  };",
    "});",
    "",
  ].join("\n");
}

function pathOf(url: string): string {
  return new URL(url).pathname;
}

test("locked-extraction-qualification", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  if (!EXTRACTION_PROJECTS.includes(testInfo.project.name as ExtractionProject)) {
    throw new Error(`unexpected extraction project: ${testInfo.project.name}`);
  }
  const projectName = testInfo.project.name as ExtractionProject;
  const observedName = browser.browserType().name();
  if (!EXTRACTION_PROJECTS.includes(observedName as ExtractionProject)) {
    throw new Error(`unexpected extraction browser: ${observedName}`);
  }
  const observedBrowser = observedName as ExtractionProject;
  const generatedRoot = process.env.FADENO_EXTRACTION_GENERATED;
  if (!generatedRoot) throw new Error("FADENO_EXTRACTION_GENERATED is required");
  const inventory = JSON.parse(
    readFileSync(join(generatedRoot, "inventory.json"), "utf8"),
  ) as GeneratedInventory;
  const inventoryByFixture = new Map(inventory.files.map((file) => [file.fixtureId, file]));
  const fixtures: ExtractionQualificationObservation["fixtures"][number][] = [];

  for (const fixtureId of EXTRACTION_ACCEPTED_CLASSES) {
    const generated = inventoryByFixture.get(fixtureId);
    if (!generated) throw new Error(`missing generated handler: ${fixtureId}`);
    const handlerPath = join(generatedRoot, `${fixtureId}.js`);
    const handlerBody = readFileSync(handlerPath);
    const requests: string[] = [];
    const responseTasks: Promise<ExtractionQualificationObservation["fixtures"][number]["response"]>[] = [];
    const page = await browser.newPage({ serviceWorkers: "block" });
    page.on("response", (response: Response) => {
      if (pathOf(response.url()) !== `/handlers/${fixtureId}.js`) return;
      responseTasks.push((async () => {
        const body = await response.body();
        return {
          path: pathOf(response.url()),
          body: body.toString("utf8"),
          contentType: response.headers()["content-type"]?.split(";", 1)[0] ?? "",
          sha256: createHash("sha256").update(body).digest("hex"),
          bytes: body.byteLength,
        };
      })());
    });
    await page.route(`${ORIGIN}/**`, async (route: Route) => {
      const path = pathOf(route.request().url());
      requests.push(path);
      if (path === "/") {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: `<!doctype html><html><body><main id="identity-root">${adapters[fixtureId].html}</main><script type="module" src="/document.js"></script></body></html>`,
        });
      } else if (path === "/document.js") {
        await route.fulfill({ status: 200, contentType: "text/javascript", body: documentModule(fixtureId) });
      } else if (path === `/handlers/${fixtureId}.js`) {
        await route.fulfill({ status: 200, contentType: "text/javascript", body: handlerBody });
      } else {
        await route.abort("blockedbyclient");
      }
    });
    await page.goto(`${ORIGIN}/`);
    const preTriggerRequests = [...requests];
    const interactions: ExtractionQualificationObservation["fixtures"][number]["interactions"][number][] = [];
    for (let ordinal = 1; ordinal <= 100; ordinal += 1) {
      const beforeRequests = requests.length;
      await page.locator("#trigger").click();
      await expect.poll(() => page.evaluate(() =>
        (globalThis as typeof globalThis & { __fadenoLast?: { ordinal: number } })
          .__fadenoLast?.ordinal
      )).toBe(ordinal);
      const record = await page.evaluate(() =>
        (globalThis as typeof globalThis & {
          __fadenoLast: {
            ordinal: number;
            before: InteractionState;
            after: InteractionState;
            effects: number;
          };
        }).__fadenoLast
      );
      expect(record.before).toEqual(expectedInteractionState(fixtureId, ordinal - 1));
      expect(record.after).toEqual(expectedInteractionState(fixtureId, ordinal));
      expect(record.effects).toBe(ordinal);
      interactions.push(record);
      if (ordinal > 1) expect(requests.slice(beforeRequests)).toEqual([]);
    }
    const identity: ExtractionQualificationObservation["fixtures"][number]["identity"][number][] = [];
    for (let index = 0; index < EXTRACTION_IDENTITY_CASES.length; index += 1) {
      const identityCase = EXTRACTION_IDENTITY_CASES[index]!;
      const beforeEffects = 100 + index;
      const targetSame = await page.evaluate((operation) => {
        const state = globalThis as typeof globalThis & { __fadenoTriggerNode?: Element };
        const target = document.querySelector("#trigger");
        const root = document.querySelector("#identity-root");
        if (!target || !root) return false;
        if (operation === "insert-keyed") {
          const peer = document.createElement("span");
          peer.textContent = "inserted";
          root.insertBefore(peer, target);
        } else if (operation === "remove-keyed") {
          const peer = document.createElement("span");
          root.insertBefore(peer, target);
          peer.remove();
        } else if (operation === "reorder-keyed") {
          root.append(target);
        }
        return state.__fadenoTriggerNode === target && target.isConnected;
      }, identityCase.operation);
      const beforeRequests = requests.length;
      await page.locator("#trigger").click();
      const ordinal = 101 + index;
      await expect.poll(() => page.evaluate(() =>
        (globalThis as typeof globalThis & { __fadenoLast?: { ordinal: number } })
          .__fadenoLast?.ordinal
      )).toBe(ordinal);
      const record = await page.evaluate(() =>
        (globalThis as typeof globalThis & {
          __fadenoLast: {
            ordinal: number;
            after: InteractionState;
            effects: number;
            handlerReferenceStable: boolean;
            moduleEvaluations: number;
          };
        }).__fadenoLast
      );
      identity.push({
        caseId: identityCase.id,
        operation: identityCase.operation,
        ordinal,
        targetSame,
        handlerReferenceStable: record.handlerReferenceStable,
        moduleEvaluations: record.moduleEvaluations,
        effectDelta: record.effects - beforeEffects,
        after: record.after,
      });
      expect(requests.slice(beforeRequests)).toEqual([]);
    }
    const last = await page.evaluate(() =>
      (globalThis as typeof globalThis & {
        __fadenoLast: {
          handlerIdentity: string;
          handlerReferenceStable: boolean;
          moduleEvaluations: number;
        };
      }).__fadenoLast
    );
    const response = (await Promise.all(responseTasks))[0];
    if (!response || responseTasks.length !== 1) {
      throw new Error(`unexpected handler responses: ${fixtureId}`);
    }
    fixtures.push({
      fixtureId,
      preTriggerRequests,
      firstTriggerRequests: requests.slice(preTriggerRequests.length, preTriggerRequests.length + 1),
      laterRequests: requests.slice(preTriggerRequests.length + 1),
      disk: { path: generated.path, sha256: generated.sha256, bytes: generated.bytes },
      response,
      handlerIdentity: last.handlerIdentity,
      moduleEvaluations: last.moduleEvaluations,
      handlerReferenceStable: last.handlerReferenceStable,
      interactions,
      identity,
    });
    await page.close();
  }

  const observation: ExtractionQualificationObservation = {
    schemaVersion: 1,
    projectName,
    observedBrowser,
    fixtures,
  };
  verifyExtractionQualificationObservation(observation, inventory);
  await testInfo.attach("qualification-observation", {
    body: Buffer.from(`${JSON.stringify(observation, null, 2)}\n`),
    contentType: "application/json",
  });
});
