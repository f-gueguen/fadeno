import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

const root = dirname(fileURLToPath(import.meta.url));
const freshWebkitWorker = /@fresh-webkit-worker/u;

export default defineConfig({
  testDir: join(root, "tests"),
  fullyParallel: false,
  globalTeardown: join(root, "teardown.ts"),
  outputDir: join(root, "../../output/playwright/v2-form-submission"),
  reporter: "line",
  workers: 1,
  timeout: 30_000,
  use: { ignoreHTTPSErrors: true, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    {
      name: "webkit",
      grepInvert: freshWebkitWorker,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "webkit-fresh",
      grep: freshWebkitWorker,
      use: { ...devices["Desktop Safari"] },
    },
  ],
});
