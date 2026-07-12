import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020Module from "ajv/dist/2020.js";

import { readJsonDocument } from "./lib/experiment-contract.ts";

type Validator = ((value: unknown) => boolean) & { errors?: unknown };
type AjvInstance = { compile(schema: unknown): Validator };
const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => AjvInstance;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = join(root, "experiments/type-spine");
const schema = readJsonDocument(join(directory, "reference-environment.schema.json"));
const document = readJsonDocument(join(directory, "reference-environment.json"));
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
if (!validate(document)) throw new Error("H3 reference control document is invalid");

let detected = 0;
for (const [label, mutate] of [
  ["provider", (value: any) => { value.host.provider = "github-actions"; }],
  ["host architecture", (value: any) => { value.host.architecture = "x64"; }],
  ["image", (value: any) => { value.container.platformDigest = `sha256:${"0".repeat(64)}`; }],
  ["CPU", (value: any) => { value.container.cpuLimit = 4; }],
  ["network", (value: any) => { value.container.networkPolicy = "enabled"; }],
  ["load", (value: any) => { value.preflight.minimumCpuIdlePercent = 10; }],
  ["extra key", (value: any) => { value.unexpected = true; }],
] as const) {
  const candidate = structuredClone(document);
  mutate(candidate);
  if (validate(candidate)) throw new Error(`H3 reference mutation was accepted: ${label}`);
  detected += 1;
}

const lock = readFileSync(join(root, "pnpm-lock.yaml"));
if (lock.byteLength === 0) throw new Error("H3 reference lock control is empty");

console.log(`type-spine reference negative tests passed (${detected} mutations)`);
