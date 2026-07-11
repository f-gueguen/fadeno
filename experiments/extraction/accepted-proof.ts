import { isDeepStrictEqual } from "node:util";
import { createScanner, SyntaxKind } from "typescript/unstable/ast";
import { EXTRACTION_PROJECTS } from "./contract.ts";
import type { ExtractionObservation } from "./contract.ts";

export class ExtractionProofError extends Error {
  readonly code = "FADENO_EXTRACTION_ACCEPTED_PROOF";
}

function imports(source: string): Readonly<{ statics: string[]; dynamics: string[] }> {
  const scanner = createScanner(true, undefined, source);
  const statics: string[] = [];
  const dynamics: string[] = [];
  let importMode: "pending" | "dynamic" | undefined;
  for (let token = scanner.scan(); token !== SyntaxKind.EndOfFile; token = scanner.scan()) {
    if (token === SyntaxKind.ImportKeyword) {
      importMode = "pending";
      continue;
    }
    if (importMode === "pending" && token === SyntaxKind.OpenParenToken) {
      importMode = "dynamic";
      continue;
    }
    if (importMode && token === SyntaxKind.StringLiteral) {
      (importMode === "dynamic" ? dynamics : statics).push(scanner.getTokenValue());
      importMode = undefined;
    }
  }
  return { statics, dynamics };
}

export function verifyAcceptedObservation(observation: ExtractionObservation): void {
  const sources = observation.responseSources;
  const documentGraph = imports(sources["/document.js"] ?? "");
  const handlerGraph = imports(sources["/handler.js"] ?? "");
  const forbidden = /(?:fragment|hydrate|component-runtime|server-only)/u;
  if (
    observation.schemaVersion !== 1 ||
    !EXTRACTION_PROJECTS.includes(observation.engine) ||
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
    !(sources["/handler.js"] ?? "").includes("fadeno-handler-only-sentinel") ||
    (sources["/document.js"] ?? "").includes("fadeno-handler-only-sentinel") ||
    Object.entries(sources).some(([path, source]) => forbidden.test(`${path}\n${source}`))
  ) {
    throw new ExtractionProofError("seeded accepted loading/module observation differs");
  }
}
