import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: join(root, "tests"),
  fullyParallel: true,
  globalTeardown: join(root, "teardown.ts"),
  outputDir: join(root, "../../output/playwright/v2-link-navigation"),
  reporter: "line",
  workers: 2,
  timeout: 30_000,
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
