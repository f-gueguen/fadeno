import { writeFileSync } from "node:fs";

import type { TestInfo } from "@playwright/test";

export async function attachJson(
  testInfo: TestInfo,
  name: string,
  value: unknown,
): Promise<void> {
  const path = testInfo.outputPath(`${name}.json`);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  await testInfo.attach(name, { path, contentType: "application/json" });
}
