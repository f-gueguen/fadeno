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

async function expectIncomingPhase(page: Page): Promise<void> {
  await expect(page.locator("#reconciliation-phase")).toHaveText("incoming");
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

      await expectIncomingPhase(page);
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

      await expectIncomingPhase(page);
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

      await expectIncomingPhase(page);
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

  await expectIncomingPhase(page);
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

  await expectIncomingPhase(page);
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

test("applies a submitted-control server reset through native current truth", async ({ page }) => {
  const scenario = MORPH_QUALIFICATION_SCENARIOS.find(({ fixture }) =>
    fixture.state === "details-open"
  );
  if (!scenario) throw new Error("FADENO_RECONCILIATION_FORM_RESET_SCENARIO");
  await page.goto(
    `${origin}/case?case=${scenario.fixture.id}&mode=action&phase=current`,
  );
  await waitForEnhancement(page);
  await prepareMorphQualificationState(page, scenario);
  await page.locator("#reconciliation-submitted-state").fill("client-dirty");
  await page.locator("#reconciliation-submitted-state").evaluate((element) => {
    Reflect.set(globalThis, "__fadenoSubmittedControl", element);
  });
  requests.length = 0;

  await activate(page, "action");

  await expectIncomingPhase(page);
  await expect(page.locator("#reconciliation-submitted-state")).toHaveValue(
    "server-default",
  );
  expect(await page.locator("#reconciliation-submitted-state").evaluate(
    (element) => Reflect.get(globalThis, "__fadenoSubmittedControl") === element,
  )).toBe(false);
  expect(await page.locator("#open-details").evaluate(
    (element) => (element as HTMLDetailsElement).open,
  )).toBe(false);
  expect(requests.filter(({ method, privateUpdate }) =>
    method === "POST" && privateUpdate
  )).toHaveLength(1);
  expect(requests.some(({ method, privateUpdate }) =>
    method === "GET" && !privateUpdate
  )).toBe(true);
});

test("revalidates the prepared tree after history selection", async ({ page }) => {
  await page.addInitScript(() => {
    const pushState = History.prototype.pushState;
    History.prototype.pushState = function (
      data: unknown,
      unused: string,
      url?: string | URL | null,
    ): void {
      pushState.call(this, data, unused, url);
      document.querySelector("#dirty-text")?.removeAttribute("id");
    };
  });
  await page.goto(
    `${origin}/case?case=dirty-text-insert&mode=navigation&phase=current`,
  );
  await waitForEnhancement(page);
  await page.locator("#dirty-text").fill("client-dirty");
  await page.locator("#dirty-text").evaluate((element) => {
    Reflect.set(globalThis, "__fadenoOriginalTarget", element);
  });
  requests.length = 0;

  await activate(page, "navigation");

  await expectIncomingPhase(page);
  expect(await page.locator("#dirty-text").evaluate(
    (element) => Reflect.get(globalThis, "__fadenoOriginalTarget") === element,
  )).toBe(false);
  expect(requests.some(({ privateUpdate }) => privateUpdate)).toBe(true);
});

test("refuses focus drift introduced during history selection", async ({ page }) => {
  await page.addInitScript(() => {
    const pushState = History.prototype.pushState;
    History.prototype.pushState = function (
      data: unknown,
      unused: string,
      url?: string | URL | null,
    ): void {
      pushState.call(this, data, unused, url);
      const input = document.querySelector("#dirty-text");
      if (input instanceof HTMLInputElement) input.focus();
    };
  });
  await page.goto(
    `${origin}/case?case=dirty-text-insert&mode=navigation&phase=current`,
  );
  await waitForEnhancement(page);
  await page.locator("#dirty-text").fill("client-dirty");
  await page.locator("#dirty-text").evaluate((element) => {
    Reflect.set(globalThis, "__fadenoOriginalTarget", element);
  });
  await page.locator("#reconciliation-link").focus();
  requests.length = 0;

  await page.locator("#reconciliation-link").press("Enter");

  await expectIncomingPhase(page);
  expect(await page.locator("#dirty-text").evaluate(
    (element) => Reflect.get(globalThis, "__fadenoOriginalTarget") === element,
  )).toBe(false);
  expect(requests.some(({ privateUpdate }) => privateUpdate)).toBe(true);
  expect(requests.some(({ method, privateUpdate }) =>
    method === "GET" && !privateUpdate
  )).toBe(true);
});

test("moves keyboard link focus to the reconciled destination", async ({ page }) => {
  await page.goto(
    `${origin}/case?case=dirty-text-insert&mode=navigation&phase=current`,
  );
  await waitForEnhancement(page);
  await page.locator("#dirty-text").fill("client-dirty");
  await page.locator("#dirty-text").evaluate((element) => {
    Reflect.set(globalThis, "__fadenoOriginalTarget", element);
  });
  await page.locator("#reconciliation-link").focus();
  requests.length = 0;

  await page.locator("#reconciliation-link").press("Enter");

  await expectIncomingPhase(page);
  await expect(page.locator("#dirty-text")).toHaveValue("client-dirty");
  expect(await page.locator("#dirty-text").evaluate(
    (element) => Reflect.get(globalThis, "__fadenoOriginalTarget") === element,
  )).toBe(true);
  expect(await page.locator("#root").evaluate((element) => ({
    focused: document.activeElement === element,
    focusOwner: element.getAttribute("data-fadeno-navigation-focus"),
  }))).toEqual({
    focused: true,
    focusOwner: "",
  });
  expect(requests.filter(({ privateUpdate }) => privateUpdate)).toHaveLength(1);
});

test("preserves focus inside one reused opaque island", async ({ page }) => {
  await page.goto(
    `${origin}/case?case=island-identity-remove&mode=navigation&phase=current`,
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
    const currentIsland = document.querySelector("#mounted-island");
    const incomingIsland = incoming.querySelector("#mounted-island");
    if (!currentIsland || !incomingIsland) {
      throw new Error("FADENO_RECONCILIATION_ISLAND");
    }
    const islandState = globalThis as typeof globalThis & {
      __fadenoIslandAttributeChanges?: number;
    };
    islandState.__fadenoIslandAttributeChanges = 0;
    if (!customElements.get("fadeno-island")) {
      customElements.define("fadeno-island", class extends HTMLElement {
        static get observedAttributes(): string[] {
          return ["class"];
        }

        attributeChangedCallback(): void {
          islandState.__fadenoIslandAttributeChanges =
            (islandState.__fadenoIslandAttributeChanges ?? 0) + 1;
        }
      });
    }
    const clientMarkup = "<button type=\"button\">Client-owned focus</button>";
    currentIsland.innerHTML = clientMarkup;
    incomingIsland.innerHTML = clientMarkup;
    const button = currentIsland.querySelector("button");
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("FADENO_RECONCILIATION_ISLAND_BUTTON");
    }
    button.focus();
    const modulePath = "/_fadeno/framework/internal/browser-reconciliation.js";
    const module = await import(modulePath) as {
      preparePrivateDocumentReconciliation(
        current: Document,
        next: Document,
      ): {
        preservesActiveElement: boolean;
        commit(): unknown;
      };
    };
    const incompatible = new DOMParser().parseFromString(
      incoming.documentElement.outerHTML,
      "text/html",
    );
    incompatible.querySelector("#mounted-island")?.setAttribute("class", "after");
    let attributeRefusal = "accepted";
    try {
      module.preparePrivateDocumentReconciliation(document, incompatible);
    } catch (error) {
      attributeRefusal = error instanceof Error ? error.message : String(error);
    }
    const transaction = module.preparePrivateDocumentReconciliation(
      document,
      incoming,
    );
    const preservesActiveElement = transaction.preservesActiveElement;
    transaction.commit();
    return {
      attributeRefusal,
      attributeChanges: islandState.__fadenoIslandAttributeChanges,
      preservesActiveElement,
      retainedFocus: document.activeElement === button,
      retainedIsland: document.querySelector("#mounted-island") === currentIsland,
    };
  }, {
    destination:
      `${origin}/case?case=island-identity-remove&mode=navigation&phase=incoming`,
  });
  expect(result).toEqual({
    attributeRefusal: "FADENO_RECONCILIATION_CONTENT",
    attributeChanges: 0,
    preservesActiveElement: true,
    retainedFocus: true,
    retainedIsland: true,
  });
});

test("refuses a direct move of a retained state owner", async ({ page }) => {
  await page.goto(
    `${origin}/case?case=dirty-text-insert&mode=navigation&phase=current`,
  );
  await waitForEnhancement(page);
  await page.locator("#dirty-text").fill("client-dirty");
  const result = await page.evaluate(async ({ destination }) => {
    const response = await fetch(destination, {
      cache: "no-store",
      credentials: "same-origin",
    });
    const incoming = new DOMParser().parseFromString(
      await response.text(),
      "text/html",
    );
    incoming.querySelector("#inserted-peer")?.remove();
    const peer = incoming.querySelector("#peer-a");
    const owner = incoming.querySelector("#dirty-text");
    if (!peer || !owner) throw new Error("FADENO_RECONCILIATION_MOVE_FIXTURE");
    owner.before(peer);
    const modulePath = "/_fadeno/framework/internal/browser-reconciliation.js";
    const module = await import(modulePath) as {
      preparePrivateDocumentReconciliation(
        current: Document,
        next: Document,
      ): unknown;
    };
    let refusal = "accepted";
    try {
      module.preparePrivateDocumentReconciliation(document, incoming);
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error);
    }
    return {
      refusal,
      order: [...(document.querySelector("#root")?.children ?? [])]
        .slice(0, 2)
        .map(({ id }) => id),
      value: (document.querySelector("#dirty-text") as HTMLInputElement | null)?.value,
    };
  }, {
    destination:
      `${origin}/case?case=dirty-text-insert&mode=navigation&phase=incoming`,
  });
  expect(result).toEqual({
    refusal: "FADENO_RECONCILIATION_OWNERSHIP",
    order: ["dirty-text", "peer-a"],
    value: "client-dirty",
  });
});

test("refuses replacement of text owned by a live selection", async ({ page }) => {
  await page.goto(
    `${origin}/case?case=dirty-text-insert&mode=navigation&phase=current`,
  );
  await waitForEnhancement(page);
  const result = await page.evaluate(async ({ destination }) => {
    const peer = document.querySelector("#peer-a");
    const text = peer?.firstChild;
    if (!peer || !text) throw new Error("FADENO_RECONCILIATION_SELECTION_FIXTURE");
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, text.textContent?.length ?? 0);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const response = await fetch(destination, {
      cache: "no-store",
      credentials: "same-origin",
    });
    const incoming = new DOMParser().parseFromString(
      await response.text(),
      "text/html",
    );
    const incomingPeer = incoming.querySelector("#peer-a");
    if (!incomingPeer) throw new Error("FADENO_RECONCILIATION_INCOMING_SELECTION");
    incomingPeer.textContent = "server-changed";
    const modulePath = "/_fadeno/framework/internal/browser-reconciliation.js";
    const module = await import(modulePath) as {
      preparePrivateDocumentReconciliation(
        current: Document,
        next: Document,
      ): unknown;
    };
    let refusal = "accepted";
    try {
      module.preparePrivateDocumentReconciliation(document, incoming);
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error);
    }
    return {
      refusal,
      selectedText: document.getSelection()?.toString(),
      text: peer.textContent,
    };
  }, {
    destination:
      `${origin}/case?case=dirty-text-insert&mode=navigation&phase=incoming`,
  });
  expect(result).toEqual({
    refusal: "FADENO_RECONCILIATION_OWNERSHIP",
    selectedText: "peer-a",
    text: "peer-a",
  });
});

test("restores live radio state after an applied transaction rolls back", async ({ page }) => {
  await page.goto(
    `${origin}/case?case=dirty-radio-reorder&mode=navigation&phase=current`,
  );
  await waitForEnhancement(page);
  await page.locator("#dirty-radio-a").check();
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
    const read = () => ({
      checkedA:
        (document.querySelector("#dirty-radio-a") as HTMLInputElement | null)?.checked,
      checkedB:
        (document.querySelector("#dirty-radio-b") as HTMLInputElement | null)?.checked,
    });
    const transaction = module.preparePrivateDocumentReconciliation(
      document,
      incoming,
    );
    transaction.commit();
    const radio = document.querySelector("#dirty-radio-b");
    if (radio instanceof HTMLInputElement) radio.checked = true;
    const applied = read();
    transaction.rollback();
    return { applied, restored: read() };
  }, {
    destination:
      `${origin}/case?case=dirty-radio-reorder&mode=navigation&phase=incoming`,
  });
  expect(result).toEqual({
    applied: { checkedA: false, checkedB: true },
    restored: { checkedA: true, checkedB: false },
  });
});

test("refuses a checked plan that would switch a dirty radio group", async ({ page }) => {
  await page.goto(
    `${origin}/case?case=dirty-radio-reorder&mode=navigation&phase=current`,
  );
  await waitForEnhancement(page);
  await page.locator("#dirty-radio-a").check();
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
      ): unknown;
    };
    const refusalFor = (next: Document): string => {
      try {
        module.preparePrivateDocumentReconciliation(document, next);
        return "accepted";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };
    incoming.querySelector("#dirty-radio-b")?.setAttribute("checked", "");
    const checkedPlanRefusal = refusalFor(incoming);
    const insertedIncoming = new DOMParser().parseFromString(
      incoming.documentElement.outerHTML,
      "text/html",
    );
    insertedIncoming.querySelector("#dirty-radio-b")?.removeAttribute("checked");
    const insertedRadio = insertedIncoming.createElement("input");
    insertedRadio.id = "inserted-dirty-radio";
    insertedRadio.type = "radio";
    insertedRadio.name = "qualification-radio";
    insertedRadio.checked = true;
    insertedRadio.setAttribute("checked", "");
    insertedIncoming.querySelector("#root")?.prepend(insertedRadio);
    const insertedPlanRefusal = refusalFor(insertedIncoming);
    return {
      checkedPlanRefusal,
      insertedPlanRefusal,
      checkedA:
        (document.querySelector("#dirty-radio-a") as HTMLInputElement | null)?.checked,
      checkedB:
        (document.querySelector("#dirty-radio-b") as HTMLInputElement | null)?.checked,
    };
  }, {
    destination:
      `${origin}/case?case=dirty-radio-reorder&mode=navigation&phase=incoming`,
  });
  expect(result).toEqual({
    checkedPlanRefusal: "FADENO_RECONCILIATION_OWNERSHIP",
    insertedPlanRefusal: "FADENO_RECONCILIATION_OWNERSHIP",
    checkedA: true,
    checkedB: false,
  });
});

test("retains an indeterminate checkbox through keyed navigation", async ({ page }) => {
  await page.goto(
    `${origin}/case?case=dirty-checkbox-remove&mode=navigation&phase=current`,
  );
  await waitForEnhancement(page);
  await page.locator("#dirty-checkbox").evaluate((element) => {
    const checkbox = element as HTMLInputElement;
    checkbox.indeterminate = true;
    Reflect.set(globalThis, "__fadenoOriginalTarget", checkbox);
  });
  requests.length = 0;

  await activate(page, "navigation");

  await expectIncomingPhase(page);
  expect(await page.locator("#dirty-checkbox").evaluate((element) => ({
    retained: Reflect.get(globalThis, "__fadenoOriginalTarget") === element,
    checked: (element as HTMLInputElement).checked,
    indeterminate: (element as HTMLInputElement).indeterminate,
  }))).toEqual({
    retained: true,
    checked: false,
    indeterminate: true,
  });
  expect(requests.some(({ privateUpdate }) => privateUpdate)).toBe(true);
});

test("retains an unrelated indeterminate checkbox through an action", async ({ page }) => {
  await page.goto(
    `${origin}/case?case=dirty-checkbox-remove&mode=action&phase=current`,
  );
  await waitForEnhancement(page);
  await page.locator("#dirty-checkbox").evaluate((element) => {
    const checkbox = element as HTMLInputElement;
    checkbox.indeterminate = true;
    Reflect.set(globalThis, "__fadenoOriginalTarget", checkbox);
  });
  requests.length = 0;

  await activate(page, "action");

  await expectIncomingPhase(page);
  expect(await page.locator("#dirty-checkbox").evaluate((element) => ({
    retained: Reflect.get(globalThis, "__fadenoOriginalTarget") === element,
    checked: (element as HTMLInputElement).checked,
    indeterminate: (element as HTMLInputElement).indeterminate,
  }))).toEqual({
    retained: true,
    checked: false,
    indeterminate: true,
  });
  expect(requests.filter(({ method, privateUpdate }) =>
    method === "POST" && privateUpdate
  )).toHaveLength(1);
});

test("refuses removal of a dirty select's live option", async ({ page }) => {
  await page.goto(
    `${origin}/case?case=dirty-select-insert&mode=navigation&phase=current`,
  );
  await waitForEnhancement(page);
  await page.locator("#dirty-select").selectOption("b");
  const result = await page.evaluate(async ({ destination }) => {
    const response = await fetch(destination, {
      cache: "no-store",
      credentials: "same-origin",
    });
    const incoming = new DOMParser().parseFromString(
      await response.text(),
      "text/html",
    );
    incoming.querySelector("#select-b")?.remove();
    const modulePath = "/_fadeno/framework/internal/browser-reconciliation.js";
    const module = await import(modulePath) as {
      preparePrivateDocumentReconciliation(
        current: Document,
        next: Document,
      ): unknown;
    };
    let refusal = "accepted";
    try {
      module.preparePrivateDocumentReconciliation(document, incoming);
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error);
    }
    const select = document.querySelector("#dirty-select");
    return {
      refusal,
      value: select instanceof HTMLSelectElement ? select.value : null,
      optionRetained: document.querySelector("#select-b") !== null,
    };
  }, {
    destination:
      `${origin}/case?case=dirty-select-insert&mode=navigation&phase=incoming`,
  });
  expect(result).toEqual({
    refusal: "FADENO_RECONCILIATION_OWNERSHIP",
    value: "b",
    optionRetained: true,
  });
});

test("revalidates prepared leaf text after history selection", async ({ page }) => {
  await page.addInitScript(() => {
    const pushState = History.prototype.pushState;
    History.prototype.pushState = function (
      data: unknown,
      unused: string,
      url?: string | URL | null,
    ): void {
      pushState.call(this, data, unused, url);
      const peer = document.querySelector("#peer-a");
      if (peer) peer.textContent = "application-mutated";
    };
  });
  await page.goto(
    `${origin}/case?case=dirty-text-insert&mode=navigation&phase=current`,
  );
  await waitForEnhancement(page);
  await page.locator("#dirty-text").fill("client-dirty");
  await page.locator("#dirty-text").evaluate((element) => {
    Reflect.set(globalThis, "__fadenoOriginalTarget", element);
  });
  requests.length = 0;

  await activate(page, "navigation");

  await expectIncomingPhase(page);
  await expect(page.locator("#peer-a")).toHaveText("peer-a");
  expect(await page.locator("#dirty-text").evaluate(
    (element) => Reflect.get(globalThis, "__fadenoOriginalTarget") === element,
  )).toBe(false);
  expect(requests.some(({ privateUpdate }) => privateUpdate)).toBe(true);
});

test("revalidates live control state before structural commit", async ({ page }) => {
  await page.goto(
    `${origin}/case?case=dirty-select-insert&mode=navigation&phase=current`,
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
    incoming.querySelector("#select-b")?.remove();
    const modulePath = "/_fadeno/framework/internal/browser-reconciliation.js";
    const module = await import(modulePath) as {
      preparePrivateDocumentReconciliation(
        current: Document,
        next: Document,
      ): {
        commit(): unknown;
      };
    };
    const transaction = module.preparePrivateDocumentReconciliation(
      document,
      incoming,
    );
    const select = document.querySelector("#dirty-select");
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error("FADENO_RECONCILIATION_SELECT_FIXTURE");
    }
    select.selectedIndex = 1;
    let refusal = "accepted";
    try {
      transaction.commit();
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error);
    }
    return {
      refusal,
      value: select.value,
      optionRetained: document.querySelector("#select-b") !== null,
      phase: document.querySelector("#reconciliation-phase")?.textContent,
    };
  }, {
    destination:
      `${origin}/case?case=dirty-select-insert&mode=navigation&phase=incoming`,
  });
  expect(result).toEqual({
    refusal: "FADENO_RECONCILIATION_OWNERSHIP",
    value: "b",
    optionRetained: true,
    phase: "current",
  });
});

test("refuses state-changing attributes on retained focus ancestry", async ({ page }) => {
  await page.goto(
    `${origin}/case?case=focused-input-selection-insert&mode=navigation&phase=current`,
  );
  await waitForEnhancement(page);
  await page.locator("#focused-input").focus();
  await page.locator("#focused-input").evaluate((element) => {
    (element as HTMLInputElement).setSelectionRange(2, 6);
  });
  const result = await page.evaluate(async ({ destination }) => {
    const response = await fetch(destination, {
      cache: "no-store",
      credentials: "same-origin",
    });
    const incoming = new DOMParser().parseFromString(
      await response.text(),
      "text/html",
    );
    const input = document.querySelector("#focused-input");
    const modulePath = "/_fadeno/framework/internal/browser-reconciliation.js";
    const module = await import(modulePath) as {
      preparePrivateDocumentReconciliation(
        current: Document,
        next: Document,
      ): unknown;
    };
    const refusalFor = (next: Document): string => {
      try {
        module.preparePrivateDocumentReconciliation(document, next);
        return "accepted";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };
    incoming.querySelector("#focused-input")?.setAttribute("disabled", "");
    const disabledRefusal = refusalFor(incoming);
    const valueIncoming = new DOMParser().parseFromString(
      incoming.documentElement.outerHTML,
      "text/html",
    );
    valueIncoming.querySelector("#focused-input")?.removeAttribute("disabled");
    valueIncoming.querySelector("#focused-input")?.setAttribute(
      "value",
      "server-updated",
    );
    const valueRefusal = refusalFor(valueIncoming);
    const classIncoming = new DOMParser().parseFromString(
      incoming.documentElement.outerHTML,
      "text/html",
    );
    classIncoming.querySelector("#focused-input")?.removeAttribute("disabled");
    classIncoming.querySelector("#root")?.setAttribute(
      "class",
      "hidden-destination",
    );
    const classRefusal = refusalFor(classIncoming);
    return {
      disabledRefusal,
      valueRefusal,
      classRefusal,
      focused: document.activeElement === input,
      disabled: input instanceof HTMLInputElement ? input.disabled : null,
      value: input instanceof HTMLInputElement ? input.value : null,
      selectionStart: input instanceof HTMLInputElement ? input.selectionStart : null,
      selectionEnd: input instanceof HTMLInputElement ? input.selectionEnd : null,
    };
  }, {
    destination:
      `${origin}/case?case=focused-input-selection-insert&mode=navigation&phase=incoming`,
  });
  expect(result).toEqual({
    disabledRefusal: "FADENO_RECONCILIATION_OWNERSHIP",
    valueRefusal: "FADENO_RECONCILIATION_OWNERSHIP",
    classRefusal: "FADENO_RECONCILIATION_OWNERSHIP",
    focused: true,
    disabled: false,
    value: "server-default",
    selectionStart: 2,
    selectionEnd: 6,
  });
});

test("refuses removal of a live top-layer owner before mutation", async ({ page }) => {
  await page.goto(
    `${origin}/case?case=dialog-modal-insert&mode=navigation&phase=current`,
  );
  await waitForEnhancement(page);
  await page.locator("#modal-dialog").evaluate((element) => {
    (element as HTMLDialogElement).showModal();
  });
  const result = await page.evaluate(async ({ destination }) => {
    const response = await fetch(destination, {
      cache: "no-store",
      credentials: "same-origin",
    });
    const incoming = new DOMParser().parseFromString(
      await response.text(),
      "text/html",
    );
    incoming.querySelector("#modal-dialog")?.remove();
    const dialog = document.querySelector("#modal-dialog");
    const modulePath = "/_fadeno/framework/internal/browser-reconciliation.js";
    const module = await import(modulePath) as {
      preparePrivateDocumentReconciliation(
        current: Document,
        next: Document,
      ): unknown;
    };
    let refusal = "accepted";
    try {
      module.preparePrivateDocumentReconciliation(document, incoming);
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error);
    }
    return {
      refusal,
      connected: dialog?.isConnected ?? false,
      open: dialog instanceof HTMLDialogElement ? dialog.open : false,
      modal: dialog instanceof HTMLDialogElement && dialog.matches(":modal"),
    };
  }, {
    destination:
      `${origin}/case?case=dialog-modal-insert&mode=navigation&phase=incoming`,
  });
  expect(result).toEqual({
    refusal: "FADENO_RECONCILIATION_OWNERSHIP",
    connected: true,
    open: true,
    modal: true,
  });
});

test("refuses removal of an open popover before mutation", async ({ page }) => {
  await page.goto(
    `${origin}/case?case=popover-open-reorder&mode=navigation&phase=current`,
  );
  await waitForEnhancement(page);
  await page.locator("#open-popover").evaluate((element) => {
    (element as HTMLElement).showPopover();
  });
  const result = await page.evaluate(async ({ destination }) => {
    const response = await fetch(destination, {
      cache: "no-store",
      credentials: "same-origin",
    });
    const incoming = new DOMParser().parseFromString(
      await response.text(),
      "text/html",
    );
    incoming.querySelector("#open-popover")?.remove();
    const popover = document.querySelector("#open-popover");
    const modulePath = "/_fadeno/framework/internal/browser-reconciliation.js";
    const module = await import(modulePath) as {
      preparePrivateDocumentReconciliation(
        current: Document,
        next: Document,
      ): unknown;
    };
    let refusal = "accepted";
    try {
      module.preparePrivateDocumentReconciliation(document, incoming);
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error);
    }
    return {
      refusal,
      connected: popover?.isConnected ?? false,
      open: popover?.matches(":popover-open") ?? false,
    };
  }, {
    destination:
      `${origin}/case?case=popover-open-reorder&mode=navigation&phase=incoming`,
  });
  expect(result).toEqual({
    refusal: "FADENO_RECONCILIATION_OWNERSHIP",
    connected: true,
    open: true,
  });
});

test("refuses every claimed hostile production reconciliation boundary", async ({ page }) => {
  await page.goto(
    `${origin}/case?case=dirty-text-insert&mode=navigation&phase=current`,
  );
  await waitForEnhancement(page);
  const refusals = await page.evaluate(async ({ baseOrigin }) => {
    const modulePath = "/_fadeno/framework/internal/browser-reconciliation.js";
    const module = await import(modulePath) as {
      PRIVATE_RECONCILIATION_LIMITS: Readonly<{ maximumRecords: number }>;
      preparePrivateDocumentReconciliation(
        current: Document,
        next: Document,
      ): unknown;
    };
    const load = async (
      caseId: string,
      phase: "current" | "incoming",
    ): Promise<Document> => {
      const response = await fetch(
        `${baseOrigin}/case?case=${caseId}&mode=navigation&phase=${phase}`,
        { cache: "no-store", credentials: "same-origin" },
      );
      return new DOMParser().parseFromString(await response.text(), "text/html");
    };
    const cases = [
      "duplicate-identity",
      "document-conflict",
      "reparented-identity",
      "retyped-identity",
      "record-limit",
      "depth-limit",
      "identity-limit",
      "derived-identity-limit",
      "script-surface",
      "event-attribute",
      "foreign-namespace",
      "unsupported-control",
      "media-drift",
      "island-drift",
      "island-attribute-drift",
      "contenteditable-drift",
      "popover-drift",
    ] as const;
    const results: Array<Readonly<{ name: string; code: string }>> = [];
    for (const name of cases) {
      const sourceCase = name === "media-drift"
        ? "media-playing-insert"
        : name === "island-drift" || name === "island-attribute-drift"
          ? "island-identity-remove"
          : name === "contenteditable-drift"
            ? "focused-contenteditable-caret-reorder"
            : name === "popover-drift"
              ? "popover-open-reorder"
              : "dirty-text-insert";
      const current = await load(sourceCase, "current");
      const incoming = await load(sourceCase, "incoming");
      const currentRoot = current.querySelector("main");
      const incomingRoot = incoming.querySelector("main");
      if (!currentRoot || !incomingRoot) throw new Error("FADENO_RECONCILIATION_HOSTILE_ROOT");
      switch (name) {
        case "duplicate-identity":
          incoming.querySelector("#inserted-peer")?.setAttribute("id", "peer-a");
          break;
        case "document-conflict": {
          const conflict = current.createElement("meta");
          conflict.id = "inserted-peer";
          current.head.append(conflict);
          break;
        }
        case "reparented-identity": {
          const owner = incoming.createElement("div");
          owner.id = "new-parent";
          const target = incoming.querySelector("#dirty-text");
          if (!target) throw new Error("FADENO_RECONCILIATION_HOSTILE_TARGET");
          owner.append(target);
          incomingRoot.prepend(owner);
          break;
        }
        case "retyped-identity": {
          const replacement = incoming.createElement("textarea");
          replacement.id = "dirty-text";
          replacement.textContent = "server-default";
          incoming.querySelector("#dirty-text")?.replaceWith(replacement);
          break;
        }
        case "record-limit":
          for (let index = 0; index < module.PRIVATE_RECONCILIATION_LIMITS.maximumRecords; index += 1) {
            const record = incoming.createElement("span");
            record.id = `overflow-${index}`;
            incomingRoot.append(record);
          }
          break;
        case "depth-limit": {
          let parent = incomingRoot;
          for (let depth = 0; depth < 17; depth += 1) {
            const nested = incoming.createElement("div");
            nested.id = `depth-${depth}`;
            parent.append(nested);
            parent = nested;
          }
          break;
        }
        case "identity-limit":
          incoming.querySelector("#inserted-peer")?.setAttribute(
            "id",
            "x".repeat(129),
          );
          break;
        case "derived-identity-limit":
          for (const [owner, root] of [
            [current, currentRoot],
            [incoming, incomingRoot],
          ] as const) {
            const form = owner.createElement("form");
            form.id = "x".repeat(128);
            const proof = owner.createElement("input");
            proof.type = "hidden";
            proof.name = "__fadeno_proof";
            form.append(proof);
            root.append(form);
          }
          break;
        case "script-surface": {
          const script = incoming.createElement("script");
          script.id = "hostile-script";
          incomingRoot.append(script);
          break;
        }
        case "event-attribute":
          incoming.querySelector("#dirty-text")?.setAttribute("onclick", "void 0");
          break;
        case "foreign-namespace": {
          const foreign = incoming.createElementNS(
            "http://www.w3.org/2000/svg",
            "svg",
          );
          foreign.id = "foreign-node";
          incomingRoot.append(foreign);
          break;
        }
        case "unsupported-control":
          incoming.querySelector("#dirty-text")?.setAttribute("type", "date");
          break;
        case "media-drift":
          incoming.querySelector("#playing-media")?.setAttribute(
            "src",
            "data:audio/wav;base64,AAAA",
          );
          break;
        case "island-drift": {
          const island = incoming.querySelector("#mounted-island");
          if (island) island.innerHTML = "changed-client-owner";
          break;
        }
        case "island-attribute-drift":
          incoming.querySelector("#mounted-island")?.setAttribute(
            "class",
            "server-owned-change",
          );
          break;
        case "contenteditable-drift":
          incoming.querySelector("#focused-editor")?.removeAttribute(
            "contenteditable",
          );
          break;
        case "popover-drift":
          incoming.querySelector("#open-popover")?.removeAttribute("popover");
          break;
      }
      let code = "accepted";
      try {
        module.preparePrivateDocumentReconciliation(current, incoming);
      } catch (error) {
        code = error instanceof Error ? error.message : String(error);
      }
      results.push(Object.freeze({ name, code }));
    }
    return results;
  }, { baseOrigin: origin });
  expect(refusals).toEqual([
    { name: "duplicate-identity", code: "FADENO_RECONCILIATION_IDENTITY" },
    { name: "document-conflict", code: "FADENO_RECONCILIATION_OWNERSHIP" },
    { name: "reparented-identity", code: "FADENO_RECONCILIATION_OWNERSHIP" },
    { name: "retyped-identity", code: "FADENO_RECONCILIATION_OWNERSHIP" },
    { name: "record-limit", code: "FADENO_RECONCILIATION_LIMIT" },
    { name: "depth-limit", code: "FADENO_RECONCILIATION_LIMIT" },
    { name: "identity-limit", code: "FADENO_RECONCILIATION_IDENTITY" },
    { name: "derived-identity-limit", code: "FADENO_RECONCILIATION_IDENTITY" },
    { name: "script-surface", code: "FADENO_RECONCILIATION_SURFACE" },
    { name: "event-attribute", code: "FADENO_RECONCILIATION_SURFACE" },
    { name: "foreign-namespace", code: "FADENO_RECONCILIATION_SURFACE" },
    { name: "unsupported-control", code: "FADENO_RECONCILIATION_SURFACE" },
    { name: "media-drift", code: "FADENO_RECONCILIATION_CONTENT" },
    { name: "island-drift", code: "FADENO_RECONCILIATION_CONTENT" },
    { name: "island-attribute-drift", code: "FADENO_RECONCILIATION_CONTENT" },
    { name: "contenteditable-drift", code: "FADENO_RECONCILIATION_OWNERSHIP" },
    { name: "popover-drift", code: "FADENO_RECONCILIATION_OWNERSHIP" },
  ]);
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
    const applied = document.querySelector("#reconciliation-phase")?.textContent
      === "incoming"
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
