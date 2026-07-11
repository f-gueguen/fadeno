import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { EXTRACTION_PROJECTS } from "./contract.ts";

const root = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  testDir: join(root, "tests"),
  testMatch: "accepted.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  outputDir: process.env.FADENO_EXTRACTION_OUTPUT ?? join(root, "../../output/playwright/extraction"),
  reporter: "line",
  use: { serviceWorkers: "block", screenshot: "off", trace: "off", video: "off" },
  projects: EXTRACTION_PROJECTS.map((name) => ({ name, use: { browserName: name } })),
});
