import { disclosure as disclosureBehavior } from "../accepted/disclosure.ts";
import { increment as counterBehavior } from "../accepted/local-counter.ts";
import { toggleMenu as menuBehavior } from "../accepted/menu.ts";
import { selectTab as tabsBehavior } from "../accepted/tabs.ts";
import { toggle as toggleBehavior } from "../accepted/toggle.ts";
import { show as ambientSwitchBehavior } from "../rejected/ambient-switch.ts";
import { start as asyncLifetimeBehavior } from "../rejected/async-lifetime.ts";
import { increment as classInstanceBehavior } from "../rejected/class-instance.ts";
import { inspect as cyclicDataBehavior } from "../rejected/cyclic-data.ts";
import { load as dynamicImportBehavior } from "../rejected/dynamic-import.ts";
import { show as nonDeterministicBehavior } from "../rejected/non-deterministic-closure.ts";
import { abort as opaqueCapabilityBehavior } from "../rejected/opaque-capability.ts";
import { size as oversizedCaptureBehavior } from "../rejected/oversized-capture.ts";
import { query as serverModuleBehavior } from "../rejected/server-module.ts";
import { reveal as serverSecretBehavior } from "../rejected/server-secret.ts";

declare function seedInteraction<T>(handler: T): T;

export function toggleRoot() {
  return seedInteraction((control: HTMLButtonElement, panel: HTMLElement): void => {
    toggleBehavior(control, panel);
  });
}

export function disclosureRoot() {
  return seedInteraction((details: HTMLDetailsElement): void => {
    disclosureBehavior(details);
  });
}

export function tabsRoot() {
  return seedInteraction((tab: HTMLElement, panels: readonly HTMLElement[]): void => {
    tabsBehavior(tab, panels);
  });
}

export function menuRoot() {
  return seedInteraction((button: HTMLButtonElement, menu: HTMLElement): void => {
    menuBehavior(button, menu);
  });
}

export function localCounterRoot() {
  const capture = Object.freeze({ step: 1 });
  return seedInteraction((output: HTMLOutputElement): void => {
    counterBehavior(output, capture.step);
  });
}

export function serverSecretRoot() {
  return seedInteraction((output: HTMLElement): void => {
    serverSecretBehavior(output);
  });
}

export function serverModuleRoot() {
  return seedInteraction((output: HTMLElement): void => {
    serverModuleBehavior(output);
  });
}

export function opaqueCapabilityRoot() {
  return seedInteraction((): void => {
    opaqueCapabilityBehavior();
  });
}

export function classInstanceRoot() {
  return seedInteraction((): void => {
    classInstanceBehavior();
  });
}

export function cyclicDataRoot() {
  return seedInteraction((output: HTMLElement): void => {
    cyclicDataBehavior(output);
  });
}

export function dynamicImportRoot() {
  return seedInteraction(async (): Promise<void> => {
    await dynamicImportBehavior("qualification-module");
  });
}

export function ambientSwitchRoot() {
  return seedInteraction((output: HTMLElement): void => {
    ambientSwitchBehavior(output);
  });
}

export function asyncLifetimeRoot() {
  return seedInteraction((output: HTMLElement): void => {
    asyncLifetimeBehavior(output);
  });
}

export function oversizedCaptureRoot() {
  return seedInteraction((output: HTMLElement): void => {
    oversizedCaptureBehavior(output);
  });
}

export function nonDeterministicClosureRoot() {
  return seedInteraction((output: HTMLElement): void => {
    nonDeterministicBehavior(output);
  });
}
