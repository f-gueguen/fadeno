import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { MorphHarnessError } from "./harness-report.ts";
import { verifyAcceptedQualificationFailure } from "./qualification-decision.ts";
import { runMorphPreflight } from "./preflight.ts";
import { verifyQualificationReport } from "./qualification-report.ts";
import { publishQualificationEvidence } from "./qualification-result.ts";
import type { MorphQualificationProfile } from "./qualification-scenarios.ts";

const experimentRoot = dirname(fileURLToPath(import.meta.url));
const root = join(experimentRoot, "../..");
const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");
const configPath = join(experimentRoot, "playwright.config.ts");

function runGit(repositoryRoot: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    throw new MorphHarnessError(
      "FADENO_MORPH_SOURCE_GIT",
      `git ${args.join(" ")} failed: ${result.stderr || result.error?.message || result.status}`,
    );
  }
  return result.stdout.trim();
}

export function assertCleanMorphSource(
  repositoryRoot: string,
  expectedCommit?: string,
): string {
  const status = runGit(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status !== "") {
    throw new MorphHarnessError(
      "FADENO_MORPH_SOURCE_DIRTY",
      "qualification requires a clean tracked and untracked working tree",
    );
  }
  const commit = runGit(repositoryRoot, ["rev-parse", "HEAD"]);
  if (!/^[a-f0-9]{40}$/u.test(commit)) {
    throw new MorphHarnessError("FADENO_MORPH_SOURCE_COMMIT", "source commit is invalid");
  }
  if (expectedCommit && commit !== expectedCommit) {
    throw new MorphHarnessError(
      "FADENO_MORPH_SOURCE_CHANGED",
      "qualification source commit changed during execution",
    );
  }
  return commit;
}

function runIdentity(
  outputRoot: string,
  startedAt: string,
  sourceCommit: string,
): Readonly<{ id: string; attempt: number }> {
  const timestamp = `${startedAt.slice(0, 19).replaceAll("-", "").replaceAll(":", "")}Z`;
  const prefix = `${timestamp}-${sourceCommit.slice(0, 7)}-a`;
  const attempts = existsSync(outputRoot)
    ? readdirSync(outputRoot)
        .filter((entry) => entry.startsWith(prefix))
        .map((entry) => Number(entry.slice(prefix.length)))
        .filter((attempt) => Number.isInteger(attempt) && attempt > 0)
    : [];
  const attempt = attempts.length === 0 ? 1 : Math.max(...attempts) + 1;
  return { id: `${prefix}${attempt}`, attempt };
}

export async function executeMorphQualification(
  profile: MorphQualificationProfile,
): Promise<void> {
  const sourceCommit = assertCleanMorphSource(root);
  const preflight = await runMorphPreflight(root, {
    requireReference: profile === "qualification" || process.env.FADENO_EXPECT_REFERENCE === "1",
    maxReferenceWaitMilliseconds: Number(process.env.FADENO_PREFLIGHT_WAIT_MS) || 0,
  });
  const startedAt = new Date().toISOString();
  const outputRoot = join(root, "output/playwright/morph-qualification");
  mkdirSync(outputRoot, { recursive: true });
  const identity = runIdentity(outputRoot, startedAt, sourceCommit);
  const runDirectory = join(outputRoot, identity.id);
  mkdirSync(runDirectory, { recursive: false });
  writeFileSync(
    join(runDirectory, "preflight.json"),
    `${JSON.stringify(preflight, null, 2)}\n`,
  );

  const reportPath = join(runDirectory, "report.json");
  const childOutput = join(runDirectory, "playwright");
  const child = spawnSync(
    process.execPath,
    [playwrightCli, "test", "--config", configPath],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      env: {
        ...process.env,
        FADENO_MORPH_CHILD_OUTPUT: childOutput,
        FADENO_MORPH_PROFILE: profile,
        FADENO_MORPH_REPORT: reportPath,
      },
    },
  );
  process.stdout.write(child.stdout ?? "");
  process.stderr.write(child.stderr ?? "");
  if (child.signal || child.error) {
    throw new MorphHarnessError(
      "FADENO_MORPH_CHILD_PROCESS",
      `qualification child failed before reporting: ${child.signal ?? child.error?.message}`,
    );
  }
  const outcome = verifyQualificationReport(reportPath, {
    profile,
    outputRoot: childOutput,
  });
  if (
    (outcome.status === "passed" && child.status !== 0) ||
    (outcome.status === "failed" && child.status === 0)
  ) {
    throw new MorphHarnessError(
      "FADENO_MORPH_CHILD_EXIT",
      `qualification ${outcome.status} report disagrees with child exit ${child.status}`,
    );
  }
  assertCleanMorphSource(root, sourceCommit);
  const completedAt = new Date().toISOString();
  const published = publishQualificationEvidence({
    root,
    runDirectory,
    runId: identity.id,
    attempt: identity.attempt,
    profile,
    sourceCommit,
    startedAt,
    completedAt,
    preflight,
    outcome,
  });
  const evidence = [...outcome.passed, ...outcome.failed];
  console.log(
    `morph ${profile} completed with ${outcome.status} conclusion (${evidence.length} engines, run ${identity.id})`,
  );
  if (published.manifestPath) {
    console.log(`morph qualification manifest published (${published.manifestPath})`);
  }
  if (outcome.status === "failed") {
    verifyAcceptedQualificationFailure(root, outcome, profile);
    console.log("morph qualification failure matches the accepted narrow decision signature");
  }
}
