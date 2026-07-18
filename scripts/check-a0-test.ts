import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const root = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = join(root, "packages/framework");
const scenario = join(root, "examples/v1-app/scenarios/application-test/expected");

function run(command: string, arguments_: readonly string[], cwd: string): CommandResult {
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return Object.freeze({ status: result.status, stdout: result.stdout, stderr: result.stderr });
}

function requireSuccess(command: string, arguments_: readonly string[], cwd: string): CommandResult {
  const result = run(command, arguments_, cwd);
  if (result.status !== 0) {
    throw new Error(`FADENO_A0_TEST_COMMAND:${command}:${result.status ?? "signal"}\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function normalize(output: string, project: string): string {
  return output
    .replaceAll(project, "<PROJECT_ROOT>")
    .replaceAll(project.replaceAll("/", "\\"), "<PROJECT_ROOT>")
    .replace(/\(\d+(?:\.\d+)?ms\)/gu, "(<DURATION>)")
    .replace(/duration_ms: \d+(?:\.\d+)?/gu, "duration_ms: <DURATION>")
    .replace(/duration_ms \d+(?:\.\d+)?/gu, "duration_ms <DURATION>")
    .replace(/# duration_ms \d+(?:\.\d+)?/gu, "# duration_ms <DURATION>")
    .replace(/node:internal\/test_runner\/[a-z_]+:\d+:\d+/gu, "node:internal/test_runner/<LOCATION>")
    .replace(/^ +$/gmu, "");
}

function expected(name: string): string {
  return readFileSync(join(scenario, name), "utf8");
}

function expectedJson(name: string): unknown {
  return JSON.parse(expected(name));
}

function humanDiagnostic(output: string, project: string): string {
  const normalized = normalize(output, project);
  const lines = [
    "✖ renders the application document through the production renderer (<DURATION>)",
    "AssertionError [ERR_ASSERTION]: The input did not match the regular expression /A heading that does not exist/u.",
    "expected: /A heading that does not exist/u",
    "operator: 'match'",
    "[ELIFECYCLE] Test failed. See above for more details.",
  ];
  for (const line of lines) assert.equal(normalized.includes(line), true, normalized);
  return `${lines.join("\n")}\n`;
}

const temporaryRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "fadeno-a0-test-packed-")));
try {
  requireSuccess("pnpm", ["--filter", "@fadeno/framework", "build"], root);
  const tarballs = join(temporaryRoot, "tarballs");
  mkdirSync(tarballs);
  requireSuccess("pnpm", ["pack", "--pack-destination", tarballs], packageRoot);
  const tarballName = readdirSync(tarballs).find((name) => name.endsWith(".tgz"));
  if (!tarballName) throw new Error("FADENO_A0_TEST_TARBALL");
  const tarball = join(tarballs, tarballName);

  const runner = join(temporaryRoot, "runner");
  mkdirSync(runner);
  writeFileSync(join(runner, "package.json"), `${JSON.stringify({
    private: true,
    dependencies: { "@fadeno/framework": `file:${tarball}` },
  }, null, 2)}\n`);
  requireSuccess("pnpm", ["install", "--offline", "--ignore-scripts"], runner);
  const executable = join(runner, "node_modules/.bin/fadeno");
  const project = join(runner, "my-fadeno-app");
  requireSuccess(executable, ["create", "--project-root", "my-fadeno-app"], runner);

  const manifestPath = join(project, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { dependencies: Record<string, string> };
  manifest.dependencies["@fadeno/framework"] = `file:${tarball}`;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  requireSuccess("pnpm", ["install", "--offline", "--ignore-scripts"], project);

  const success = requireSuccess("pnpm", ["test"], project);
  assert.equal(normalize(`${success.stdout}${success.stderr}`, project), expected("success.txt"));

  const testPath = join(project, "test/application.test.tsx");
  const acceptedTest = readFileSync(testPath, "utf8");
  const refusedAssertion = "/A heading that does not exist/u";
  const failingTest = acceptedTest.replace("/Your Fadeno application is running/u", refusedAssertion);
  assert.notEqual(failingTest, acceptedTest);
  writeFileSync(testPath, failingTest);

  const failure = run("pnpm", ["test"], project);
  assert.equal(failure.status, 1);
  assert.equal(humanDiagnostic(`${failure.stdout}${failure.stderr}`, project), expected("diagnostic-human.txt"));
  assert.deepEqual({
    command: "pnpm test",
    exitCode: failure.status,
    source: "test/application.test.tsx",
    assertion: refusedAssertion,
    diagnostic: "ERR_ASSERTION",
  }, expectedJson("diagnostic.json"));

  const tap = run(process.execPath, ["--test", "--test-reporter=tap", ".fadeno/test/test/application.test.js"], project);
  assert.equal(tap.status, 1);
  assert.equal(normalize(`${tap.stdout}${tap.stderr}`, project), expected("diagnostic.tap"));
  assert.deepEqual({
    source: "test/application.test.tsx",
    before: refusedAssertion,
    accepted: false,
    diagnostic: "ERR_ASSERTION",
  }, expectedJson("correction-before.json"));

  const staleCanary = join(project, ".fadeno/test/stale-canary.js");
  writeFileSync(staleCanary, "throw new Error('stale test output executed');\n");
  writeFileSync(testPath, acceptedTest);
  const recovery = requireSuccess("pnpm", ["test"], project);
  const recoveryOutput = normalize(`${recovery.stdout}${recovery.stderr}`, project);
  assert.equal(recoveryOutput, expected("success.txt"));
  assert.equal(existsSync(staleCanary), false);
  assert.deepEqual({
    source: "test/application.test.tsx",
    after: "/Your Fadeno application is running/u",
    accepted: true,
    diagnostic: null,
  }, expectedJson("correction-after.json"));
  assert.deepEqual({
    failure: { exitCode: failure.status, diagnostic: "ERR_ASSERTION" },
    recovery: {
      exitCode: recovery.status,
      staleDiagnosticPresent: recoveryOutput.includes("ERR_ASSERTION"),
      staleOutputPresent: existsSync(staleCanary),
      testCount: 3,
    },
  }, expectedJson("recovery.json"));

  assert.deepEqual({
    operation: "pnpm test",
    causes: [
      "typed application and test sources compiled with stock TypeScript",
      "production renderRoute executed the application page and not-found page",
      "production Handler executed the stylesheet response",
    ],
    ownership: {
      source: ["src", "test/application.test.tsx", "tsconfig.test.json"],
      disposableOutput: ".fadeno/test",
      productionOutput: "excluded",
    },
    skippedWork: [
      "framework test runtime",
      "public test helper",
      "private package import",
      "public analyzer schema",
    ],
    outcome: { success: true, deliberateFailure: "ERR_ASSERTION", recovery: true, tests: 3 },
  }, expectedJson("flow.json"));

  console.log("A0 packed application test passed (render, handler, failure, TAP, correction, stale-output recovery)");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
