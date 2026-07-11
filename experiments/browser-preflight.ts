import { createRequire } from "node:module";
import { cpus, loadavg, platform, release, totalmem } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { statfsSync } from "node:fs";

import { chromium, firefox, webkit } from "@playwright/test";

import { loadReferenceEnvironment } from "../scripts/lib/experiment-validation.ts";
import type { ReferenceEnvironment } from "../scripts/lib/experiment-validation.ts";

export const BROWSER_PREFLIGHT_PROJECTS = ["chromium", "firefox", "webkit"] as const;
export type BrowserPreflightProject = (typeof BROWSER_PREFLIGHT_PROJECTS)[number];

export class BrowserPreflightError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BrowserPreflightError";
    this.code = code;
  }
}

type ErrorFactory = (code: string, message: string) => Error;
const defaultErrorFactory: ErrorFactory = (code, message) =>
  new BrowserPreflightError(code, message);

const require = createRequire(import.meta.url);
const browserTypes = { chromium, firefox, webkit } satisfies Record<
  BrowserPreflightProject,
  typeof chromium
>;
export type BrowserVersions = Record<BrowserPreflightProject, string>;

export type ReferenceObservation = {
  host: {
    provider: string;
    repositoryVisibility: string;
    runnerLabel: string;
    runnerImageVersion: string;
    runnerName: string;
    operatingSystemVersion: string;
    kernelVersion: string;
    architecture: string;
    cpuModel: string;
    observedLogicalCpuCount: number;
    observedMemoryMiB: number;
    advertisedLogicalCpuCount: number | null;
    advertisedMemoryMiB: number | null;
    advertisedStorageMiB: number | null;
    freeStorageMiB: number;
    loadAverage1m: number;
    processCount: number | null;
  };
  container: {
    runtimeImage: string;
    platform: string;
    platformDigest: string;
    configDigest: string;
  };
  toolchain: {
    node: string;
    pnpm: string;
    playwright: string;
  };
  browsers: BrowserVersions;
};

export type BrowserPreflightResult = Readonly<ReferenceObservation & {
  schemaVersion: 1;
  observedAt: string;
  classification: "reference" | "non-reference";
  reasons: readonly string[];
}>;

export function browserManifestEnvironment(
  preflight: BrowserPreflightResult,
  reference: ReferenceEnvironment,
) {
  const host = preflight.host;
  return {
    referenceId: reference.id,
    referenceClass: preflight.classification,
    host: {
      provider: host.provider,
      repositoryVisibility: host.repositoryVisibility,
      runnerLabel: host.runnerLabel,
      runnerImage: host.runnerLabel,
      runnerImageVersion: host.runnerImageVersion,
      runnerName: host.runnerName,
      operatingSystemVersion: host.operatingSystemVersion,
      kernelVersion: host.kernelVersion,
      architecture: host.architecture,
      cpuModel: host.cpuModel,
      logicalCpuCount: host.advertisedLogicalCpuCount ?? host.observedLogicalCpuCount,
      memoryMiB: host.advertisedMemoryMiB ?? host.observedMemoryMiB,
      advertisedStorageMiB: host.advertisedStorageMiB ?? reference.host.minimumHardware.storageMiB,
      freeStorageMiB: host.freeStorageMiB,
    },
    container: {
      image: preflight.container.runtimeImage,
      indexDigest: reference.container.indexDigest,
      platform: preflight.container.platform,
      platformDigest: preflight.container.platformDigest,
      configDigest: preflight.container.configDigest,
      executionUser: reference.container.executionUser,
      browserSandbox: reference.container.browserSandbox,
      networkPolicy: reference.container.networkPolicy,
    },
    toolchain: preflight.toolchain,
    browsers: {
      chromeForTesting: preflight.browsers.chromium,
      firefox: preflight.browsers.firefox,
      webkit: preflight.browsers.webkit,
    },
    power: { policy: reference.power.policy, telemetry: reference.power.telemetry },
    backgroundLoad: {
      preflightObservedAt: preflight.observedAt,
      loadAverage1m: host.loadAverage1m,
      processCount: host.processCount,
      accepted: preflight.classification === "reference",
      reason: preflight.classification === "reference"
        ? reference.backgroundLoad.acceptanceReason
        : `non-reference:${preflight.reasons.join(",") || "host"}`,
    },
  };
}

function integerEnvironment(name: string): number | null {
  const value = Number(process.env[name]);
  return Number.isInteger(value) ? value : null;
}

function processCount(): number | null {
  const result = spawnSync("ps", ["-A", "-o", "pid="], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim().split(/\n/u).filter(Boolean).length : null;
}

function commandVersion(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim() !== "" ? result.stdout.trim() : "unknown";
}

export function assertBrowserCompatibility(
  versions: BrowserVersions,
  reference: ReferenceEnvironment,
  packageVersion: string,
  createError: ErrorFactory = defaultErrorFactory,
): void {
  const expected = {
    chromium: reference.browsers.chromeForTesting,
    firefox: reference.browsers.firefox,
    webkit: reference.browsers.webkit,
  };
  if (packageVersion !== reference.toolchain.playwright) {
    throw createError(
      "FADENO_BROWSER_PREFLIGHT_PLAYWRIGHT_VERSION",
      `Playwright ${packageVersion} differs from ${reference.toolchain.playwright}`,
    );
  }
  for (const project of BROWSER_PREFLIGHT_PROJECTS) {
    const version = versions[project];
    if (version !== expected[project]) {
      throw createError(
        "FADENO_BROWSER_PREFLIGHT_BROWSER_VERSION",
        `${project} ${version} differs from ${expected[project]}`,
      );
    }
  }
}

export function classifyReferenceHost(
  observation: ReferenceObservation,
  reference: ReferenceEnvironment,
): { classification: "reference" | "non-reference"; reasons: string[] } {
  const { host, container, toolchain, browsers } = observation;
  const reasons: string[] = [];
  const expected = reference.host.minimumHardware;
  const observedFields: Record<string, unknown> = {
    "host.runnerImageVersion": host.runnerImageVersion,
    "host.runnerName": host.runnerName,
    "host.operatingSystemVersion": host.operatingSystemVersion,
    "host.kernelVersion": host.kernelVersion,
    "host.cpuModel": host.cpuModel,
    "host.logicalCpuCount": host.observedLogicalCpuCount,
    "host.memoryMiB": host.observedMemoryMiB,
    "host.advertisedStorageMiB": host.advertisedStorageMiB,
    "host.freeStorageMiB": host.freeStorageMiB,
    "backgroundLoad.loadAverage1m": host.loadAverage1m,
    "backgroundLoad.processCount": host.processCount,
    "container.platformDigest": container.platformDigest,
    "container.configDigest": container.configDigest,
    "toolchain.node": toolchain.node,
    "toolchain.pnpm": toolchain.pnpm,
    "toolchain.playwright": toolchain.playwright,
    "browsers.chromeForTesting": browsers.chromium,
    "browsers.firefox": browsers.firefox,
    "browsers.webkit": browsers.webkit,
  };
  for (const field of reference.preflight.requiredObservedFields) {
    const value = observedFields[field];
    if (
      value === undefined ||
      value === null ||
      value === "" ||
      value === "unknown" ||
      (typeof value === "number" && !Number.isFinite(value))
    ) {
      reasons.push(`missing:${field}`);
    }
  }
  const checks: Array<readonly [boolean, string]> = [
    [host.provider === reference.host.provider, "provider"],
    [host.repositoryVisibility === reference.host.repositoryVisibility, "visibility"],
    [host.runnerLabel === reference.host.runnerLabel, "runner-label"],
    [host.architecture === reference.host.architecture, "architecture"],
    [host.observedLogicalCpuCount >= expected.logicalCpuCount, "observed-cpu"],
    [host.observedMemoryMiB >= Math.floor(expected.memoryMiB * 0.95), "observed-memory"],
    [host.advertisedLogicalCpuCount === expected.logicalCpuCount, "cpu-advertisement"],
    [host.advertisedMemoryMiB === expected.memoryMiB, "memory-advertisement"],
    [host.advertisedStorageMiB === expected.storageMiB, "storage-advertisement"],
    [
      Number.isFinite(host.freeStorageMiB) &&
        host.freeStorageMiB >= reference.storage.minimumFreeMiB,
      "free-storage",
    ],
    [
      Number.isFinite(host.loadAverage1m) &&
        host.loadAverage1m <= reference.backgroundLoad.maxLoadAverage1m,
      "load-average",
    ],
    [
      Number.isInteger(host.processCount) &&
        host.processCount !== null &&
        host.processCount <= reference.backgroundLoad.maxProcessCount,
      "process-count",
    ],
    [container.runtimeImage === reference.container.runtimeImage, "container-image"],
    [container.platform === reference.container.platform, "container-platform"],
    [container.platformDigest === reference.container.platformDigest, "container-platform-digest"],
    [container.configDigest === reference.container.configDigest, "container-config-digest"],
    [toolchain.node === reference.toolchain.node, "node-version"],
    [toolchain.pnpm === reference.toolchain.pnpm, "pnpm-version"],
    [toolchain.playwright === reference.toolchain.playwright, "playwright-version"],
    [browsers.chromium === reference.browsers.chromeForTesting, "chromium-version"],
    [browsers.firefox === reference.browsers.firefox, "firefox-version"],
    [browsers.webkit === reference.browsers.webkit, "webkit-version"],
  ];
  for (const [accepted, reason] of checks) if (!accepted) reasons.push(reason);
  return { classification: reasons.length === 0 ? "reference" : "non-reference", reasons };
}

export async function runBrowserPreflight(
  root: string,
  options: {
    requireReference?: boolean;
    maxReferenceWaitMilliseconds?: number;
    createError?: ErrorFactory;
  } = {},
) {
  const createError = options.createError ?? defaultErrorFactory;
  const reference = loadReferenceEnvironment(root);
  const packageVersion = (require("@playwright/test/package.json") as { version: string })
    .version;
  const versions = {} as BrowserVersions;
  for (const name of BROWSER_PREFLIGHT_PROJECTS) {
    const browserType = browserTypes[name];
    let browser;
    try {
      browser = await browserType.launch({ headless: true });
      versions[name] = browser.version();
    } catch (error: unknown) {
      throw createError(
        "FADENO_BROWSER_PREFLIGHT_BROWSER_LAUNCH",
        `${name} failed to launch: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await browser?.close();
    }
  }
  assertBrowserCompatibility(versions, reference, packageVersion, createError);

  const immutableObservation = {
    container: {
      runtimeImage: process.env.FADENO_CONTAINER_IMAGE ?? "unknown",
      platform: process.env.FADENO_CONTAINER_PLATFORM ?? "unknown",
      platformDigest: process.env.FADENO_CONTAINER_PLATFORM_DIGEST ?? "unknown",
      configDigest: process.env.FADENO_CONTAINER_CONFIG_DIGEST ?? "unknown",
    },
    toolchain: {
      node: process.versions.node,
      pnpm: commandVersion("pnpm", ["--version"]),
      playwright: packageVersion,
    },
    browsers: versions,
  } as const;
  const sampleObservation = (): ReferenceObservation => {
    const filesystem = statfsSync(root);
    return {
      host: {
        provider: process.env.GITHUB_ACTIONS === "true" ? "github-actions" : "local",
        repositoryVisibility: process.env.FADENO_REPOSITORY_VISIBILITY ?? "unknown",
        runnerLabel: process.env.FADENO_RUNNER_LABEL ?? "local",
        runnerImageVersion: process.env.FADENO_RUNNER_IMAGE_VERSION ?? "unknown",
        runnerName: process.env.FADENO_RUNNER_NAME ?? "unknown",
        operatingSystemVersion: process.env.FADENO_OPERATING_SYSTEM_VERSION ?? platform(),
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
      },
      ...immutableObservation,
    };
  };
  const deadline = Date.now() + (options.maxReferenceWaitMilliseconds ?? 0);
  let observation = sampleObservation();
  let classification = classifyReferenceHost(observation, reference);
  while (
    options.requireReference &&
    classification.classification !== "reference" &&
    classification.reasons.every((reason) =>
      ["load-average", "process-count"].includes(reason),
    ) &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    observation = sampleObservation();
    classification = classifyReferenceHost(observation, reference);
  }
  if (options.requireReference && classification.classification !== "reference") {
    throw createError(
      "FADENO_BROWSER_PREFLIGHT_NON_REFERENCE",
      `reference preflight failed: ${classification.reasons.join(",")} (load=${observation.host.loadAverage1m}, processes=${observation.host.processCount})`,
    );
  }
  return {
    schemaVersion: 1 as const,
    observedAt: new Date().toISOString(),
    ...observation,
    ...classification,
  };
}
