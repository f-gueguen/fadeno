import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  AnalyzerSession,
  type AnalyzerDocumentOnlySnapshot,
  type AnalyzerOperationResult,
  type AnalyzerRefusalCode,
} from "../packages/framework/src/internal/analyzer-session.ts";
import {
  ANALYZER_FACET_LIMITS,
  deserializeAnalyzerFacetSnapshot,
  readAnalyzerFacet,
  serializeAnalyzerFacetSnapshot,
  type AnalyzerFacetOperationResult,
  type AnalyzerFacetRequest,
  type AnalyzerFacetValue,
} from "../packages/framework/src/internal/analyzer-facets.ts";

interface ReferenceDocument {
  epoch: number;
  saved: string;
  savedRevision: number;
  overlay?: string;
  version?: number;
  lifetime: number;
}

type ReferenceOperation =
  | Readonly<{ kind: "open"; version: number; text: string }>
  | Readonly<{ kind: "save"; text: string }>
  | Readonly<{ kind: "change"; lifetime: number; version: number; edits: readonly Readonly<{ start: number; end: number; text: string }>[] }>
  | Readonly<{ kind: "replace"; lifetime: number; version: number; text: string }>
  | Readonly<{ kind: "close"; lifetime: number; version: number }>;

interface ReferenceState {
  epoch: number;
  saved: string;
  savedRevision: number;
  overlay?: string;
  version?: number;
  lifetime?: number;
  nextLifetime: number;
}

function referenceTransition(state: ReferenceState, operation: ReferenceOperation): Readonly<{ accepted: boolean; state: ReferenceState }> {
  const next: ReferenceState = { ...state };
  const accept = (): Readonly<{ accepted: true; state: ReferenceState }> => {
    next.epoch += 1;
    return { accepted: true, state: next };
  };
  if (operation.kind === "open") {
    if (!Number.isSafeInteger(operation.version) || operation.version < 0 || next.version !== undefined) return { accepted: false, state };
    next.nextLifetime += 1;
    next.lifetime = next.nextLifetime;
    next.version = operation.version;
    next.overlay = operation.text;
    return accept();
  }
  if (operation.kind === "save") {
    next.saved = operation.text;
    next.savedRevision += 1;
    return accept();
  }
  if (next.version === undefined || next.overlay === undefined || next.lifetime !== operation.lifetime) return { accepted: false, state };
  if (operation.kind === "close") {
    if (operation.version !== next.version) return { accepted: false, state };
    delete next.overlay;
    delete next.version;
    delete next.lifetime;
    return accept();
  }
  if (operation.version <= next.version) return { accepted: false, state };
  if (operation.kind === "replace") {
    next.overlay = operation.text;
    next.version = operation.version;
    return accept();
  }
  let text = next.overlay;
  for (const edit of operation.edits) {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < 0 || edit.end < edit.start || edit.end > text.length) {
      return { accepted: false, state };
    }
    text = `${text.slice(0, edit.start)}${edit.text}${text.slice(edit.end)}`;
  }
  next.overlay = text;
  next.version = operation.version;
  return accept();
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

function acceptedFacets(result: AnalyzerFacetOperationResult) {
  assert.ok(!operationIds.has(result.operationId), `duplicate operation ID ${result.operationId}`);
  operationIds.add(result.operationId);
  assert.ok(Object.isFrozen(result));
  assert.equal(result.accepted, true);
  return result.snapshot;
}

function refusedFacets(session: AnalyzerSession, action: () => AnalyzerFacetOperationResult, code: string): void {
  const before = session.currentSnapshot;
  const result = action();
  assert.ok(!operationIds.has(result.operationId), `duplicate operation ID ${result.operationId}`);
  operationIds.add(result.operationId);
  assert.ok(Object.isFrozen(result));
  assert.equal(result.accepted, false);
  assert.equal(result.code, code);
  assert.equal(result.currentEpoch, before.workspaceEpoch);
  assert.equal(session.currentSnapshot, before);
}

function refused(
  session: AnalyzerSession,
  action: () => AnalyzerOperationResult,
  code: AnalyzerRefusalCode,
  current?: Readonly<{ version: number | null; lifetime: number | null }>,
): void {
  const before = session.currentSnapshot;
  const result = record(action());
  assert.equal(result.accepted, false);
  assert.equal(result.code, code);
  assert.equal(result.currentEpoch, before.workspaceEpoch);
  if (current) {
    assert.equal(result.currentDocumentVersion, current.version);
    assert.equal(result.currentLifetime, current.lifetime);
  }
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
  const replacementSession = new AnalyzerSession(root);
  const initial = session.currentSnapshot;
  assert.notEqual(initial.sessionId, replacementSession.currentSnapshot.sessionId);
  assert.notEqual(initial.operationId, replacementSession.currentSnapshot.operationId);
  assert.equal(initial.workspaceEpoch, 0);
  assert.equal(initial.operation, "initialize");
  assert.deepEqual(initial.requestedFacets, []);
  assert.deepEqual(initial.documents, []);
  assert.ok(Object.isFrozen(initial));
  assert.ok(Object.isFrozen(initial.documents));
  assert.ok(Object.isFrozen(initial.ownership));

  const replacementOpened = accepted(replacementSession.open(documentPath, 0, "replacement overlay"));
  const replacementClosed = accepted(replacementSession.close(documentPath, 1, 0));
  assert.equal(replacementClosed.documents[0]?.effective.text, initialSaved, "initial BOM/CRLF backing text changed");

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
  assert.equal(opened.workspaceEpoch, replacementOpened.workspaceEpoch);
  assert.equal(opened.documentVersions[0]?.version, replacementOpened.documentVersions[0]?.version);
  assert.equal(opened.documentVersions[0]?.lifetime, replacementOpened.documentVersions[0]?.lifetime);
  assert.notEqual(opened.sessionId, replacementOpened.sessionId, "session restart identity collided");
  assert.notEqual(opened.operationId, replacementOpened.operationId, "cross-session operation identity collided");
  assert.equal(Object.isFrozen(opened.documents[0]?.effective), true);
  assert.equal(Reflect.set(opened.documents[0]!.effective, "text", "mutated"), false);
  assert.throws(() => (opened.documents as unknown[]).push({}), TypeError);

  reference.saved = "saved while open\r\n新";
  refused(
    session,
    () => session.save(documentPath, reference.saved),
    "FADENO_ANALYZER_SAVED_MISMATCH",
    { version: 0, lifetime: 1 },
  );
  writeFileSync(documentPath, reference.saved);
  reference.epoch += 1;
  reference.savedRevision += 1;
  const savedWhileOpen = accepted(session.save(documentPath, reference.saved));
  assertDocument(savedWhileOpen, "src/document.ts", reference);
  assert.equal(opened.documents[0]?.effective.text, "alpha\r\nβ", "prior snapshot changed");

  reference.epoch += 1;
  reference.overlay = "A--β";
  reference.version = 1;
  const changed = accepted(session.change(documentPath, 1, 1, [
    { start: 0, end: 5, text: "A" },
    { start: 1, end: 3, text: "--" },
  ]));
  assertDocument(changed, "src/document.ts", reference);

  refused(session, () => session.change(documentPath, 1, 2, [
    { start: 0, end: 1, text: "valid-prefix" },
    { start: 999, end: 1000, text: "invalid-later-edit" },
  ]), "FADENO_ANALYZER_EDIT_RANGE", { version: 1, lifetime: 1 });
  assertDocument(session.currentSnapshot, "src/document.ts", reference);
  for (const edits of [
    [{ start: 2, end: 1, text: "reversed" }],
    [{ start: 0.5, end: 1, text: "fractional" }],
    [{ start: -1, end: 0, text: "negative" }],
  ]) refused(session, () => session.change(documentPath, 1, 2, edits), "FADENO_ANALYZER_EDIT_RANGE", { version: 1, lifetime: 1 });
  refused(session, () => session.change(documentPath, 1, 1, []), "FADENO_ANALYZER_VERSION", { version: 1, lifetime: 1 });
  refused(session, () => session.change(documentPath, 1, 0, []), "FADENO_ANALYZER_VERSION", { version: 1, lifetime: 1 });

  reference.epoch += 1;
  reference.overlay = "\uFEFFline\r\n😀";
  reference.version = 2;
  assertDocument(accepted(session.replace(documentPath, 1, 2, reference.overlay)), "src/document.ts", reference);
  refused(session, () => session.replace(documentPath, 1, 2, "equal-version"), "FADENO_ANALYZER_VERSION", { version: 2, lifetime: 1 });
  reference.epoch += 1;
  reference.version = 3;
  assertDocument(accepted(session.replace(documentPath, 1, 3, reference.overlay)), "src/document.ts", reference);

  reference.epoch += 1;
  reference.savedRevision += 1;
  const identicalSave = accepted(session.save(documentPath, reference.saved));
  assertDocument(identicalSave, "src/document.ts", reference);

  refused(session, () => session.close(documentPath, 1, 2), "FADENO_ANALYZER_CLOSE_VERSION", { version: 3, lifetime: 1 });
  reference.epoch += 1;
  delete reference.overlay;
  delete reference.version;
  const closed = accepted(session.close(documentPath, 1, 3));
  assertDocument(closed, "src/document.ts", reference);
  refused(session, () => session.close(documentPath, 1, 3), "FADENO_ANALYZER_DOCUMENT_CLOSED", { version: null, lifetime: null });

  reference.epoch += 1;
  reference.overlay = "restart\r\n寿";
  reference.version = 0;
  reference.lifetime = 2;
  const reopened = accepted(session.open(pathToFileURL(documentPath).href, 0, reference.overlay));
  assertDocument(reopened, "src/document.ts", reference);
  assert.equal(closed.documents[0]?.open, null);
  assert.equal(reopened.documentVersions[0]?.lifetime, 2);
  refused(session, () => session.open(documentPath, 1, "duplicate"), "FADENO_ANALYZER_DOCUMENT_OPEN");
  refused(session, () => session.change(documentPath, 1, 4, []), "FADENO_ANALYZER_LIFETIME", { version: 0, lifetime: 2 });

  reference.epoch += 1;
  delete reference.overlay;
  delete reference.version;
  assertDocument(accepted(session.close(documentPath, 2, 0)), "src/document.ts", reference);

  const spacedOpen = accepted(session.open(spacedPath, 0, "overlay space"));
  assert.equal(spacedOpen.documents.find(({ path }) => path === "src/space name.ts")?.effective.text, "overlay space");
  refused(session, () => session.open(pathToFileURL(spacedPath).href.replace("space%20name", "space%20name"), 1, "alias"), "FADENO_ANALYZER_DOCUMENT_OPEN");
  accepted(session.close(spacedPath, 1, 0));

  const newPath = join(root, "new", "nested.ts");
  refused(session, () => session.open(newPath, -1, "invalid"), "FADENO_ANALYZER_VERSION", { version: null, lifetime: null });
  refused(session, () => session.open(newPath, 0.5, "invalid"), "FADENO_ANALYZER_VERSION", { version: null, lifetime: null });
  const newOpen = accepted(session.open(newPath, 0, "new\r\nfile"));
  assert.equal(newOpen.documents.find(({ path }) => path === "new/nested.ts")?.effective.text, "new\r\nfile");
  const newClosed = accepted(session.close(newPath, 1, 0));
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
  const saveUnknown = session.save.bind(session) as unknown as (document: string, text: unknown) => AnalyzerOperationResult;
  refused(session, () => saveUnknown(documentPath, 42), "FADENO_ANALYZER_TEXT", { version: null, lifetime: null });

  const reconcileSession = new AnalyzerSession(root);
  const retainedRoots = ["first", "second", "third"].map((name) => {
    const directory = join(root, "retained", name);
    mkdirSync(directory, { recursive: true });
    const path = join(directory, "page.tsx");
    const text = `export default ${JSON.stringify(name)};\n`;
    writeFileSync(path, text);
    return { name, path, text };
  });
  let reconciled = accepted(reconcileSession.reconcile({
    documents: [{ document: retainedRoots[0]!.path, text: retainedRoots[0]!.text, expectedOpen: null }],
    forget: [],
  }));
  assert.equal(reconciled.operation, "reconcile");
  assert.deepEqual(reconciled.documents.map(({ path }) => path), ["retained/first/page.tsx"]);
  const firstIdentity = reconciled.documents[0]!.open!;
  reconciled = accepted(reconcileSession.reconcile({
    documents: [{ document: retainedRoots[1]!.path, text: retainedRoots[1]!.text, expectedOpen: null }],
    forget: [{ document: retainedRoots[0]!.path, expectedOpen: firstIdentity }],
  }));
  assert.deepEqual(reconciled.documents.map(({ path }) => path), ["retained/second/page.tsx"]);
  assert.equal(readFileSync(retainedRoots[0]!.path, "utf8"), retainedRoots[0]!.text, "forget removed an existing source");
  const secondIdentity = reconciled.documents[0]!.open!;
  const beforeFailedReconcile = reconcileSession.currentSnapshot;
  refused(reconcileSession, () => reconcileSession.reconcile({
    documents: [
      { document: retainedRoots[2]!.path, text: retainedRoots[2]!.text, expectedOpen: null },
      { document: pathToFileURL(retainedRoots[2]!.path).href, text: retainedRoots[2]!.text, expectedOpen: null },
    ],
    forget: [{ document: retainedRoots[1]!.path, expectedOpen: secondIdentity }],
  }), "FADENO_ANALYZER_RECONCILE_DUPLICATE");
  assert.equal(reconcileSession.currentSnapshot, beforeFailedReconcile);
  refused(reconcileSession, () => reconcileSession.reconcile({
    documents: [{ document: symlinkPath, text: readFileSync(documentPath, "utf8"), expectedOpen: null }],
    forget: [{ document: retainedRoots[1]!.path, expectedOpen: secondIdentity }],
  }), "FADENO_ANALYZER_DOCUMENT_SYMLINK");
  assert.equal(reconcileSession.currentSnapshot, beforeFailedReconcile);
  refused(reconcileSession, () => reconcileSession.reconcile({
    documents: [{ document: retainedRoots[2]!.path, text: retainedRoots[2]!.text, expectedOpen: null }],
    forget: [{ document: retainedRoots[1]!.path, expectedOpen: { lifetime: secondIdentity.lifetime + 1, version: secondIdentity.version } }],
  }), "FADENO_ANALYZER_LIFETIME");
  assert.equal(reconcileSession.currentSnapshot, beforeFailedReconcile);
  refused(reconcileSession, () => reconcileSession.reconcile({
    documents: [{ document: retainedRoots[2]!.path, text: "not-authoritative", expectedOpen: null }],
    forget: [{ document: retainedRoots[1]!.path, expectedOpen: secondIdentity }],
  }), "FADENO_ANALYZER_SAVED_MISMATCH");
  assert.equal(reconcileSession.currentSnapshot, beforeFailedReconcile);
  refused(reconcileSession, () => reconcileSession.reconcile({
    documents: [{ document: retainedRoots[2]!.path, text: retainedRoots[2]!.text, expectedOpen: null }],
    forget: [{ document: retainedRoots[1]!.path, expectedOpen: { lifetime: secondIdentity.lifetime, version: secondIdentity.version + 1 } }],
  }), "FADENO_ANALYZER_CLOSE_VERSION");
  assert.equal(reconcileSession.currentSnapshot, beforeFailedReconcile);
  const updatedSecondText = "export default 'second-updated';\n";
  writeFileSync(retainedRoots[1]!.path, updatedSecondText);
  reconciled = accepted(reconcileSession.reconcile({
    documents: [{ document: retainedRoots[1]!.path, text: updatedSecondText, expectedOpen: secondIdentity }],
    forget: [],
  }));
  assert.equal(reconciled.documents[0]!.open!.version, secondIdentity.version + 1);
  const updatedSecondIdentity = reconciled.documents[0]!.open!;
  reconciled = accepted(reconcileSession.reconcile({
    documents: [{ document: retainedRoots[2]!.path, text: retainedRoots[2]!.text, expectedOpen: null }],
    forget: [{ document: retainedRoots[1]!.path, expectedOpen: updatedSecondIdentity }],
  }));
  assert.deepEqual(reconciled.documents.map(({ path }) => path), ["retained/third/page.tsx"]);
  assert.equal(reconciled.workspaceEpoch, 4, "reconcile did not commit exactly one epoch per batch");

  const unrelatedOpen = accepted(reconcileSession.open(documentPath, 9, "unsaved owner"));
  const unrelated = unrelatedOpen.documents.find(({ path }) => path === "src/document.ts")!;
  const beforeOpenRefusal = reconcileSession.currentSnapshot;
  refused(reconcileSession, () => reconcileSession.reconcile({
    documents: [],
    forget: [{ document: documentPath, expectedOpen: null }],
  }), "FADENO_ANALYZER_DOCUMENT_OPEN", { version: 9, lifetime: unrelated.open!.lifetime });
  assert.equal(reconcileSession.currentSnapshot, beforeOpenRefusal, "open-owner refusal changed the batch snapshot");

  const modelPath = join(sourceDirectory, "model.ts");
  writeFileSync(modelPath, "model-base\r\n");
  const modelSession = new AnalyzerSession(root);
  let model: ReferenceState = {
    epoch: 0,
    saved: "model-base\r\n",
    savedRevision: 0,
    nextLifetime: 0,
  };
  const modelOperations: readonly ReferenceOperation[] = [
    { kind: "open", version: 0, text: "alpha\r\nβ" },
    { kind: "save", text: "disk-update\n新" },
    { kind: "change", lifetime: 1, version: 1, edits: [{ start: 0, end: 5, text: "A" }, { start: 1, end: 3, text: "--" }] },
    { kind: "change", lifetime: 1, version: 2, edits: [{ start: 0, end: 1, text: "valid" }, { start: 99, end: 100, text: "invalid" }] },
    { kind: "replace", lifetime: 1, version: 2, text: "replacement" },
    { kind: "replace", lifetime: 1, version: 3, text: "replacement" },
    { kind: "close", lifetime: 1, version: 3 },
    { kind: "open", version: 0, text: "reopened" },
    { kind: "change", lifetime: 1, version: 4, edits: [] },
    { kind: "close", lifetime: 2, version: 0 },
  ];
  for (const operation of modelOperations) {
    if (operation.kind === "save") writeFileSync(modelPath, operation.text);
    const expectedTransition = referenceTransition(model, operation);
    let actual: AnalyzerOperationResult;
    if (operation.kind === "open") actual = modelSession.open(modelPath, operation.version, operation.text);
    else if (operation.kind === "save") actual = modelSession.save(modelPath, operation.text);
    else if (operation.kind === "change") actual = modelSession.change(modelPath, operation.lifetime, operation.version, operation.edits);
    else if (operation.kind === "replace") actual = modelSession.replace(modelPath, operation.lifetime, operation.version, operation.text);
    else actual = modelSession.close(modelPath, operation.lifetime, operation.version);
    record(actual);
    assert.equal(actual.accepted, expectedTransition.accepted, `reference disagreement for ${operation.kind}`);
    if (actual.accepted) model = expectedTransition.state;
    else assert.equal(model, expectedTransition.state, `reference refusal mutated ${operation.kind}`);
    assert.equal(modelSession.currentSnapshot.workspaceEpoch, model.epoch);
    const actualDocument = modelSession.currentSnapshot.documents.find(({ path }) => path === "src/model.ts");
    assert.ok(actualDocument);
    assert.equal(actualDocument.savedRevision, model.savedRevision);
    assert.equal(actualDocument.open?.version, model.version);
    assert.equal(actualDocument.open?.lifetime, model.lifetime);
    assert.equal(actualDocument.effective.text, model.overlay ?? model.saved);
  }

  const facetPath = join(sourceDirectory, "facet.ts");
  writeFileSync(facetPath, "saved facet\n");
  const facetSession = new AnalyzerSession(root);
  const facetBase = accepted(facetSession.open(facetPath, 4, "overlay facet\r\n"));
  const facetSnapshot = acceptedFacets(facetSession.snapshotFacets(
    [
      { namespace: "fadeno.routes" },
      { namespace: "fadeno.explain" },
      { namespace: "fadeno.diagnostics" },
      { namespace: "fadeno.future" },
    ],
    [
      {
        namespace: "fadeno.future",
        version: 7,
        value: { opaque: ["preserved", null, true] },
      },
      {
        namespace: "fadeno.routes",
        version: 3,
        value: { decisions: [{ owner: "src/facet.ts", selected: true }] },
      },
      {
        namespace: "fadeno.diagnostics",
        version: 1,
        value: { records: [{ code: "FADENO_SAMPLE", range: null }], skipped: [] },
      },
    ],
  ));
  assert.equal(facetSession.currentSnapshot, facetBase, "derived facets replaced document authority");
  assert.equal(facetSnapshot.workspaceEpoch, facetBase.workspaceEpoch);
  assert.equal(facetSnapshot.schemaVersion, 2);
  assert.deepEqual(facetSnapshot.requestedFacets.map(({ namespace }) => namespace), [
    "fadeno.diagnostics", "fadeno.explain", "fadeno.future", "fadeno.routes",
  ]);
  assert.deepEqual(facetSnapshot.facets.map(({ namespace, version }) => [namespace, version]), [
    ["fadeno.diagnostics", 1], ["fadeno.future", 7], ["fadeno.routes", 3],
  ]);
  assert.equal(Object.isFrozen(facetSnapshot), true);
  assert.equal(Object.isFrozen(facetSnapshot.facets), true);
  assert.equal(Object.isFrozen(facetSnapshot.facets[0]?.value), true);
  assert.equal(Reflect.set(facetSnapshot.facets[0]!, "version", 9), false);

  assert.deepEqual(readAnalyzerFacet(facetSnapshot, "fadeno.explain", { "fadeno.explain": 1 }), { state: "absent" });
  assert.deepEqual(readAnalyzerFacet(facetSnapshot, "fadeno.future", {}), {
    state: "unknown", namespace: "fadeno.future", version: 7, opaque: { opaque: ["preserved", null, true] },
  });
  assert.deepEqual(readAnalyzerFacet(facetSnapshot, "fadeno.routes", { "fadeno.routes": 2 }), {
    state: "newer", namespace: "fadeno.routes", version: 3, supportedVersion: 2,
    opaque: { decisions: [{ owner: "src/facet.ts", selected: true }] },
  });
  assert.equal(readAnalyzerFacet(facetSnapshot, "fadeno.diagnostics", { "fadeno.diagnostics": 1 }).state, "supported");

  const serialized = serializeAnalyzerFacetSnapshot(facetSnapshot);
  const roundTrip = deserializeAnalyzerFacetSnapshot(serialized);
  assert.deepEqual(roundTrip, facetSnapshot);
  assert.equal(serializeAnalyzerFacetSnapshot(roundTrip), serialized);
  assert.equal(Object.isFrozen(roundTrip), true);
  assert.equal(Object.isFrozen(roundTrip.documents[0]?.effective), true);
  assert.equal(Object.isFrozen(roundTrip.facets[1]?.value), true);
  assert.equal(readAnalyzerFacet(roundTrip, "fadeno.future", {}).state, "unknown");
  assert.equal(readAnalyzerFacet(roundTrip, "fadeno.routes", { "fadeno.routes": 2 }).state, "newer");

  const hostileKeys = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}') as AnalyzerFacetValue;
  const hostileSnapshot = acceptedFacets(facetSession.snapshotFacets(
    [{ namespace: "fadeno.keys" }], [{ namespace: "fadeno.keys", version: 1, value: hostileKeys }],
  ));
  const hostileRoundTrip = deserializeAnalyzerFacetSnapshot(serializeAnalyzerFacetSnapshot(hostileSnapshot));
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
  assert.deepEqual(hostileRoundTrip.facets[0]?.value, hostileKeys);

  const normalizedFixture = {
    analyzerVersion: facetSnapshot.analyzerVersion,
    schemaVersion: facetSnapshot.schemaVersion,
    sessionId: "<session>",
    operationId: "<operation>",
    operation: facetSnapshot.operation,
    workspaceEpoch: facetSnapshot.workspaceEpoch,
    requestedFacets: facetSnapshot.requestedFacets,
    documentVersions: facetSnapshot.documentVersions.map((entry) => ({ ...entry, uri: "<document>" })),
    ownership: { ...facetSnapshot.ownership, root: "<root>" },
    documents: facetSnapshot.documents.map((entry) => ({ ...entry, uri: "<document>" })),
    facets: facetSnapshot.facets,
    completeness: facetSnapshot.completeness,
    interruption: facetSnapshot.interruption,
    truncated: facetSnapshot.truncated,
  };
  const expectedFixture = JSON.parse(readFileSync(new URL("../fixtures/v1-analyzer/facets.normalized.json", import.meta.url), "utf8"));
  assert.deepEqual(normalizedFixture, expectedFixture);

  refusedFacets(facetSession, () => facetSession.snapshotFacets(
    [{ namespace: "fadeno.routes" }, { namespace: "fadeno.routes" }], [],
  ), "FADENO_ANALYZER_FACET_DUPLICATE");
  refusedFacets(facetSession, () => facetSession.snapshotFacets(
    [{ namespace: "fadeno.routes" }], [{ namespace: "fadeno.explain", version: 1, value: null }],
  ), "FADENO_ANALYZER_FACET_UNREQUESTED");
  refusedFacets(facetSession, () => facetSession.snapshotFacets(
    [{ namespace: "routes" }], [],
  ), "FADENO_ANALYZER_FACET_NAMESPACE");
  refusedFacets(facetSession, () => facetSession.snapshotFacets(
    [{ namespace: "fadeno.routes" }], [{ namespace: "fadeno.routes", version: 0, value: null }],
  ), "FADENO_ANALYZER_FACET_VERSION");
  for (const invalidValue of [Number.NaN, Number.POSITIVE_INFINITY, -0, undefined, new Date()] as unknown[]) {
    refusedFacets(facetSession, () => facetSession.snapshotFacets(
      [{ namespace: "fadeno.routes" }],
      [{ namespace: "fadeno.routes", version: 1, value: invalidValue as AnalyzerFacetValue }],
    ), "FADENO_ANALYZER_FACET_VALUE");
  }
  const sparse: AnalyzerFacetValue[] = [];
  sparse.length = 1;
  refusedFacets(facetSession, () => facetSession.snapshotFacets(
    [{ namespace: "fadeno.routes" }], [{ namespace: "fadeno.routes", version: 1, value: sparse }],
  ), "FADENO_ANALYZER_FACET_VALUE");
  const accessor = Object.defineProperty({}, "secret", { enumerable: true, get: () => "value" });
  refusedFacets(facetSession, () => facetSession.snapshotFacets(
    [{ namespace: "fadeno.routes" }], [{ namespace: "fadeno.routes", version: 1, value: accessor as AnalyzerFacetValue }],
  ), "FADENO_ANALYZER_FACET_VALUE");
  let indexedAccessorExecutions = 0;
  const indexedAccessor = ["placeholder"];
  Object.defineProperty(indexedAccessor, "0", {
    enumerable: true,
    get: () => {
      indexedAccessorExecutions += 1;
      return "executed";
    },
  });
  refusedFacets(facetSession, () => facetSession.snapshotFacets(
    [{ namespace: "fadeno.routes" }],
    [{ namespace: "fadeno.routes", version: 1, value: indexedAccessor as unknown as AnalyzerFacetValue }],
  ), "FADENO_ANALYZER_FACET_VALUE");
  assert.equal(indexedAccessorExecutions, 0, "array accessor executed during refusal");
  const arrayWithExtra = ["value"] as string[] & { extra?: string };
  arrayWithExtra.extra = "discarded";
  refusedFacets(facetSession, () => facetSession.snapshotFacets(
    [{ namespace: "fadeno.routes" }],
    [{ namespace: "fadeno.routes", version: 1, value: arrayWithExtra as unknown as AnalyzerFacetValue }],
  ), "FADENO_ANALYZER_FACET_VALUE");
  const arrayWithHidden = ["value"];
  Object.defineProperty(arrayWithHidden, "hidden", { value: "discarded", enumerable: false });
  refusedFacets(facetSession, () => facetSession.snapshotFacets(
    [{ namespace: "fadeno.routes" }],
    [{ namespace: "fadeno.routes", version: 1, value: arrayWithHidden as unknown as AnalyzerFacetValue }],
  ), "FADENO_ANALYZER_FACET_VALUE");
  const arrayWithSymbol = ["value"];
  Object.defineProperty(arrayWithSymbol, Symbol("hidden"), { value: "discarded", enumerable: true });
  refusedFacets(facetSession, () => facetSession.snapshotFacets(
    [{ namespace: "fadeno.routes" }],
    [{ namespace: "fadeno.routes", version: 1, value: arrayWithSymbol as unknown as AnalyzerFacetValue }],
  ), "FADENO_ANALYZER_FACET_VALUE");
  const proxiedValue = new Proxy({ safe: true }, {});
  refusedFacets(facetSession, () => facetSession.snapshotFacets(
    [{ namespace: "fadeno.routes" }],
    [{ namespace: "fadeno.routes", version: 1, value: proxiedValue as AnalyzerFacetValue }],
  ), "FADENO_ANALYZER_FACET_VALUE");
  let tooDeep: AnalyzerFacetValue = null;
  for (let depth = 0; depth <= ANALYZER_FACET_LIMITS.maximumDepth; depth += 1) tooDeep = [tooDeep];
  const tooDeepValue = tooDeep;
  refusedFacets(facetSession, () => facetSession.snapshotFacets(
    [{ namespace: "fadeno.routes" }], [{ namespace: "fadeno.routes", version: 1, value: tooDeepValue }],
  ), "FADENO_ANALYZER_FACET_LIMIT");
  refusedFacets(facetSession, () => facetSession.snapshotFacets(
    [{ namespace: "fadeno.routes" }],
    [{ namespace: "fadeno.routes", version: 1, value: "x".repeat(ANALYZER_FACET_LIMITS.maximumFacetBytes) }],
  ), "FADENO_ANALYZER_FACET_LIMIT");
  const tooManyNodes = Array.from({ length: ANALYZER_FACET_LIMITS.maximumNodes }, () => null);
  refusedFacets(facetSession, () => facetSession.snapshotFacets(
    [{ namespace: "fadeno.routes" }], [{ namespace: "fadeno.routes", version: 1, value: tooManyNodes }],
  ), "FADENO_ANALYZER_FACET_LIMIT");
  const aggregateRequests = Array.from({ length: 5 }, (_, index) => ({ namespace: `fadeno.total-${index}` }));
  const aggregateContributions = aggregateRequests.map(({ namespace }) => ({
    namespace,
    version: 1,
    value: "x".repeat(60_000),
  }));
  refusedFacets(facetSession, () => facetSession.snapshotFacets(
    aggregateRequests, aggregateContributions,
  ), "FADENO_ANALYZER_FACET_LIMIT");
  const tooManyRequests: AnalyzerFacetRequest[] = Array.from(
    { length: ANALYZER_FACET_LIMITS.maximumFacets + 1 },
    (_, index) => ({ namespace: `fadeno.module-${index}` }),
  );
  refusedFacets(facetSession, () => facetSession.snapshotFacets(tooManyRequests, []), "FADENO_ANALYZER_FACET_LIMIT");

  const parsed = JSON.parse(serialized) as Record<string, unknown>;
  parsed["serializationVersion"] = 2;
  assert.throws(() => deserializeAnalyzerFacetSnapshot(JSON.stringify(parsed)), /FADENO_ANALYZER_SERIALIZATION/u);
  const malformed = JSON.parse(serialized) as { snapshot: { documentVersions: Array<{ version: number }> } };
  malformed.snapshot.documentVersions[0]!.version += 1;
  assert.throws(() => deserializeAnalyzerFacetSnapshot(JSON.stringify(malformed)), /FADENO_ANALYZER_SERIALIZATION/u);
  for (const mutate of [
    (value: any) => { value.snapshot.ownership.root = "not-a-uri"; },
    (value: any) => { value.snapshot.documents[0].path = "../escape"; },
    (value: any) => { value.snapshot.documents[0].uri = pathToFileURL(join(otherRoot, "external.ts")).href; },
    (value: any) => { value.snapshot.operationId = "unrelated:operation-1"; },
    (value: any) => { value.snapshot.sessionId = "not-a-session"; },
  ]) {
    const invalidOwnership = JSON.parse(serialized);
    mutate(invalidOwnership);
    assert.throws(
      () => deserializeAnalyzerFacetSnapshot(JSON.stringify(invalidOwnership)),
      /FADENO_ANALYZER_SERIALIZATION/u,
    );
  }
  assert.throws(
    () => serializeAnalyzerFacetSnapshot({ ...facetSnapshot, schemaVersion: 3 as 2 }),
    /FADENO_ANALYZER_SERIALIZATION/u,
  );

  const finalSnapshot = session.currentSnapshot;
  assert.equal(finalSnapshot.documents.find(({ path }) => path === "src/document.ts")?.effective.text, reference.saved);
  assert.equal(new Set(operationIds).size, operationIds.size);
  assert.ok(operationIds.size >= 20);
  console.log("V1 analyzer B1/B2 passed (document sync, bounded facets, explicit compatibility, lossless round trips)");
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(otherRoot, { recursive: true, force: true });
}
