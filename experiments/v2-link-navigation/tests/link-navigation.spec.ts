import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test, type Page } from "@playwright/test";

const root = process.cwd();
const outputRoot = join(root, "output/v2-link-navigation");
const consumer = join(outputRoot, "consumer");
const site = join(outputRoot, "site");
const expected = (name: string): unknown => JSON.parse(readFileSync(join(outputRoot, `expected-${name}.json`), "utf8")) as unknown;

async function settleBrowserTraversal(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function waitForPrivateHistoryOwner(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.readyState === "complete"
    && history.scrollRestoration === "manual"
    && Boolean(Reflect.get(globalThis, "__fadenoExampleEnhancement")))).toBe(true);
}

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
let enhancedHomeDelay = 0;
let enhancedSlowDelay = 0;

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
    if (enhancedHomeDelay > 0
      && url.pathname === "/"
      && request.headers.get("accept") === "application/vnd.fadeno.private-update+json; version=1") {
      await new Promise((resolve) => setTimeout(resolve, enhancedHomeDelay));
    }
    if (enhancedSlowDelay > 0
      && url.pathname === "/slow"
      && request.headers.get("accept") === "application/vnd.fadeno.private-update+json; version=1") {
      await new Promise((resolve) => setTimeout(resolve, enhancedSlowDelay));
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
test.beforeEach(() => {
  requests.length = 0;
  enhancedHomeDelay = 0;
  enhancedSlowDelay = 0;
});

test("enhances one safe link with document, title, URL, history, and focus", async ({ page }) => {
  await page.goto(origin);
  expect(await page.evaluate(() => ({
    ...history.state,
    session: typeof history.state?.session === "string" && history.state.session.startsWith("session:"),
    entry: typeof history.state?.entry === "string" && history.state.entry.startsWith("history:"),
  }))).toEqual({
    "fadeno.private.navigation.v1": true,
    version: 1,
    session: true,
    entry: true,
    scrollX: 0,
    scrollY: 0,
    elementScroll: false,
  });
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

test("restores automatic scroll ownership before native same-context departure", async ({ page }) => {
  await page.goto(origin);
  await page.evaluate(() => {
    addEventListener("pagehide", () => {
      sessionStorage.setItem("fadeno-test-native-departure-restoration", history.scrollRestoration);
    }, { once: true });
    const input = document.createElement("input");
    input.defaultValue = "before";
    input.value = "after";
    document.body.append(input);
  });
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  expect({
    schema: "fadeno.example.history-native-departure",
    version: 1,
    restorationAtDeparture: await page.evaluate(() => sessionStorage.getItem("fadeno-test-native-departure-restoration")),
    nativeRecovery: requests.filter(({ path }) => path === "/next").at(-1)?.enhanced === false,
  }).toEqual(expected("history-native-departure"));
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

for (const [motion, evidence] of [["no-preference", "history-focus-normal"], ["reduce", "history-focus"]] as const) {
  test(`commits focus and top scroll without animation under ${motion} motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: motion });
    await page.addInitScript(() => {
      Reflect.set(globalThis, "__fadenoTransitions", 0);
      const transition = Reflect.get(Document.prototype, "startViewTransition");
      if (typeof transition === "function") {
        Reflect.set(Document.prototype, "startViewTransition", function(this: Document, ...arguments_: unknown[]) {
          Reflect.set(globalThis, "__fadenoTransitions", Number(Reflect.get(globalThis, "__fadenoTransitions")) + 1);
          return Reflect.apply(transition, this, arguments_);
        });
      }
    });
    await page.goto(origin);
    expect(await page.evaluate(() => ({ focus: document.activeElement?.tagName, restoration: history.scrollRestoration })))
      .toEqual({ focus: "BODY", restoration: "manual" });
    await page.locator("#next-link").click();
    await expect(page.locator("h1")).toHaveText("Next");
    const result = await page.evaluate(() => ({
      schema: "fadeno.example.history-focus-success",
      version: 1,
      path: location.pathname,
      heading: document.querySelector("h1")?.textContent,
      focus: document.activeElement?.tagName,
      scrollX,
      scrollY,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      animations: document.getAnimations().length,
      transitions: Number(Reflect.get(globalThis, "__fadenoTransitions")),
    }));
    expect(result).toEqual(expected(evidence));
  });
}

test("restores automatic scroll ownership when the runtime closes", async ({ page }) => {
  await page.goto(origin);
  const result = await page.evaluate(() => {
    const enhancement = Reflect.get(globalThis, "__fadenoExampleEnhancement") as { close(): void; state(): string };
    const activeRestoration = history.scrollRestoration;
    enhancement.close();
    return {
      schema: "fadeno.example.history-teardown",
      version: 1,
      activeRestoration,
      closedState: enhancement.state(),
      restoredRestoration: history.scrollRestoration,
    };
  });
  expect(result).toEqual(expected("history-teardown"));
});

test("restores automatic scroll ownership when initial history acquisition fails", async ({ page }) => {
  await page.addInitScript(() => {
    history.replaceState = (): never => { throw new DOMException("history mutation limited", "SecurityError"); };
  });
  await page.goto(origin);
  const restoration = await page.evaluate(() => history.scrollRestoration);
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  expect({
    schema: "fadeno.example.history-startup-recovery",
    version: 1,
    restoration,
    nativeRecovery: requests.filter(({ path }) => path === "/next").at(-1)?.enhanced === false,
  }).toEqual(expected("history-startup-recovery"));
});

test("allows a scrolled origin and reloads that unsafe history entry on return", async ({ page }) => {
  await page.goto(origin);
  await page.locator("#bottom-next-link").scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
  const enhancedNextBeforeScroll = requests.filter(({ path, enhanced }) => path === "/next" && enhanced).length;
  await page.locator("#bottom-next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  const scrolledOriginEnhanced = requests.filter(({ path, enhanced }) => path === "/next" && enhanced).length > enhancedNextBeforeScroll;
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.goBack();
  await expect(page.locator("h1")).toHaveText("Home");
  const recoveredPath = new URL(page.url()).pathname;
  const recoveredHeading = await page.locator("h1").textContent();
  const nativeScrollRestored = await page.evaluate(() => scrollY > 0);
  const nativeRecovery = await page.evaluate(() => typeof history.state === "object"
    && history.state !== null
    && Number(Reflect.get(history.state as object, "scrollY")) > 0);
  const restorationLifecycle = await page.evaluate(async () => {
    const enhancement = Reflect.get(globalThis, "__fadenoExampleEnhancement") as { close(): void; state(): string };
    const recoveredActiveRestoration = history.scrollRestoration;
    enhancement.close();
    const recoveredClosedRestoration = history.scrollRestoration;
    const modulePath: string = "/_fadeno/framework/browser.js";
    const runtime = await import(modulePath) as Readonly<{
      startBrowserEnhancement(): { close(): void; state(): string };
    }>;
    Reflect.set(globalThis, "__fadenoExampleEnhancement", runtime.startBrowserEnhancement());
    return { recoveredActiveRestoration, recoveredClosedRestoration };
  });
  const enhancedNextBefore = requests.filter(({ path, enhanced }) => path === "/next" && enhanced).length;
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  const result = {
    schema: "fadeno.example.history-scroll-refusal",
    version: 1,
    path: recoveredPath,
    heading: recoveredHeading,
    nativeRecovery,
    staleDocumentRemoved: recoveredHeading !== "Next",
    scrolledOriginEnhanced,
    nativeScrollRestored,
    ...restorationLifecycle,
    runtimeRestarted: requests.filter(({ path, enhanced }) => path === "/next" && enhanced).length > enhancedNextBefore,
  };
  expect(result).toEqual(expected("history-scroll-refusal"));
});

test("keeps an entry unsafe after returning to the top and restarting", async ({ page }) => {
  await page.goto(origin);
  await page.locator("#bottom-next-link").scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => Number(history.state?.scrollY))).toBeGreaterThan(0);
  await page.evaluate(() => scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  const unsafeStatePreserved = await page.evaluate(async () => {
    const enhancement = Reflect.get(globalThis, "__fadenoExampleEnhancement") as { close(): void };
    enhancement.close();
    const modulePath: string = "/_fadeno/framework/browser.js";
    const runtime = await import(modulePath) as Readonly<{
      startBrowserEnhancement(): { close(): void; state(): string };
    }>;
    Reflect.set(globalThis, "__fadenoExampleEnhancement", runtime.startBrowserEnhancement());
    return Number(history.state?.scrollY) > 0;
  });
  const enhancedNextBefore = requests.filter(({ path, enhanced }) => path === "/next" && enhanced).length;
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  const nativeHomeBefore = requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length;
  await page.goBack();
  await expect(page.locator("h1")).toHaveText("Home");
  expect({
    schema: "fadeno.example.history-monotonic-scroll-recovery",
    version: 1,
    unsafeStatePreserved,
    enhancedDeparture: requests.filter(({ path, enhanced }) => path === "/next" && enhanced).length > enhancedNextBefore,
    nativeRecovery: requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length > nativeHomeBefore,
    staleDocumentRemoved: await page.locator("h1").textContent() === "Home",
  }).toEqual(expected("history-monotonic-scroll-recovery"));
});

test("coalesces history writes and keeps mutation-limit failure native", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.name));
  await page.goto(origin);
  const coalescedWrites = await page.evaluate(async () => {
    const original = history.replaceState.bind(history);
    let writes = 0;
    history.replaceState = (data: unknown, unused: string, url?: string | URL | null): void => {
      writes += 1;
      original(data, unused, url);
    };
    scrollTo(0, 100);
    for (let frame = 0; frame < 5; frame += 1) {
      for (let index = 0; index < 20; index += 1) document.dispatchEvent(new Event("scroll"));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return writes;
  });
  await page.evaluate(() => {
    history.replaceState({
      ...history.state,
      scrollX: 0,
      scrollY: 0,
      elementScroll: false,
    }, "", location.href);
    history.replaceState = (): never => { throw new DOMException("history mutation limited", "SecurityError"); };
    scrollTo(0, 200);
    addEventListener("pagehide", () => {
      sessionStorage.setItem("fadeno-test-write-failure-restoration", history.scrollRestoration);
    }, { once: true });
  });
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  const result = {
    schema: "fadeno.example.history-write-recovery",
    version: 1,
    coalescedWrites,
    nativeRecovery: requests.filter(({ path }) => path === "/next").at(-1)?.enhanced === false,
    restorationAtDeparture: await page.evaluate(() => sessionStorage.getItem("fadeno-test-write-failure-restoration")),
    uncaughtErrors: pageErrors.length,
  };
  expect(result).toEqual(expected("history-write-recovery"));
});

test("keeps unsafe history tracking fail closed after its bound", async ({ page }) => {
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const modulePath: string = "/_fadeno/framework/internal/browser-navigation.js";
    const runtime = await import(modulePath) as Readonly<{
      createPrivateUnsafeHistoryEntryTracker(): {
        mark(entry: string): void;
        requiresReload(entry: string): boolean;
      };
    }>;
    const tracker = runtime.createPrivateUnsafeHistoryEntryTracker();
    for (let index = 0; index <= 256; index += 1) tracker.mark(`history:overflow-${index}`);
    return {
      schema: "fadeno.example.history-overflow-recovery",
      version: 1,
      evictedEntryReloads: tracker.requiresReload("history:overflow-0"),
      unknownEntryReloads: tracker.requiresReload("history:not-observed"),
    };
  });
  expect(result).toEqual(expected("history-overflow-recovery"));
});

test("reloads application-owned and malformed history instead of showing stale markup", async ({ page }) => {
  await page.goto(origin);
  await page.evaluate(() => history.pushState({ application: true }, "", "/next"));
  await page.goBack();
  await expect(page.locator("h1")).toHaveText("Home");
  const nativeNextBefore = requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length;
  await page.goForward();
  await expect(page.locator("h1")).toHaveText("Next");
  const result = {
    schema: "fadeno.example.history-state-recovery",
    version: 1,
    path: new URL(page.url()).pathname,
    heading: await page.locator("h1").textContent(),
    nativeRecovery: requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length > nativeNextBefore,
    staleDocumentRemoved: await page.locator("h1").textContent() !== "Home",
    malformedRecoveries: 0,
  };
  const base = {
    "fadeno.private.navigation.v1": true,
    version: 1,
    session: "session:malformed-fixture",
    entry: "history:malformed-fixture",
    scrollX: 0,
    scrollY: 0,
    elementScroll: false,
  };
  const malformed: unknown[] = [
    { ...base, version: 2 },
    { ...base, extra: true },
    { ...base, scrollY: -1 },
    { ...base, elementScroll: "false" },
    { "fadeno.private.navigation.v1": true, version: 1, entry: base.entry, scrollX: 0, scrollY: 0 },
  ];
  for (const state of malformed) {
    await page.goto(origin);
    await page.evaluate((value) => history.pushState(value, "", "/next"), state);
    await page.goBack();
    await expect(page.locator("h1")).toHaveText("Home");
    const nativeBefore = requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length;
    await page.goForward();
    await expect(page.locator("h1")).toHaveText("Next");
    if (requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length > nativeBefore) result.malformedRecoveries += 1;
  }
  expect(result).toEqual(expected("history-recovery"));
});

test("discards only a collapsed old-document selection", async ({ page }) => {
  await page.goto(origin);
  expect(await page.evaluate(() => {
    const text = document.querySelector("h1")?.firstChild;
    if (!text) return false;
    const range = document.createRange();
    range.setStart(text, 1);
    range.collapse(true);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return selection?.isCollapsed;
  })).toBe(true);
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  expect(requests.filter(({ path }) => path === "/next").map(({ enhanced }) => enhanced)).toEqual([true]);
  expect(await page.evaluate(() => document.getSelection()?.toString())).toBe("");
});

test("keeps a non-collapsed selection on the native path", async ({ page }) => {
  await page.goto(origin);
  await page.evaluate(() => {
    const heading = document.querySelector("h1");
    if (!heading) return;
    const range = document.createRange();
    range.selectNodeContents(heading);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.addEventListener("mousedown", (event) => event.preventDefault(), { once: true });
  });
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  expect(requests.filter(({ path }) => path === "/next").map(({ enhanced }) => enhanced)).toEqual([false]);
});

test("reloads an owned element-scrolled entry during traversal", async ({ page }) => {
  await page.goto(origin);
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  await page.locator("#home-link").click();
  await expect(page.locator("h1")).toHaveText("Home");
  await page.evaluate(() => {
    const scroller = document.createElement("div");
    scroller.style.cssText = "height:20px;overflow:auto";
    const child = document.createElement("div");
    child.style.height = "200px";
    scroller.append(child);
    document.body.append(scroller);
    scroller.scrollTop = 20;
  });
  await expect.poll(() => page.evaluate(() => Boolean(history.state?.elementScroll))).toBe(true);
  await page.goBack();
  await expect(page.locator("h1")).toHaveText("Next");
  await settleBrowserTraversal(page);
  const nativeHomeBefore = requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length;
  await page.goForward();
  await expect(page.locator("h1")).toHaveText("Home", { timeout: 15_000 });
  expect({
    schema: "fadeno.example.history-element-recovery",
    version: 1,
    path: new URL(page.url()).pathname,
    nativeRecovery: requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length > nativeHomeBefore,
    elementScrollRecorded: await page.evaluate(() => Boolean(history.state?.elementScroll)),
  }).toEqual(expected("history-element-recovery"));
});

test("marks an outgoing scroll before a same-task traversal", async ({ page }) => {
  await page.goto(origin);
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  await page.locator("#home-link").click();
  await expect(page.locator("h1")).toHaveText("Home");
  await page.evaluate(() => {
    document.documentElement.scrollTop = 100;
    history.back();
  });
  await expect(page.locator("h1")).toHaveText("Next");
  await waitForPrivateHistoryOwner(page);
  const nativeHomeBefore = requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length;
  await page.goForward();
  await expect(page.locator("h1")).toHaveText("Home", { timeout: 15_000 });
  await waitForPrivateHistoryOwner(page);
  const staleDocumentRemoved = await page.locator("h1").textContent() === "Home";
  const nativeNextBeforePersistentRecovery = requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length;
  await page.goBack();
  await expect(page.locator("h1")).toHaveText("Next", { timeout: 15_000 });
  expect({
    schema: "fadeno.example.history-pending-scroll-recovery",
    version: 1,
    nativeRecovery: requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length > nativeHomeBefore,
    persistentRecovery: requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length > nativeNextBeforePersistentRecovery,
    staleDocumentRemoved,
  }).toEqual(expected("history-pending-scroll-recovery"));
});

test("records document scroll while traversal work is pending", async ({ page }) => {
  await page.goto(origin);
  await page.locator("#slow-link").click();
  await expect(page.locator("h1")).toHaveText("Slow");
  await page.locator("#home-link").click();
  await expect(page.locator("h1")).toHaveText("Home");
  enhancedSlowDelay = 250;
  await page.evaluate(() => {
    history.back();
    setTimeout(() => scrollTo(0, 100), 20);
  });
  await expect(page.locator("h1")).toHaveText("Slow");
  const nativeHomeBefore = requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length;
  await page.goForward();
  await expect(page.locator("h1")).toHaveText("Home", { timeout: 15_000 });
  expect({
    schema: "fadeno.example.history-traversal-scroll-recovery",
    version: 1,
    nativeRecovery: requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length > nativeHomeBefore,
    staleDocumentRemoved: await page.locator("h1").textContent() === "Home",
  }).toEqual(expected("history-traversal-scroll-recovery"));
});

test("recovers the selected entry when closing a pending traversal", async ({ page }) => {
  await page.goto(origin);
  await page.locator("#slow-link").click();
  await expect(page.locator("h1")).toHaveText("Slow");
  await page.locator("#home-link").click();
  await expect(page.locator("h1")).toHaveText("Home");
  enhancedSlowDelay = 250;
  const nativeSlowBefore = requests.filter(({ path, enhanced }) => path === "/slow" && !enhanced).length;
  await page.evaluate(() => {
    addEventListener("pagehide", () => {
      sessionStorage.setItem("fadeno-test-close-traversal-restoration", history.scrollRestoration);
    }, { once: true });
    history.back();
    setTimeout(() => {
      const enhancement = Reflect.get(globalThis, "__fadenoExampleEnhancement") as { close(): void };
      enhancement.close();
    }, 20);
  });
  await expect(page.locator("h1")).toHaveText("Slow", { timeout: 15_000 });
  expect({
    schema: "fadeno.example.history-close-traversal-recovery",
    version: 1,
    path: new URL(page.url()).pathname,
    restorationAtRecovery: await page.evaluate(() => sessionStorage.getItem("fadeno-test-close-traversal-restoration")),
    nativeRecovery: requests.filter(({ path, enhanced }) => path === "/slow" && !enhanced).length > nativeSlowBefore,
    staleDocumentRemoved: await page.locator("h1").textContent() === "Slow",
  }).toEqual(expected("history-close-traversal-recovery"));
});

test("flushes late outgoing document scroll before commit", async ({ page }) => {
  await page.addInitScript(() => {
    const original = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (...arguments_: Parameters<typeof fetch>): Promise<Response> => {
      const response = await original(...arguments_);
      const request = new Request(arguments_[0], arguments_[1]);
      if (new URL(request.url).pathname === "/next") scrollTo(0, 100);
      return response;
    };
  });
  await page.goto(origin);
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  const nativeHomeBefore = requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length;
  await page.goBack();
  await expect(page.locator("h1")).toHaveText("Home");
  expect({
    schema: "fadeno.example.history-late-scroll-recovery",
    version: 1,
    nativeRecovery: requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length > nativeHomeBefore,
    staleDocumentRemoved: await page.locator("h1").textContent() === "Home",
  }).toEqual(expected("history-late-scroll-recovery"));
});

test("revalidates selected history ownership before traversal commit", async ({ page }) => {
  await page.goto(origin);
  await page.locator("#slow-link").click();
  await expect(page.locator("h1")).toHaveText("Slow");
  enhancedHomeDelay = 250;
  const nativeHomeBefore = requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length;
  await page.evaluate(() => {
    const original = history.replaceState.bind(history);
    sessionStorage.setItem("fadeno-test-private-history-overwrite", "0");
    sessionStorage.setItem("fadeno-test-private-history-armed", "0");
    history.replaceState = (data: unknown, unused: string, url?: string | URL | null): void => {
      if (sessionStorage.getItem("fadeno-test-private-history-armed") === "1"
        && typeof data === "object" && data !== null
        && Reflect.get(data, "fadeno.private.navigation.v1") === true) {
        sessionStorage.setItem("fadeno-test-private-history-overwrite", "1");
      }
      original(data, unused, url);
    };
    history.back();
    setTimeout(() => {
      original({ application: true }, "", location.href);
      sessionStorage.setItem("fadeno-test-private-history-armed", "1");
    }, 20);
  });
  await expect(page.locator("h1")).toHaveText("Home");
  expect({
    schema: "fadeno.example.history-selected-state-recovery",
    version: 1,
    privateStateOverwritePrevented: await page.evaluate(() => sessionStorage.getItem("fadeno-test-private-history-overwrite") === "0"),
    nativeRecovery: requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length > nativeHomeBefore,
    staleDocumentRemoved: await page.locator("h1").textContent() !== "Slow",
  }).toEqual(expected("history-selected-state-recovery"));
});

test("cancels an obsolete history traversal and publishes only the newest entry", async ({ page }) => {
  await page.goto(origin);
  await page.locator("#slow-link").click();
  await expect(page.locator("h1")).toHaveText("Slow");
  await page.locator("#home-link").click();
  await expect(page.locator("h1")).toHaveText("Home");
  enhancedHomeDelay = 250;
  const nativeHomeBeforeRapidTraversal = requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length;
  await page.evaluate(() => {
    const original = history.replaceState.bind(history);
    sessionStorage.setItem("fadeno-test-stale-history-writes", "0");
    history.replaceState = (data: unknown, unused: string, url?: string | URL | null): void => {
      if (typeof data === "object" && data !== null && Number(Reflect.get(data, "scrollY")) > 0) {
        sessionStorage.setItem(
          "fadeno-test-stale-history-writes",
          String(Number(sessionStorage.getItem("fadeno-test-stale-history-writes")) + 1),
        );
      }
      original(data, unused, url);
    };
    history.back();
    setTimeout(() => scrollTo(0, 100), 10);
    setTimeout(() => history.forward(), 20);
  });
  await expect(page.locator("h1")).toHaveText("Home");
  await expect.poll(() => requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length)
    .toBeGreaterThan(nativeHomeBeforeRapidTraversal);
  expect(new URL(page.url()).pathname).toBe("/");
  expect(await page.locator("h1").textContent()).not.toBe("Slow");
  expect(await page.evaluate(() => Number(sessionStorage.getItem("fadeno-test-stale-history-writes")))).toBe(0);
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
      "destination scroll committed at the native top boundary without transition work",
    ],
    ownership: {
      browser: ["activation", "operation", "history", "focus", "scroll"],
      server: ["authorization", "route", "resources", "rendered outcome"],
    },
    skipped: ["form interception", "general state reconciliation", "transported script execution", "animation"],
    outcome: "enhanced-document",
  });
});
