import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MORPH_QUALIFICATION_SCENARIOS } from "../experiments/morph/qualification-scenarios.ts";
import { RECONCILIATION_SCENARIOS } from "../examples/v1-app/scenarios/structural-reconciliation/scenario-data.ts";

const packageName = "@fadeno/framework";
const root = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = join(root, "packages/framework");
const scenarioRoot = join(root, "examples/v1-app/scenarios/structural-reconciliation");
const outputRoot = join(root, "output/v2-reconciliation");
const require = createRequire(import.meta.url);
const tsc = join(dirname(require.resolve("typescript/package.json")), "bin/tsc");

function run(command: string, arguments_: readonly string[], cwd: string): string {
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `FADENO_V2_RECONCILIATION_COMMAND:${command}:${result.status ?? result.signal}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return `${result.stdout}${result.stderr}`;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function rootChildren(markup: string): string {
  const match = /<main id="root" class="(?:before|after)">([\s\S]*)<\/main>$/u.exec(markup);
  if (!match?.[1]) throw new TypeError("FADENO_V2_RECONCILIATION_LOCKED_MARKUP");
  return match[1];
}

assert.deepEqual(
  RECONCILIATION_SCENARIOS.map((scenario) => ({
    id: scenario.id,
    state: scenario.state,
    operation: scenario.operation,
    targetIdentity: scenario.targetIdentity,
    currentChildren: scenario.currentChildren,
    incomingChildren: scenario.incomingChildren,
  })),
  MORPH_QUALIFICATION_SCENARIOS.map((scenario) => ({
    id: scenario.fixture.id,
    state: scenario.fixture.state,
    operation: scenario.fixture.operation,
    targetIdentity: scenario.fixture.targetIdentity,
    currentChildren: rootChildren(scenario.currentHtml),
    incomingChildren: rootChildren(scenario.patch.replacementHtml),
  })),
  "the V2 scenario must replay the exact locked K0 corpus",
);
assert.equal(RECONCILIATION_SCENARIOS.length, 18);
assert.deepEqual(
  readJson(join(scenarioRoot, "expected/success.json")),
  {
    schema: "fadeno.example.structural-reconciliation-success",
    version: 1,
    lockedCases: 18,
    operationModes: ["navigation", "action"],
    preservedStateCases: 15,
    documentScroll: "qualified-top-reset",
    elementScroll: "native-refusal",
    declaredReplacement: "private-control",
  },
  "the normalized success evidence must describe the exact qualified boundary",
);
assert.deepEqual(
  readdirSync(join(scenarioRoot, "expected")).sort(),
  [
    "correction-after.json",
    "correction-before.json",
    "flow.json",
    "recovery.json",
    "refusal-human.txt",
    "refusal.json",
    "success.json",
  ],
  "the permanent example must retain success, refusal, correction, flow, and recovery evidence",
);
const applicationSource = readFileSync(join(scenarioRoot, "application.ts"), "utf8");
const browserSource = readFileSync(join(scenarioRoot, "browser-entry.ts"), "utf8");
assert.match(applicationSource, /from "@fadeno\/framework"/u);
assert.match(applicationSource, /from "@fadeno\/framework\/jsx-runtime"/u);
assert.match(browserSource, /from "@fadeno\/framework\/browser"/u);
assert.doesNotMatch(`${applicationSource}\n${browserSource}`, /@fadeno\/framework\/internal/u);
const rootPackage = readJson(join(root, "package.json")) as {
  scripts?: Record<string, string>;
};
assert.match(
  rootPackage.scripts?.["check:v2-reconciliation"] ?? "",
  /experiments\/v2-reconciliation\/playwright\.config\.ts/u,
);
assert.match(
  rootPackage.scripts?.["check"] ?? "",
  /pnpm check:v2-reconciliation/u,
);

const temporaryRoot = mkdtempSync(join(tmpdir(), "fadeno-v2-reconciliation-"));
try {
  run("pnpm", ["--filter", packageName, "build"], root);
  const tarballs = join(temporaryRoot, "tarballs");
  mkdirSync(tarballs);
  run("pnpm", ["pack", "--pack-destination", tarballs], packageRoot);
  const tarball = readdirSync(tarballs).find((name) => name.endsWith(".tgz"));
  if (!tarball) throw new Error("FADENO_V2_RECONCILIATION_TARBALL");

  rmSync(outputRoot, { recursive: true, force: true });
  const builtConsumer = join(temporaryRoot, "consumer");
  mkdirSync(join(builtConsumer, "src"), { recursive: true });
  writeJson(join(builtConsumer, "package.json"), {
    name: "fadeno-v2-reconciliation-consumer",
    version: "0.0.0",
    private: true,
    type: "module",
    dependencies: { [packageName]: `file:${join(tarballs, tarball)}` },
  });
  writeJson(join(builtConsumer, "tsconfig.json"), {
    compilerOptions: {
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      module: "NodeNext",
      moduleResolution: "NodeNext",
      outDir: "dist",
      rootDir: "src",
      strict: true,
      types: [],
      verbatimModuleSyntax: true,
    },
    include: ["src/**/*.ts"],
  });
  for (const name of ["application.ts", "browser-entry.ts", "scenario-data.ts"]) {
    cpSync(join(scenarioRoot, name), join(builtConsumer, "src", name));
  }
  run("pnpm", ["install", "--offline", "--ignore-scripts"], builtConsumer);
  run(process.execPath, [tsc, "-p", "tsconfig.json"], builtConsumer);

  const consumer = join(outputRoot, "consumer");
  cpSync(builtConsumer, consumer, { recursive: true });
  const installed = join(builtConsumer, "node_modules", packageName);
  const retainedPackage = join(consumer, "node_modules", packageName);
  rmSync(retainedPackage, { recursive: true, force: true });
  cpSync(installed, retainedPackage, { recursive: true, dereference: true });

  const site = join(outputRoot, "site");
  mkdirSync(join(site, "_fadeno/framework"), { recursive: true });
  cpSync(join(installed, "dist"), join(site, "_fadeno/framework"), {
    recursive: true,
  });
  const entry = readFileSync(join(builtConsumer, "dist/browser-entry.js"), "utf8")
    .replace('from "@fadeno/framework/browser"', 'from "./framework/browser.js"');
  assert.equal(entry.includes(packageName), false);
  writeFileSync(join(site, "_fadeno/browser-entry.js"), entry);
  for (const name of [
    "success.json",
    "refusal.json",
    "refusal-human.txt",
    "correction-before.json",
    "correction-after.json",
    "flow.json",
    "recovery.json",
  ]) {
    cpSync(
      join(scenarioRoot, "expected", name),
      join(outputRoot, `expected-${name}`),
    );
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("V2 reconciliation packed example prepared (locked corpus, public browser facade, private mechanism)");
