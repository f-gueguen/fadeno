import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

import { applyPrivateMorphCandidate } from "../candidate.ts";
import type { PrivateMorphPatch } from "../candidate.ts";
import { getMorphFixture } from "../fixtures/catalog.ts";
import { attachJson } from "./evidence.ts";

const selectedFixture = getMorphFixture(
  process.env.FADENO_MORPH_FIXTURE ?? "intentional-replacement",
);
if (selectedFixture.kind !== "candidate-control") {
  throw new Error(`FADENO_MORPH_CANDIDATE_SPEC_MISMATCH: ${selectedFixture.id}`);
}
const fixture = selectedFixture;

declare global {
  interface Window {
    __fadenoOriginalTarget: HTMLInputElement;
    __fadenoOriginalReplacement: HTMLOutputElement;
  }
}

const CANDIDATE_CURRENT_HTML =
  '<!doctype html><meta charset="utf-8"><main id="root" class="before"><input id="target" aria-label="Control before" value="server-before"><output id="status">before</output></main>';
const CANDIDATE_PATCH: PrivateMorphPatch = {
  rootIdentity: "root",
  replacementHtml:
    '<main id="root" class="after"><input id="target" aria-label="Control after" value="server-after"><output id="status">after</output></main>',
  replacementIdentities: ["status"],
};

async function prepareCandidatePage(page: Page, html = CANDIDATE_CURRENT_HTML): Promise<void> {
  await page.setContent(html);
  const target = page.locator("#target").first();
  await target.fill("dirty-client-value");
  await target.focus();
  await target.evaluate((element) =>
    (element as HTMLInputElement).setSelectionRange(2, 8),
  );
  await page.evaluate(() => {
    const target = document.querySelector<HTMLInputElement>("#target");
    const replacement = document.querySelector<HTMLOutputElement>("#status");
    if (!target || !replacement) throw new Error("FADENO_MORPH_CANDIDATE_SETUP_MISSING");
    window.__fadenoOriginalTarget = target;
    window.__fadenoOriginalReplacement = replacement;
  });
}

async function captureCandidateState(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("#root");
    const target = document.querySelector<HTMLInputElement>("#target");
    const replacement = document.querySelector<HTMLOutputElement>("#status");
    if (!root || !target || !replacement) {
      throw new Error("FADENO_MORPH_CANDIDATE_STATE_MISSING");
    }
    return {
      rootClass: root.className,
      target: {
        nodeIdentity: target === window.__fadenoOriginalTarget ? "original" : "replacement",
        state: {
          value: target.value,
          focused: document.activeElement === target,
          selectionStart: target.selectionStart,
          selectionEnd: target.selectionEnd,
        },
        server: {
          valueAttribute: target.getAttribute("value"),
          ariaLabel: target.getAttribute("aria-label"),
        },
      },
      replacement: {
        nodeIdentity:
          replacement === window.__fadenoOriginalReplacement ? "original" : "replacement",
        originalConnected: window.__fadenoOriginalReplacement.isConnected,
        text: replacement.textContent,
      },
    };
  });
}

async function assertCandidateRefusal(
  page: Page,
  patch: PrivateMorphPatch,
  reason: string,
  currentHtml = CANDIDATE_CURRENT_HTML,
): Promise<void> {
  await prepareCandidatePage(page, currentHtml);
  const beforeMarkup = await page.locator("#root").first().evaluate((element) => element.outerHTML);
  const beforeState = await captureCandidateState(page);
  const message = await page.evaluate(applyPrivateMorphCandidate, patch).then(
    () => "",
    (error: unknown) => error instanceof Error ? error.message : String(error),
  );
  expect(message, `FADENO_MORPH_CANDIDATE_REFUSAL_${reason}`).toContain(
    `FADENO_MORPH_CANDIDATE_REFUSED: ${reason}`,
  );
  expect(await page.locator("#root").first().evaluate((element) => element.outerHTML)).toBe(
    beforeMarkup,
  );
  expect(await captureCandidateState(page)).toEqual(beforeState);
}

async function runCandidateControl(
  page: Page,
  testInfo: TestInfo,
  engine: string,
  blockedRequests: readonly string[],
  pageErrors: readonly string[],
): Promise<void> {
  await assertCandidateRefusal(
    page,
    {
      ...CANDIDATE_PATCH,
      rootIdentity: "missing",
      replacementHtml: CANDIDATE_PATCH.replacementHtml.replaceAll(
        'id="root"',
        'id="missing"',
      ),
    },
    "current root identity is missing or ambiguous",
  );
  await assertCandidateRefusal(
    page,
    CANDIDATE_PATCH,
    "current root identity is missing or ambiguous",
    `${CANDIDATE_CURRENT_HTML}<main id="root"><input id="other"><output id="other-status"></output></main>`,
  );
  await assertCandidateRefusal(
    page,
    CANDIDATE_PATCH,
    "current document identity is missing or ambiguous: target",
    `${CANDIDATE_CURRENT_HTML}<aside id="outside"><input id="target"></aside>`,
  );
  await assertCandidateRefusal(
    page,
    CANDIDATE_PATCH,
    "current element identity is missing",
    CANDIDATE_CURRENT_HTML.replace("</main>", "<span>unidentified</span></main>"),
  );
  await assertCandidateRefusal(
    page,
    CANDIDATE_PATCH,
    "current identity is duplicated: status",
    CANDIDATE_CURRENT_HTML.replace("</main>", '<output id="status">duplicate</output></main>'),
  );
  await assertCandidateRefusal(
    page,
    {
      ...CANDIDATE_PATCH,
      replacementHtml: CANDIDATE_PATCH.replacementHtml.replace(
        "</main>",
        '<output id="status">duplicate</output></main>',
      ),
    },
    "incoming identity is duplicated: status",
  );
  await assertCandidateRefusal(
    page,
    {
      ...CANDIDATE_PATCH,
      replacementHtml: CANDIDATE_PATCH.replacementHtml.replace(
        '<output id="status">after</output>',
        "",
      ),
    },
    "current and incoming identity order differs",
  );
  await assertCandidateRefusal(
    page,
    {
      ...CANDIDATE_PATCH,
      replacementHtml:
        '<main id="root" class="after"><section id="target"><input id="nested"></section><output id="status">after</output></main>',
    },
    "incoming root has unsupported nested elements",
  );
  await assertCandidateRefusal(
    page,
    {
      ...CANDIDATE_PATCH,
      replacementHtml:
        '<main id="root" class="after"><textarea id="target" aria-label="Control after">server-after</textarea><output id="status">after</output></main>',
    },
    "element kind differs: target",
  );
  await assertCandidateRefusal(
    page,
    { ...CANDIDATE_PATCH, replacementIdentities: [] },
    "reused element content differs: status",
  );
  await assertCandidateRefusal(
    page,
    {
      ...CANDIDATE_PATCH,
      replacementHtml: CANDIDATE_PATCH.replacementHtml.replace(
        'aria-label="Control after"',
        'aria-label="Control after" onclick="void 0"',
      ),
    },
    "incoming attribute is unsupported: onclick",
  );
  await assertCandidateRefusal(
    page,
    { ...CANDIDATE_PATCH, replacementIdentities: ["status", "missing"] },
    "declared replacement is not observed: missing",
  );
  await assertCandidateRefusal(
    page,
    { ...CANDIDATE_PATCH, replacementIdentities: ["status", "status"] },
    "replacement identity is duplicated",
  );

  await prepareCandidatePage(page);
  const before = await captureCandidateState(page);
  const candidateResult = await page.evaluate(applyPrivateMorphCandidate, CANDIDATE_PATCH);
  const independentProof = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("#root");
    const target = document.querySelector<HTMLInputElement>("#target");
    const replacement = document.querySelector<HTMLOutputElement>("#status");
    if (!root || !target || !replacement) {
      throw new Error("FADENO_MORPH_CANDIDATE_PROOF_MISSING");
    }
    return {
      preservedTargetIdentity: target === window.__fadenoOriginalTarget,
      replacedTargetIdentity: replacement !== window.__fadenoOriginalReplacement,
      originalReplacementDisconnected: !window.__fadenoOriginalReplacement.isConnected,
      dirtyStatePreserved:
        target.value === "dirty-client-value" &&
        document.activeElement === target &&
        target.selectionStart === 2 &&
        target.selectionEnd === 8,
      serverOwnedContentUpdated:
        root.className === "after" &&
        target.getAttribute("value") === "server-after" &&
        target.getAttribute("aria-label") === "Control after" &&
        replacement.textContent === "after",
    };
  });
  const operation = {
    kind: fixture.operation,
    completed: true,
    ...candidateResult,
    ...independentProof,
  };
  const after = await captureCandidateState(page);

  await attachJson(testInfo, "operation", { fixture: fixture.id, engine, ...operation });
  await attachJson(testInfo, "before-after", { fixture: fixture.id, engine, before, after });

  expect(candidateResult).toEqual({
    rootIdentity: "root",
    reusedIdentities: ["root", "target"],
    replacedIdentities: ["status"],
  });
  expect(independentProof).toEqual({
    preservedTargetIdentity: true,
    replacedTargetIdentity: true,
    originalReplacementDisconnected: true,
    dirtyStatePreserved: true,
    serverOwnedContentUpdated: true,
  });
  expect(blockedRequests, "FADENO_MORPH_EXTERNAL_REQUEST").toEqual([]);
  expect(pageErrors, "FADENO_MORPH_RUNTIME_ERROR").toEqual([]);
}

test(fixture.id, async ({ page }, testInfo) => {
  const engine = page.context().browser()?.browserType().name();
  if (!engine) throw new Error("FADENO_MORPH_BROWSER_IDENTITY_MISSING");
  const blockedRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route(/^https?:\/\//u, async (route) => {
    blockedRequests.push(route.request().url());
    await route.abort("blockedbyclient");
  });
  await runCandidateControl(page, testInfo, engine, blockedRequests, pageErrors);
});
