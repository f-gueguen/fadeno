import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, firefox, webkit, type BrowserType, type Page } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const example = join(root, "examples/v1-app");
const browsers = { chromium, firefox, webkit } satisfies Readonly<Record<string, BrowserType>>;

function signalChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

async function terminateChild(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) return child.exitCode;
  return new Promise<number | null>((resolve) => {
    const force = setTimeout(() => signalChild(child, "SIGKILL"), 5_000);
    child.once("exit", (code) => {
      clearTimeout(force);
      resolve(code);
    });
    signalChild(child, "SIGTERM");
  });
}

function expectedJson(name: string, value: unknown): void {
  assert.equal(
    readFileSync(join(example, "scenarios/evaluator-demo/expected", name), "utf8"),
    `${JSON.stringify(value, null, 2)}\n`,
    `${name} drifted from executed evidence`,
  );
}

function expectedText(name: string, value: string): void {
  assert.equal(
    readFileSync(join(example, "scenarios/evaluator-demo/expected", name), "utf8"),
    value,
    `${name} drifted from executed evidence`,
  );
}

async function startDemo(): Promise<Readonly<{
  origin: string;
  output(): string;
  stop(): Promise<void>;
}>> {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "fadeno-demo-check-"));
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    rmSync(temporaryRoot, { recursive: true, force: true });
  };
  const child = spawn(process.execPath, [
    "--no-warnings",
    "--experimental-strip-types",
    join(root, "scripts/run-v1-demo-https.ts"),
    "--port",
    "0",
  ], {
    cwd: root,
    detached: true,
    env: { ...process.env, FADENO_DEMO_TEMPORARY_ROOT: temporaryRoot },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  try {
    const origin = await new Promise<string>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        void terminateChild(child).then(
          () => reject(new Error(`FADENO_V2_DEMO_START_TIMEOUT\n${stdout}\n${stderr}`)),
          reject,
        );
      }, 60_000);
      const inspect = (): void => {
        const match = /Fadeno secure demo ready at (https:\/\/127\.0\.0\.1:[0-9]+)\./u.exec(stdout);
        if (settled || !match?.[1] || !stdout.includes("certificate is self-signed")) return;
        settled = true;
        clearTimeout(timeout);
        resolve(match[1]);
      };
      child.stdout.on("data", inspect);
      child.once("exit", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`FADENO_V2_DEMO_START_EXIT:${code}\n${stdout}\n${stderr}`));
      });
    });
    return Object.freeze({
      origin,
      output: () => `${stdout}${stderr}`,
      stop: async () => {
        try {
          const code = await terminateChild(child);
          if (code !== 0) throw new Error(`FADENO_V2_DEMO_STOP:${code}\n${stdout}\n${stderr}`);
        } finally {
          cleanup();
        }
      },
    });
  } catch (error) {
    cleanup();
    throw error;
  }
}

async function waitForEnhancement(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const enhancement = Reflect.get(globalThis, "__fadenoDemoEnhancement") as
      | Readonly<{ state(): string }>
      | undefined;
    return enhancement?.state() === "active";
  });
}

async function documentIdentity(page: Page): Promise<string> {
  return page.evaluate(() => {
    const identity = Reflect.get(globalThis, "__fadenoDemoDocumentIdentity");
    if (typeof identity !== "string") throw new Error("FADENO_V2_DEMO_DOCUMENT_IDENTITY");
    return identity;
  });
}

async function verifyEnhancedWorkflow(
  name: string,
  browserType: BrowserType,
  origin: string,
): Promise<Readonly<{ refusalHuman: string }>> {
  const browser = await browserType.launch({ headless: true });
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, colorScheme: "light" });
    const page = await context.newPage();
    const home = await page.goto(origin);
    assert.equal(home?.status(), 200, `${name}: home status`);
    await waitForEnhancement(page);
    assert.equal(await page.locator("#demo-enhancement-status").textContent(), "Active for eligible links and forms.", `${name}: public enhancement state`);
    assert.equal(await page.locator("nav[aria-label='Guided demonstration'] a").count(), 5, `${name}: guided steps`);
    assert.equal(await page.locator("details.developer-panel").count(), 1, `${name}: source panel`);
    const routeAudit = await browser.newContext({ ignoreHTTPSErrors: true });
    const catalog = await routeAudit.request.get(`${origin}/shop/catalog`);
    assert.equal(catalog.status(), 200, `${name}: generated catalog route`);
    assert.match(await catalog.text(), /<h1>Shop catalog<\/h1>/u, `${name}: generated catalog page`);
    const missingShop = await routeAudit.request.get(`${origin}/shop/missing`);
    assert.equal(missingShop.status(), 404, `${name}: generated scoped fallback`);
    assert.match(await missingShop.text(), /<h1>Shop page not found<\/h1>/u, `${name}: generated shop not found`);
    const raw = await routeAudit.request.get(`${origin}/raw`);
    assert.equal(raw.status(), 200, `${name}: generated raw route`);
    assert.equal(await raw.text(), "raw:/raw", `${name}: generated raw handler`);
    const directGuarded = await routeAudit.request.get(`${origin}/routing?outcome=dirty-control`);
    const directGuardedBody = await directGuarded.text();
    assert.equal(directGuarded.status(), 200, `${name}: direct guarded destination`);
    assert.match(directGuardedBody, /Guarded destination reached\./u, `${name}: direct guarded wording`);
    assert.doesNotMatch(directGuardedBody, /Native navigation completed/u, `${name}: direct load makes no browser claim`);
    await routeAudit.close();
    const homeIdentity = await documentIdentity(page);

    await page.getByRole("link", { name: "Resources", exact: true }).click();
    await page.getByRole("heading", { name: "Two reads. One request-owned result." }).waitFor();
    await waitForEnhancement(page);
    assert.equal(await documentIdentity(page), homeIdentity, `${name}: eligible link stayed enhanced`);
    await page.locator("details.developer-panel summary").click();
    assert.equal(await page.getByText("src/routes/resources/page.tsx", { exact: true }).count(), 2, `${name}: source path`);
    assert.match(await page.locator("details.developer-panel pre").textContent() ?? "", /read\(projectSummary/u, `${name}: source excerpt`);
    await page.locator("details.developer-panel summary").click();

    await page.getByRole("link", { name: "Routing", exact: true }).click();
    const cleanRoutingIdentity = await documentIdentity(page);
    await page.getByRole("link", { name: "Try the guarded navigation" }).click();
    await page.getByRole("heading", { name: "Guarded destination reached." }).waitFor();
    assert.equal(await documentIdentity(page), cleanRoutingIdentity, `${name}: clean guarded route stayed enhanced`);
    assert.equal(await page.getByText("Native navigation completed", { exact: false }).count(), 0, `${name}: enhanced route makes no native claim`);
    await page.getByRole("link", { name: "Routing", exact: true }).click();
    await page.waitForURL(`${origin}/routing`);
    await page.getByRole("heading", { name: "URLs select typed server outcomes." }).waitFor();
    assert.equal(await documentIdentity(page), cleanRoutingIdentity, `${name}: clean route reset stayed enhanced`);
    const routingIdentity = await documentIdentity(page);
    await page.locator("#refusal-draft").fill("browser-owned draft");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.getByRole("link", { name: "Try the guarded navigation" }).click(),
    ]);
    await waitForEnhancement(page);
    assert.notEqual(await documentIdentity(page), routingIdentity, `${name}: dirty-control refusal stayed native`);
    assert.equal(await page.getByRole("heading", { name: "Guarded destination reached." }).count(), 1, `${name}: guarded destination`);
    assert.equal(await page.getByText("Native navigation completed", { exact: false }).count(), 0, `${name}: destination makes no inferred refusal claim`);
    const refusalHuman = [
      await page.locator("#refusal-heading").textContent(),
      await page.locator("#refusal-outcome-detail").textContent(),
      await page.locator("#refusal-correction").textContent(),
      "",
    ].join("\n");

    const recoveredIdentity = await documentIdentity(page);
    await page.locator("#refusal-draft").fill("");
    await page.getByRole("link", { name: "Overview", exact: true }).click();
    await page.getByRole("heading", { name: "Follow the request thread." }).waitFor();
    assert.equal(await documentIdentity(page), recoveredIdentity, `${name}: refusal correction restored enhancement`);

    await page.getByRole("link", { name: "Projects", exact: true }).click();
    await page.locator("#owner-passcode").fill("incorrect");
    const actionIdentity = await documentIdentity(page);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByText("Sign-in was refused.", { exact: true }).waitFor();
    assert.equal(await documentIdentity(page), actionIdentity, `${name}: validation result applied atomically`);
    await page.locator("#owner-passcode").fill("example-owner");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.locator("#authenticated-viewer").waitFor();
    await waitForEnhancement(page);
    const signedInIdentity = await documentIdentity(page);
    assert.notEqual(signedInIdentity, actionIdentity, `${name}: sign-in redirect selected one fresh server document`);

    await page.locator("#new-project-title").fill("   ");
    await page.getByRole("button", { name: "Create project" }).click();
    await page.getByText("The project was not created.", { exact: true }).waitFor();
    assert.equal(await documentIdentity(page), signedInIdentity, `${name}: field correction applied atomically`);
    await page.locator("#new-project-title").fill(`Thread ${name}`);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.getByRole("heading", { name: `Thread ${name}` }).waitFor();
    await waitForEnhancement(page);
    assert.notEqual(await documentIdentity(page), signedInIdentity, `${name}: corrected action revalidated into one fresh server document`);

    const recoveryUrl = `${origin}/resource-recovery?run=${name}`;
    const failure = await page.goto(recoveryUrl);
    assert.equal(failure?.status(), 503, `${name}: deliberate recovery failure`);
    assert.equal(await page.getByText("PROJECT_TEMPORARILY_UNAVAILABLE (503)", { exact: true }).count(), 1, `${name}: typed failure visible`);
    const recovery = await page.reload();
    assert.equal(recovery?.status(), 200, `${name}: recovery status`);
    assert.equal(await page.getByRole("heading", { name: "Resource recovered" }).count(), 1, `${name}: recovery heading`);
    assert.equal(await page.getByText("PROJECT_TEMPORARILY_UNAVAILABLE (503)", { exact: true }).count(), 0, `${name}: stale failure removed`);

    const keyboard = await page.goto(origin);
    assert.equal(keyboard?.status(), 200, `${name}: keyboard start`);
    await waitForEnhancement(page);
    await page.getByRole("link", { name: "Routing", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { name: "URLs select typed server outcomes." }).waitFor();
    assert.equal(await page.locator("h1").evaluate((element) => element === document.activeElement), true, `${name}: enhanced destination focus`);

    const mobile = await browser.newContext({
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true,
      viewport: { width: 390, height: 844 },
    });
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(origin);
    await waitForEnhancement(mobilePage);
    assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, `${name}: mobile width`);
    assert.equal(await mobilePage.locator(".mode-ribbon").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length), 1, `${name}: mobile mode stack`);
    assert.equal(await mobilePage.locator("details.developer-panel").evaluate((element) => getComputedStyle(element).position), "static", `${name}: mobile source panel`);
    await mobile.close();
    await context.close();

    const nativeContext = await browser.newContext({
      ignoreHTTPSErrors: true,
      javaScriptEnabled: false,
      colorScheme: "light",
    });
    const nativePage = await nativeContext.newPage();
    const nativeHome = await nativePage.goto(origin);
    assert.equal(nativeHome?.status(), 200, `${name}: no-JavaScript home`);
    assert.equal(await nativePage.evaluate(() => Reflect.get(globalThis, "__fadenoDemoEnhancement")), undefined, `${name}: no runtime without JavaScript`);
    assert.equal(await nativePage.locator("#demo-enhancement-status").textContent(), "Native mode remains active until the optional runtime starts.", `${name}: native label`);
    await Promise.all([
      nativePage.waitForNavigation({ waitUntil: "domcontentloaded" }),
      nativePage.getByRole("link", { name: "Projects", exact: true }).click(),
    ]);
    await nativePage.locator("#owner-passcode").fill("example-owner");
    await Promise.all([
      nativePage.waitForNavigation({ waitUntil: "domcontentloaded" }),
      nativePage.getByRole("button", { name: "Sign in" }).click(),
    ]);
    assert.equal(await nativePage.locator("#authenticated-viewer").count(), 1, `${name}: native protected form`);
    await nativePage.locator("#new-project-title").fill("   ");
    await Promise.all([
      nativePage.waitForNavigation({ waitUntil: "domcontentloaded" }),
      nativePage.getByRole("button", { name: "Create project" }).click(),
    ]);
    assert.equal(await nativePage.getByText("The project was not created.", { exact: true }).count(), 1, `${name}: native validation`);
    const nativeTitle = `Native ${name}`;
    await nativePage.locator("#new-project-title").fill(nativeTitle);
    await Promise.all([
      nativePage.waitForNavigation({ waitUntil: "domcontentloaded" }),
      nativePage.getByRole("button", { name: "Create project" }).click(),
    ]);
    assert.equal(await nativePage.getByRole("heading", { name: nativeTitle, exact: true }).count(), 1, `${name}: native create`);
    const updatedTitle = `${nativeTitle} updated`;
    const createdCard = nativePage.locator(".project-card").filter({
      has: nativePage.getByRole("heading", { name: nativeTitle, exact: true }),
    });
    await createdCard.getByLabel("New title").fill(updatedTitle);
    await Promise.all([
      nativePage.waitForNavigation({ waitUntil: "domcontentloaded" }),
      createdCard.getByRole("button", { name: "Update project" }).click(),
    ]);
    assert.equal(await nativePage.getByRole("heading", { name: updatedTitle, exact: true }).count(), 1, `${name}: native update`);
    const updatedCard = nativePage.locator(".project-card").filter({
      has: nativePage.getByRole("heading", { name: updatedTitle, exact: true }),
    });
    await updatedCard.getByLabel("Confirm deletion").check();
    await Promise.all([
      nativePage.waitForNavigation({ waitUntil: "domcontentloaded" }),
      updatedCard.getByRole("button", { name: "Delete project" }).click(),
    ]);
    assert.equal(await nativePage.getByRole("heading", { name: updatedTitle, exact: true }).count(), 0, `${name}: native delete`);
    await nativeContext.close();
    return Object.freeze({ refusalHuman });
  } finally {
    await browser.close();
  }
}

execFileSync("pnpm", ["check:source-excerpts"], { cwd: example, stdio: "inherit" });
assert.equal(existsSync(join(example, "scenarios/evaluator-demo/application.tsx")), false);
const routerPreparationSource = readFileSync(join(example, "scripts/prepare-evaluator-router.ts"), "utf8");
const sourceGenerator = readFileSync(join(example, "scripts/generate-source-excerpts.ts"), "utf8");
const browserSource = readFileSync(join(example, "scenarios/evaluator-demo/browser-entry.ts"), "utf8");
assert.match(routerPreparationSource, /\.fadeno\/routes\/app\.ts/u);
assert.match(routerPreparationSource, /generation\.sourceSha256/u);
assert.match(routerPreparationSource, /browserModule/u);
assert.doesNotMatch(routerPreparationSource, /src\/routes\/(page|projects|resources)/u);
assert.match(sourceGenerator, /fadeno-demo-source:start/u);
assert.doesNotMatch(sourceGenerator, /read\(projectSummary/u);
assert.match(browserSource, /from "@fadeno\/framework\/browser"/u);
assert.doesNotMatch(browserSource, /fadeno\.private|\/internal\//u);

expectedJson("experience.json", {
  schemaVersion: 1,
  scenario: "canonical-evaluator-walkthrough",
  browserEngines: Object.keys(browsers),
  steps: ["observe-request", "change-route", "share-read", "run-action", "recover-truth"],
  modes: {
    native: "complete-links-and-forms",
    enhanced: "eligible-links-and-protected-actions",
    refused: "unsafe-state-returns-to-native",
  },
  developerPanel: "application-source-and-public-behavior-only",
  preV208Limit: "no-general-structural-reconciliation",
});
expectedJson("flow.json", {
  schemaVersion: 1,
  scenario: "canonical-evaluator-flow",
  decisions: ["match-route", "share-request-resource", "validate-action", "revalidate", "enhance-eligible", "refuse-unsafe"],
  causes: ["request-url", "resource-input", "protected-form", "browser-owned-dirty-control"],
  ownership: {
    route: "canonical-application",
    resource: "request",
    actionAndSession: "server",
    eligibility: "public-browser-runtime",
  },
  skippedWork: ["client-router", "optimistic-mutation", "unsafe-reconciliation", "private-record-publication"],
  redirectedActionOutcome: "fresh-server-document",
  observableOutcome: "complete-current-server-document",
});
expectedJson("refusal.json", {
  schemaVersion: 1,
  scenario: "dirty-control-native-refusal",
  before: "eligible-enhanced-document",
  cause: "browser-owned-draft",
  decision: "refuse-before-interception",
  outcome: "native-current-document",
  correction: "clear-draft-before-next-navigation",
});
expectedJson("correction-before.json", {
  schemaVersion: 1,
  scenario: "project-title-validation",
  submittedTitle: "<redacted-invalid-value>",
  result: "PROJECT_TITLE_REQUIRED",
});
expectedJson("correction-after.json", {
  schemaVersion: 1,
  scenario: "project-title-validation",
  submittedTitle: "<redacted-corrected-value>",
  result: "created-and-revalidated",
});
expectedJson("recovery.json", {
  schemaVersion: 1,
  scenario: "typed-resource-recovery",
  firstStatus: 503,
  nextStatus: 200,
  staleDiagnosticRemoved: true,
  staleResourceResultRemoved: true,
  currentDocumentPublished: true,
});
expectedText("setup.txt", [
  "command: pnpm demo",
  "input: clean canonical application plus current packed framework",
  "result: one local HTTPS evaluator workflow",
  "modes: native baseline; eligible enhancement; conservative refusal",
  "stop: Ctrl-C closes all owned listeners and temporary files",
  "",
].join("\n"));

const demo = await startDemo();
try {
  assert.match(demo.output(), /Fadeno production build completed/u);
  assert.match(demo.output(), /Fadeno evaluator router derived from canonical generation [a-f0-9]{64}/u);
  assert.match(demo.output(), /certificate is self-signed/u);
  let refusalHuman: string | undefined;
  for (const [name, browserType] of Object.entries(browsers)) {
    const evidence = await verifyEnhancedWorkflow(name, browserType, demo.origin);
    if (refusalHuman === undefined) refusalHuman = evidence.refusalHuman;
    else assert.equal(evidence.refusalHuman, refusalHuman, `${name}: refusal evidence matches every engine`);
  }
  if (refusalHuman === undefined) throw new Error("FADENO_V2_DEMO_REFUSAL_EVIDENCE");
  expectedText("failure-human.txt", refusalHuman);
} finally {
  await demo.stop();
}

console.log("V2 demo experience passed (clean packed HTTPS setup, guided native/enhanced/refused workflow, source, correction, recovery, three engines)");
