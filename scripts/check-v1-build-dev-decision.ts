import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  assertPrivateBuildCompilerContract,
  assertPrivateRuntimeIdentity,
  capturePrivateEnvironment,
  capturePrivateRuntimeIdentity,
  parsePrivateBuildDevArguments,
  parsePrivateEnvironmentFile,
  PrivateDevelopmentDecisionModel,
} from "../packages/framework/src/internal/build-dev-decision.ts";

function validCompilerDocument(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    compilerOptions: Object.freeze({
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      rootDir: ".",
      outDir: "dist",
      jsx: "react-jsx",
      jsxImportSource: "fadeno-framework-internal",
      allowImportingTsExtensions: true,
      rewriteRelativeImportExtensions: true,
      isolatedModules: true,
      strict: true,
    }),
    include: Object.freeze(["src/**/*.ts", "src/**/*.tsx"]),
  });
}

function compilerMutation(name: string, value: unknown): Readonly<Record<string, unknown>> {
  const valid = validCompilerDocument();
  return {
    ...valid,
    compilerOptions: { ...(valid["compilerOptions"] as Record<string, unknown>), [name]: value },
  };
}

const commandRoot = resolve("decision-project");
assert.deepEqual(parsePrivateBuildDevArguments(["build", "--project-root", "decision-project"], process.cwd()), {
  command: "build",
  projectRoot: commandRoot,
});
assert.deepEqual(parsePrivateBuildDevArguments([
  "dev", "--port", "4173", "--project-root", "decision-project",
], process.cwd()), { command: "dev", projectRoot: commandRoot, port: 4_173 });
for (const invalid of [
  [] as string[],
  ["build"],
  ["build", "--project-root", "decision-project", "--port", "4173"],
  ["build", "--project-root", "a", "--project-root", "b"],
  ["dev", "--project-root", "decision-project"],
  ["dev", "--project-root", "decision-project", "--port", "0"],
  ["dev", "--project-root", "decision-project", "--port", "65536"],
  ["dev", "--project-root", "decision-project", "--port", "04173"],
  ["dev", "--project-root", "decision-project", "--port", "4173", "--unknown"],
]) assert.equal(parsePrivateBuildDevArguments(invalid, process.cwd()), null, invalid.join(" "));

assert.doesNotThrow(() => { assertPrivateBuildCompilerContract(validCompilerDocument()); });
for (const [name, value] of [
  ["target", "ES2021"],
  ["module", "ESNext"],
  ["rootDir", "src"],
  ["outDir", ".fadeno/output"],
  ["jsxImportSource", "other"],
  ["allowImportingTsExtensions", false],
  ["paths", { "@/*": ["src/*"] }],
  ["composite", true],
  ["declaration", true],
  ["incremental", true],
  ["noEmit", true],
  ["sourceMap", true],
] as const) assert.throws(() => { assertPrivateBuildCompilerContract(compilerMutation(name, value)); }, /FADENO_BUILD_TSCONFIG/u);
assert.throws(() => { assertPrivateBuildCompilerContract({ ...validCompilerDocument(), extends: "./base.json" }); }, /FADENO_BUILD_TSCONFIG/u);
assert.throws(() => { assertPrivateBuildCompilerContract({ ...validCompilerDocument(), references: [] }); }, /FADENO_BUILD_TSCONFIG/u);

const temporaryRoot = mkdtempSync(join(tmpdir(), "fadeno-v1-build-dev-decision-"));
const packageRoot = join(temporaryRoot, "package");
const projectRoot = join(temporaryRoot, "project");
const externalRoot = join(temporaryRoot, "external");
try {
  mkdirSync(join(packageRoot, "dist"), { recursive: true });
  mkdirSync(projectRoot);
  mkdirSync(externalRoot);
  writeFileSync(join(packageRoot, "package.json"), "{\"name\":\"decision-package\"}\n");
  writeFileSync(join(packageRoot, "dist/runtime.js"), "export const generation = 1;\n");
  const identity = capturePrivateRuntimeIdentity(packageRoot, ["package.json", "dist/runtime.js"]);
  assert.equal(identity.schemaVersion, 1);
  assert.deepEqual(identity.files.map(({ path }) => path), ["dist/runtime.js", "package.json"]);
  assert.doesNotThrow(() => { assertPrivateRuntimeIdentity(packageRoot, identity); });
  writeFileSync(join(packageRoot, "dist/runtime.js"), "export const generation = 2;\n");
  assert.throws(() => { assertPrivateRuntimeIdentity(packageRoot, identity); }, /FADENO_BUILD_RUNTIME_IDENTITY/u);
  assert.throws(() => { capturePrivateRuntimeIdentity(packageRoot, ["package.json", "package.json"]); }, /FADENO_BUILD_RUNTIME_IDENTITY/u);
  assert.throws(() => { capturePrivateRuntimeIdentity(packageRoot, ["../external/file.js"]); }, /FADENO_BUILD_RUNTIME_IDENTITY/u);
  writeFileSync(join(externalRoot, "file.js"), "external\n");
  symlinkSync(join(externalRoot, "file.js"), join(packageRoot, "dist/linked.js"));
  assert.throws(() => { capturePrivateRuntimeIdentity(packageRoot, ["dist/linked.js"]); }, /FADENO_BUILD_RUNTIME_IDENTITY/u);
  symlinkSync(packageRoot, join(temporaryRoot, "package-link"));
  assert.throws(() => { capturePrivateRuntimeIdentity(join(temporaryRoot, "package-link"), ["package.json"]); }, /FADENO_BUILD_RUNTIME_IDENTITY/u);

  writeFileSync(join(projectRoot, ".env"), "ALPHA=base\nSHARED=base\nQUOTED='literal value'\n");
  writeFileSync(join(projectRoot, ".env.local"), "SHARED=local\nLOCAL=enabled\n");
  const firstEnvironment = capturePrivateEnvironment(projectRoot, { SHARED: "process", PROCESS_ONLY: "yes", OMITTED: undefined });
  assert.deepEqual(firstEnvironment.values, {
    ALPHA: "base",
    LOCAL: "enabled",
    PROCESS_ONLY: "yes",
    QUOTED: "literal value",
    SHARED: "process",
  });
  writeFileSync(join(projectRoot, ".env.local"), "SHARED=changed\nLOCAL=enabled\n");
  const secondEnvironment = capturePrivateEnvironment(projectRoot, { PROCESS_ONLY: "yes" });
  assert.notEqual(secondEnvironment.sha256, firstEnvironment.sha256);
  assert.equal(secondEnvironment.values["SHARED"], "changed");
  for (const invalid of [
    "DUPLICATE=one\nDUPLICATE=two\n",
    "export VALUE=bad\n",
    "VALUE=${OTHER}\n",
    "VALUE='unterminated\n",
    "9VALUE=bad\n",
  ]) assert.throws(() => { parsePrivateEnvironmentFile(invalid); }, /FADENO_BUILD_ENV/u);
  assert.throws(() => { capturePrivateEnvironment(projectRoot, { "BAD-NAME": "bad" }); }, /FADENO_BUILD_ENV/u);
  rmSync(join(projectRoot, ".env.local"));
  symlinkSync(join(externalRoot, "file.js"), join(projectRoot, ".env.local"));
  assert.throws(() => { capturePrivateEnvironment(projectRoot, {}); }, /FADENO_BUILD_ENV/u);

  const recovery = new PrivateDevelopmentDecisionModel(5_000);
  assert.deepEqual(recovery.ready(1), {
    state: "ready", acceptedGeneration: 1, candidateGeneration: null, exitCode: null,
    output: "Fadeno development server ready.\n",
  });
  assert.equal(recovery.prepare(2).state, "preparing");
  assert.deepEqual(recovery.refuseCandidate(), {
    state: "ready", acceptedGeneration: 1, candidateGeneration: null, exitCode: null,
    output: "Fadeno development diagnostics published; last accepted generation remains active.\n",
  });
  recovery.prepare(3);
  assert.equal(recovery.candidateReady().state, "switching");
  assert.deepEqual(recovery.acceptCandidate(), {
    state: "ready", acceptedGeneration: 3, candidateGeneration: null, exitCode: null,
    output: "Fadeno development diagnostics cleared; new generation active.\n",
  });
  assert.throws(() => { recovery.prepare(3); }, /FADENO_DEV_STATE/u);

  const graceful = new PrivateDevelopmentDecisionModel(100);
  graceful.ready(1);
  assert.equal(graceful.signal(1_000).state, "stopping");
  assert.equal(graceful.tick(1_099).state, "stopping");
  assert.deepEqual(graceful.drained(), {
    state: "stopped", acceptedGeneration: 1, candidateGeneration: null, exitCode: 0,
    output: "Fadeno development server stopped.\n",
  });

  const deadline = new PrivateDevelopmentDecisionModel(100);
  deadline.ready(1);
  deadline.signal(1_000);
  assert.deepEqual(deadline.tick(1_100), {
    state: "forced", acceptedGeneration: 1, candidateGeneration: null, exitCode: 3,
    output: "Fadeno development shutdown deadline exceeded.\n",
  });

  const repeated = new PrivateDevelopmentDecisionModel(100);
  repeated.ready(1);
  repeated.signal(1_000);
  assert.deepEqual(repeated.signal(1_001), {
    state: "forced", acceptedGeneration: 1, candidateGeneration: null, exitCode: 3,
    output: "Fadeno development shutdown forced.\n",
  });
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("V1 private build/development decision model passed");
