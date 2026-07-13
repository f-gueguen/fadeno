import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { runProjectCheckCommand } from "../packages/framework/src/internal/project-check.ts";

const root = mkdtempSync(join(tmpdir(), "fadeno-v1-project-check-"));
try {
  cpSync(new URL("../examples/v1-app/src/", import.meta.url), join(root, "src"), { recursive: true });
  writeFileSync(join(root, "fadeno.config.ts"), "export default { routes: { root: 'src/routes' } };\n");

  let usageAnalyzerCalls = 0;
  for (const arguments_ of [
    [], ["check"], ["build", "--project-root", root], ["check", root],
    ["check", "--project-root"], ["check", "--project-root", ""],
    ["check", "--project-root", root, "--project-root", root],
    ["check", "--project-root", root, "--explain", "--explain"],
    ["check", "--project-root", root, "--format", "json"],
    ["check", "--project-root", root, "--json"],
    ["check", "--project-root", root, "--deep"],
    ["check", "--project-root", root, "--unknown"],
  ]) {
    const result = await runProjectCheckCommand(arguments_, {
      cwd: dirname(root),
      analyzeProject: async () => { usageAnalyzerCalls += 1; throw new Error("must not run"); },
    });
    assert.deepEqual(result, {
      exitCode: 2,
      stdout: "",
      stderr: "FADENO_CHECK_USAGE: fadeno check --project-root <path> [--explain]\n",
    });
  }
  assert.equal(usageAnalyzerCalls, 0);

  const absolute = await runProjectCheckCommand(["check", "--project-root", root], { cwd: dirname(root) });
  const relative = await runProjectCheckCommand(["check", "--project-root", basename(root)], { cwd: dirname(root) });
  assert.deepEqual(relative, absolute);
  assert.equal(absolute.exitCode, 0);
  assert.match(absolute.stdout, /^Fadeno framework route analysis completed: [0-9]+ routes, 7 artifacts planned, no files written\.\n$/u);
  assert.equal(absolute.stderr, "");
  assert.equal(existsSync(join(root, ".fadeno")), false);

  const dashRoot = join(dirname(root), `-${basename(root)}`);
  cpSync(root, dashRoot, { recursive: true });
  try {
    const dashLeading = await runProjectCheckCommand(["check", "--project-root", basename(dashRoot)], { cwd: dirname(root) });
    assert.deepEqual(dashLeading, absolute);
  } finally { rmSync(dashRoot, { recursive: true, force: true }); }

  const explained = await runProjectCheckCommand(["check", "--explain", "--project-root", root], { cwd: dirname(root) });
  assert.equal(explained.exitCode, 0);
  assert.match(explained.stdout, /decision: publish-static-route-plan/u);
  assert.match(explained.stdout, /outcome: static-ready/u);
  assert.equal(explained.stdout.includes("operation-"), false);

  const collisionPath = join(root, "src/routes/handler.ts");
  cpSync(new URL("../examples/v1-app/scenarios/analyzer-project/handler.ts", import.meta.url), collisionPath);
  const collision = await runProjectCheckCommand(["check", "--project-root", root, "--explain"], { cwd: dirname(root) });
  assert.equal(collision.exitCode, 1);
  assert.equal(collision.stdout, "");
  assert.match(collision.stderr, /FADENO_ROUTE_ROUTE_ROLE_COLLISION/u);
  assert.match(collision.stderr, /correction: FADENO_FIX_REVIEW_ROUTE_ROLE_COLLISION \(review\)/u);
  assert.match(collision.stderr, /decision: refuse-static-route-plan/u);
  assert.match(collision.stderr, /skipped: manifest-publication/u);
  assert.match(collision.stderr, /outcome: static-refused/u);
  assert.equal(collision.stderr.includes(root), false);
  assert.equal(collision.stderr.includes("operation-"), false);

  rmSync(collisionPath);
  const recovery = await runProjectCheckCommand(["check", "--project-root", root], { cwd: dirname(root) });
  assert.deepEqual(recovery, absolute);
  assert.equal(recovery.stdout.includes("COLLISION"), false);
  assert.equal(existsSync(join(root, ".fadeno")), false);

  const mutationPath = join(root, "changed-by-check.txt");
  writeFileSync(join(root, "fadeno.config.ts"), [
    'import { writeFileSync } from "node:fs";',
    'console.log("FADENO_CONFIG_SECRET_STDOUT");',
    'process.stderr.write("FADENO_CONFIG_SECRET_STDERR\\n");',
    'writeFileSync(new URL("./changed-by-check.txt", import.meta.url), "changed");',
    "export default { routes: { root: 'src/routes' } };",
    "",
  ].join("\n"));
  const sideEffecting = await runProjectCheckCommand(["check", "--project-root", root], { cwd: dirname(root) });
  assert.equal(sideEffecting.exitCode, 1);
  assert.match(sideEffecting.stderr, /^FADENO_CONFIG_STATIC:/u);
  assert.equal(JSON.stringify(sideEffecting).includes("CONFIG_SECRET"), false);
  assert.equal(existsSync(mutationPath), false);

  writeFileSync(join(root, "fadeno.config.ts"), "export default defineConfig({ routes: { root: 'src/routes' } });\n");
  const missingDefineConfigImport = await runProjectCheckCommand(["check", "--project-root", root], { cwd: dirname(root) });
  assert.equal(missingDefineConfigImport.exitCode, 1);
  assert.match(missingDefineConfigImport.stderr, /^FADENO_CONFIG_STATIC:/u);

  rmSync(join(root, "fadeno.config.ts"));
  const missingConfig = await runProjectCheckCommand(["check", "--project-root", root], { cwd: dirname(root) });
  assert.equal(missingConfig.exitCode, 1);
  assert.match(missingConfig.stderr, /^FADENO_CONFIG_MISSING:/u);
  assert.equal(missingConfig.stderr.includes(root), false);

  const alias = `${root}-alias`;
  symlinkSync(root, alias);
  try {
    const symlinkRoot = await runProjectCheckCommand(["check", "--project-root", alias], { cwd: dirname(root) });
    assert.deepEqual(symlinkRoot, {
      exitCode: 1,
      stdout: "",
      stderr: "FADENO_ANALYZER_ROOT_OWNERSHIP: Project root must be one owned, non-symlink directory.\n",
    });
  } finally { unlinkSync(alias); }

  const internal = await runProjectCheckCommand(["check", "--project-root", root], {
    cwd: dirname(root),
    analyzeProject: async () => { throw new Error("FADENO_SECRET_CANARY:/private/owner/secret"); },
    createIncidentId: () => "00000000-0000-4000-8000-000000000001",
  });
  assert.deepEqual(internal, {
    exitCode: 3,
    stdout: "",
    stderr: "FADENO_CHECK_INTERNAL: Framework route analysis could not complete.\n  incident: 00000000-0000-4000-8000-000000000001\n",
  });
  assert.equal(JSON.stringify(internal).includes("SECRET_CANARY"), false);
  assert.equal(JSON.stringify(internal).includes("/private/owner"), false);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("V1 project check command passed (argv, streams, diagnostics, flow, recovery, redaction)");
