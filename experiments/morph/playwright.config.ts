import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

const root = dirname(fileURLToPath(import.meta.url));
const outputRoot =
  process.env.FADENO_MORPH_CHILD_OUTPUT ?? join(root, "../../output/playwright/morph/child");

export default defineConfig({
  testDir: join(root, "tests"),
  testMatch: "harness.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  outputDir: outputRoot,
  reporter: [["line"], [join(root, "tests/machine-reporter.ts")]],
  use: {
    acceptDownloads: false,
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
