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
): void {
  if (child.status !== fixture.expectedExitCode) {
    throw new MorphHarnessError(
      "FADENO_MORPH_CHILD_EXIT",
      `${fixture.id}: expected exit ${fixture.expectedExitCode}, received ${child.status}`,
    );
  }
  verifyHarnessReport(child.reportPath, {
    fixture,
    outputRoot: child.childOutput,
  });
}

export async function executeMorphHarness(
  mode: "default" | "verify" | "intentional-replacement",
): Promise<void> {
  const outputRoot = join(root, "output/playwright/morph");
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });

  const runAndRecordPreflight = async (name: string) => {
    let preflight: Awaited<ReturnType<typeof runMorphPreflight>>;
    try {
      preflight = await runMorphPreflight(root, {
        requireReference: process.env.FADENO_EXPECT_REFERENCE === "1",
        maxReferenceWaitMilliseconds:
          Number(process.env.FADENO_PREFLIGHT_WAIT_MS) || 0,
      });
    } catch (error: unknown) {
      writeFileSync(
        join(outputRoot, `${name}-error.json`),
        `${JSON.stringify({
          schemaVersion: 1,
          code: error instanceof Error && "code" in error ? String(error.code) : "FADENO_MORPH_INTERNAL",
          message: error instanceof Error ? error.message : String(error),
        }, null, 2)}\n`,
      );
      throw error;
    }
    writeFileSync(join(outputRoot, `${name}.json`), `${JSON.stringify(preflight, null, 2)}\n`);
    console.log(
      `morph preflight passed (${preflight.classification}; ${Object.entries(preflight.browsers)
        .map(([browser, version]) => `${browser}=${version}`)
        .join(", ")})`,
    );
  };

  const runBatch = async (
    preflightName: string,
    fixtureId: string,
    directoryName: string,
  ): Promise<void> => {
    await runAndRecordPreflight(preflightName);
    const fixture = getMorphFixture(fixtureId);
    const child = runChild(fixture.id, join(outputRoot, directoryName));
    verifyChild(child, fixture);
  };

  if (mode === "intentional-replacement") {
    await runBatch(
      "preflight-intentional-replacement",
      "intentional-replacement",
      "intentional-replacement",
    );
    console.log("private morph candidate passed (3 engines, reuse and declared replacement)");
    return;
  }

  await runBatch(
    "preflight",
    "seeded-preservation-control",
    "passing-control",
  );

  if (mode === "default") {
    console.log("morph harness passed (3 engines, passing control)");
    return;
  }

  await runBatch(
    "preflight-seeded-failure",
    "seeded-undeclared-state-loss",
    "seeded-failure",
  );
  console.log("morph harness integrity verified (3 passes, 3 intended failures)");
}
