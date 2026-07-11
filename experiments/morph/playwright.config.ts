import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";
import { MORPH_PROJECTS } from "./contract.ts";

const root = dirname(fileURLToPath(import.meta.url));
const outputRoot =
  process.env.FADENO_MORPH_CHILD_OUTPUT ?? join(root, "../../output/playwright/morph/child");
const fixtureId = process.env.FADENO_MORPH_FIXTURE ?? "seeded-preservation-control";
const qualificationProfile = process.env.FADENO_MORPH_PROFILE;

export default defineConfig({
  testDir: join(root, "tests"),
  testMatch: qualificationProfile
    ? "qualification.spec.ts"
    : fixtureId === "intentional-replacement"
      ? "candidate.spec.ts"
      : "harness.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: qualificationProfile === "qualification" ? 15 * 60_000 : qualificationProfile ? 5 * 60_000 : 30_000,
  expect: { timeout: 5_000 },
  outputDir: outputRoot,
  reporter: [["line"], [join(root, "tests/machine-reporter.ts")]],
  use: {
    acceptDownloads: false,
    serviceWorkers: "block",
    viewport: { width: 1_280, height: 720 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: MORPH_PROJECTS.map((name) => ({ name, use: { browserName: name } })),
});
