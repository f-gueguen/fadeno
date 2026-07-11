import type { ReferenceEnvironment } from "../../scripts/lib/experiment-validation.ts";
import {
  assertBrowserCompatibility as assertSharedBrowserCompatibility,
  classifyReferenceHost,
  runBrowserPreflight,
} from "../browser-preflight.ts";
import type { BrowserVersions } from "../browser-preflight.ts";
import { MorphHarnessError } from "./harness-report.ts";

export type { ReferenceObservation } from "../browser-preflight.ts";
export { classifyReferenceHost };

const morphCodes: Readonly<Record<string, string>> = {
  FADENO_BROWSER_PREFLIGHT_PLAYWRIGHT_VERSION: "FADENO_MORPH_PLAYWRIGHT_VERSION",
  FADENO_BROWSER_PREFLIGHT_BROWSER_VERSION: "FADENO_MORPH_BROWSER_VERSION",
  FADENO_BROWSER_PREFLIGHT_BROWSER_LAUNCH: "FADENO_MORPH_BROWSER_LAUNCH",
  FADENO_BROWSER_PREFLIGHT_NON_REFERENCE: "FADENO_MORPH_NON_REFERENCE",
};

function morphError(code: string, message: string): Error {
  return new MorphHarnessError(morphCodes[code] ?? code, message);
}

export function assertBrowserCompatibility(
  versions: BrowserVersions,
  reference: ReferenceEnvironment,
  packageVersion: string,
): void {
  assertSharedBrowserCompatibility(versions, reference, packageVersion, morphError);
}

export function runMorphPreflight(
  root: string,
  options: { requireReference?: boolean; maxReferenceWaitMilliseconds?: number } = {},
) {
  return runBrowserPreflight(root, { ...options, createError: morphError });
}
