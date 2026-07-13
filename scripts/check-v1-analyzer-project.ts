import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PrivateProjectAnalyzer } from "../packages/framework/src/internal/analyzer-project.ts";
import { AnalyzerSession } from "../packages/framework/src/internal/analyzer-session.ts";
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

  const success = await analyzer.analyze().result;
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
  const collision = await analyzer.analyze().result;
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
  const recovery = await analyzer.analyze().result;
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
  const nestedCollision = await analyzer.analyze().result;
  assert.equal(nestedCollision.routePlan, null);
  assert.deepEqual(
    nestedCollision.diagnostics.diagnostics.map(({ parameters }) => parameters["route"]),
    ["/hello/[name]", "/hello/[name]", "/hello/[name]"],
  );
  rmSync(nestedCollisionPath);
  const nestedRecovery = await analyzer.analyze().result;
  assert.equal(nestedRecovery.diagnostics.diagnostics.length, 0);

  const batchedDirectory = join(root, "src/routes/batched");
  const batchedPage = join(batchedDirectory, "page.tsx");
  mkdirSync(batchedDirectory, { recursive: true });
  writeFileSync(batchedPage, "export default function Page(): string { return 'batched'; }\n");
  const structuralAddition = await analyzer.analyze().result;
  assert.equal(structuralAddition.routePlan?.manifest.routes.some(({ id }) => id === "/batched"), true);
  writeFileSync(batchedPage, "export default function Page(): string { return 'direct-edit'; }\n");
  const directEdit = await analyzer.analyze().result;
  assert.equal(directEdit.publication.graph.invalidations.some(({ reasons }) => reasons.some(({ kind }) => kind === "document")), true);
  const renamedDirectory = join(root, "src/routes/batched-renamed");
  const renamedPage = join(renamedDirectory, "page.tsx");
  mkdirSync(renamedDirectory, { recursive: true });
  renameSync(batchedPage, renamedPage);
  const renamed = await analyzer.analyze().result;
  assert.equal(renamed.routePlan?.manifest.routes.some(({ id }) => id === "/batched"), false);
  assert.equal(renamed.routePlan?.manifest.routes.some(({ id }) => id === "/batched-renamed"), true);
  assert.equal(renamed.publication.graph.removedNodes.some(({ reason }) => reason === "owner-disappeared"), true);
  rmSync(renamedPage);
  const deleted = await analyzer.analyze().result;
  assert.equal(deleted.routePlan?.manifest.routes.some(({ id }) => id === "/batched-renamed"), false);
  assert.equal(deleted.publication.graph.removedNodes.some(({ reason }) => reason === "owner-disappeared"), true);

  const sessionId = nestedRecovery.publication.sessionId;
  const configurationEpoch = nestedRecovery.publication.configurationEpoch;
  writeFileSync(join(root, "fadeno.config.ts"), "// equivalent configuration edit\nexport default { routes: { root: 'src/routes' } };\n");
  const equivalentConfiguration = await analyzer.analyze().result;
  assert.equal(equivalentConfiguration.publication.sessionId, sessionId);
  assert.equal(equivalentConfiguration.publication.configurationEpoch, configurationEpoch + 1);

  mkdirSync(join(root, "src/alternate-routes"), { recursive: true });
  writeFileSync(join(root, "src/alternate-routes/page.tsx"), "export default function page(): string { return 'alternate'; }\n");
  writeFileSync(join(root, "fadeno.config.ts"), "export default { routes: { root: 'src/alternate-routes' } };\n");
  const switchedRoot = await analyzer.analyze().result;
  assert.equal(switchedRoot.publication.sessionId, sessionId);
  assert.equal(switchedRoot.routePlan?.manifest.root, "src/alternate-routes");
  assert.deepEqual(
    switchedRoot.diagnostics.identity.documents.map(({ path }) => path),
    ["fadeno.config.ts", "src/alternate-routes/page.tsx"],
  );
  assert.equal(switchedRoot.publication.graph.removedNodes.length > 0, true);
  assert.equal(switchedRoot.publication.graph.removedNodes.every(({ reason }) => reason === "owner-disappeared"), true);
  assert.equal(switchedRoot.publication.artifacts.length, 7);

  const ownershipRoot = mkdtempSync(join(tmpdir(), "fadeno-v1-project-saved-ownership-"));
  try {
    cpSync(new URL("../examples/v1-app/src/", import.meta.url), join(ownershipRoot, "src"), { recursive: true });
    writeFileSync(join(ownershipRoot, "fadeno.config.ts"), "export default { routes: { root: 'src/routes' } };\n");
    const sharedSession = new AnalyzerSession(ownershipRoot);
    const ownershipAnalyzer = new PrivateProjectAnalyzer(ownershipRoot, { session: sharedSession });
    const owned = await ownershipAnalyzer.analyze().result;
    const ownedPagePath = join(ownershipRoot, "src/routes/page.tsx");
    const desiredOverlay = sharedSession.open(ownedPagePath, 7, "unsaved desired owner");
    assert.equal(desiredOverlay.accepted, true);
    if (!desiredOverlay.accepted) throw new Error("FADENO_TEST_DESIRED_OVERLAY");
    await assert.rejects(ownershipAnalyzer.analyze().result, /FADENO_ANALYZER_DOCUMENT_OPEN/u);
    assert.equal(sharedSession.currentPublicationSnapshot, owned.publication, "desired overlay refusal replaced publication");
    const desiredOpen = desiredOverlay.snapshot.documents.find(({ path }) => path === "src/routes/page.tsx")!.open!;
    assert.equal(sharedSession.close(ownedPagePath, desiredOpen.lifetime, desiredOpen.version).accepted, true);
    const desiredRecovery = await ownershipAnalyzer.analyze().result;
    assert.equal(desiredRecovery.publication.publicationGeneration, owned.publication.publicationGeneration + 1);

    const forgottenOverlay = sharedSession.open(ownedPagePath, 8, "unsaved forgotten owner");
    assert.equal(forgottenOverlay.accepted, true);
    if (!forgottenOverlay.accepted) throw new Error("FADENO_TEST_FORGOTTEN_OVERLAY");
    mkdirSync(join(ownershipRoot, "src/alternate"), { recursive: true });
    writeFileSync(join(ownershipRoot, "src/alternate/page.tsx"), "export default function Page(): string { return 'alternate'; }\n");
    writeFileSync(join(ownershipRoot, "fadeno.config.ts"), "export default { routes: { root: 'src/alternate' } };\n");
    await assert.rejects(ownershipAnalyzer.analyze().result, /FADENO_ANALYZER_DOCUMENT_OPEN/u);
    assert.equal(sharedSession.currentPublicationSnapshot, desiredRecovery.publication, "forgotten overlay refusal replaced publication");
    const forgottenOpen = forgottenOverlay.snapshot.documents.find(({ path }) => path === "src/routes/page.tsx")!.open!;
    assert.equal(sharedSession.close(ownedPagePath, forgottenOpen.lifetime, forgottenOpen.version).accepted, true);
    const forgottenRecovery = await ownershipAnalyzer.analyze().result;
    assert.equal(forgottenRecovery.routePlan?.manifest.root, "src/alternate");
    await ownershipAnalyzer.close();
  } finally {
    rmSync(ownershipRoot, { recursive: true, force: true });
  }

  writeFileSync(join(root, "fadeno.config.ts"), [
    'import { writeFileSync } from "node:fs";',
    "const owner = new URL(import.meta.url);",
    'owner.search = "";',
    'writeFileSync(owner, "export default { routes: { root: \'src/routes\' } };\\n");',
    "export default { routes: { root: 'src/other-routes' } };",
    "",
  ].join("\n"));
  await assert.rejects(() => analyzer.analyze().result, /FADENO_CONFIG_STATIC/u);
  assert.match(readFileSync(join(root, "fadeno.config.ts"), "utf8"), /writeFileSync\(owner/u);
  assert.equal(existsSync(join(root, ".fadeno")), false);

  const targetConfig = join(root, "owned-config-target.ts");
  writeFileSync(targetConfig, "export default { routes: { root: 'src/routes' } };\n");
  rmSync(join(root, "fadeno.config.ts"));
  symlinkSync(targetConfig, join(root, "fadeno.config.ts"));
  await assert.rejects(() => analyzer.analyze().result, /FADENO_CONFIG_FILE/u);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("V1 private project analyzer passed (success, collision, correction, flow, recovery, no writes)");
