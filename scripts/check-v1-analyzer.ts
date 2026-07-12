import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  AnalyzerSession,
  type AnalyzerDocumentOnlySnapshot,
  type AnalyzerOperationResult,
  type AnalyzerRefusalCode,
} from "../packages/framework/src/internal/analyzer-session.ts";

interface ReferenceDocument {
  epoch: number;
  saved: string;
  savedRevision: number;
  overlay?: string;
  version?: number;
  lifetime: number;
}

const root = mkdtempSync(join(tmpdir(), "fadeno-v1-analyzer-"));
const otherRoot = mkdtempSync(join(tmpdir(), "fadeno-v1-analyzer-other-"));
const operationIds = new Set<string>();

function record(result: AnalyzerOperationResult): AnalyzerOperationResult {
  assert.ok(!operationIds.has(result.operationId), `duplicate operation ID ${result.operationId}`);
  operationIds.add(result.operationId);
  assert.ok(Object.isFrozen(result));
  return result;
}

function accepted(result: AnalyzerOperationResult): AnalyzerDocumentOnlySnapshot {
  record(result);
  assert.equal(result.accepted, true);
  return result.snapshot;
}

function refused(
  session: AnalyzerSession,
  action: () => AnalyzerOperationResult,
  code: AnalyzerRefusalCode,
): void {
  const before = session.currentSnapshot;
  const result = record(action());
  assert.equal(result.accepted, false);
  assert.equal(result.code, code);
  assert.equal(result.currentEpoch, before.workspaceEpoch);
  assert.equal(session.currentSnapshot, before);
}

function assertDocument(snapshot: AnalyzerDocumentOnlySnapshot, path: string, reference: ReferenceDocument): void {
  assert.equal(snapshot.workspaceEpoch, reference.epoch);
  const document = snapshot.documents.find((candidate) => candidate.path === path);
  assert.ok(document, `missing ${path}`);
  assert.equal(document.savedRevision, reference.savedRevision);
  assert.equal(document.open?.version, reference.version);
  assert.equal(document.open?.lifetime, reference.version === undefined ? undefined : reference.lifetime);
  assert.equal(document.effective.source, reference.overlay === undefined ? "saved" : "overlay");
  assert.equal(document.effective.text, reference.overlay ?? reference.saved);
}

try {
  const sourceDirectory = join(root, "src");
  mkdirSync(sourceDirectory);
  const documentPath = join(sourceDirectory, "document.ts");
  const initialSaved = "\uFEFFconst value = '初';\r\n";
  writeFileSync(documentPath, Buffer.from(initialSaved, "utf8"));
  const spacedPath = join(sourceDirectory, "space name.ts");
  writeFileSync(spacedPath, "space\n");
  const invalidUtf8 = join(sourceDirectory, "invalid.ts");
  writeFileSync(invalidUtf8, Buffer.from([0xc3, 0x28]));
  const symlinkPath = join(sourceDirectory, "alias.ts");
  symlinkSync(documentPath, symlinkPath);
  const rootAlias = join(otherRoot, "root-alias");
  symlinkSync(root, rootAlias);
  assert.throws(() => new AnalyzerSession(rootAlias), /FADENO_ANALYZER_ROOT_OWNERSHIP/u);

  const session = new AnalyzerSession(root);
  const initial = session.currentSnapshot;
  assert.equal(initial.workspaceEpoch, 0);
  assert.equal(initial.operation, "initialize");
  assert.deepEqual(initial.requestedFacets, []);
  assert.deepEqual(initial.documents, []);
  assert.ok(Object.isFrozen(initial));
  assert.ok(Object.isFrozen(initial.documents));
  assert.ok(Object.isFrozen(initial.ownership));

  const reference: ReferenceDocument = {
    epoch: 1,
    saved: initialSaved,
    savedRevision: 0,
    overlay: "alpha\r\nβ",
    version: 0,
    lifetime: 1,
  };
  const opened = accepted(session.open(documentPath, 0, reference.overlay!));
  assertDocument(opened, "src/document.ts", reference);
  assert.equal(Object.isFrozen(opened.documents[0]?.effective), true);
  assert.equal(Reflect.set(opened.documents[0]!.effective, "text", "mutated"), false);
  assert.throws(() => (opened.documents as unknown[]).push({}), TypeError);

  reference.epoch += 1;
  reference.saved = "saved while open\r\n新";
  reference.savedRevision += 1;
  const savedWhileOpen = accepted(session.save(documentPath, reference.saved));
  assertDocument(savedWhileOpen, "src/document.ts", reference);
  assert.equal(opened.documents[0]?.effective.text, "alpha\r\nβ", "prior snapshot changed");

  reference.epoch += 1;
  reference.overlay = "A--β";
  reference.version = 1;
  const changed = accepted(session.change(documentPath, 1, [
    { start: 0, end: 5, text: "A" },
    { start: 1, end: 3, text: "--" },
  ]));
  assertDocument(changed, "src/document.ts", reference);

  refused(session, () => session.change(documentPath, 2, [
    { start: 0, end: 1, text: "valid-prefix" },
    { start: 999, end: 1000, text: "invalid-later-edit" },
  ]), "FADENO_ANALYZER_EDIT_RANGE");
  assertDocument(session.currentSnapshot, "src/document.ts", reference);
  for (const edits of [
    [{ start: 2, end: 1, text: "reversed" }],
    [{ start: 0.5, end: 1, text: "fractional" }],
    [{ start: -1, end: 0, text: "negative" }],
  ]) refused(session, () => session.change(documentPath, 2, edits), "FADENO_ANALYZER_EDIT_RANGE");
  refused(session, () => session.change(documentPath, 1, []), "FADENO_ANALYZER_VERSION");
  refused(session, () => session.change(documentPath, 0, []), "FADENO_ANALYZER_VERSION");

  reference.epoch += 1;
  reference.overlay = "\uFEFFline\r\n😀";
  reference.version = 2;
  assertDocument(accepted(session.replace(documentPath, 2, reference.overlay)), "src/document.ts", reference);
  refused(session, () => session.replace(documentPath, 2, "equal-version"), "FADENO_ANALYZER_VERSION");

  reference.epoch += 1;
  reference.savedRevision += 1;
  const identicalSave = accepted(session.save(documentPath, reference.saved));
  assertDocument(identicalSave, "src/document.ts", reference);

  refused(session, () => session.close(documentPath, 1), "FADENO_ANALYZER_CLOSE_VERSION");
  reference.epoch += 1;
  delete reference.overlay;
  delete reference.version;
  const closed = accepted(session.close(documentPath, 2));
  assertDocument(closed, "src/document.ts", reference);
  refused(session, () => session.close(documentPath, 2), "FADENO_ANALYZER_DOCUMENT_CLOSED");

  reference.epoch += 1;
  reference.overlay = "restart\r\n寿";
  reference.version = 0;
  reference.lifetime = 2;
  const reopened = accepted(session.open(pathToFileURL(documentPath).href, 0, reference.overlay));
  assertDocument(reopened, "src/document.ts", reference);
  assert.equal(closed.documents[0]?.open, null);
  assert.equal(reopened.documentVersions[0]?.lifetime, 2);
  refused(session, () => session.open(documentPath, 1, "duplicate"), "FADENO_ANALYZER_DOCUMENT_OPEN");

  reference.epoch += 1;
  delete reference.overlay;
  delete reference.version;
  assertDocument(accepted(session.close(documentPath, 0)), "src/document.ts", reference);

  const spacedOpen = accepted(session.open(spacedPath, 0, "overlay space"));
  assert.equal(spacedOpen.documents.find(({ path }) => path === "src/space name.ts")?.effective.text, "overlay space");
  refused(session, () => session.open(pathToFileURL(spacedPath).href.replace("space%20name", "space%20name"), 1, "alias"), "FADENO_ANALYZER_DOCUMENT_OPEN");
  accepted(session.close(spacedPath, 0));

  const newPath = join(root, "new", "nested.ts");
  const newOpen = accepted(session.open(newPath, 0, "new\r\nfile"));
  assert.equal(newOpen.documents.find(({ path }) => path === "new/nested.ts")?.effective.text, "new\r\nfile");
  const newClosed = accepted(session.close(newPath, 0));
  assert.equal(newClosed.documents.some(({ path }) => path === "new/nested.ts"), false);

  refused(session, () => session.open(join(otherRoot, "outside.ts"), 0, "outside"), "FADENO_ANALYZER_DOCUMENT_ESCAPE");
  refused(session, () => session.open("https://example.test/file.ts", 0, "scheme"), "FADENO_ANALYZER_DOCUMENT_SCHEME");
  refused(session, () => session.open("file://remote/tmp/file.ts", 0, "authority"), "FADENO_ANALYZER_URI_AUTHORITY");
  refused(session, () => session.open(`${pathToFileURL(documentPath).href}?query=1`, 0, "query"), "FADENO_ANALYZER_URI_QUERY");
  refused(session, () => session.open(`${pathToFileURL(documentPath).href}#fragment`, 0, "fragment"), "FADENO_ANALYZER_URI_FRAGMENT");
  refused(session, () => session.open(root, 0, "root"), "FADENO_ANALYZER_DOCUMENT_ROOT");
  refused(session, () => session.open(sourceDirectory, 0, "directory"), "FADENO_ANALYZER_DOCUMENT_DIRECTORY");
  refused(session, () => session.open(symlinkPath, 0, "symlink"), "FADENO_ANALYZER_DOCUMENT_SYMLINK");
  refused(session, () => session.open(invalidUtf8, 0, "overlay"), "FADENO_ANALYZER_DOCUMENT_ENCODING");

  const finalSnapshot = session.currentSnapshot;
  assert.equal(finalSnapshot.documents.find(({ path }) => path === "src/document.ts")?.effective.text, reference.saved);
  assert.equal(new Set(operationIds).size, operationIds.size);
  assert.ok(operationIds.size >= 20);
  console.log("V1 analyzer B1 passed (ownership, saved/overlay sync, transactions, refusals, immutable snapshots)");
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(otherRoot, { recursive: true, force: true });
}
