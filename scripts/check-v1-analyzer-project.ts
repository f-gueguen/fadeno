import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PrivateProjectAnalyzer } from "../packages/framework/src/internal/analyzer-project.ts";
import {
  deserializeAnalyzerDiagnosticBatch,
  formatAnalyzerDiagnosticBatchHuman,
  serializeAnalyzerDiagnosticBatch,
} from "../packages/framework/src/internal/analyzer-diagnostics.ts";
import {
  deserializeAnalyzerPublicationSnapshot,
  serializeAnalyzerPublicationSnapshot,
} from "../packages/framework/src/internal/analyzer-publication.ts";
import { formatRouteExplainHuman } from "../packages/framework/src/internal/analyzer-route-explain.ts";

function artifactBytes(value: unknown): string {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  const bytes = (value as { bytes?: unknown }).bytes;
  assert.equal(typeof bytes, "string");
  return bytes as string;
}

const root = mkdtempSync(join(tmpdir(), "fadeno-v1-analyzer-project-"));
try {
  cpSync(new URL("../examples/v1-app/src/", import.meta.url), join(root, "src"), { recursive: true });
  writeFileSync(join(root, "fadeno.config.ts"), "export default { routes: { root: 'src/routes' } };\n");
  const analyzer = new PrivateProjectAnalyzer(root);

  const success = await analyzer.analyze();
  assert.ok(success.routePlan);
  assert.equal(success.diagnostics.diagnostics.length, 0);
  assert.equal(success.publication.artifacts.length, 7);
  const serializedSuccess = serializeAnalyzerPublicationSnapshot(success.publication);
  assert.equal(serializeAnalyzerPublicationSnapshot(deserializeAnalyzerPublicationSnapshot(serializedSuccess)), serializedSuccess);
  assert.equal(existsSync(join(root, ".fadeno")), false);
  for (const [name, bytes] of Object.entries(success.routePlan.files)) {
    const artifact = success.publication.artifacts.find(({ path }) => path === `.fadeno/routes/${name}`);
    assert.ok(artifact, name);
    assert.equal(artifactBytes(artifact.value), bytes);
    assert.equal(artifact.provenance.generatedArtifactOwnership?.path, `.fadeno/routes/${name}`);
  }
  const successfulFlow = await success.explain("semantic");
  assert.equal(successfulFlow.status, "complete");
  if (successfulFlow.status === "complete") {
    const human = formatRouteExplainHuman(successfulFlow.contributions[0]!);
    assert.match(human, /decision: publish-static-route-plan/u);
    assert.match(human, /outcome: static-ready/u);
  }

  const collisionPath = join(root, "src/routes/handler.ts");
  cpSync(new URL("../examples/v1-app/scenarios/analyzer-project/handler.ts", import.meta.url), collisionPath);
  const collision = await analyzer.analyze();
  assert.equal(collision.routePlan, null);
  assert.deepEqual(collision.diagnostics.diagnostics.map(({ code }) => code), [
    "FADENO_ROUTE_ROUTE_ROLE_OWNER",
    "FADENO_ROUTE_ROUTE_ROLE_OWNER",
    "FADENO_ROUTE_ROUTE_ROLE_COLLISION",
  ]);
  assert.deepEqual(collision.diagnostics.corrections.map(({ fixId, safety, edits }) => ({ fixId, safety, edits })), [{
    fixId: "FADENO_FIX_REVIEW_ROUTE_ROLE_COLLISION",
    safety: "review",
    edits: [],
  }]);
  assert.deepEqual(collision.diagnostics.skippedWork.map(({ id }) => id), ["manifest-publication"]);
  const serializedCollision = serializeAnalyzerDiagnosticBatch(collision.diagnostics);
  assert.equal(serializeAnalyzerDiagnosticBatch(deserializeAnalyzerDiagnosticBatch(serializedCollision)), serializedCollision);
  assert.equal(collision.publication.artifacts.length, 0);
  assert.equal(collision.publication.removedArtifacts.length, 7);
  const humanDiagnostics = formatAnalyzerDiagnosticBatchHuman(collision.diagnostics);
  assert.match(humanDiagnostics, /FADENO_ROUTE_ROUTE_ROLE_COLLISION: Route \/ has conflicting owners\./u);
  assert.match(humanDiagnostics, /correction: FADENO_FIX_REVIEW_ROUTE_ROLE_COLLISION \(review\)/u);
  assert.match(humanDiagnostics, /SKIPPED manifest-publication/u);
  assert.equal(humanDiagnostics.includes(root), false);
  const refusedFlow = await collision.explain("semantic");
  assert.equal(refusedFlow.status, "complete");
  if (refusedFlow.status === "complete") {
    const human = formatRouteExplainHuman(refusedFlow.contributions[0]!);
    assert.match(human, /decision: refuse-static-route-plan/u);
    assert.match(human, /skipped: manifest-publication/u);
    assert.match(human, /outcome: static-refused/u);
  }
  assert.equal(existsSync(join(root, ".fadeno")), false);

  rmSync(collisionPath);
  const recovery = await analyzer.analyze();
  assert.ok(recovery.routePlan);
  assert.equal(recovery.diagnostics.diagnostics.length, 0);
  assert.equal(recovery.diagnostics.corrections.length, 0);
  assert.equal(recovery.diagnostics.skippedWork.length, 0);
  assert.equal(recovery.publication.artifacts.length, 7);
  assert.deepEqual(
    recovery.publication.artifacts.map(({ id }) => id),
    success.publication.artifacts.map(({ id }) => id),
  );
  assert.equal(existsSync(join(root, ".fadeno")), false);
  assert.equal(readFileSync(join(root, "fadeno.config.ts"), "utf8"), "export default { routes: { root: 'src/routes' } };\n");

  const nestedCollisionPath = join(root, "src/routes/hello/[name]/handler.ts");
  cpSync(new URL("../examples/v1-app/scenarios/analyzer-project/handler.ts", import.meta.url), nestedCollisionPath);
  const nestedCollision = await analyzer.analyze();
  assert.equal(nestedCollision.routePlan, null);
  assert.deepEqual(
    nestedCollision.diagnostics.diagnostics.map(({ parameters }) => parameters["route"]),
    ["/hello/[name]", "/hello/[name]", "/hello/[name]"],
  );
  rmSync(nestedCollisionPath);
  const nestedRecovery = await analyzer.analyze();
  assert.equal(nestedRecovery.diagnostics.diagnostics.length, 0);

  const sessionId = nestedRecovery.publication.sessionId;
  const configurationEpoch = nestedRecovery.publication.configurationEpoch;
  writeFileSync(join(root, "fadeno.config.ts"), "// equivalent configuration edit\nexport default { routes: { root: 'src/routes' } };\n");
  const equivalentConfiguration = await analyzer.analyze();
  assert.equal(equivalentConfiguration.publication.sessionId, sessionId);
  assert.equal(equivalentConfiguration.publication.configurationEpoch, configurationEpoch + 1);

  mkdirSync(join(root, "src/alternate-routes"), { recursive: true });
  writeFileSync(join(root, "src/alternate-routes/page.tsx"), "export default function page(): string { return 'alternate'; }\n");
  writeFileSync(join(root, "fadeno.config.ts"), "export default { routes: { root: 'src/alternate-routes' } };\n");
  const switchedRoot = await analyzer.analyze();
  assert.equal(switchedRoot.publication.sessionId, sessionId);
  assert.equal(switchedRoot.routePlan?.manifest.root, "src/alternate-routes");
  assert.deepEqual(
    switchedRoot.diagnostics.identity.documents.map(({ path }) => path),
    ["fadeno.config.ts", "src/alternate-routes/page.tsx"],
  );
  assert.equal(switchedRoot.publication.graph.removedNodes.length > 0, true);
  assert.equal(switchedRoot.publication.graph.removedNodes.every(({ reason }) => reason === "definition-removed"), true);
  assert.equal(switchedRoot.publication.artifacts.length, 7);

  writeFileSync(join(root, "fadeno.config.ts"), [
    'import { writeFileSync } from "node:fs";',
    "const owner = new URL(import.meta.url);",
    'owner.search = "";',
    'writeFileSync(owner, "export default { routes: { root: \'src/routes\' } };\\n");',
    "export default { routes: { root: 'src/other-routes' } };",
    "",
  ].join("\n"));
  await assert.rejects(() => analyzer.analyze(), /FADENO_CONFIG_SOURCE_CHANGED/u);
  assert.equal(existsSync(join(root, ".fadeno")), false);

  const targetConfig = join(root, "owned-config-target.ts");
  writeFileSync(targetConfig, "export default { routes: { root: 'src/routes' } };\n");
  rmSync(join(root, "fadeno.config.ts"));
  symlinkSync(targetConfig, join(root, "fadeno.config.ts"));
  await assert.rejects(() => analyzer.analyze(), /FADENO_CONFIG_FILE/u);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("V1 private project analyzer passed (success, collision, correction, flow, recovery, no writes)");
