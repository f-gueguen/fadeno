import { performance } from "node:perf_hooks";

import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

import { applyPrivateMorphCandidate } from "../candidate.ts";
import type { PrivateMorphResult } from "../candidate.ts";
import { MORPH_QUALIFICATION_ASSETS, createQualificationFile } from "../fixtures/qualification-assets.ts";
import type { QualificationState } from "../fixtures/qualification-corpus.ts";
import type {
  QualificationFailureEvidence,
  QualificationRecord,
  QualificationSnapshot,
} from "../qualification-proof.ts";
import {
  qualificationRepetitions,
  verifyQualificationOutcome,
  verifyQualificationRecords,
} from "../qualification-proof.ts";
import {
  MORPH_QUALIFICATION_SCENARIOS,
} from "../qualification-scenarios.ts";
import type {
  MorphQualificationProfile,
  MorphQualificationScenario,
} from "../qualification-scenarios.ts";
import { attachJson } from "./evidence.ts";

const rawProfile = process.env.FADENO_MORPH_PROFILE;
if (rawProfile !== "ci" && rawProfile !== "qualification") {
  throw new Error(`FADENO_MORPH_QUALIFICATION_PROFILE: ${rawProfile ?? "missing"}`);
}
const profile: MorphQualificationProfile = rawProfile;
const repetitions = qualificationRepetitions(profile);

type Instrumentation = {
  setterCalls: string[];
  methodCalls: string[];
  events: string[];
  listenerHits: number;
  unhandledRejections: string[];
};

class QualificationScenarioProofError extends Error {
  readonly record: QualificationRecord;

  constructor(record: QualificationRecord, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "QualificationScenarioProofError";
    this.record = record;
  }
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )
  );
}

async function resetUnhandledRejectionCollector(page: Page): Promise<void> {
  await page.evaluate(() => {
    const currentWindow = window as typeof window & {
      __fadenoUnhandledRejections?: string[];
      __fadenoUnhandledHandler?: (event: PromiseRejectionEvent) => void;
    };
    if (currentWindow.__fadenoUnhandledHandler) {
      window.removeEventListener("unhandledrejection", currentWindow.__fadenoUnhandledHandler);
    }
    currentWindow.__fadenoUnhandledRejections = [];
    currentWindow.__fadenoUnhandledHandler = (event) => {
      currentWindow.__fadenoUnhandledRejections?.push(String(event.reason));
    };
    window.addEventListener("unhandledrejection", currentWindow.__fadenoUnhandledHandler);
  });
}

async function verifyUnhandledRejectionSensor(page: Page): Promise<void> {
  await page.setContent("<!doctype html><meta charset=\"utf-8\">");
  await resetUnhandledRejectionCollector(page);
  await page.evaluate(() => {
    void Promise.reject(new Error("FADENO_MORPH_REJECTION_SENSOR"));
  });
  await settle(page);
  const observed = await page.evaluate(() => {
    const currentWindow = window as typeof window & { __fadenoUnhandledRejections?: string[] };
    return currentWindow.__fadenoUnhandledRejections ?? [];
  });
  expect(observed).toEqual(["Error: FADENO_MORPH_REJECTION_SENSOR"]);
}

async function prepareScenario(page: Page, scenario: MorphQualificationScenario): Promise<void> {
  await page.setContent("<!doctype html><meta charset=\"utf-8\">");
  await page.evaluate(() => {
    const state = window as typeof window & {
      __fadenoIslandConnected?: number;
      __fadenoIslandDisconnected?: number;
    };
    state.__fadenoIslandConnected = 0;
    state.__fadenoIslandDisconnected = 0;
    if (!customElements.get("fadeno-island")) {
      customElements.define(
        "fadeno-island",
        class extends HTMLElement {
          connectedCallback(): void {
            const current = window as typeof window & { __fadenoIslandConnected?: number };
            current.__fadenoIslandConnected = (current.__fadenoIslandConnected ?? 0) + 1;
          }

          disconnectedCallback(): void {
            const current = window as typeof window & { __fadenoIslandDisconnected?: number };
            current.__fadenoIslandDisconnected = (current.__fadenoIslandDisconnected ?? 0) + 1;
          }
        },
      );
    }
  });
  await page.setContent(scenario.currentHtml);
  await resetUnhandledRejectionCollector(page);

  switch (scenario.fixture.state) {
    case "focused-input-selection": {
      const target = page.locator(`#${scenario.fixture.targetIdentity}`);
      await target.fill("client-dirty");
      await target.focus();
      await target.evaluate((element) =>
        (element as HTMLInputElement).setSelectionRange(2, 8)
      );
      break;
    }
    case "focused-textarea-selection": {
      const target = page.locator(`#${scenario.fixture.targetIdentity}`);
      await target.fill("client-dirty");
      await target.focus();
      await target.evaluate((element) =>
        (element as HTMLTextAreaElement).setSelectionRange(1, 7)
      );
      break;
    }
    case "focused-contenteditable-caret":
      await page.locator(`#${scenario.fixture.targetIdentity}`).evaluate((element) => {
        const text = element.firstChild;
        if (!text) throw new Error("FADENO_MORPH_EDITOR_TEXT_MISSING");
        (element as HTMLElement).focus();
        const range = document.createRange();
        range.setStart(text, 4);
        range.collapse(true);
        const selection = document.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      });
      break;
    case "dirty-text":
      await page.locator(`#${scenario.fixture.targetIdentity}`).fill("client-dirty");
      break;
    case "dirty-checkbox":
    case "dirty-radio":
      await page.locator(`#${scenario.fixture.targetIdentity}`).check();
      break;
    case "dirty-select":
      await page.locator(`#${scenario.fixture.targetIdentity}`).selectOption("b");
      break;
    case "dirty-file":
      await page.locator(`#${scenario.fixture.targetIdentity}`).setInputFiles({
        name: MORPH_QUALIFICATION_ASSETS.file.name,
        mimeType: MORPH_QUALIFICATION_ASSETS.file.contentType,
        buffer: createQualificationFile(),
      });
      break;
    case "details-open":
      await page.locator("#details-summary").click();
      break;
    case "dialog-modal":
      await page.locator(`#${scenario.fixture.targetIdentity}`).evaluate((element) =>
        (element as HTMLDialogElement).showModal()
      );
      break;
    case "dialog-nonmodal":
      await page.locator(`#${scenario.fixture.targetIdentity}`).evaluate((element) =>
        (element as HTMLDialogElement).show()
      );
      break;
    case "popover-open":
      await page.locator(`#${scenario.fixture.targetIdentity}`).evaluate((element) =>
        (element as HTMLElement).showPopover()
      );
      break;
    case "media-playing":
      await page.locator(`#${scenario.fixture.targetIdentity}`).evaluate(async (element) => {
        const media = element as HTMLAudioElement;
        if (media.readyState < 2) {
          await new Promise<void>((resolve, reject) => {
            media.addEventListener("canplay", () => resolve(), { once: true });
            media.addEventListener("error", () => reject(new Error("media failed")), { once: true });
          });
        }
        await media.play();
        const deadline = performance.now() + 2_000;
        while (media.currentTime <= 0.02 && performance.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        if (media.currentTime <= 0.02) throw new Error("FADENO_MORPH_MEDIA_DID_NOT_ADVANCE");
      });
      break;
    case "media-paused":
      await page.locator(`#${scenario.fixture.targetIdentity}`).evaluate(async (element) => {
        const media = element as HTMLAudioElement;
        if (media.readyState < 2) {
          await new Promise<void>((resolve, reject) => {
            media.addEventListener("canplay", () => resolve(), { once: true });
            media.addEventListener("error", () => reject(new Error("media failed")), { once: true });
          });
        }
        media.pause();
        media.currentTime = 0.25;
        if (media.seeking) {
          await new Promise<void>((resolve) =>
            media.addEventListener("seeked", () => resolve(), { once: true })
          );
        }
      });
      break;
    case "document-scroll":
      await page.evaluate(() => window.scrollTo(0, 400));
      break;
    case "element-scroll":
      await page.locator(`#${scenario.fixture.targetIdentity}`).evaluate((element) => {
        element.scrollTop = 120;
      });
      break;
    case "island-identity":
    case "intentional-replacement":
      break;
  }
  await settle(page);
}

async function installInstrumentation(
  page: Page,
  stateName: QualificationState,
  targetIdentity: string,
): Promise<void> {
  await page.evaluate(
    ({ stateName, targetIdentity }) => {
      const currentWindow = window as typeof window & {
        __fadenoRoot?: Element;
        __fadenoTarget?: Element;
        __fadenoAncestors?: Array<readonly [string, Element]>;
        __fadenoOriginalFile?: File | undefined;
        __fadenoInstrumentation?: Instrumentation;
        __fadenoUnhandledRejections?: string[];
        __fadenoIslandConnected?: number;
        __fadenoIslandDisconnected?: number;
        __fadenoIslandBaseline?: readonly [number, number];
      };
      const root = document.querySelector("#root");
      const target = document.getElementById(targetIdentity);
      if (!root || !target) throw new Error("FADENO_MORPH_INSTRUMENTATION_TARGET_MISSING");
      const instrumentation: Instrumentation = {
        setterCalls: [],
        methodCalls: [],
        events: [],
        listenerHits: 0,
        unhandledRejections: currentWindow.__fadenoUnhandledRejections ?? [],
      };
      currentWindow.__fadenoRoot = root;
      currentWindow.__fadenoTarget = target;
      currentWindow.__fadenoAncestors = [];
      let ancestor: Element | null = target;
      while (ancestor) {
        currentWindow.__fadenoAncestors.push([ancestor.id, ancestor]);
        if (ancestor === root) break;
        ancestor = ancestor.parentElement;
      }
      if (currentWindow.__fadenoAncestors.at(-1)?.[1] !== root) {
        throw new Error("FADENO_MORPH_INSTRUMENTATION_ANCESTOR_MISSING");
      }
      (target as Element & { __fadenoExpando?: string }).__fadenoExpando = "retained";
      target.addEventListener("fadeno-sentinel", () => {
        instrumentation.listenerHits += 1;
      });
      currentWindow.__fadenoOriginalFile =
        stateName === "dirty-file"
          ? (target as HTMLInputElement).files?.[0]
          : undefined;
      currentWindow.__fadenoIslandBaseline = [
        currentWindow.__fadenoIslandConnected ?? 0,
        currentWindow.__fadenoIslandDisconnected ?? 0,
      ];

      const descriptor = (object: object, property: string): PropertyDescriptor | undefined => {
        let owner: object | null = object;
        while (owner) {
          const found = Object.getOwnPropertyDescriptor(owner, property);
          if (found) return found;
          owner = Object.getPrototypeOf(owner) as object | null;
        }
        return undefined;
      };
      const wrapSetter = (object: object, property: string): void => {
        const found = descriptor(object, property);
        if (!found?.get || !found.set) return;
        Object.defineProperty(object, property, {
          configurable: true,
          enumerable: found.enumerable ?? false,
          get: () => found.get?.call(object),
          set: (value: unknown) => {
            instrumentation.setterCalls.push(property);
            found.set?.call(object, value);
          },
        });
      };
      const wrapMethod = (object: object, method: string): void => {
        const original = (object as Record<string, unknown>)[method];
        if (typeof original !== "function") return;
        Object.defineProperty(object, method, {
          configurable: true,
          value: (...args: unknown[]) => {
            instrumentation.methodCalls.push(method);
            return Reflect.apply(original, object, args) as unknown;
          },
        });
      };

      const stateSetters: Partial<Record<QualificationState, readonly string[]>> = {
        "focused-input-selection": ["value", "selectionStart", "selectionEnd"],
        "focused-textarea-selection": ["value", "selectionStart", "selectionEnd"],
        "dirty-text": ["value"],
        "dirty-checkbox": ["checked"],
        "dirty-radio": ["checked"],
        "dirty-select": ["value", "selectedIndex"],
        "details-open": ["open"],
        "dialog-modal": ["open"],
        "dialog-nonmodal": ["open"],
        "media-playing": ["currentTime"],
        "media-paused": ["currentTime"],
        "element-scroll": ["scrollLeft", "scrollTop"],
      };
      const stateMethods: Partial<Record<QualificationState, readonly string[]>> = {
        "focused-input-selection": ["focus", "blur", "setSelectionRange"],
        "focused-textarea-selection": ["focus", "blur", "setSelectionRange"],
        "focused-contenteditable-caret": ["focus", "blur"],
        "dialog-modal": ["show", "showModal", "close"],
        "dialog-nonmodal": ["show", "showModal", "close"],
        "popover-open": ["showPopover", "hidePopover", "togglePopover"],
        "media-playing": ["play", "pause", "load"],
        "media-paused": ["play", "pause", "load"],
        "element-scroll": ["scroll", "scrollTo", "scrollBy"],
      };
      for (const property of stateSetters[stateName] ?? []) wrapSetter(target, property);
      for (const method of stateMethods[stateName] ?? []) wrapMethod(target, method);
      if (stateName === "document-scroll") {
        for (const method of ["scroll", "scrollTo", "scrollBy"]) wrapMethod(window, method);
      }
      const observedEvents = [
        "beforetoggle",
        "blur",
        "change",
        "focus",
        "input",
        "pause",
        "play",
        "scroll",
        "seeking",
        "seeked",
        "toggle",
      ];
      for (const name of observedEvents) {
        target.addEventListener(name, () => instrumentation.events.push(name));
      }
      if (stateName === "document-scroll") {
        window.addEventListener("scroll", () => instrumentation.events.push("window-scroll"));
      }
      currentWindow.__fadenoInstrumentation = instrumentation;
    },
    { stateName, targetIdentity },
  );
}

async function captureSnapshot(
  page: Page,
  stateName: QualificationState,
  targetIdentity: string,
  operationParentIdentity: string,
  dispatchSentinel: boolean,
): Promise<QualificationSnapshot> {
  return page.evaluate(
    async ({ stateName, targetIdentity, operationParentIdentity, dispatchSentinel }) => {
      const currentWindow = window as typeof window & {
        __fadenoRoot?: Element;
        __fadenoTarget?: Element;
        __fadenoAncestors?: Array<readonly [string, Element]>;
        __fadenoOriginalFile?: File | undefined;
        __fadenoInstrumentation?: Instrumentation;
        __fadenoIslandConnected?: number;
        __fadenoIslandDisconnected?: number;
        __fadenoIslandBaseline?: readonly [number, number];
      };
      const root = document.querySelector<HTMLElement>("#root");
      const target = document.getElementById(targetIdentity);
      const operationParent = document.getElementById(operationParentIdentity);
      const originalRoot = currentWindow.__fadenoRoot;
      const originalTarget = currentWindow.__fadenoTarget;
      const instrumentation = currentWindow.__fadenoInstrumentation;
      if (!root || !target || !operationParent || !originalRoot || !originalTarget || !instrumentation) {
        throw new Error("FADENO_MORPH_SNAPSHOT_TARGET_MISSING");
      }
      if (dispatchSentinel) target.dispatchEvent(new Event("fadeno-sentinel"));
      const state = await (async (): Promise<Record<string, unknown>> => {
        switch (stateName) {
          case "focused-input-selection":
          case "focused-textarea-selection": {
            const control = target as HTMLInputElement | HTMLTextAreaElement;
            return {
              value: control.value,
              focused: document.activeElement === target,
              selectionStart: control.selectionStart,
              selectionEnd: control.selectionEnd,
            };
          }
          case "focused-contenteditable-caret": {
            const selection = document.getSelection();
            return {
              text: target.textContent,
              focused: document.activeElement === target,
              anchorInTarget: Boolean(selection?.anchorNode && target.contains(selection.anchorNode)),
              focusInTarget: Boolean(selection?.focusNode && target.contains(selection.focusNode)),
              anchorOffset: selection?.anchorOffset ?? null,
              focusOffset: selection?.focusOffset ?? null,
              collapsed: selection?.isCollapsed ?? false,
            };
          }
          case "dirty-text":
            return { value: (target as HTMLInputElement).value };
          case "dirty-checkbox":
            return { checked: (target as HTMLInputElement).checked };
          case "dirty-radio":
            return {
              checkedA: (document.querySelector("#dirty-radio-a") as HTMLInputElement | null)?.checked,
              checkedB: (document.querySelector("#dirty-radio-b") as HTMLInputElement | null)?.checked,
            };
          case "dirty-select": {
            const select = target as HTMLSelectElement;
            return { value: select.value, selectedIndex: select.selectedIndex };
          }
          case "dirty-file": {
            const file = (target as HTMLInputElement).files?.[0];
            if (!file) throw new Error("FADENO_MORPH_FILE_MISSING");
            return {
              name: file.name,
              contentType: file.type,
              bytes: file.size,
              lastModified: file.lastModified,
              text: await file.text(),
            };
          }
          case "details-open":
            return { open: (target as HTMLDetailsElement).open };
          case "dialog-modal":
          case "dialog-nonmodal":
            return {
              open: (target as HTMLDialogElement).open,
              modal: target.matches(":modal"),
            };
          case "popover-open":
            return { open: target.matches(":popover-open") };
          case "media-playing":
          case "media-paused": {
            const media = target as HTMLAudioElement;
            return {
              paused: media.paused,
              currentTime: Number(media.currentTime.toFixed(6)),
              readyState: media.readyState,
            };
          }
          case "document-scroll":
            return { x: window.scrollX, y: window.scrollY };
          case "element-scroll":
            return { left: target.scrollLeft, top: target.scrollTop };
          case "island-identity":
            return {
              connectedCount: currentWindow.__fadenoIslandConnected ?? 0,
              disconnectedCount: currentWindow.__fadenoIslandDisconnected ?? 0,
            };
          case "intentional-replacement":
            return { text: target.textContent };
        }
      })();
      const ancestorsOriginal = (currentWindow.__fadenoAncestors ?? []).every(
        ([identity, element]) => document.getElementById(identity) === element && element.isConnected,
      );
      const sameFileObject = stateName === "dirty-file"
        ? (target as HTMLInputElement).files?.[0] === currentWindow.__fadenoOriginalFile
        : null;
      const islandBaseline = currentWindow.__fadenoIslandBaseline;
      const islandLifecycleStable = stateName === "island-identity"
        ? Boolean(
            islandBaseline &&
              islandBaseline[0] === (currentWindow.__fadenoIslandConnected ?? 0) &&
              islandBaseline[1] === (currentWindow.__fadenoIslandDisconnected ?? 0),
          )
        : null;
      const topLayerStable = stateName === "dialog-modal"
        ? (target as HTMLDialogElement).open && target.matches(":modal")
        : stateName === "dialog-nonmodal"
          ? (target as HTMLDialogElement).open && !target.matches(":modal")
          : stateName === "popover-open"
            ? target.matches(":popover-open")
            : null;
      return {
        serverClass: root.className,
        order: Array.from(operationParent.children).map((element) => element.id),
        rootOriginal: root === originalRoot,
        targetOriginal: target === originalTarget,
        originalTargetConnected: originalTarget.isConnected,
        currentTargetConnected: target.isConnected,
        ancestorsOriginal,
        expandoPreserved:
          (target as Element & { __fadenoExpando?: string }).__fadenoExpando === "retained",
        listenerHits: instrumentation.listenerHits,
        sameFileObject,
        islandLifecycleStable,
        topLayerStable,
        state,
      };
    },
    { stateName, targetIdentity, operationParentIdentity, dispatchSentinel },
  );
}

function assertBrowserProof(
  scenario: MorphQualificationScenario,
  candidate: PrivateMorphResult,
  before: QualificationSnapshot,
  after: QualificationSnapshot,
  instrumentation: QualificationRecord["instrumentation"],
): void {
  expect(before.serverClass).toBe("before");
  expect(after.serverClass).toBe("after");
  expect(before.order).toEqual(scenario.beforeOrder);
  expect(after.order).toEqual(scenario.afterOrder);
  expect(before.rootOriginal).toBe(true);
  expect(after.rootOriginal).toBe(true);
  expect(before.targetOriginal).toBe(true);
  expect(before.originalTargetConnected).toBe(true);
  expect(before.ancestorsOriginal).toBe(true);
  expect(before.expandoPreserved).toBe(true);
  expect(before.listenerHits).toBe(0);
  for (const values of Object.values(instrumentation)) expect(values).toEqual([]);
  expect(candidate.rootIdentity).toBe("root");
  expect(candidate.reusedIdentities).toContain("root");

  if (scenario.fixture.state === "intentional-replacement") {
    expect(after.targetOriginal).toBe(false);
    expect(after.originalTargetConnected).toBe(false);
    expect(after.currentTargetConnected).toBe(true);
    expect(after.expandoPreserved).toBe(false);
    expect(after.listenerHits).toBe(0);
    expect(before.state).toEqual({ text: "before" });
    expect(after.state).toEqual({ text: "after" });
    expect(candidate.replacedIdentities).toEqual([scenario.fixture.targetIdentity]);
  } else {
    expect(after.targetOriginal).toBe(true);
    expect(after.originalTargetConnected).toBe(true);
    expect(after.currentTargetConnected).toBe(true);
    expect(after.ancestorsOriginal).toBe(true);
    expect(after.expandoPreserved).toBe(true);
    expect(after.listenerHits).toBe(1);
    expect(candidate.reusedIdentities).toContain(scenario.fixture.targetIdentity);
    expect(candidate.replacedIdentities).toEqual([]);
    if (scenario.fixture.state === "media-playing") {
      const beforeTime = Number(before.state.currentTime);
      const afterTime = Number(after.state.currentTime);
      expect(before.state.paused).toBe(false);
      expect(after.state.paused).toBe(false);
      expect(beforeTime).toBeGreaterThan(0.02);
      expect(afterTime).toBeGreaterThanOrEqual(beforeTime - 0.01);
      expect(afterTime).toBeLessThanOrEqual(beforeTime + 0.5);
    } else if (scenario.fixture.state === "media-paused") {
      expect(before.state.paused).toBe(true);
      expect(after.state.paused).toBe(true);
      expect(Number(before.state.currentTime)).toBeCloseTo(0.25, 2);
      expect(Number(after.state.currentTime)).toBeCloseTo(Number(before.state.currentTime), 2);
    } else {
      expect(after.state).toEqual(before.state);
    }
  }
  if (scenario.fixture.state === "dirty-file") {
    expect(before.sameFileObject).toBe(true);
    expect(after.sameFileObject).toBe(true);
  }
  if (scenario.fixture.state === "island-identity") {
    expect(before.islandLifecycleStable).toBe(true);
    expect(after.islandLifecycleStable).toBe(true);
  }
  if (["dialog-modal", "dialog-nonmodal", "popover-open"].includes(scenario.fixture.state)) {
    expect(before.topLayerStable).toBe(true);
    expect(after.topLayerStable).toBe(true);
  }
}

async function runScenario(
  page: Page,
  scenario: MorphQualificationScenario,
  ordinal: number,
  engine: QualificationRecord["engine"],
  blockedRequests: readonly string[],
  pageErrors: readonly string[],
): Promise<QualificationRecord> {
  await prepareScenario(page, scenario);
  await installInstrumentation(page, scenario.fixture.state, scenario.fixture.targetIdentity);
  const before = await captureSnapshot(
    page,
    scenario.fixture.state,
    scenario.fixture.targetIdentity,
    scenario.operationParentIdentity,
    false,
  );
  const documentElementCount = await page.locator("*").count();
  const started = performance.now();
  const candidate = await page.evaluate(applyPrivateMorphCandidate, scenario.patch);
  const candidateRoundTripMilliseconds = performance.now() - started;
  await settle(page);
  const after = await captureSnapshot(
    page,
    scenario.fixture.state,
    scenario.fixture.targetIdentity,
    scenario.operationParentIdentity,
    true,
  );
  const browserInstrumentation = await page.evaluate(() => {
    const currentWindow = window as typeof window & {
      __fadenoInstrumentation?: Instrumentation;
    };
    const instrumentation = currentWindow.__fadenoInstrumentation;
    if (!instrumentation) throw new Error("FADENO_MORPH_INSTRUMENTATION_MISSING");
    return {
      setterCalls: instrumentation.setterCalls,
      methodCalls: instrumentation.methodCalls,
      events: instrumentation.events,
      unhandledRejections: instrumentation.unhandledRejections,
    };
  });
  const instrumentation = {
    ...browserInstrumentation,
    blockedRequests: [...blockedRequests],
    pageErrors: [...pageErrors],
  };
  const record: QualificationRecord = {
    schemaVersion: 1,
    profile,
    engine,
    caseId: scenario.fixture.id,
    state: scenario.fixture.state,
    operation: scenario.fixture.operation,
    ordinal,
    key: `${engine}/${scenario.fixture.id}/${ordinal}`,
    completed: true,
    candidateRoundTripMilliseconds,
    documentElementCount,
    candidate,
    before,
    after,
    instrumentation,
  };
  try {
    assertBrowserProof(scenario, candidate, before, after, instrumentation);
  } catch (error: unknown) {
    throw new QualificationScenarioProofError(record, error);
  }
  return record;
}

test(`qualification-${profile}`, async ({ page }, testInfo: TestInfo) => {
  test.setTimeout(profile === "qualification" ? 15 * 60_000 : 5 * 60_000);
  const engine = page.context().browser()?.browserType().name();
  if (engine !== "chromium" && engine !== "firefox" && engine !== "webkit") {
    throw new Error("FADENO_MORPH_BROWSER_IDENTITY_MISSING");
  }
  const records: QualificationRecord[] = [];
  const failures: QualificationFailureEvidence[] = [];
  let blockedRequests: string[] = [];
  let pageErrors: string[] = [];
  let activeScenario: MorphQualificationScenario | undefined;
  let activeOrdinal = 0;
  await verifyUnhandledRejectionSensor(page);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route(/^https?:\/\//u, async (route) => {
    blockedRequests.push(route.request().url());
    await route.abort("blockedbyclient");
  });

  try {
    for (const scenario of MORPH_QUALIFICATION_SCENARIOS) {
      for (let ordinal = 1; ordinal <= repetitions; ordinal += 1) {
        activeScenario = scenario;
        activeOrdinal = ordinal;
        blockedRequests = [];
        pageErrors = [];
        try {
          records.push(await runScenario(
            page,
            scenario,
            ordinal,
            engine,
            blockedRequests,
            pageErrors,
          ));
        } catch (error: unknown) {
          if (!(error instanceof QualificationScenarioProofError)) throw error;
          failures.push({
            operation: {
              profile,
              engine,
              caseId: scenario.fixture.id,
              state: scenario.fixture.state,
              operation: scenario.fixture.operation,
              ordinal,
              failure: error.message,
            },
            observation: error.record,
          });
        }
        activeScenario = undefined;
        activeOrdinal = 0;
      }
    }
    await attachJson(testInfo, "qualification-records", records);
    if (failures.length === 0) {
      const summary = verifyQualificationRecords(records, profile, engine);
      await attachJson(testInfo, "qualification-summary", summary);
      return;
    }
    const summary = verifyQualificationOutcome(records, failures, profile, engine);
    await attachJson(testInfo, "qualification-failures", failures);
    await attachJson(testInfo, "qualification-summary", summary);
    throw new Error(
      `FADENO_MORPH_QUALIFICATION_FAILURE: ${failures.length} of ${summary.expectedRecords} cells failed`,
    );
  } catch (error: unknown) {
    if (failures.length > 0) throw error;
    const message = error instanceof Error ? error.message : String(error);
    await attachJson(testInfo, "qualification-records", records);
    await attachJson(testInfo, "qualification-summary", {
      profile,
      engine,
      expectedRecords: MORPH_QUALIFICATION_SCENARIOS.length * repetitions,
      completedRecords: records.length,
      failure: message,
    });
    await attachJson(testInfo, "qualification-failures", [{
      operation: {
      profile,
      engine,
      caseId: activeScenario?.fixture.id,
      state: activeScenario?.fixture.state,
      operation: activeScenario?.fixture.operation,
      ordinal: activeOrdinal,
      failure: message,
      },
      observation: null,
    }]);
    throw new Error(`FADENO_MORPH_QUALIFICATION_FAILURE: ${message}`);
  }
});
