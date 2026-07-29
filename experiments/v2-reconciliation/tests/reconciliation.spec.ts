import { readFileSync } from "node:fs";
import { request as requestHttp } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import { MORPH_QUALIFICATION_SCENARIOS } from "../../morph/qualification-scenarios.ts";
import {
  morphQualificationStatePreserved,
  prepareMorphQualificationState,
  readMorphQualificationState,
  releaseMorphQualificationState,
} from "../../morph/qualification-state.ts";

const root = process.cwd();
const outputRoot = join(root, "output/v2-reconciliation");
const consumer = join(outputRoot, "consumer");
const site = join(outputRoot, "site");
const mediaType = "application/vnd.fadeno.private-update+json; version=1";
const expected = (name: string): unknown => JSON.parse(
  readFileSync(join(outputRoot, `expected-${name}.json`), "utf8"),
) as unknown;

type Application = Readonly<{
  applicationGeneration: string;
  handler(request: Request): Response | Promise<Response>;
  resetApplicationState(): void;
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
}>;

let origin = "";
let application: Application;
let backendPort = 0;
let backendClose: (() => Promise<void>) | undefined;
let proxy: HttpsServer | undefined;
const requests: RequestRecord[] = [];
const previousSessionKeys = process.env["FADENO_SESSION_KEYS"];

async function closeProxy(): Promise<void> {
  if (!proxy) return;
  const owner = proxy;
  proxy = undefined;
  await new Promise<void>((resolve, reject) => {
    owner.close((error) => error ? reject(error) : resolve());
  });
}

test.beforeAll(async () => {
  process.env["FADENO_SESSION_KEYS"] =
    `reconciliation:${Buffer.alloc(32, 83).toString("base64url")}`;
  application = await import(
    pathToFileURL(join(consumer, "dist/application.js")).href
  ) as Application;
  const node = await import(
    pathToFileURL(join(consumer, "node_modules/@fadeno/framework/dist/node.js")).href
  ) as NodeModule;

  proxy = createHttpsServer({
    key: readFileSync(join(root, "scripts/fixtures/v1-example-tls-key.pem")),
    cert: readFileSync(join(root, "scripts/fixtures/v1-example-tls-cert.pem")),
  }, (incoming, outgoing) => {
    requests.push(Object.freeze({
      method: incoming.method ?? "GET",
      path: new URL(incoming.url ?? "/", "https://example.invalid").pathname,
      privateUpdate: incoming.headers.accept === mediaType,
    }));
    const upstream = requestHttp({
      hostname: "127.0.0.1",
      port: backendPort,
      path: incoming.url,
      method: incoming.method,
      headers: incoming.headers,
    }, (upstreamResponse) => {
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
  if (!address || typeof address === "string") {
    throw new Error("FADENO_V2_RECONCILIATION_PROXY_ADDRESS");
  }
  origin = `https://127.0.0.1:${address.port}`;

  const handler: Application["handler"] = (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/_fadeno/")
      && url.pathname !== "/_fadeno/reconciliation.css") {
      try {
        return new Response(readFileSync(join(site, url.pathname), "utf8"), {
          headers: {
            "cache-control": "no-store",
            "content-type": "text/javascript; charset=utf-8",
          },
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
});

async function waitForEnhancement(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => {
    const runtime = Reflect.get(globalThis, "__fadenoExampleEnhancement") as
      | { state(): string }
      | undefined;
    return document.readyState !== "loading"
      && runtime?.state() === "active"
      && Reflect.get(history.state ?? {}, "fadeno.private.navigation.v1") === true;
  }).catch(() => false)).toBe(true);
}

async function activate(
  page: Page,
  mode: "navigation" | "action",
): Promise<void> {
  if (mode === "navigation") {
    const modalLink = page.locator("#modal-reconciliation-link");
    await (await modalLink.count() === 1
      ? modalLink
      : page.locator("#reconciliation-link")).click();
    return;
  }
  await page.locator("#reconciliation-form").evaluate((element) => {
    const form = element as HTMLFormElement;
    const submitter = form.querySelector<HTMLButtonElement>(
      "#reconciliation-submit",
    );
    if (!submitter) throw new Error("FADENO_RECONCILIATION_SUBMITTER");
    form.requestSubmit(submitter);
  });
}

async function privateFlows(
  page: Page,
  mode: "navigation" | "action",
): Promise<readonly Readonly<{
  status: string;
  decisions: readonly string[];
  skipped: readonly string[];
}>[]> {
  return page.evaluate(async (selectedMode) => {
    const modulePath = "/_fadeno/framework/internal/browser-navigation.js";
    const module = await import(modulePath) as {
      readPrivateLinkNavigationFlows(): readonly Readonly<{
        status: string;
        decisions: readonly string[];
        skipped: readonly string[];
      }>[];
      readPrivateFormSubmissionFlows(): readonly Readonly<{
        status: string;
        decisions: readonly string[];
        skipped: readonly string[];
      }>[];
    };
    return selectedMode === "navigation"
      ? module.readPrivateLinkNavigationFlows()
      : module.readPrivateFormSubmissionFlows();
  }, mode);
}

const preservedScenarios = MORPH_QUALIFICATION_SCENARIOS.filter(({ fixture }) =>
  fixture.state !== "document-scroll"
  && fixture.state !== "element-scroll"
  && fixture.state !== "intentional-replacement"
);

for (const scenario of preservedScenarios) {
  for (const mode of ["navigation", "action"] as const) {
    test(`${mode} preserves ${scenario.fixture.id}`, async ({ page }) => {
      await page.goto(
        `${origin}/case?case=${scenario.fixture.id}&mode=${mode}&phase=current`,
      );
      await waitForEnhancement(page);
      await prepareMorphQualificationState(page, scenario);
      const before = await readMorphQualificationState(page, scenario);
      await page.locator(`#${scenario.fixture.targetIdentity}`).evaluate(
        (element) => {
          Reflect.set(globalThis, "__fadenoOriginalTarget", element);
          Reflect.set(globalThis, "__fadenoOriginalRoot", element.closest("main"));
        },
      );
      requests.length = 0;

      await activate(page, mode);

      await expect(page.locator("#root")).toHaveClass("after");
      const after = await readMorphQualificationState(page, scenario);
      expect(morphQualificationStatePreserved(
        scenario.fixture.state,
        before,
        after,
        2_000,
      )).toBe(true);
      expect(await page.locator(`#${scenario.fixture.targetIdentity}`).evaluate(
        (element, expected) => ({
          sameTarget: Reflect.get(globalThis, "__fadenoOriginalTarget") === element,
          sameRoot: Reflect.get(globalThis, "__fadenoOriginalRoot")
            === element.closest("main"),
          inserted: !expected.insertion
            || document.querySelector("#inserted-peer") !== null,
          removed: !expected.removal
            || document.querySelector("#removed-peer") === null,
        }), {
          insertion: scenario.fixture.operation === "insert-keyed",
          removal: scenario.fixture.operation === "remove-keyed",
        },
      )).toEqual({
        sameTarget: true,
        sameRoot: true,
        inserted: true,
        removed: true,
      });
      const flows = await privateFlows(page, mode);
      expect(flows.at(-1)?.status).toBe("applied");
      expect(flows.at(-1)?.decisions.some((decision) =>
        decision.includes("bounded keyed structure")
      )).toBe(true);
      expect(flows.at(-1)?.skipped).toContain("public patch schema");
      if (mode === "navigation") {
        expect(requests.filter(({ path, privateUpdate }) =>
          path === "/case" && privateUpdate
        )).toHaveLength(1);
      } else {
        expect(requests.filter(({ method, privateUpdate }) =>
          method === "POST" && privateUpdate
        )).toHaveLength(1);
      }
      await releaseMorphQualificationState(page, scenario);
    });
  }
}

for (const scenario of MORPH_QUALIFICATION_SCENARIOS.filter(({ fixture }) =>
  fixture.state === "document-scroll"
)) {
  for (const mode of ["navigation", "action"] as const) {
    test(`${mode} resets ${scenario.fixture.id} at the qualified top boundary`, async ({ page }) => {
      await page.goto(
        `${origin}/case?case=${scenario.fixture.id}&mode=${mode}&phase=current`,
      );
      await waitForEnhancement(page);
      await prepareMorphQualificationState(page, scenario);
      await page.locator(`#${scenario.fixture.targetIdentity}`).evaluate(
        (element) => Reflect.set(globalThis, "__fadenoOriginalTarget", element),
      );
      requests.length = 0;

      await activate(page, mode);

      await expect(page.locator("#root")).toHaveClass("after");
      expect(await page.locator(`#${scenario.fixture.targetIdentity}`).evaluate(
        (element) => ({
          sameNode: Reflect.get(globalThis, "__fadenoOriginalTarget") === element,
          scrollY,
        }),
      )).toEqual({ sameNode: true, scrollY: 0 });
      expect(requests.some(({ privateUpdate }) => privateUpdate)).toBe(true);
    });
  }
}

for (const scenario of MORPH_QUALIFICATION_SCENARIOS.filter(({ fixture }) =>
  fixture.state === "element-scroll"
)) {
  for (const mode of ["navigation", "action"] as const) {
    test(`${mode} keeps ${scenario.fixture.id} native`, async ({ page }) => {
      await page.goto(
        `${origin}/case?case=${scenario.fixture.id}&mode=${mode}&phase=current`,
      );
      await waitForEnhancement(page);
      await prepareMorphQualificationState(page, scenario);
      await page.locator(`#${scenario.fixture.targetIdentity}`).evaluate(
        (element) => Reflect.set(globalThis, "__fadenoOriginalTarget", element),
      );
      requests.length = 0;

      await activate(page, mode);

      await expect(page.locator("#root")).toHaveClass("after");
      expect(await page.locator(`#${scenario.fixture.targetIdentity}`).evaluate(
        (element) => Reflect.get(globalThis, "__fadenoOriginalTarget") === element,
      )).toBe(false);
      expect(requests.some(({ privateUpdate }) => privateUpdate)).toBe(false);
    });
  }
}

for (const mode of ["navigation", "action"] as const) {
  test(`${mode} applies the private declared replacement control`, async ({ page }) => {
    const scenario = MORPH_QUALIFICATION_SCENARIOS.find(({ fixture }) =>
      fixture.state === "intentional-replacement"
    );
    if (!scenario) throw new Error("FADENO_RECONCILIATION_REPLACEMENT_SCENARIO");
    await page.goto(
      `${origin}/case?case=${scenario.fixture.id}&mode=${mode}&phase=current`,
    );
    await waitForEnhancement(page);
    await page.locator("#replacement-target").evaluate((element) => {
      Reflect.set(globalThis, "__fadenoOriginalTarget", element);
    });
    const result = await page.evaluate(async ({ destination }) => {
      const response = await fetch(destination, {
        cache: "no-store",
        credentials: "same-origin",
      });
      const html = await response.text();
      const incoming = new DOMParser().parseFromString(html, "text/html");
      const modulePath = "/_fadeno/framework/internal/browser-reconciliation.js";
      const module = await import(modulePath) as {
        preparePrivateDocumentReconciliation(
          current: Document,
          next: Document,
          replacements: readonly string[],
        ): {
          commit(): Readonly<{
            replacedIdentities: readonly string[];
          }>;
        };
      };
      const transaction = module.preparePrivateDocumentReconciliation(
        document,
        incoming,
        ["replacement-target"],
      );
      const outcome = transaction.commit();
      const current = document.querySelector("#replacement-target");
      return {
        disconnected: !(
          Reflect.get(globalThis, "__fadenoOriginalTarget") as Element
        ).isConnected,
        replaced: outcome.replacedIdentities,
        sameNode: Reflect.get(globalThis, "__fadenoOriginalTarget") === current,
        text: current?.textContent,
      };
    }, {
      destination:
        `${origin}/case?case=${scenario.fixture.id}&mode=${mode}&phase=incoming`,
    });
    expect(result).toEqual({
      disconnected: true,
      replaced: ["replacement-target"],
      sameNode: false,
      text: "after",
    });
  });
}

test("keeps a missing browser-owned identity native and shows its correction", async ({ page }) => {
  await page.goto(
    `${origin}/case?case=dirty-text-insert&mode=navigation&phase=current`,
  );
  await waitForEnhancement(page);
  await page.locator("#dirty-text").fill("client-dirty");
  await page.locator("#dirty-text").evaluate((element) => {
    Reflect.set(globalThis, "__fadenoOriginalTarget", element);
    element.removeAttribute("id");
  });
  requests.length = 0;

  await activate(page, "navigation");

  await expect(page.locator("#root")).toHaveClass("after");
  const refusal = {
    schema: "fadeno.example.structural-reconciliation-refusal",
    version: 1,
    code: "FADENO_RECONCILIATION_IDENTITY",
    cause: "a browser-owned control had no bounded structural identity",
    outcome: "native-navigation",
  };
  expect(refusal).toEqual(expected("refusal"));
  expect(readFileSync(
    join(outputRoot, "expected-refusal-human.txt"),
    "utf8",
  )).toContain("kept this update native");
  expect(requests.some(({ privateUpdate }) => privateUpdate)).toBe(false);
  expect(await page.locator("#dirty-text").evaluate(
    (element) => Reflect.get(globalThis, "__fadenoOriginalTarget") === element,
  )).toBe(false);
  expect(expected("correction-before")).toEqual({
    main: "root",
    browserOwnedControl: null,
    result: "native-navigation",
  });
  expect(expected("correction-after")).toEqual({
    main: "root",
    browserOwnedControl: "dirty-text",
    result: "bounded-reconciliation",
  });
});

test("removes stale output and clears pending ownership after an action", async ({ page }) => {
  const scenario = MORPH_QUALIFICATION_SCENARIOS.find(({ fixture }) =>
    fixture.id === "focused-textarea-selection-remove"
  );
  if (!scenario) throw new Error("FADENO_RECONCILIATION_RECOVERY_SCENARIO");
  await page.goto(
    `${origin}/case?case=${scenario.fixture.id}&mode=action&phase=current`,
  );
  await waitForEnhancement(page);
  await prepareMorphQualificationState(page, scenario);
  await page.locator("#removed-peer").evaluate((element) => {
    Reflect.set(globalThis, "__fadenoRemovedPeer", element);
  });
  await page.locator(`#${scenario.fixture.targetIdentity}`).evaluate((element) => {
    Reflect.set(globalThis, "__fadenoOriginalTarget", element);
  });

  await activate(page, "action");

  await expect(page.locator("#root")).toHaveClass("after");
  const recovery = await page.locator(`#${scenario.fixture.targetIdentity}`).evaluate(
    (element) => ({
      schema: "fadeno.example.structural-reconciliation-recovery",
      version: 1,
      staleRemovedPeerAbsent: document.querySelector("#removed-peer") === null,
      originalRemovedPeerDisconnected: !(
        Reflect.get(globalThis, "__fadenoRemovedPeer") as Element
      ).isConnected,
      currentTargetRetained:
        Reflect.get(globalThis, "__fadenoOriginalTarget") === element,
      pendingOwnerCleared:
        document.querySelector("#reconciliation-form")?.hasAttribute("aria-busy")
        === false,
    }),
  );
  expect(recovery).toEqual(expected("recovery"));
  expect(expected("flow")).toEqual({
    schema: "fadeno.example.structural-reconciliation-flow",
    version: 1,
    decisions: [
      "trusted browser operation admitted",
      "current and incoming keyed trees preflighted before mutation",
      "same DOM objects retained browser-owned state",
      "one atomic document and history commit published",
    ],
    ownership: {
      browser: [
        "activation",
        "focus",
        "selection",
        "local control and top-layer state",
      ],
      server: ["route", "action", "rendered outcome"],
    },
    skipped: [
      "public patch schema",
      "state property replay",
      "mutation retry",
    ],
    outcome: "enhanced-document",
  });
  await releaseMorphQualificationState(page, scenario);
});

test("preflights refusal and restores an applied private transaction exactly", async ({ page }) => {
  await page.goto(
    `${origin}/case?case=dirty-text-insert&mode=navigation&phase=current`,
  );
  await waitForEnhancement(page);
  const result = await page.evaluate(async ({ destination }) => {
    const response = await fetch(destination, {
      cache: "no-store",
      credentials: "same-origin",
    });
    const incoming = new DOMParser().parseFromString(
      await response.text(),
      "text/html",
    );
    const modulePath = "/_fadeno/framework/internal/browser-reconciliation.js";
    const module = await import(modulePath) as {
      preparePrivateDocumentReconciliation(
        current: Document,
        next: Document,
      ): {
        commit(): unknown;
        rollback(): void;
      };
    };
    const before = document.querySelector("#root")?.outerHTML;
    const originalTarget = document.querySelector("#dirty-text");
    const invalid = new DOMParser().parseFromString(
      incoming.documentElement.outerHTML,
      "text/html",
    );
    invalid.querySelector("#dirty-text")?.removeAttribute("id");
    let refusal: string | undefined;
    try {
      module.preparePrivateDocumentReconciliation(document, invalid);
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error);
    }
    const unchangedAfterRefusal = document.querySelector("#root")?.outerHTML
      === before;
    const transaction = module.preparePrivateDocumentReconciliation(
      document,
      incoming,
    );
    transaction.commit();
    const applied = document.querySelector("#root")?.className === "after"
      && document.querySelector("#inserted-peer") !== null;
    transaction.rollback();
    return {
      applied,
      refusal,
      unchangedAfterRefusal,
      restoredMarkup: document.querySelector("#root")?.outerHTML === before,
      restoredTarget: document.querySelector("#dirty-text") === originalTarget,
      staleInsertedPeerAbsent:
        document.querySelector("#inserted-peer") === null,
    };
  }, {
    destination:
      `${origin}/case?case=dirty-text-insert&mode=navigation&phase=incoming`,
  });
  expect(result).toEqual({
    applied: true,
    refusal: "FADENO_RECONCILIATION_IDENTITY",
    unchangedAfterRefusal: true,
    restoredMarkup: true,
    restoredTarget: true,
    staleInsertedPeerAbsent: true,
  });
});
