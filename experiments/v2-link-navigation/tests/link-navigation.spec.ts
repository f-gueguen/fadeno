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
  await expect.poll(async () => {
    try {
      return await page.evaluate(() => document.readyState === "complete"
        && history.scrollRestoration === "manual"
        && Boolean(Reflect.get(globalThis, "__fadenoExampleEnhancement")));
    } catch { return false; }
  }).toBe(true);
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

test("declines history ownership when secure identity generation is unavailable", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.name));
  await page.addInitScript(() => {
    Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: undefined });
  });
  await page.goto(origin);
  const nativeNextBefore = requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length;
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  expect({
    schema: "fadeno.example.history-environment-refusal",
    version: 1,
    nativeNavigation: requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length > nativeNextBefore,
    historyUnclaimed: await page.evaluate(() => history.state === null),
    uncaughtErrors: pageErrors.length,
  }).toEqual(expected("history-environment-refusal"));
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
    const refusedReplaceState = (): never => { throw new DOMException("history mutation limited", "SecurityError"); };
    Reflect.set(globalThis, "__fadenoStartupReplaceState", refusedReplaceState);
    Reflect.set(globalThis, "__fadenoStartupPushState", history.pushState);
    history.replaceState = refusedReplaceState;
  });
  await page.goto(origin);
  const startup = await page.evaluate(() => ({
    restoration: history.scrollRestoration,
    wrappersRestored: history.replaceState === Reflect.get(globalThis, "__fadenoStartupReplaceState")
      && history.pushState === Reflect.get(globalThis, "__fadenoStartupPushState"),
  }));
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  expect({
    schema: "fadeno.example.history-startup-recovery",
    version: 1,
    ...startup,
    nativeRecovery: requests.filter(({ path }) => path === "/next").at(-1)?.enhanced === false,
  }).toEqual(expected("history-startup-recovery"));
});

test("rekeys exact-shape startup state before claiming ownership", async ({ page }) => {
  await page.addInitScript(() => {
    history.replaceState({
      "fadeno.private.navigation.v1": true,
      version: 1,
      session: "session:application",
      entry: "history:application",
      scrollX: 0,
      scrollY: 0,
      elementScroll: false,
    }, "", location.href);
  });
  await page.goto(origin);
  const startup = await page.evaluate(() => ({
    startupStateRekeyed: history.state?.session !== "session:application"
      && history.state?.entry !== "history:application",
    restoration: history.scrollRestoration,
  }));
  const enhancedNextBefore = requests.filter(({ path, enhanced }) => path === "/next" && enhanced).length;
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  expect({
    schema: "fadeno.example.history-startup-state-rekey",
    version: 1,
    ...startup,
    enhancementUsesRekeyedOwner: requests.filter(({ path, enhanced }) => path === "/next" && enhanced).length > enhancedNextBefore,
  }).toEqual(expected("history-startup-state-rekey"));
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
  const nativeHomeBefore = requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length;
  await page.goBack();
  await expect(page.locator("h1")).toHaveText("Home");
  const recoveredPath = new URL(page.url()).pathname;
  const recoveredHeading = await page.locator("h1").textContent();
  const nativeScrollRestored = await page.evaluate(() => scrollY > 0);
  const nativeRecovery = requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length > nativeHomeBefore;
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

test("clears only the recovered unsafe entry after a zero-scroll current-truth reload", async ({ page }) => {
  await page.addInitScript(() => { history.scrollRestoration = "manual"; });
  await page.goto(origin);
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  await page.locator("#home-link").click();
  await expect(page.locator("h1")).toHaveText("Home");
  const unsafeEntry = await page.evaluate(() => String(history.state?.entry));
  await page.evaluate(() => {
    document.documentElement.scrollTop = 100;
    history.back();
  });
  await expect(page.locator("h1")).toHaveText("Next");
  const nativeHomeBefore = requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length;
  await page.goForward();
  await expect(page.locator("h1")).toHaveText("Home");
  await waitForPrivateHistoryOwner(page);
  const recoveredEntry = await page.evaluate(() => String(history.state?.entry));
  const enhancedNextBefore = requests.filter(({ path, enhanced }) => path === "/next" && enhanced).length;
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  const enhancedHomeBefore = requests.filter(({ path, enhanced }) => path === "/" && enhanced).length;
  await page.goBack();
  await expect(page.locator("h1")).toHaveText("Home");
  expect({
    schema: "fadeno.example.history-entry-recovery-resumption",
    version: 1,
    unsafeEntryReloaded: requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length > nativeHomeBefore,
    recoveredEntryRekeyed: recoveredEntry !== unsafeEntry,
    supportedTraversalResumed: requests.filter(({ path, enhanced }) => path === "/next" && enhanced).length > enhancedNextBefore
      && requests.filter(({ path, enhanced }) => path === "/" && enhanced).length > enhancedHomeBefore,
    staleDocumentRemoved: new URL(page.url()).pathname === "/" && await page.locator("h1").textContent() === "Home",
  }).toEqual(expected("history-entry-recovery-resumption"));
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

test("reloads application-owned, foreign-session, and malformed history instead of showing stale markup", async ({ page }) => {
  const recoverOwnedHome = async (): Promise<void> => {
    const nativeHomeBefore = requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length;
    await page.goBack();
    await expect(page.locator("h1")).toHaveText("Home");
    await expect.poll(() => requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length)
      .toBeGreaterThan(nativeHomeBefore);
    await waitForPrivateHistoryOwner(page);
  };
  await page.goto(origin);
  await page.evaluate(() => history.pushState({ application: true }, "", "/next"));
  await recoverOwnedHome();
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
    foreignSessionRecovery: false,
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
    await recoverOwnedHome();
    const nativeBefore = requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length;
    await page.goForward();
    await expect(page.locator("h1")).toHaveText("Next");
    if (requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length > nativeBefore) result.malformedRecoveries += 1;
  }
  await page.goto(origin);
  await page.evaluate((state) => history.pushState(state, "", "/next"), base);
  await recoverOwnedHome();
  const nativeForeignBefore = requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length;
  await page.goForward();
  await expect(page.locator("h1")).toHaveText("Next");
  result.foreignSessionRecovery = requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length > nativeForeignBefore;
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
    staleElementOwnershipCleared: await page.evaluate(() => history.state?.elementScroll === false),
  }).toEqual(expected("history-element-recovery"));
});

test("keeps a link native after recorded element scroll returns to zero", async ({ page }) => {
  await page.goto(origin);
  await page.evaluate(() => {
    const scroller = document.createElement("div");
    scroller.id = "recorded-element-scroller";
    scroller.style.cssText = "height:20px;overflow:auto";
    const child = document.createElement("div");
    child.style.height = "200px";
    scroller.append(child);
    document.body.append(scroller);
    scroller.scrollTop = 20;
  });
  await expect.poll(() => page.evaluate(() => Boolean(history.state?.elementScroll))).toBe(true);
  await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>("#recorded-element-scroller");
    if (scroller) scroller.scrollTop = 0;
  });
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>("#recorded-element-scroller")?.scrollTop)).toBe(0);
  const nativeNextBefore = requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length;
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  expect({
    schema: "fadeno.example.history-element-link-refusal",
    version: 1,
    elementOwnershipRetained: true,
    nativeDeparture: requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length > nativeNextBefore,
    enhancedRequestSkipped: requests.filter(({ path, enhanced }) => path === "/next" && enhanced).length === 0,
  }).toEqual(expected("history-element-link-refusal"));
});

test("retains element ownership when document scroll was already recorded", async ({ page }) => {
  await page.goto(origin);
  await page.evaluate(() => scrollTo(0, 100));
  await expect.poll(() => page.evaluate(() => Number(history.state?.scrollY))).toBeGreaterThan(0);
  await page.evaluate(() => {
    const scroller = document.createElement("div");
    scroller.id = "combined-scroll-scroller";
    scroller.style.cssText = "height:20px;overflow:auto";
    const child = document.createElement("div");
    child.style.height = "200px";
    scroller.append(child);
    document.body.append(scroller);
    scroller.scrollTop = 20;
  });
  await expect.poll(() => page.evaluate(() => Boolean(history.state?.elementScroll))).toBe(true);
  const combinedOwnershipRecorded = await page.evaluate(() => Number(history.state?.scrollY) > 0
    && history.state?.elementScroll === true);
  await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>("#combined-scroll-scroller");
    if (scroller) scroller.scrollTop = 0;
  });
  const nativeNextBefore = requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length;
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  expect({
    schema: "fadeno.example.history-combined-scroll-refusal",
    version: 1,
    combinedOwnershipRecorded,
    nativeDeparture: requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length > nativeNextBefore,
    enhancedRequestSkipped: requests.filter(({ path, enhanced }) => path === "/next" && enhanced).length === 0,
  }).toEqual(expected("history-combined-scroll-refusal"));
});

test("refuses element-scroll ownership acquired while a request is pending", async ({ page }) => {
  await page.goto(origin);
  enhancedSlowDelay = 250;
  const nativeSlowBefore = requests.filter(({ path, enhanced }) => path === "/slow" && !enhanced).length;
  await page.locator("#slow-link").click({ noWaitAfter: true });
  await page.waitForTimeout(20);
  await page.evaluate(() => {
    const scroller = document.createElement("div");
    scroller.id = "pending-element-scroller";
    scroller.style.cssText = "height:20px;overflow:auto";
    const child = document.createElement("div");
    child.style.height = "200px";
    scroller.append(child);
    document.body.append(scroller);
    scroller.scrollTop = 20;
  });
  await expect.poll(() => page.evaluate(() => Boolean(history.state?.elementScroll))).toBe(true);
  await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>("#pending-element-scroller");
    if (scroller) scroller.scrollTop = 0;
  });
  await expect(page.locator("h1")).toHaveText("Slow");
  expect({
    schema: "fadeno.example.history-pending-element-scroll-refusal",
    version: 1,
    elementOwnershipRetained: true,
    enhancedAttemptObserved: requests.some(({ path, enhanced }) => path === "/slow" && enhanced),
    nativeRecovery: requests.filter(({ path, enhanced }) => path === "/slow" && !enhanced).length > nativeSlowBefore,
    staleDocumentRemoved: new URL(page.url()).pathname === "/slow" && await page.locator("h1").textContent() === "Slow",
  }).toEqual(expected("history-pending-element-scroll-refusal"));
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
  const nativeSlowBefore = requests.filter(({ path, enhanced }) => path === "/slow" && !enhanced).length;
  await page.evaluate(() => {
    history.back();
    setTimeout(() => scrollTo(0, 100), 20);
  });
  await expect(page.locator("h1")).toHaveText("Slow");
  await expect.poll(() => requests.filter(({ path, enhanced }) => path === "/slow" && !enhanced).length)
    .toBeGreaterThan(nativeSlowBefore);
  await waitForPrivateHistoryOwner(page);
  const pendingTraversalNativeRecovery = requests.filter(({ path, enhanced }) => path === "/slow" && !enhanced).length > nativeSlowBefore;
  const nativeHomeBefore = requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length;
  await page.goForward();
  await expect(page.locator("h1")).toHaveText("Home", { timeout: 15_000 });
  expect({
    schema: "fadeno.example.history-traversal-scroll-recovery",
    version: 1,
    pendingTraversalNativeRecovery,
    nativeRecovery: requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length > nativeHomeBefore,
    staleDocumentRemoved: await page.locator("h1").textContent() === "Home",
  }).toEqual(expected("history-traversal-scroll-recovery"));
});

test("keeps delayed traversal recovery supersedable by a native click", async ({ page }) => {
  await page.goto(origin);
  await page.locator("#slow-link").click();
  await expect(page.locator("h1")).toHaveText("Slow");
  await page.locator("#home-link").click();
  await expect(page.locator("h1")).toHaveText("Home");
  enhancedSlowDelay = 250;
  await page.evaluate(() => history.back());
  await expect.poll(() => new URL(page.url()).pathname).toBe("/slow");
  await page.evaluate(() => scrollTo(0, 100));
  await page.waitForTimeout(10);
  const nativeNextBefore = requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length;
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  await page.waitForTimeout(300);
  expect({
    schema: "fadeno.example.history-delayed-recovery-supersession",
    version: 1,
    nativeClickWon: requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length > nativeNextBefore,
    obsoleteRecoverySuppressed: new URL(page.url()).pathname === "/next"
      && await page.locator("h1").textContent() === "Next",
  }).toEqual(expected("history-delayed-recovery-supersession"));
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

test("repairs displayed truth when close recovery is cancelled", async ({ page }) => {
  await page.goto(origin);
  await page.locator("#slow-link").click();
  await expect(page.locator("h1")).toHaveText("Slow");
  await page.locator("#home-link").click();
  await expect(page.locator("h1")).toHaveText("Home");
  enhancedSlowDelay = 250;
  await page.evaluate(() => {
    addEventListener("beforeunload", (event) => {
      event.preventDefault();
      event.returnValue = "";
    }, { once: true });
    history.back();
    setTimeout(() => {
      const enhancement = Reflect.get(globalThis, "__fadenoExampleEnhancement") as { close(): void };
      enhancement.close();
    }, 20);
  });
  const dismissed = new Promise<void>((resolve) => {
    page.once("dialog", (dialog) => { void dialog.dismiss().then(resolve); });
  });
  await dismissed;
  await expect(page).toHaveURL(origin);
  await expect(page.locator("h1")).toHaveText("Home");
  const readCloseState = (): Promise<Readonly<{ flowCode: string | undefined; restoration: ScrollRestoration; state: string }>> => page.evaluate(async () => {
    const modulePath: string = "/_fadeno/framework/internal/browser-navigation.js";
    const runtime = await import(modulePath) as Readonly<{
      readPrivateLinkNavigationFlows(): readonly Readonly<{ code: string }>[];
    }>;
    const enhancement = Reflect.get(globalThis, "__fadenoExampleEnhancement") as { state(): string };
    return {
      flowCode: runtime.readPrivateLinkNavigationFlows().at(-1)?.code,
      restoration: history.scrollRestoration,
      state: enhancement.state(),
    };
  });
  await expect.poll(async () => (await readCloseState()).flowCode).toBe("FADENO_UPDATE_NATIVE_CLOSE_CANCELLED");
  const closeState = await readCloseState();
  const enhancedNextBefore = requests.filter(({ path, enhanced }) => path === "/next" && enhanced).length;
  const nativeNextBefore = requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length;
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  expect({
    schema: "fadeno.example.history-close-cancelled-traversal-recovery",
    version: 1,
    repairedPath: "/",
    repairedHeading: "Home",
    flowCode: closeState.flowCode,
    restorationAfterRepair: closeState.restoration,
    runtimeClosed: closeState.state === "closed",
    nativeDeparture: requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length > nativeNextBefore,
    enhancedRequestSkipped: requests.filter(({ path, enhanced }) => path === "/next" && enhanced).length === enhancedNextBefore,
  }).toEqual(expected("history-close-cancelled-traversal-recovery"));
});

test("aborts an ordinary pending navigation before close completes", async ({ page }) => {
  await page.goto(origin);
  enhancedSlowDelay = 250;
  await page.locator("#slow-link").click({ noWaitAfter: true });
  await page.waitForTimeout(20);
  const closedState = await page.evaluate(() => {
    const enhancement = Reflect.get(globalThis, "__fadenoExampleEnhancement") as { close(): void; state(): string };
    enhancement.close();
    return enhancement.state();
  });
  await page.waitForTimeout(300);
  const pendingCommitSuppressed = new URL(page.url()).pathname === "/"
    && await page.locator("h1").textContent() === "Home";
  const enhancedNextBefore = requests.filter(({ path, enhanced }) => path === "/next" && enhanced).length;
  const nativeNextBefore = requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length;
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  expect({
    schema: "fadeno.example.history-close-pending-navigation",
    version: 1,
    closedState,
    pendingCommitSuppressed,
    nativeDeparture: requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length > nativeNextBefore,
    enhancedRequestSkippedAfterClose: requests.filter(({ path, enhanced }) => path === "/next" && enhanced).length === enhancedNextBefore,
  }).toEqual(expected("history-close-pending-navigation"));
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

test("revalidates ordinary link source history before commit", async ({ page }) => {
  await page.goto(origin);
  enhancedSlowDelay = 250;
  const nativeSlowBefore = requests.filter(({ path, enhanced }) => path === "/slow" && !enhanced).length;
  await page.locator("#slow-link").click({ noWaitAfter: true });
  await page.waitForTimeout(20);
  await page.evaluate(() => history.pushState({ ...history.state }, "", "/?application=1"));
  await expect(page.locator("h1")).toHaveText("Slow");
  expect({
    schema: "fadeno.example.history-source-state-recovery",
    version: 1,
    nativeRecovery: requests.filter(({ path, enhanced }) => path === "/slow" && !enhanced).length > nativeSlowBefore,
    staleCommitSuppressed: new URL(page.url()).pathname === "/slow"
      && await page.locator("h1").textContent() === "Slow",
  }).toEqual(expected("history-source-state-recovery"));
});

test("reloads cloned private-looking entries instead of granting ownership", async ({ page }) => {
  await page.goto(origin);
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  await page.locator("#home-link").click();
  await expect(page.locator("h1")).toHaveText("Home");
  const nativeHomeBefore = requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length;
  const nativeNextBefore = requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length;
  await page.evaluate(() => history.pushState({ ...history.state }, "", "/next"));
  await page.goBack();
  await expect(page.locator("h1")).toHaveText("Home");
  const duplicateIdentityRefused = requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length > nativeHomeBefore;
  await waitForPrivateHistoryOwner(page);
  await page.goForward();
  await expect(page.locator("h1")).toHaveText("Next");
  expect({
    schema: "fadeno.example.history-cloned-entry-recovery",
    version: 1,
    duplicateIdentityRefused,
    clonedDestinationRefused: requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length > nativeNextBefore,
    staleDocumentRemoved: new URL(page.url()).pathname === "/next" && await page.locator("h1").textContent() === "Next",
  }).toEqual(expected("history-cloned-entry-recovery"));
});

test("keeps same-URL copied history native before and after reload", async ({ page }) => {
  await page.goto(origin);
  await page.evaluate(() => history.pushState({ ...history.state }, "", location.href));
  const nativeNextBefore = requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length;
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  const directCopyRefused = requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length > nativeNextBefore;

  await page.evaluate(() => sessionStorage.removeItem("fadeno.private.navigation.unsafe-traversal.v1"));
  await page.goto(origin);
  await page.evaluate(() => history.pushState({ ...history.state }, "", location.href));
  expect(await page.evaluate(() => sessionStorage.getItem("fadeno.private.navigation.unsafe-traversal.v1")?.includes("application-owned"))).toBe(true);
  await page.reload();
  const historyUnclaimedAfterReload = await page.evaluate(() => history.scrollRestoration !== "manual");
  const historyUnclaimedAfterRestart = await page.evaluate(async () => {
    const enhancement = Reflect.get(globalThis, "__fadenoExampleEnhancement") as { close(): void };
    enhancement.close();
    const modulePath: string = "/_fadeno/framework/browser.js";
    const runtime = await import(modulePath) as Readonly<{
      startBrowserEnhancement(): { close(): void; state(): string };
    }>;
    Reflect.set(globalThis, "__fadenoExampleEnhancement", runtime.startBrowserEnhancement());
    return history.scrollRestoration !== "manual";
  });
  const nativeAfterReloadBefore = requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length;
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  expect({
    schema: "fadeno.example.history-same-url-copy-refusal",
    version: 1,
    directCopyRefused,
    historyUnclaimedAfterReload,
    historyUnclaimedAfterRestart,
    reloadedCopyRefused: requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length > nativeAfterReloadBefore,
  }).toEqual(expected("history-same-url-copy-refusal"));
});

test("rekeys copied state before accepting a later repeated reload", async ({ page }) => {
  await page.goto(origin);
  const copiedSession = await page.evaluate(() => {
    history.pushState({ ...history.state }, "", location.href);
    return String(history.state?.session);
  });
  await page.reload();
  const firstReloadRefused = await page.evaluate(() => history.scrollRestoration !== "manual");
  await page.reload();
  const secondReload = await page.evaluate((priorSession) => ({
    stateRekeyed: history.state?.session !== priorSession,
    restoration: history.scrollRestoration,
  }), copiedSession);
  const enhancedNextBefore = requests.filter(({ path, enhanced }) => path === "/next" && enhanced).length;
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  expect({
    schema: "fadeno.example.history-repeated-reload-rekey",
    version: 1,
    firstReloadRefused,
    ...secondReload,
    enhancementUsesRekeyedOwner: requests.filter(({ path, enhanced }) => path === "/next" && enhanced).length > enhancedNextBefore,
  }).toEqual(expected("history-repeated-reload-rekey"));
});

test("keeps bounded long-URL recovery persistence decodable", async ({ page }) => {
  await page.goto(origin);
  await page.evaluate((query) => history.pushState({ ...history.state }, "", `/?value=${query}`), "a".repeat(3_000));
  await page.reload();
  const result = await page.evaluate(() => {
    const raw = sessionStorage.getItem("fadeno.private.navigation.unsafe-traversal.v1");
    const record = raw ? JSON.parse(raw) as { overflowed?: unknown } : undefined;
    return {
      restoration: history.scrollRestoration,
      persistenceHealthy: record?.overflowed === false,
    };
  });
  expect({
    schema: "fadeno.example.history-long-url-recovery",
    version: 1,
    ...result,
  }).toEqual(expected("history-long-url-recovery"));
});

test("recovers a selected destination without duplicating it when document commit fails", async ({ page }) => {
  await page.goto(origin);
  const historyLengthBefore = await page.evaluate(() => history.length);
  const nativeNextBefore = requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length;
  await page.evaluate(() => {
    const originalFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function failFirstFocus(): void {
      HTMLElement.prototype.focus = originalFocus;
      throw new DOMException("focus commit refused", "InvalidStateError");
    };
  });
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  await waitForPrivateHistoryOwner(page);
  const historyEntriesAdded = await page.evaluate((before) => history.length - before, historyLengthBefore);
  await page.goBack();
  await expect(page.locator("h1")).toHaveText("Home");
  expect({
    schema: "fadeno.example.history-commit-failure-recovery",
    version: 1,
    nativeRecovery: requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length > nativeNextBefore,
    historyEntriesAdded,
    oneBackReachedPriorDocument: new URL(page.url()).pathname === "/" && await page.locator("h1").textContent() === "Home",
  }).toEqual(expected("history-commit-failure-recovery"));
});

test("preserves replacement recovery after focus mutates selected state", async ({ page }) => {
  await page.goto(origin);
  const historyLengthBefore = await page.evaluate(() => history.length);
  const nativeNextBefore = requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length;
  await page.evaluate(() => {
    document.addEventListener("focusin", () => {
      history.replaceState({ application: true }, "", location.href);
    }, { once: true });
  });
  const recoveredLoad = page.waitForEvent("load");
  await page.locator("#next-link").click();
  await recoveredLoad;
  await expect(page.locator("h1")).toHaveText("Next");
  const historyEntriesAdded = await page.evaluate((before) => history.length - before, historyLengthBefore);
  expect(historyEntriesAdded).toBe(1);
  await page.goBack({ waitUntil: "load" });
  await expect(page.locator("h1")).toHaveText("Home");
  expect({
    schema: "fadeno.example.history-focus-state-recovery",
    version: 1,
    nativeRecovery: requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length > nativeNextBefore,
    historyEntriesAdded,
    oneBackReachedPriorDocument: new URL(page.url()).pathname === "/" && await page.locator("h1").textContent() === "Home",
  }).toEqual(expected("history-focus-state-recovery"));
});

test("rolls back every selected push before native recovery", async ({ page }) => {
  await page.goto(origin);
  const historyLengthBefore = await page.evaluate(() => history.length);
  const nativeNextBefore = requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length;
  await page.evaluate(() => {
    const pushDuringDestinationFocus = (event: FocusEvent): void => {
      if (!(event.target instanceof Element) || !event.target.hasAttribute("data-fadeno-navigation-focus")) return;
      document.removeEventListener("focusin", pushDuringDestinationFocus);
      history.pushState({ ...history.state }, "", "/focus-extra");
    };
    document.addEventListener("focusin", pushDuringDestinationFocus);
  });
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  await waitForPrivateHistoryOwner(page);
  const historyEntriesAdded = await page.evaluate((before) => history.length - before, historyLengthBefore);
  await page.goBack();
  await expect(page.locator("h1")).toHaveText("Home");
  expect({
    schema: "fadeno.example.history-multiple-push-recovery",
    version: 1,
    nativeRecovery: requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length > nativeNextBefore,
    historyEntriesAdded,
    oneBackReachedPriorDocument: new URL(page.url()).pathname === "/" && await page.locator("h1").textContent() === "Home",
  }).toEqual(expected("history-multiple-push-recovery"));
});

test("repairs displayed truth when post-selection native recovery is cancelled", async ({ page }) => {
  await page.goto(origin);
  await page.locator("#next-link").focus();
  await page.evaluate(() => {
    const originalFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function failFirstFocus(): void {
      HTMLElement.prototype.focus = originalFocus;
      throw new DOMException("focus commit refused", "InvalidStateError");
    };
    addEventListener("beforeunload", (event) => {
      event.preventDefault();
      event.returnValue = "";
    }, { once: true });
  });
  const dismissed = new Promise<void>((resolve) => {
    page.once("dialog", (dialog) => { void dialog.dismiss().then(resolve); });
  });
  await page.keyboard.press("Enter");
  await dismissed;
  await expect(page).toHaveURL(origin);
  await expect(page.locator("h1")).toHaveText("Home");
  await waitForPrivateHistoryOwner(page);
  const readFlowCode = (): Promise<string | undefined> => page.evaluate(async () => {
    const modulePath: string = "/_fadeno/framework/internal/browser-navigation.js";
    const runtime = await import(modulePath) as Readonly<{
      readPrivateLinkNavigationFlows(): readonly Readonly<{ code: string }>[];
    }>;
    return runtime.readPrivateLinkNavigationFlows().at(-1)?.code;
  });
  await expect.poll(readFlowCode).toBe("FADENO_UPDATE_NATIVE_FALLBACK_CANCELLED");
  const repairedPath = new URL(page.url()).pathname;
  const repairedFlowCode = await readFlowCode();
  const focusRestored = await page.evaluate(() => document.activeElement?.id === "next-link");
  const enhancedNextBefore = requests.filter(({ path, enhanced }) => path === "/next" && enhanced).length;
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  expect({
    schema: "fadeno.example.history-cancelled-fallback-recovery",
    version: 1,
    repairedPath,
    flowCode: repairedFlowCode,
    focusRestored,
    enhancementResumed: requests.filter(({ path, enhanced }) => path === "/next" && enhanced).length > enhancedNextBefore,
    staleDocumentRemoved: await page.locator("h1").textContent() === "Next",
  }).toEqual(expected("history-cancelled-fallback-recovery"));
});

test("reacquires history ownership when preselection fallback is cancelled", async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = globalThis.fetch.bind(globalThis);
    let refused = false;
    globalThis.fetch = async (...arguments_: Parameters<typeof fetch>): Promise<Response> => {
      const request = new Request(arguments_[0], arguments_[1]);
      if (!refused && new URL(request.url).pathname === "/next") {
        refused = true;
        return new Response("refused", { status: 200, headers: { "content-type": "text/plain" } });
      }
      return originalFetch(...arguments_);
    };
  });
  await page.goto(origin);
  await page.evaluate(() => {
    addEventListener("beforeunload", (event) => {
      event.preventDefault();
      event.returnValue = "";
    }, { once: true });
  });
  const dismissed = new Promise<void>((resolve) => {
    page.once("dialog", (dialog) => { void dialog.dismiss().then(resolve); });
  });
  await page.locator("#next-link").click({ noWaitAfter: true });
  await dismissed;
  await expect(page).toHaveURL(origin);
  await waitForPrivateHistoryOwner(page);
  const readRecovery = (): Promise<Readonly<{ flowCode: string | undefined; restoration: ScrollRestoration }>> => page.evaluate(async () => {
    const modulePath: string = "/_fadeno/framework/internal/browser-navigation.js";
    const runtime = await import(modulePath) as Readonly<{
      readPrivateLinkNavigationFlows(): readonly Readonly<{ code: string }>[];
    }>;
    return {
      flowCode: runtime.readPrivateLinkNavigationFlows().at(-1)?.code,
      restoration: history.scrollRestoration,
    };
  });
  await expect.poll(async () => (await readRecovery()).flowCode).toBe("FADENO_UPDATE_NATIVE_FALLBACK_CANCELLED");
  const recovery = await readRecovery();
  const enhancedNextBefore = requests.filter(({ path, enhanced }) => path === "/next" && enhanced).length;
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  expect({
    schema: "fadeno.example.history-cancelled-preselection-recovery",
    version: 1,
    repairedPath: "/",
    flowCode: recovery.flowCode,
    restorationAfterRepair: recovery.restoration,
    enhancementResumed: requests.filter(({ path, enhanced }) => path === "/next" && enhanced).length > enhancedNextBefore,
    staleDocumentRemoved: await page.locator("h1").textContent() === "Next",
  }).toEqual(expected("history-cancelled-preselection-recovery"));
});

test("preserves replacement recovery when destination scroll and rollback both fail", async ({ page }) => {
  await page.goto(origin);
  const historyLengthBefore = await page.evaluate(() => history.length);
  const nativeNextBefore = requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length;
  await page.evaluate(() => {
    Object.defineProperty(globalThis, "scrollTo", {
      configurable: true,
      value: (): never => { throw new DOMException("scroll commit refused", "InvalidStateError"); },
    });
  });
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  await waitForPrivateHistoryOwner(page);
  const historyEntriesAdded = await page.evaluate((before) => history.length - before, historyLengthBefore);
  await page.goBack();
  await expect(page.locator("h1")).toHaveText("Home");
  expect({
    schema: "fadeno.example.history-scroll-rollback-recovery",
    version: 1,
    nativeRecovery: requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length > nativeNextBefore,
    historyEntriesAdded,
    oneBackReachedPriorDocument: new URL(page.url()).pathname === "/" && await page.locator("h1").textContent() === "Home",
  }).toEqual(expected("history-scroll-rollback-recovery"));
});

test("refuses a commit when destination scroll does not reach the recorded top", async ({ page }) => {
  await page.goto(`${origin}/next`);
  await page.evaluate(() => {
    const filler = document.createElement("div");
    filler.style.height = "3000px";
    document.body.append(filler);
    document.querySelector<HTMLElement>("#home-link")?.focus();
    scrollTo(0, 100);
    Object.defineProperty(globalThis, "scrollTo", {
      configurable: true,
      value: (): void => { /* deliberate no-op */ },
    });
  });
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
  const nativeHomeBefore = requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length;
  await page.keyboard.press("Enter");
  await expect(page.locator("h1")).toHaveText("Home");
  await waitForPrivateHistoryOwner(page);
  await page.goBack();
  await expect(page.locator("h1")).toHaveText("Next");
  expect({
    schema: "fadeno.example.history-scroll-postcondition-recovery",
    version: 1,
    nativeRecovery: requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length > nativeHomeBefore,
    falseTopCommitSuppressed: new URL(page.url()).pathname === "/next"
      && await page.locator("h1").textContent() === "Next",
  }).toEqual(expected("history-scroll-postcondition-recovery"));
});

test("repairs displayed document truth when a traversal reload is cancelled", async ({ page }) => {
  await page.goto(origin);
  await page.evaluate(() => scrollTo(0, 100));
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  await page.evaluate(() => {
    addEventListener("beforeunload", (event) => {
      event.preventDefault();
      event.returnValue = "";
    }, { once: true });
  });
  await page.locator("h1").click();
  const dismissed = new Promise<void>((resolve) => {
    page.once("dialog", (dialog) => { void dialog.dismiss().then(resolve); });
  });
  await page.evaluate(() => history.back());
  await dismissed;
  await expect(page).toHaveURL(`${origin}/next`);
  await expect(page.locator("h1")).toHaveText("Next");
  await waitForPrivateHistoryOwner(page);
  const readFlowCode = (): Promise<string | undefined> => page.evaluate(async () => {
    const modulePath: string = "/_fadeno/framework/internal/browser-navigation.js";
    const runtime = await import(modulePath) as Readonly<{
      readPrivateLinkNavigationFlows(): readonly Readonly<{ code: string }>[];
    }>;
    return runtime.readPrivateLinkNavigationFlows().at(-1)?.code;
  });
  await expect.poll(readFlowCode).toBe("FADENO_UPDATE_NATIVE_RECOVERY_CANCELLED");
  const repaired = {
    path: new URL(page.url()).pathname,
    heading: await page.locator("h1").textContent(),
    restoration: await page.evaluate(() => history.scrollRestoration),
    flowCode: await readFlowCode(),
  };
  const enhancedHomeBefore = requests.filter(({ path, enhanced }) => path === "/" && enhanced).length;
  await page.locator("#home-link").click();
  await expect(page.locator("h1")).toHaveText("Home");
  expect({
    schema: "fadeno.example.history-cancelled-reload-recovery",
    version: 1,
    repairedPath: repaired.path,
    repairedHeading: repaired.heading,
    restorationAfterRepair: repaired.restoration,
    flowCode: repaired.flowCode,
    enhancementResumed: requests.filter(({ path, enhanced }) => path === "/" && enhanced).length > enhancedHomeBefore,
  }).toEqual(expected("history-cancelled-reload-recovery"));
});

test("repairs a returnValue-only cancelled traversal reload", async ({ page }) => {
  await page.goto(origin);
  await page.evaluate(() => scrollTo(0, 100));
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  await page.evaluate(() => {
    addEventListener("beforeunload", (event) => {
      Reflect.set(event, "returnValue", "stay");
    }, { once: true });
  });
  await page.locator("h1").click();
  const dismissed = new Promise<void>((resolve) => {
    page.once("dialog", (dialog) => { void dialog.dismiss().then(resolve); });
  });
  await page.evaluate(() => history.back());
  await dismissed;
  await expect(page).toHaveURL(`${origin}/next`);
  await expect(page.locator("h1")).toHaveText("Next");
  await waitForPrivateHistoryOwner(page);
  const readFlowCode = (): Promise<string | undefined> => page.evaluate(async () => {
    const modulePath: string = "/_fadeno/framework/internal/browser-navigation.js";
    const runtime = await import(modulePath) as Readonly<{
      readPrivateLinkNavigationFlows(): readonly Readonly<{ code: string }>[];
    }>;
    return runtime.readPrivateLinkNavigationFlows().at(-1)?.code;
  });
  await expect.poll(readFlowCode).toBe("FADENO_UPDATE_NATIVE_RECOVERY_CANCELLED");
  expect({
    schema: "fadeno.example.history-return-value-reload-recovery",
    version: 1,
    repairedPath: new URL(page.url()).pathname,
    repairedHeading: await page.locator("h1").textContent(),
    restorationAfterRepair: await page.evaluate(() => history.scrollRestoration),
    flowCode: await readFlowCode(),
  }).toEqual(expected("history-return-value-reload-recovery"));
});

test("cancels a pending traversal before a newer click remains native", async ({ page }) => {
  await page.goto(origin);
  await page.locator("#slow-link").click();
  await expect(page.locator("h1")).toHaveText("Slow");
  await page.locator("#home-link").click();
  await expect(page.locator("h1")).toHaveText("Home");
  enhancedSlowDelay = 250;
  await page.evaluate(() => {
    const originalAbort = AbortController.prototype.abort;
    sessionStorage.setItem("fadeno-test-native-click-aborts", "0");
    AbortController.prototype.abort = function recordAbort(reason?: unknown): void {
      sessionStorage.setItem(
        "fadeno-test-native-click-aborts",
        String(Number(sessionStorage.getItem("fadeno-test-native-click-aborts")) + 1),
      );
      originalAbort.call(this, reason);
    };
    history.back();
  });
  await page.waitForTimeout(20);
  const nativeNextBefore = requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length;
  await page.locator("#next-link").click();
  await expect(page.locator("h1")).toHaveText("Next");
  await page.waitForTimeout(300);
  expect({
    schema: "fadeno.example.history-click-supersession-recovery",
    version: 1,
    pendingTraversalAborted: await page.evaluate(() => Number(sessionStorage.getItem("fadeno-test-native-click-aborts")) > 0),
    nativeClickWon: requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length > nativeNextBefore,
    obsoleteDocumentSuppressed: new URL(page.url()).pathname === "/next" && await page.locator("h1").textContent() === "Next",
  }).toEqual(expected("history-click-supersession-recovery"));
});

test("cancels a pending traversal before a refused fragment remains native", async ({ page }) => {
  await page.goto(origin);
  await page.locator("#slow-link").click();
  await expect(page.locator("h1")).toHaveText("Slow");
  await page.locator("#home-link").click();
  await expect(page.locator("h1")).toHaveText("Home");
  enhancedSlowDelay = 250;
  await page.evaluate(() => {
    const originalAbort = AbortController.prototype.abort;
    sessionStorage.setItem("fadeno-test-native-fragment-aborts", "0");
    AbortController.prototype.abort = function recordAbort(reason?: unknown): void {
      sessionStorage.setItem("fadeno-test-native-fragment-aborts", "1");
      originalAbort.call(this, reason);
    };
    history.back();
  });
  await page.waitForTimeout(20);
  await page.locator("#fragment-link").click();
  await page.waitForTimeout(300);
  expect({
    schema: "fadeno.example.history-fragment-supersession-recovery",
    version: 1,
    pendingTraversalAborted: await page.evaluate(() => sessionStorage.getItem("fadeno-test-native-fragment-aborts") === "1"),
    nativeFragmentWon: new URL(page.url()).pathname === "/" && new URL(page.url()).hash === "#details",
    displayedTruthRepaired: await page.locator("h1").textContent() === "Home",
    obsoleteDocumentSuppressed: await page.getByRole("heading", { name: "Slow" }).count() === 0,
  }).toEqual(expected("history-fragment-supersession-recovery"));
});

test("cancels a pending traversal before a native form submission", async ({ page }) => {
  await page.goto(origin);
  await page.locator("#slow-link").click();
  await expect(page.locator("h1")).toHaveText("Slow");
  await page.locator("#home-link").click();
  await expect(page.locator("h1")).toHaveText("Home");
  enhancedSlowDelay = 250;
  await page.evaluate(() => {
    const originalAbort = AbortController.prototype.abort;
    sessionStorage.setItem("fadeno-test-native-form-aborts", "0");
    AbortController.prototype.abort = function recordAbort(reason?: unknown): void {
      sessionStorage.setItem("fadeno-test-native-form-aborts", "1");
      originalAbort.call(this, reason);
    };
    history.back();
  });
  await page.waitForTimeout(20);
  const nativeNextBefore = requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length;
  await page.locator("#native-form button").click();
  await expect(page.locator("h1")).toHaveText("Next");
  await page.waitForTimeout(300);
  expect({
    schema: "fadeno.example.history-form-supersession-recovery",
    version: 1,
    pendingTraversalAborted: await page.evaluate(() => sessionStorage.getItem("fadeno-test-native-form-aborts") === "1"),
    nativeFormWon: requests.filter(({ path, enhanced }) => path === "/next" && !enhanced).length > nativeNextBefore,
    obsoleteDocumentSuppressed: new URL(page.url()).pathname === "/next" && await page.locator("h1").textContent() === "Next",
  }).toEqual(expected("history-form-supersession-recovery"));
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

test("cancels an older traversal before a newer native recovery", async ({ page }) => {
  await page.goto(origin);
  await page.locator("#slow-link").click();
  await expect(page.locator("h1")).toHaveText("Slow");
  await page.locator("#home-link").click();
  await expect(page.locator("h1")).toHaveText("Home");
  enhancedSlowDelay = 250;
  const nativeHomeBefore = requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length;
  await page.evaluate(() => {
    const originalAbort = AbortController.prototype.abort;
    sessionStorage.setItem("fadeno-test-native-supersession-aborts", "0");
    AbortController.prototype.abort = function recordAbort(reason?: unknown): void {
      sessionStorage.setItem(
        "fadeno-test-native-supersession-aborts",
        String(Number(sessionStorage.getItem("fadeno-test-native-supersession-aborts")) + 1),
      );
      originalAbort.call(this, reason);
    };
    history.back();
    setTimeout(() => {
      const input = document.createElement("input");
      input.defaultValue = "before";
      input.value = "after";
      document.body.append(input);
      history.forward();
    }, 20);
  });
  await expect(page.locator("h1")).toHaveText("Home");
  await expect.poll(() => requests.filter(({ path, enhanced }) => path === "/" && !enhanced).length)
    .toBeGreaterThan(nativeHomeBefore);
  expect({
    schema: "fadeno.example.history-native-supersession-recovery",
    version: 1,
    olderTraversalCancelled: await page.evaluate(() => Number(sessionStorage.getItem("fadeno-test-native-supersession-aborts")) > 0),
    nativeRecovery: true,
    staleDocumentRemoved: new URL(page.url()).pathname === "/" && await page.locator("h1").textContent() === "Home",
  }).toEqual(expected("history-native-supersession-recovery"));
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
