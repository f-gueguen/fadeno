import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { fileURLToPath } from "node:url";

import { getMorphFixture } from "./fixtures/catalog.ts";
import type { MorphFixture } from "./fixtures/catalog.ts";
import { MorphHarnessError, verifyHarnessReport } from "./harness-report.ts";
import { runMorphPreflight } from "./preflight.ts";

const experimentRoot = dirname(fileURLToPath(import.meta.url));
const root = join(experimentRoot, "../..");
const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");
const configPath = join(experimentRoot, "playwright.config.ts");

type ChildRun = SpawnSyncReturns<string> & {
  reportPath: string;
  childOutput: string;
};

function runChild(fixtureId: string, directory: string): ChildRun {
  const reportPath = join(directory, "report.json");
  const childOutput = join(directory, "test-results");
  mkdirSync(directory, { recursive: true });
  const result = spawnSync(process.execPath, [playwrightCli, "test", "--config", configPath], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      FADENO_MORPH_CHILD_OUTPUT: childOutput,
      FADENO_MORPH_FIXTURE: fixtureId,
      FADENO_MORPH_REPORT: reportPath,
    },
  });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.signal || result.error) {
    throw new MorphHarnessError(
      "FADENO_MORPH_CHILD_PROCESS",
      `child failed before reporting: ${result.signal ?? result.error?.message}`,
    );
  }
  return { ...result, reportPath, childOutput };
}

function verifyChild(
  child: ChildRun,
  fixture: MorphFixture,
  expectedStatus: "passed" | "failed",
  expectedExit: number,
): void {
  if (child.status !== expectedExit) {
    throw new MorphHarnessError(
      "FADENO_MORPH_CHILD_EXIT",
      `${fixture.id}: expected exit ${expectedExit}, received ${child.status}`,
    );
  }
  verifyHarnessReport(child.reportPath, {
    fixture,
    expected: expectedStatus,
    outputRoot: child.childOutput,
  });
}

export async function executeMorphHarness(mode: "default" | "verify"): Promise<void> {
  const outputRoot =
    process.env.FADENO_MORPH_OUTPUT_ROOT ?? join(root, "output/playwright/morph");
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });

  const preflight = await runMorphPreflight(root, {
    requireReference: process.env.FADENO_EXPECT_REFERENCE === "1",
  });
  writeFileSync(join(outputRoot, "preflight.json"), `${JSON.stringify(preflight, null, 2)}\n`);
  console.log(
    `morph preflight passed (${preflight.classification}; ${Object.entries(preflight.browsers)
      .map(([name, version]) => `${name}=${version}`)
      .join(", ")})`,
  );

  const passing = getMorphFixture("seeded-preservation-control");
  const passingChild = runChild(passing.id, join(outputRoot, "passing-control"));
  verifyChild(passingChild, passing, "passed", 0);

  if (mode === "default") {
    console.log("morph harness passed (3 engines, passing control)");
    return;
  }

  const seededFailure = getMorphFixture("seeded-undeclared-state-loss");
  const failingChild = runChild(
    seededFailure.id,
    join(outputRoot, "seeded-failure"),
  );
  verifyChild(failingChild, seededFailure, "failed", 1);
  console.log("morph harness integrity verified (3 passes, 3 intended failures)");
}
