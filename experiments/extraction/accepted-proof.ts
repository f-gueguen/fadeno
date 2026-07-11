import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { EXTRACTION_PROJECTS } from "./contract.ts";
import type { ExtractionObservation } from "./contract.ts";
import { scanImports } from "./import-scan.ts";

export class ExtractionProofError extends Error {
  readonly code = "FADENO_EXTRACTION_ACCEPTED_PROOF";
}

function imports(source: string): Readonly<{ statics: string[]; dynamics: string[] }> {
  const found = scanImports(source);
  return {
    statics: found.filter((entry) => entry.kind === "static").map((entry) => entry.specifier),
    dynamics: found.filter((entry) => entry.kind === "dynamic").map((entry) => entry.specifier),
  };
}

export function verifyAcceptedObservation(observation: ExtractionObservation): void {
  const responses = observation.responses;
  const sources = Object.fromEntries(
    Object.entries(responses).map(([path, response]) => [path, response.body]),
  );
  const documentGraph = imports(sources["/document.js"] ?? "");
  const handlerGraph = imports(sources["/handler.js"] ?? "");
  const forbidden = /(?:fragment|hydrate|component-runtime|server-only)/u;
  const html = sources["/"] ?? "";
  if (
    observation.schemaVersion !== 2 ||
    !EXTRACTION_PROJECTS.includes(observation.projectName) ||
    observation.observedBrowser !== observation.projectName ||
    !isDeepStrictEqual(observation.preTriggerRequests, ["/", "/document.js"]) ||
    !isDeepStrictEqual(observation.firstTriggerRequests, ["/handler.js", "/shared.js"]) ||
    observation.secondTriggerRequests.length !== 0 ||
    observation.valueWhileHandlerBlocked !== "0" ||
    observation.valueAfterFirstTrigger !== "1" ||
    observation.valueAfterSecondTrigger !== "2" ||
    observation.noJavaScriptValue !== "0" ||
    !isDeepStrictEqual(observation.noJavaScriptRequests, ["/"]) ||
    !isDeepStrictEqual(documentGraph, { statics: [], dynamics: ["/handler.js"] }) ||
    !isDeepStrictEqual(handlerGraph, { statics: ["/shared.js"], dynamics: [] }) ||
    !isDeepStrictEqual(Object.keys(responses).sort(), ["/", "/document.js", "/handler.js", "/shared.js"]) ||
    responses["/"]?.contentType !== "text/html" ||
    ["/document.js", "/handler.js", "/shared.js"].some(
      (path) => responses[path]?.contentType !== "text/javascript",
    ) ||
    Object.values(responses).some(
      (response) => createHash("sha256").update(response.body).digest("hex") !== response.sha256,
    ) ||
    /<script\b(?![^>]*\bsrc\s*=)[^>]*>/iu.test(html) ||
    /<link\b[^>]*\brel\s*=\s*["']?(?:modulepreload|preload)\b/iu.test(html) ||
    /fadeno-handler-only-sentinel/u.test(html) ||
    !(sources["/handler.js"] ?? "").includes("fadeno-handler-only-sentinel") ||
    (sources["/document.js"] ?? "").includes("fadeno-handler-only-sentinel") ||
    Object.entries(sources).some(([path, source]) => forbidden.test(`${path}\n${source}`))
  ) {
    throw new ExtractionProofError("seeded accepted loading/module observation differs");
  }
}
