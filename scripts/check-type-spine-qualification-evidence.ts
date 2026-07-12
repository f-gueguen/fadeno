import { readFileSync } from "node:fs";

import { statSync } from "node:fs";

import { verifyQualificationCapture, verifyQualificationResult } from "./lib/type-spine-qualification-evidence.ts";

const path = process.argv[2];
if (!path) throw new Error("usage: check-type-spine-qualification-evidence.ts <capture.json>");
const conclusion = statSync(path).isDirectory()
  ? verifyQualificationResult(path)
  : verifyQualificationCapture(JSON.parse(readFileSync(path, "utf8")));
console.log(`type-spine qualification evidence passed (${conclusion.decision}; clean/tsc=${conclusion.metrics.cleanGeneratorToTscRatio.toFixed(6)}; incremental/clean=${conclusion.metrics.incrementalToCleanRatio.toFixed(6)})`);
