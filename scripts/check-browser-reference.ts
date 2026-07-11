import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readJsonDocument } from "./lib/experiment-contract.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const action = readFileSync(join(root, ".github/actions/browser-reference/action.yml"), "utf8");
const workflow = readFileSync(join(root, ".github/workflows/check.yml"), "utf8");
const reference = readJsonDocument(join(root, "experiments/reference-environment.json"));
const tasks = ["morph-ci", "morph-qualification", "extraction-harness"];

for (const required of [
  `image=\"${reference.container.runtimeImage}\"`,
  "docker run --rm --ipc=host",
  "--env FADENO_EXPECT_REFERENCE=1",
  "--env FADENO_RUNNER_IMAGE_VERSION=\"$ImageVersion\"",
  "--env FADENO_RUNNER_NAME=\"$RUNNER_NAME\"",
  "--env FADENO_CONTAINER_PLATFORM_DIGEST=\"$container_platform_digest\"",
  "--env FADENO_CONTAINER_CONFIG_DIGEST=\"$container_config_digest\"",
  "pnpm experiment:morph -- --verify-harness",
  "cp -R output/playwright/morph output/playwright/morph-harness",
  "pnpm experiment:morph -- --fixture intentional-replacement",
  "pnpm experiment:morph -- --ci",
  "pnpm experiment:morph -- --qualify",
  "pnpm experiment:extraction -- --verify-harness",
]) {
  if (!action.includes(required)) throw new Error(`browser reference action missing: ${required}`);
}
for (const task of tasks) {
  if ((action.match(new RegExp(`(?:^|[ |)])${task}(?:[ |)])`, "gmu")) ?? []).length < 2) {
    throw new Error(`browser reference action does not close and dispatch task: ${task}`);
  }
  if ((workflow.match(new RegExp(`task: ${task}`, "gu")) ?? []).length !== 1) {
    throw new Error(`browser reference workflow must consume task once: ${task}`);
  }
}
if (
  (workflow.match(/uses: \.\/\.github\/actions\/browser-reference/gu) ?? []).length !== tasks.length ||
  workflow.includes("docker run --rm --ipc=host")
) {
  throw new Error("browser reference action must be the only workflow container-policy owner");
}

console.log(`browser reference contract passed (${tasks.length} closed tasks)`);
