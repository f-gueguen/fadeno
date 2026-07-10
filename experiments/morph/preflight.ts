import { createRequire } from "node:module";
import { cpus, loadavg, platform, release, totalmem } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { statfsSync } from "node:fs";

import { chromium, firefox, webkit } from "@playwright/test";

import { loadReferenceEnvironment } from "../../scripts/lib/experiment-validation.ts";
import type { ReferenceEnvironment } from "../../scripts/lib/experiment-validation.ts";
import { MORPH_PROJECTS } from "./contract.ts";
import type { MorphProject } from "./contract.ts";
import { MorphHarnessError } from "./harness-report.ts";

const require = createRequire(import.meta.url);
const browserTypes = { chromium, firefox, webkit } satisfies Record<MorphProject, typeof chromium>;
type BrowserVersions = Record<MorphProject, string>;

export type ReferenceHostSnapshot = {
  provider: string;
  repositoryVisibility: string;
  runnerLabel: string;
  architecture: string;
  advertisedLogicalCpuCount: number | null;
  advertisedMemoryMiB: number | null;
  advertisedStorageMiB: number | null;
  freeStorageMiB: number;
  loadAverage1m: number;
  processCount: number | null;
  containerImage: string;
};

function integerEnvironment(name: string): number | null {
  const value = Number(process.env[name]);
  return Number.isInteger(value) ? value : null;
}

function processCount(): number | null {
  const result = spawnSync("ps", ["-A", "-o", "pid="], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim().split(/\n/u).filter(Boolean).length : null;
}

export function assertBrowserCompatibility(
  versions: BrowserVersions,
  reference: ReferenceEnvironment,
  packageVersion: string,
): void {
  const expected = {
    chromium: reference.browsers.chromeForTesting,
    firefox: reference.browsers.firefox,
    webkit: reference.browsers.webkit,
  };
  if (packageVersion !== reference.toolchain.playwright) {
    throw new MorphHarnessError(
      "FADENO_MORPH_PLAYWRIGHT_VERSION",
      `Playwright ${packageVersion} differs from ${reference.toolchain.playwright}`,
    );
  }
  for (const project of MORPH_PROJECTS) {
    const version = versions[project];
    if (version !== expected[project]) {
      throw new MorphHarnessError(
        "FADENO_MORPH_BROWSER_VERSION",
        `${project} ${version} differs from ${expected[project]}`,
      );
    }
  }
}

export function classifyReferenceHost(
  snapshot: ReferenceHostSnapshot,
  reference: ReferenceEnvironment,
): { classification: "reference" | "non-reference"; reasons: string[] } {
  const reasons: string[] = [];
  const expected = reference.host.minimumHardware;
  const checks: Array<readonly [boolean, string]> = [
    [snapshot.provider === reference.host.provider, "provider"],
    [snapshot.repositoryVisibility === reference.host.repositoryVisibility, "visibility"],
    [snapshot.runnerLabel === reference.host.runnerLabel, "runner-label"],
    [snapshot.architecture === reference.host.architecture, "architecture"],
    [snapshot.advertisedLogicalCpuCount === expected.logicalCpuCount, "cpu-advertisement"],
    [snapshot.advertisedMemoryMiB === expected.memoryMiB, "memory-advertisement"],
    [snapshot.advertisedStorageMiB === expected.storageMiB, "storage-advertisement"],
    [
      Number.isFinite(snapshot.freeStorageMiB) &&
        snapshot.freeStorageMiB >= reference.storage.minimumFreeMiB,
      "free-storage",
    ],
    [
      Number.isFinite(snapshot.loadAverage1m) &&
        snapshot.loadAverage1m <= reference.backgroundLoad.maxLoadAverage1m,
      "load-average",
    ],
    [
      Number.isInteger(snapshot.processCount) &&
        snapshot.processCount !== null &&
        snapshot.processCount <= reference.backgroundLoad.maxProcessCount,
      "process-count",
    ],
    [snapshot.containerImage === reference.container.runtimeImage, "container-image"],
  ];
  for (const [accepted, reason] of checks) if (!accepted) reasons.push(reason);
  return { classification: reasons.length === 0 ? "reference" : "non-reference", reasons };
}

export async function runMorphPreflight(
  root: string,
  options: { requireReference?: boolean; maxReferenceWaitMilliseconds?: number } = {},
) {
  const reference = loadReferenceEnvironment(root);
  const packageVersion = (require("@playwright/test/package.json") as { version: string })
    .version;
  const versions = {} as BrowserVersions;
  for (const name of MORPH_PROJECTS) {
    const browserType = browserTypes[name];
    let browser;
    try {
      browser = await browserType.launch({ headless: true });
      versions[name] = browser.version();
    } catch (error: unknown) {
      throw new MorphHarnessError(
        "FADENO_MORPH_BROWSER_LAUNCH",
        `${name} failed to launch: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await browser?.close();
    }
  }
  assertBrowserCompatibility(versions, reference, packageVersion);

  const sampleHost = () => {
    const filesystem = statfsSync(root);
    return {
      provider: process.env.GITHUB_ACTIONS === "true" ? "github-actions" : "local",
      repositoryVisibility: process.env.FADENO_REPOSITORY_VISIBILITY ?? "unknown",
      runnerLabel: process.env.FADENO_RUNNER_LABEL ?? "local",
      runnerImageVersion: process.env.ImageVersion ?? "unknown",
      runnerProvisionerVersion: process.env.Runner_Provisioner ?? "unknown",
      operatingSystemVersion: process.env.ImageOS ?? platform(),
      kernelVersion: release(),
      architecture: process.arch === "x64" ? "x64" : process.arch,
      cpuModel: cpus()[0]?.model ?? "unknown",
      observedLogicalCpuCount: cpus().length,
      observedMemoryMiB: Math.floor(totalmem() / 1024 / 1024),
      advertisedLogicalCpuCount: integerEnvironment("FADENO_ADVERTISED_LOGICAL_CPU"),
      advertisedMemoryMiB: integerEnvironment("FADENO_ADVERTISED_MEMORY_MIB"),
      advertisedStorageMiB: integerEnvironment("FADENO_ADVERTISED_STORAGE_MIB"),
      freeStorageMiB: Math.floor((filesystem.bavail * filesystem.bsize) / 1024 / 1024),
      loadAverage1m: loadavg()[0] ?? Number.POSITIVE_INFINITY,
      processCount: processCount(),
      containerImage: process.env.FADENO_CONTAINER_IMAGE ?? "none",
    } satisfies ReferenceHostSnapshot & Record<string, unknown>;
  };
  const deadline = Date.now() + (options.maxReferenceWaitMilliseconds ?? 0);
  let host = sampleHost();
  let classification = classifyReferenceHost(host, reference);
  while (
    options.requireReference &&
    classification.classification !== "reference" &&
    classification.reasons.every((reason) =>
      ["load-average", "process-count"].includes(reason),
    ) &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    host = sampleHost();
    classification = classifyReferenceHost(host, reference);
  }
  if (options.requireReference && classification.classification !== "reference") {
    throw new MorphHarnessError(
      "FADENO_MORPH_NON_REFERENCE",
      `reference preflight failed: ${classification.reasons.join(",")} (load=${host.loadAverage1m}, processes=${host.processCount})`,
    );
  }
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    packageVersion,
    browsers: versions,
    host,
    ...classification,
  };
}
