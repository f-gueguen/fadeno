import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  PrivateProjectAnalyzer,
  type PrivateProjectDocumentEvent,
  type PrivateProjectDocumentOperation,
  type PrivateProjectDocumentRefusalCode,
  type PrivateProjectDocumentResult,
} from "../packages/framework/src/internal/analyzer-project.ts";

async function accepted(result: PrivateProjectDocumentResult): Promise<PrivateProjectDocumentEvent> {
  assert.equal(result.accepted, true);
  if (!result.accepted) throw new Error("FADENO_TEST_DOCUMENT_REFUSED");
  return result.event.result;
}

function refused(
  result: PrivateProjectDocumentResult,
  code: PrivateProjectDocumentRefusalCode,
  expectedEpoch: number,
): void {
  assert.equal(result.accepted, false);
  if (result.accepted) throw new Error("FADENO_TEST_DOCUMENT_ACCEPTED");
  assert.equal(result.code, code);
  assert.equal(result.currentEpoch, expectedEpoch);
}

function open(
  workspaceRoots: readonly string[],
  document: string,
  version: number,
  text: string,
): PrivateProjectDocumentOperation {
  return { kind: "open", workspaceRoots, document, version, text };
}

const root = mkdtempSync(join(tmpdir(), "fadeno-v1-project-lifecycle-"));
try {
  cpSync(new URL("../examples/v1-app/src/", import.meta.url), join(root, "src"), { recursive: true });
  const configPath = join(root, "fadeno.config.ts");
  const savedConfig = "// café 😀\r\nexport default { routes: { root: 'src/routes' } };\r\n";
  writeFileSync(configPath, savedConfig);
  const collisionRoot = join(root, "src/collision");
  mkdirSync(collisionRoot, { recursive: true });
  writeFileSync(join(collisionRoot, "page.tsx"), "export default function Page(): string { return 'collision'; }\n");
  writeFileSync(join(collisionRoot, "handler.ts"), "export function GET(): Response { return new Response('collision'); }\n");

  const analyzer = new PrivateProjectAnalyzer(root);
  const initialized = await analyzer.analyze().result;
  assert.equal(initialized.input, "saved");
  assert.equal(initialized.diagnostics.diagnostics.length, 0);
  const initialPublication = initialized.publication;

  const openResult = analyzer.document(open([root], configPath, 1, savedConfig));
  const opened = await accepted(openResult);
  assert.equal(openResult.accepted, true);
  if (!openResult.accepted) throw new Error("FADENO_TEST_OPEN_REFUSED");
  assert.equal(opened.operationId, openResult.operationId);
  assert.equal(opened.documentOperationId, openResult.documentOperationId);
  assert.equal(opened.documentOperationId, openResult.transitionSnapshot.operationId);
  assert.equal(opened.operation, "open");
  assert.equal(opened.input, "overlay");
  assert.equal(opened.document.effective.source, "overlay");
  assert.equal(opened.document.effective.text, savedConfig);
  assert.equal(opened.document.open?.version, 1);
  assert.equal(opened.document.open?.lifetime, 1);
  assert.equal(opened.documentVersion, 1);
  assert.equal(opened.documentLifetime, 1);
  assert.equal(opened.publication.workspaceEpoch, opened.workspaceEpoch);
  assert.deepEqual(opened.requestedFacets, [
    { namespace: "fadeno.diagnostics" },
    { namespace: "fadeno.graph" },
  ]);
  assert.equal(opened.completeness, "complete");
  assert.equal(opened.interruption, null);
  assert.equal(opened.truncated, false);
  assert.ok(opened.publication.publicationGeneration > initialPublication.publicationGeneration);
  assert.throws(() => initialized.apply(), /FADENO_ANALYZER_APPLICATION_STALE/u);
  const overlayAnalysis = await analyzer.analyze().result;
  assert.equal(overlayAnalysis.input, "overlay");
  assert.throws(() => overlayAnalysis.apply(), /FADENO_ANALYZER_APPLICATION_OVERLAY/u);

  const prefix = "/* overlay generation */";
  const afterFirstEdit = `${prefix}${savedConfig}`;
  const routeStart = afterFirstEdit.indexOf("src/routes");
  assert.notEqual(routeStart, -1);
  const changedText = `${afterFirstEdit.slice(0, routeStart)}src/collision${afterFirstEdit.slice(routeStart + "src/routes".length)}`;
  const changed = await accepted(analyzer.document({
    kind: "change",
    workspaceRoots: [root],
    document: configPath,
    lifetime: 1,
    version: 2,
    edits: [
      { start: 0, end: 0, text: prefix },
      {
        start: routeStart,
        end: routeStart + "src/routes".length,
        text: "src/collision",
      },
    ],
  }));
  assert.equal(changed.document.effective.text, changedText);
  assert.equal(changed.document.effective.text.includes("\r\n"), true);
  assert.equal(changed.routePlan, null);
  assert.deepEqual(changed.diagnostics.diagnostics.map(({ code }) => code), [
    "FADENO_ROUTE_ROUTE_ROLE_OWNER",
    "FADENO_ROUTE_ROUTE_ROLE_OWNER",
    "FADENO_ROUTE_ROUTE_ROLE_COLLISION",
  ]);
  assert.deepEqual(changed.diagnostics.corrections.map(({ fixId }) => fixId), [
    "FADENO_FIX_REVIEW_ROUTE_ROLE_COLLISION",
  ]);
  assert.equal(opened.document.effective.text, savedConfig, "later event mutated prior event");
  assert.equal(Object.isFrozen(changed), true);
  assert.equal(Object.isFrozen(changed.documentSnapshot), true);
  assert.equal(Object.isFrozen(changed.documentSnapshot.documents), true);
  assert.equal(Object.isFrozen(changed.publication), true);

  const beforeAtomicRefusal = changed.documentSnapshot;
  const beforeAtomicPublication = changed.publication;
  refused(analyzer.document({
    kind: "change",
    workspaceRoots: [root],
    document: configPath,
    lifetime: 1,
    version: 3,
    edits: [
      { start: 0, end: 0, text: "valid-first-edit" },
      { start: changedText.length + 100, end: changedText.length + 100, text: "invalid" },
    ],
  }), "FADENO_ANALYZER_EDIT_RANGE", beforeAtomicRefusal.workspaceEpoch);
  assert.equal(changed.documentSnapshot, beforeAtomicRefusal);
  assert.equal(changed.publication, beforeAtomicPublication);
  refused(analyzer.document({
    kind: "change",
    workspaceRoots: [root],
    document: configPath,
    lifetime: 1,
    version: 2,
    edits: [],
  }), "FADENO_ANALYZER_VERSION", beforeAtomicRefusal.workspaceEpoch);
  refused(analyzer.document({
    kind: "replace",
    workspaceRoots: [root],
    document: configPath,
    lifetime: 999,
    version: 3,
    text: savedConfig,
  }), "FADENO_ANALYZER_LIFETIME", beforeAtomicRefusal.workspaceEpoch);

  const replaced = await accepted(analyzer.document({
    kind: "replace",
    workspaceRoots: [root],
    document: configPath,
    lifetime: 1,
    version: 3,
    text: savedConfig,
  }));
  assert.equal(replaced.diagnostics.diagnostics.length, 0);
  assert.ok(replaced.routePlan);
  const sameTextReplacement = await accepted(analyzer.document({
    kind: "replace",
    workspaceRoots: [root],
    document: configPath,
    lifetime: 1,
    version: 4,
    text: savedConfig,
  }));
  assert.equal(sameTextReplacement.document.open?.version, 4);
  assert.equal(sameTextReplacement.document.effective.text, savedConfig);

  const savedBacking = "// saved backing differs while overlay remains authoritative\nexport default { routes: { root: 'src/routes' } };\n";
  writeFileSync(configPath, savedBacking);
  const backingRefresh = await analyzer.analyze().result;
  assert.equal(backingRefresh.input, "overlay");
  const savedWhileOpen = await accepted(analyzer.document({
    kind: "save",
    workspaceRoots: [root],
    document: configPath,
    text: savedBacking,
  }));
  assert.equal(savedWhileOpen.input, "overlay");
  assert.equal(savedWhileOpen.document.effective.text, savedConfig);
  assert.equal(savedWhileOpen.document.effective.source, "overlay");
  assert.equal(readFileSync(configPath, "utf8"), savedBacking);
  const beforeDivergentSave = savedWhileOpen.documentSnapshot;
  refused(analyzer.document({
    kind: "save",
    workspaceRoots: [root],
    document: configPath,
    text: "divergent",
  }), "FADENO_ANALYZER_SAVED_MISMATCH", beforeDivergentSave.workspaceEpoch);
  assert.equal(savedWhileOpen.documentSnapshot, beforeDivergentSave);

  refused(analyzer.document({
    kind: "close",
    workspaceRoots: [root],
    document: configPath,
    lifetime: 1,
    version: 3,
  }), "FADENO_ANALYZER_CLOSE_VERSION", beforeDivergentSave.workspaceEpoch);
  const closed = await accepted(analyzer.document({
    kind: "close",
    workspaceRoots: [root],
    document: configPath,
    lifetime: 1,
    version: 4,
  }));
  assert.equal(closed.input, "saved");
  assert.equal(closed.document.open, null);
  assert.equal(closed.documentVersion, 4);
  assert.equal(closed.documentLifetime, 1);
  assert.equal(closed.document.effective.source, "saved");
  assert.equal(closed.document.effective.text, savedBacking);

  const configInputUri = pathToFileURL(configPath).href;
  const configUri = closed.document.uri;
  const reopened = await accepted(analyzer.document(open([root], configInputUri, 0, savedBacking)));
  assert.equal(reopened.document.uri, configUri);
  assert.equal(reopened.document.open?.version, 0);
  assert.equal(reopened.document.open?.lifetime, 2);

  const refusalEpoch = reopened.documentSnapshot.workspaceEpoch;
  const refusalPublication = reopened.publication;
  const assertStableRefusal = (operation: PrivateProjectDocumentOperation, code: PrivateProjectDocumentRefusalCode): void => {
    refused(analyzer.document(operation), code, refusalEpoch);
    assert.equal(reopened.publication, refusalPublication);
    assert.equal(reopened.documentSnapshot.workspaceEpoch, refusalEpoch);
  };
  assertStableRefusal({
    kind: "unknown",
    workspaceRoots: [root],
    document: configPath,
  } as unknown as PrivateProjectDocumentOperation, "FADENO_ANALYZER_PROJECT_DOCUMENT_OPERATION");
  assertStableRefusal(open([root, join(root, "second")], configPath, 1, savedBacking), "FADENO_ANALYZER_WORKSPACE_ROOTS");
  assertStableRefusal(open([join(root, "other-root")], configPath, 1, savedBacking), "FADENO_ANALYZER_WORKSPACE_ROOTS");
  assertStableRefusal(open([root], "https://fadeno.invalid/config.ts", 1, savedBacking), "FADENO_ANALYZER_DOCUMENT_SCHEME");
  assertStableRefusal(open([root], "file://remote.invalid/fadeno.config.ts", 1, savedBacking), "FADENO_ANALYZER_URI_AUTHORITY");
  assertStableRefusal(open([root], `${configInputUri}?version=1`, 1, savedBacking), "FADENO_ANALYZER_URI_QUERY");
  assertStableRefusal(open([root], `${configInputUri}#fragment`, 1, savedBacking), "FADENO_ANALYZER_URI_FRAGMENT");
  assertStableRefusal(open([root], root, 1, savedBacking), "FADENO_ANALYZER_DOCUMENT_ROOT");
  assertStableRefusal(open([root], join(root, "src/routes"), 1, savedBacking), "FADENO_ANALYZER_DOCUMENT_DIRECTORY");
  assertStableRefusal(open([root], join(root, "../escape.ts"), 1, savedBacking), "FADENO_ANALYZER_DOCUMENT_ESCAPE");

  const unrelated = join(root, "src/unrelated.ts");
  writeFileSync(unrelated, "export const unrelated = true;\n");
  assertStableRefusal(open([root], unrelated, 1, readFileSync(unrelated, "utf8")), "FADENO_ANALYZER_PROJECT_DOCUMENT_UNMANAGED");
  assertStableRefusal(open([root], join(root, "src/routes/new/page.tsx"), 1, "export default function New() {}\n"), "FADENO_ANALYZER_PROJECT_DOCUMENT_UNMANAGED");
  const symlinkFile = join(root, "src/config-link.ts");
  symlinkSync(configPath, symlinkFile);
  assertStableRefusal(open([root], symlinkFile, 1, savedBacking), "FADENO_ANALYZER_DOCUMENT_SYMLINK");
  const symlinkParent = join(root, "linked-routes");
  symlinkSync(join(root, "src/routes"), symlinkParent);
  assertStableRefusal(open([root], join(symlinkParent, "page.tsx"), 1, ""), "FADENO_ANALYZER_DOCUMENT_SYMLINK");

  const secondClose = await accepted(analyzer.document({
    kind: "close",
    workspaceRoots: [root],
    document: configInputUri,
    lifetime: 2,
    version: 0,
  }));
  assert.equal(secondClose.input, "saved");

  const pagePath = join(root, "src/routes/page.tsx");
  const savedPage = readFileSync(pagePath, "utf8");
  const overlayPage = `\uFEFF// route overlay café 😀\r\n${savedPage.replaceAll("\n", "\r\n")}`;
  const pageOpened = await accepted(analyzer.document(open([root], pagePath, 9, overlayPage)));
  assert.equal(pageOpened.input, "overlay");
  assert.equal(pageOpened.document.effective.text, overlayPage);
  assert.equal(pageOpened.routePlan?.sources["src/routes/page.tsx"], overlayPage);
  assert.notEqual(pageOpened.routePlan?.sourceSha256, secondClose.routePlan?.sourceSha256);
  const pageOverlayAnalysis = await analyzer.analyze().result;
  assert.throws(() => pageOverlayAnalysis.apply(), /FADENO_ANALYZER_APPLICATION_OVERLAY/u);
  const pageClosed = await accepted(analyzer.document({
    kind: "close",
    workspaceRoots: [root],
    document: pagePath,
    lifetime: 1,
    version: 9,
  }));
  assert.equal(pageClosed.input, "saved");
  assert.equal(pageClosed.document.effective.text, savedPage);
  assert.equal(pageClosed.routePlan?.sourceSha256, secondClose.routePlan?.sourceSha256);
  assert.equal(rmSync(join(root, ".fadeno"), { recursive: true, force: true }), undefined);
  await analyzer.close();
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("V1 project-owned analyzer lifecycle passed (overlay, refusal, replacement, save, close/reopen, recovery)");
