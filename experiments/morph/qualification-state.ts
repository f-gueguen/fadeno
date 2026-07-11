import { isDeepStrictEqual } from "node:util";

import type { Page } from "@playwright/test";

import {
  MORPH_QUALIFICATION_ASSETS,
  createQualificationFile,
} from "./fixtures/qualification-assets.ts";
import type { QualificationState } from "./fixtures/qualification-corpus.ts";
import type { MorphQualificationScenario } from "./qualification-scenarios.ts";

export type MorphQualificationState = Readonly<Record<string, unknown>>;

async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )
  );
}

export async function prepareMorphQualificationState(
  page: Page,
  scenario: MorphQualificationScenario,
): Promise<void> {
  const target = page.locator(`#${scenario.fixture.targetIdentity}`);
  switch (scenario.fixture.state) {
    case "focused-input-selection":
      await target.fill("client-dirty");
      await target.focus();
      await target.evaluate((element) => (element as HTMLInputElement).setSelectionRange(2, 8));
      break;
    case "focused-textarea-selection":
      await target.fill("client-dirty");
      await target.focus();
      await target.evaluate((element) => (element as HTMLTextAreaElement).setSelectionRange(1, 7));
      break;
    case "focused-contenteditable-caret":
      await target.evaluate((element) => {
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
      await target.fill("client-dirty");
      break;
    case "dirty-checkbox":
    case "dirty-radio":
      await target.check();
      break;
    case "dirty-select":
      await target.selectOption("b");
      break;
    case "dirty-file":
      await target.setInputFiles({
        name: MORPH_QUALIFICATION_ASSETS.file.name,
        mimeType: MORPH_QUALIFICATION_ASSETS.file.contentType,
        buffer: createQualificationFile(),
      });
      await target.evaluate((element) => {
        (window as typeof window & { __fadenoQualificationFile: File | undefined })
          .__fadenoQualificationFile = (element as HTMLInputElement).files?.[0];
      });
      break;
    case "details-open":
      await page.locator("#details-summary").click();
      break;
    case "dialog-modal":
      await target.evaluate((element) => (element as HTMLDialogElement).showModal());
      break;
    case "dialog-nonmodal":
      await target.evaluate((element) => (element as HTMLDialogElement).show());
      break;
    case "popover-open":
      await target.evaluate((element) => (element as HTMLElement).showPopover());
      break;
    case "media-playing":
      await target.evaluate(async (element) => {
        const media = element as HTMLAudioElement;
        if (media.readyState < 2) await new Promise<void>((resolve, reject) => {
          media.addEventListener("canplay", () => resolve(), { once: true });
          media.addEventListener("error", () => reject(new Error("media failed")), { once: true });
        });
        media.playbackRate = 0.5;
        await media.play();
        const deadline = performance.now() + 2_000;
        while (media.currentTime <= 0.02 && performance.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        if (media.currentTime <= 0.02) throw new Error("FADENO_MORPH_MEDIA_DID_NOT_ADVANCE");
      });
      break;
    case "media-paused":
      await target.evaluate(async (element) => {
        const media = element as HTMLAudioElement;
        if (media.readyState < 2) await new Promise<void>((resolve, reject) => {
          media.addEventListener("canplay", () => resolve(), { once: true });
          media.addEventListener("error", () => reject(new Error("media failed")), { once: true });
        });
        media.pause();
        media.currentTime = 0.25;
        const deadline = performance.now() + 2_000;
        while ((Math.abs(media.currentTime - 0.25) > 0.002 || media.seeking) &&
          performance.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        if (Math.abs(media.currentTime - 0.25) > 0.002 || media.seeking) {
          throw new Error("FADENO_MORPH_MEDIA_SEEK_DID_NOT_SETTLE");
        }
      });
      break;
    case "document-scroll":
      await page.evaluate(() => window.scrollTo(0, 400));
      break;
    case "element-scroll":
      await target.evaluate((element) => { element.scrollTop = 120; });
      break;
    case "island-identity":
    case "intentional-replacement":
      break;
  }
  await settle(page);
}

export function readMorphQualificationState(
  page: Page,
  scenario: MorphQualificationScenario,
): Promise<MorphQualificationState> {
  return page.evaluate(async ({ state, targetIdentity }) => {
    const target = document.getElementById(targetIdentity);
    if (!target) throw new Error("FADENO_MORPH_STATE_TARGET_MISSING");
    switch (state) {
      case "focused-input-selection":
      case "focused-textarea-selection": {
        const control = target as HTMLInputElement | HTMLTextAreaElement;
        return { value: control.value, focused: document.activeElement === target,
          selectionStart: control.selectionStart, selectionEnd: control.selectionEnd };
      }
      case "focused-contenteditable-caret": {
        const selection = document.getSelection();
        return { text: target.textContent, focused: document.activeElement === target,
          anchorInTarget: Boolean(selection?.anchorNode && target.contains(selection.anchorNode)),
          focusInTarget: Boolean(selection?.focusNode && target.contains(selection.focusNode)),
          anchorOffset: selection?.anchorOffset ?? null, focusOffset: selection?.focusOffset ?? null,
          collapsed: selection?.isCollapsed ?? false };
      }
      case "dirty-text": return { value: (target as HTMLInputElement).value };
      case "dirty-checkbox": return { checked: (target as HTMLInputElement).checked };
      case "dirty-radio": return {
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
        return { name: file.name, contentType: file.type, bytes: file.size,
          lastModified: file.lastModified, text: await file.text(),
          sameFile: file === (window as typeof window & {
            __fadenoQualificationFile: File | undefined;
          })
            .__fadenoQualificationFile };
      }
      case "details-open": return { open: (target as HTMLDetailsElement).open };
      case "dialog-modal":
      case "dialog-nonmodal": return {
        open: (target as HTMLDialogElement).open,
        modal: target.matches(":modal"),
      };
      case "popover-open": return { open: target.matches(":popover-open") };
      case "media-playing":
      case "media-paused": {
        const media = target as HTMLAudioElement;
        return { paused: media.paused, currentTime: Number(media.currentTime.toFixed(6)),
          playbackRate: media.playbackRate };
      }
      case "document-scroll": return { x: window.scrollX, y: window.scrollY };
      case "element-scroll": return { left: target.scrollLeft, top: target.scrollTop };
      case "island-identity": return { connected: target.isConnected };
      case "intentional-replacement": return { text: target.textContent };
    }
  }, { state: scenario.fixture.state, targetIdentity: scenario.fixture.targetIdentity });
}

export function morphQualificationStatePreserved(
  state: QualificationState,
  before: MorphQualificationState,
  after: MorphQualificationState,
): boolean {
  if (state === "media-playing") {
    const beforeTime = Number(before.currentTime);
    const afterTime = Number(after.currentTime);
    return before.paused === false && after.paused === false &&
      before.playbackRate === 0.5 && after.playbackRate === 0.5 &&
      beforeTime > 0.02 && afterTime >= beforeTime - 0.01 && afterTime <= beforeTime + 1;
  }
  if (state === "media-paused") {
    return before.paused === true && after.paused === true &&
      before.playbackRate === 1 && after.playbackRate === 1 &&
      Math.abs(Number(before.currentTime) - 0.25) <= 0.01 &&
      Math.abs(Number(after.currentTime) - Number(before.currentTime)) <= 0.01;
  }
  return isDeepStrictEqual(before, after);
}

export async function releaseMorphQualificationState(
  page: Page,
  scenario: MorphQualificationScenario,
): Promise<void> {
  const target = page.locator(`#${scenario.fixture.targetIdentity}`);
  switch (scenario.fixture.state) {
    case "dialog-modal":
    case "dialog-nonmodal":
      await target.evaluate((element) => {
        const dialog = element as HTMLDialogElement;
        if (dialog.open) dialog.close();
      });
      break;
    case "popover-open":
      await target.evaluate((element) => {
        if (element.matches(":popover-open")) (element as HTMLElement).hidePopover();
      });
      break;
    case "media-playing":
    case "media-paused":
      await target.evaluate((element) => (element as HTMLMediaElement).pause());
      break;
    default:
      break;
  }
}
