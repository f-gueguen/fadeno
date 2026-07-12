import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020Module from "ajv/dist/2020.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const experiment = join(root, "experiments/revalidation");
const schema = JSON.parse(readFileSync(join(experiment, "reference-environment.schema.json"), "utf8"));
type MutableReference = {
  id: string;
  scope: string;
  host: { cpuModel: string };
  docker: { engineVersion: string };
  container: { cpuLimit: number; networkPolicy: string };
  toolchain: { lockSha256: string };
  preflight: { exclusiveQualificationContainers: number };
};
const reference = JSON.parse(readFileSync(join(experiment, "reference-environment.json"), "utf8")) as MutableReference;
const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => { compile(schema: unknown): (value: unknown) => boolean };
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const mutations: readonly ((value: MutableReference) => void)[] = [
  (value) => { value.id = "k0-h3-local-docker-arm64-v1"; },
  (value) => { value.scope = "all-k0"; },
  (value) => { value.host.cpuModel = "unknown"; },
  (value) => { value.docker.engineVersion = "29.1.2"; },
  (value) => { value.container.cpuLimit = 4; },
  (value) => { value.container.networkPolicy = "enabled"; },
  (value) => { value.toolchain.lockSha256 = "0".repeat(64); },
  (value) => { value.preflight.exclusiveQualificationContainers = 2; },
];
for (const mutate of mutations) {
  const candidate = structuredClone(reference);
  mutate(candidate);
  if (validate(candidate)) throw new Error("revalidation reference mutation accepted");
}
console.log(`revalidation reference negative tests passed (${mutations.length} mutations)`);
