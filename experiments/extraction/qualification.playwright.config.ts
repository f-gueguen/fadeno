import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

import { EXTRACTION_PROJECTS } from "./contract.ts";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: join(root, "tests"),
  testMatch: "qualification.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  outputDir: process.env.FADENO_EXTRACTION_QUALIFICATION_RUNNER_OUTPUT ??
    join(root, "../../output/playwright/extraction-qualification-runner"),
  reporter: [[join(root, "qualification-reporter.ts")]],
  use: { serviceWorkers: "block", screenshot: "off", trace: "off", video: "off" },
  projects: EXTRACTION_PROJECTS.map((name) => ({ name, use: { browserName: name } })),
});
