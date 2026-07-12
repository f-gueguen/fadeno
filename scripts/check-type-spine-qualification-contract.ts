import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020Module from "ajv/dist/2020.js";

import { renderTypeSpineCandidate } from "../experiments/type-spine/generator.ts";
import type { TypeSpineInput } from "../experiments/type-spine/contract.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const experiment = join(root, "experiments/type-spine");
type QualificationContract = {
  corpus: { path: string; sha256: string; outputA: string; outputB: string };
  stockTypeScript: { compilerArguments: string[] };
  capabilitySlice: { immutableResultsAllowed: boolean; decisionAllowed: boolean };
};
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const contract = readJson<QualificationContract>(join(experiment, "qualification-contract.json"));
const schema = readJson<unknown>(join(experiment, "qualification-contract.schema.json"));
const corpusBytes = readFileSync(join(root, contract.corpus.path));
const corpus = JSON.parse(corpusBytes.toString("utf8")) as { inputA: TypeSpineInput; inputB: TypeSpineInput };
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => { compile(schema: unknown): ((value: unknown) => boolean) & { errors?: unknown } };
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
if (!validate(contract)) throw new Error(`FADENO_TYPE_SPINE_QUALIFICATION_SCHEMA:${JSON.stringify(validate.errors)}`);
if (hash(corpusBytes) !== contract.corpus.sha256) throw new Error("FADENO_TYPE_SPINE_QUALIFICATION_CORPUS_HASH");
if (hash(renderTypeSpineCandidate(corpus.inputA)) !== contract.corpus.outputA || hash(renderTypeSpineCandidate(corpus.inputB)) !== contract.corpus.outputB) {
  throw new Error("FADENO_TYPE_SPINE_QUALIFICATION_OUTPUT_HASH");
}
const expectedArguments = ["--noEmit", "--strict", "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "Bundler", "--allowImportingTsExtensions", "--skipLibCheck", "false", "--incremental", "false", "--pretty", "false"];
if (JSON.stringify(contract.stockTypeScript.compilerArguments) !== JSON.stringify(expectedArguments)) throw new Error("FADENO_TYPE_SPINE_QUALIFICATION_TSC_ARGUMENTS");
const resultEntries = readdirSync(join(experiment, "results")).filter((name) => name !== "README.md");
const registry = readJson<{ experiments: readonly { id: string; status: string }[] }>(
  join(root, "experiments/registry.json"),
);
const status = registry.experiments.find(({ id }) => id === "type-spine")?.status;
const expectedResults = status === "qualified" ? ["20260712T022123Z-122ba57-a1"] : [];
if (
  JSON.stringify(resultEntries.sort()) !== JSON.stringify(expectedResults) ||
  contract.capabilitySlice.immutableResultsAllowed || contract.capabilitySlice.decisionAllowed
) {
  throw new Error("FADENO_TYPE_SPINE_QUALIFICATION_PREMATURE_RESULT");
}
console.log(`type-spine qualification contract passed (5 warmups, 20 samples, ${status})`);
