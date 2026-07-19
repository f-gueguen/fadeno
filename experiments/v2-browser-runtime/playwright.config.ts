import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: join(root, "tests"),
  globalTeardown: join(root, "teardown.ts"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  outputDir: join(root, "../../output/playwright/v2-browser-runtime"),
  reporter: "line",
  use: {
    acceptDownloads: false,
    serviceWorkers: "block",
    viewport: { width: 1_280, height: 720 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: (["chromium", "firefox", "webkit"] as const).map((name) => ({ name, use: { browserName: name } })),
});
