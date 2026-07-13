import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createAnalyzerFacetSnapshot,
  type AnalyzerFacetContribution,
  type AnalyzerFacetOperationResult,
  type AnalyzerFacetRequest,
} from "./analyzer-facets.ts";
import {
  AnalyzerDependencyGraph,
  type AnalyzerGraphNodeDefinition,
  type AnalyzerGraphOperationResult,
} from "./analyzer-graph.ts";
import {
  AnalyzerPublicationCoordinator,
  type AnalyzerPublicationHandle,
  type AnalyzerPublicationRequest,
  type AnalyzerPublicationSnapshot,
} from "./analyzer-publication.ts";
import {
  AnalyzerExplainCoordinator,
  type AnalyzerExplainHandle,
  type AnalyzerExplainRequest,
} from "./analyzer-explain.ts";

export type AnalyzerRefusalCode =
  | "FADENO_ANALYZER_DOCUMENT_SCHEME"
  | "FADENO_ANALYZER_URI_AUTHORITY"
  | "FADENO_ANALYZER_URI_QUERY"
  | "FADENO_ANALYZER_URI_FRAGMENT"
  | "FADENO_ANALYZER_DOCUMENT_ESCAPE"
  | "FADENO_ANALYZER_DOCUMENT_ROOT"
  | "FADENO_ANALYZER_DOCUMENT_SYMLINK"
  | "FADENO_ANALYZER_DOCUMENT_DIRECTORY"
  | "FADENO_ANALYZER_DOCUMENT_TYPE"
  | "FADENO_ANALYZER_DOCUMENT_PARENT"
  | "FADENO_ANALYZER_DOCUMENT_EXISTS"
  | "FADENO_ANALYZER_DOCUMENT_UNKNOWN"
  | "FADENO_ANALYZER_DOCUMENT_ENCODING"
  | "FADENO_ANALYZER_SAVED_MISMATCH"
  | "FADENO_ANALYZER_DOCUMENT_OPEN"
  | "FADENO_ANALYZER_DOCUMENT_CLOSED"
  | "FADENO_ANALYZER_LIFETIME"
  | "FADENO_ANALYZER_VERSION"
  | "FADENO_ANALYZER_CLOSE_VERSION"
  | "FADENO_ANALYZER_EDIT_RANGE"
  | "FADENO_ANALYZER_TEXT"
  | "FADENO_ANALYZER_CONFIGURATION_IDENTITY"
  | "FADENO_ANALYZER_RECONCILE_INPUT"
  | "FADENO_ANALYZER_RECONCILE_DUPLICATE";

export type AnalyzerRootRefusalCode =
  | "FADENO_ANALYZER_ROOT"
  | "FADENO_ANALYZER_ROOT_MISSING"
  | "FADENO_ANALYZER_ROOT_OWNERSHIP";

export class AnalyzerRootError extends TypeError {
  readonly code: AnalyzerRootRefusalCode;

  constructor(code: AnalyzerRootRefusalCode) {
    super(code);
    this.name = "AnalyzerRootError";
    this.code = code;
  }
}

export interface AnalyzerTextEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface AnalyzerReconcileOpenIdentity {
  readonly lifetime: number;
  readonly version: number;
}

export interface AnalyzerReconcileDocument {
  readonly document: string;
  readonly text: string;
  readonly expectedOpen: AnalyzerReconcileOpenIdentity | null;
}

export interface AnalyzerReconcileForget {
  readonly document: string;
  readonly expectedOpen: AnalyzerReconcileOpenIdentity | null;
}

export interface AnalyzerReconcileRequest {
  readonly documents: readonly AnalyzerReconcileDocument[];
  readonly forget: readonly AnalyzerReconcileForget[];
}

export interface AnalyzerDocumentSnapshot {
  readonly path: string;
  readonly uri: string;
  readonly savedRevision: number;
  readonly open: Readonly<{ version: number; lifetime: number }> | null;
  readonly effective: Readonly<{ source: "saved" | "overlay"; text: string }>;
}

export interface AnalyzerDocumentVersion {
  readonly uri: string;
  readonly version: number;
  readonly lifetime: number;
}

export interface AnalyzerDocumentOnlySnapshot {
  readonly analyzerVersion: 1;
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly operationId: string;
  readonly operation: "initialize" | "save" | "open" | "change" | "replace" | "close" | "remove" | "reconcile" | "configuration";
  readonly workspaceEpoch: number;
  readonly requestedFacets: readonly [];
  readonly documentVersions: readonly AnalyzerDocumentVersion[];
  readonly ownership: Readonly<{ mode: "single-root"; root: string }>;
  readonly documents: readonly AnalyzerDocumentSnapshot[];
  readonly completeness: "complete";
  readonly interruption: null;
  readonly truncated: false;
}

export type AnalyzerAccepted = Readonly<{
  accepted: true;
  operationId: string;
  snapshot: AnalyzerDocumentOnlySnapshot;
}>;

export type AnalyzerRefused = Readonly<{
  accepted: false;
  operationId: string;
  code: AnalyzerRefusalCode;
  currentEpoch: number;
  currentDocumentVersion: number | null;
  currentLifetime: number | null;
}>;

export type AnalyzerOperationResult = AnalyzerAccepted | AnalyzerRefused;

interface DocumentState {
  readonly owner: string;
  savedText?: string;
  savedRevision: number;
  overlayText?: string;
  overlayVersion?: number;
  overlayLifetime?: number;
  nextLifetime: number;
}

class Refusal extends Error {
  readonly code: AnalyzerRefusalCode;

  constructor(code: AnalyzerRefusalCode) {
    super(code);
    this.code = code;
  }
}

function refuse(code: AnalyzerRefusalCode): never {
  throw new Refusal(code);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function assertText(value: unknown): asserts value is string {
  if (typeof value !== "string") refuse("FADENO_ANALYZER_TEXT");
}

function assertVersion(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) refuse("FADENO_ANALYZER_VERSION");
}

export class AnalyzerSession {
  readonly #inputRoot: string;
  readonly #root: string;
  readonly #rootUri: string;
  readonly #sessionId = randomUUID();
  #documents = new Map<string, DocumentState>();
  #epoch = 0;
  #operationSequence = 0;
  #snapshot: AnalyzerDocumentOnlySnapshot;
  #configurationEpoch = 0;
  #configurationFingerprint = "0".repeat(64);
  readonly #dependencyGraph: AnalyzerDependencyGraph;
  readonly #publication: AnalyzerPublicationCoordinator;
  readonly #explain: AnalyzerExplainCoordinator;

  constructor(projectRoot: string) {
    if (typeof projectRoot !== "string" || !isAbsolute(projectRoot)) throw new AnalyzerRootError("FADENO_ANALYZER_ROOT");
    const absolute = resolve(projectRoot);
    if (!existsSync(absolute)) throw new AnalyzerRootError("FADENO_ANALYZER_ROOT_MISSING");
    const status = lstatSync(absolute);
    if (status.isSymbolicLink() || !status.isDirectory()) {
      throw new AnalyzerRootError("FADENO_ANALYZER_ROOT_OWNERSHIP");
    }
    this.#inputRoot = absolute;
    this.#root = realpathSync(absolute);
    this.#rootUri = pathToFileURL(this.#root.endsWith(sep) ? this.#root : `${this.#root}${sep}`).href;
    this.#snapshot = this.#createSnapshot(`${this.#sessionId}:initialize`, "initialize");
    this.#dependencyGraph = new AnalyzerDependencyGraph(() => ({
      snapshot: this.#snapshot,
      configurationEpoch: this.#configurationEpoch,
      configurationFingerprint: this.#configurationFingerprint,
    }));
    this.#publication = new AnalyzerPublicationCoordinator(
      () => ({
        snapshot: this.#snapshot,
        configurationEpoch: this.#configurationEpoch,
        configurationFingerprint: this.#configurationFingerprint,
      }),
      (operationId, definitions, signal) => this.#dependencyGraph.analyze(operationId, definitions, { commit: false, signal }),
      (operationId, expected) => this.#dependencyGraph.commitPrepared(operationId, expected),
    );
    this.#explain = new AnalyzerExplainCoordinator(() => ({
      publication: this.#publication.currentSnapshot,
      sessionId: this.#snapshot.sessionId,
      workspaceEpoch: this.#snapshot.workspaceEpoch,
      configurationEpoch: this.#configurationEpoch,
      configurationFingerprint: this.#configurationFingerprint,
      root: this.#snapshot.ownership.root,
      documentVersions: this.#snapshot.documentVersions,
    }));
  }

  get currentSnapshot(): AnalyzerDocumentOnlySnapshot {
    return this.#snapshot;
  }

  snapshotFacets(
    requests: readonly AnalyzerFacetRequest[],
    contributions: readonly AnalyzerFacetContribution[],
  ): AnalyzerFacetOperationResult {
    const operationId = `${this.#sessionId}:operation-${++this.#operationSequence}`;
    return createAnalyzerFacetSnapshot(this.#snapshot, operationId, requests, contributions);
  }

  analyzeGraph(definitions: readonly AnalyzerGraphNodeDefinition[]): AnalyzerGraphOperationResult {
    const operationId = `${this.#sessionId}:operation-${++this.#operationSequence}`;
    return this.#dependencyGraph.analyze(operationId, definitions);
  }

  get currentGraphSnapshot() {
    return this.#dependencyGraph.currentSnapshot;
  }

  startPublication(request: AnalyzerPublicationRequest): AnalyzerPublicationHandle {
    const operationId = `${this.#sessionId}:operation-${++this.#operationSequence}`;
    this.#explain.invalidate();
    return this.#publication.start(operationId, request);
  }

  get currentPublicationSnapshot(): AnalyzerPublicationSnapshot | null {
    return this.#publication.currentSnapshot;
  }

  startExplain(request: AnalyzerExplainRequest): AnalyzerExplainHandle {
    const operationId = `${this.#sessionId}:operation-${++this.#operationSequence}`;
    return this.#explain.start(operationId, request);
  }

  reloadConfiguration(fingerprint: string): AnalyzerOperationResult {
    const operationId = `${this.#sessionId}:operation-${++this.#operationSequence}`;
    if (typeof fingerprint !== "string" || !/^[0-9a-f]{64}$/u.test(fingerprint)) {
      return frozen({
        accepted: false as const,
        operationId,
        code: "FADENO_ANALYZER_CONFIGURATION_IDENTITY" as const,
        currentEpoch: this.#epoch,
        currentDocumentVersion: null,
        currentLifetime: null,
      });
    }
    this.#configurationEpoch += 1;
    this.#configurationFingerprint = fingerprint;
    this.#epoch += 1;
    this.#snapshot = this.#createSnapshot(operationId, "configuration");
    this.#publication.invalidate();
    this.#explain.invalidate();
    return frozen({ accepted: true as const, operationId, snapshot: this.#snapshot });
  }

  save(document: string, text: string): AnalyzerOperationResult {
    return this.#operate("save", document, (owner) => {
      assertText(text);
      let ownedText: string;
      try { ownedText = this.#readOwnedFile(owner); } catch (error) {
        if (error instanceof Refusal && error.code === "FADENO_ANALYZER_DOCUMENT_ENCODING") throw error;
        refuse("FADENO_ANALYZER_SAVED_MISMATCH");
      }
      if (ownedText !== text) refuse("FADENO_ANALYZER_SAVED_MISMATCH");
      const state = this.#documents.get(owner) ?? { owner, savedRevision: 0, nextLifetime: 0 };
      state.savedText = text;
      state.savedRevision += 1;
      this.#documents.set(owner, state);
    });
  }

  open(document: string, version: number, text: string): AnalyzerOperationResult {
    return this.#operate("open", document, (owner) => {
      assertVersion(version);
      assertText(text);
      const state = this.#documents.get(owner) ?? this.#initialState(owner);
      if (state.overlayVersion !== undefined) refuse("FADENO_ANALYZER_DOCUMENT_OPEN");
      state.nextLifetime += 1;
      state.overlayLifetime = state.nextLifetime;
      state.overlayVersion = version;
      state.overlayText = text;
      this.#documents.set(owner, state);
    });
  }

  change(document: string, lifetime: number, version: number, edits: readonly AnalyzerTextEdit[]): AnalyzerOperationResult {
    return this.#operate("change", document, (owner) => {
      assertVersion(version);
      const state = this.#requireOpen(owner, lifetime);
      if (version <= state.overlayVersion!) refuse("FADENO_ANALYZER_VERSION");
      if (!Array.isArray(edits)) refuse("FADENO_ANALYZER_EDIT_RANGE");
      let next = state.overlayText!;
      for (const edit of edits) {
        if (
          typeof edit !== "object" || edit === null || !Number.isInteger(edit.start) || !Number.isInteger(edit.end) ||
          edit.start < 0 || edit.end < edit.start || edit.end > next.length || typeof edit.text !== "string"
        ) refuse("FADENO_ANALYZER_EDIT_RANGE");
        next = `${next.slice(0, edit.start)}${edit.text}${next.slice(edit.end)}`;
      }
      state.overlayText = next;
      state.overlayVersion = version;
    });
  }

  replace(document: string, lifetime: number, version: number, text: string): AnalyzerOperationResult {
    return this.#operate("replace", document, (owner) => {
      assertVersion(version);
      assertText(text);
      const state = this.#requireOpen(owner, lifetime);
      if (version <= state.overlayVersion!) refuse("FADENO_ANALYZER_VERSION");
      state.overlayText = text;
      state.overlayVersion = version;
    });
  }

  close(document: string, lifetime: number, version: number): AnalyzerOperationResult {
    return this.#operate("close", document, (owner) => {
      assertVersion(version);
      const state = this.#requireOpen(owner, lifetime);
      if (version !== state.overlayVersion) refuse("FADENO_ANALYZER_CLOSE_VERSION");
      delete state.overlayText;
      delete state.overlayVersion;
      delete state.overlayLifetime;
    });
  }

  remove(document: string): AnalyzerOperationResult {
    return this.#operate("remove", document, (owner) => {
      const state = this.#documents.get(owner);
      if (!state) refuse("FADENO_ANALYZER_DOCUMENT_UNKNOWN");
      if (state.overlayVersion !== undefined) refuse("FADENO_ANALYZER_DOCUMENT_OPEN");
      if (existsSync(owner)) refuse("FADENO_ANALYZER_DOCUMENT_EXISTS");
      this.#documents.delete(owner);
    });
  }

  reconcile(request: AnalyzerReconcileRequest): AnalyzerOperationResult {
    const operationId = `${this.#sessionId}:operation-${++this.#operationSequence}`;
    let owner: string | undefined;
    try {
      if (!request || !Array.isArray(request.documents) || !Array.isArray(request.forget)) {
        refuse("FADENO_ANALYZER_RECONCILE_INPUT");
      }
      const seen = new Set<string>();
      const documents = request.documents.map((document) => {
        if (!document || typeof document !== "object") refuse("FADENO_ANALYZER_RECONCILE_INPUT");
        const canonicalOwner = this.#canonicalOwner(document.document);
        owner = canonicalOwner;
        if (seen.has(canonicalOwner)) refuse("FADENO_ANALYZER_RECONCILE_DUPLICATE");
        seen.add(canonicalOwner);
        assertText(document.text);
        this.#assertExpectedOpen(document.expectedOpen);
        let ownedText: string;
        try { ownedText = this.#readOwnedFile(canonicalOwner); } catch (error) {
          if (error instanceof Refusal && error.code === "FADENO_ANALYZER_DOCUMENT_ENCODING") throw error;
          refuse("FADENO_ANALYZER_SAVED_MISMATCH");
        }
        if (ownedText !== document.text) refuse("FADENO_ANALYZER_SAVED_MISMATCH");
        return { ...document, owner: canonicalOwner };
      });
      const forget = request.forget.map((document) => {
        if (!document || typeof document !== "object") refuse("FADENO_ANALYZER_RECONCILE_INPUT");
        const canonicalOwner = this.#canonicalOwner(document.document);
        owner = canonicalOwner;
        if (seen.has(canonicalOwner)) refuse("FADENO_ANALYZER_RECONCILE_DUPLICATE");
        seen.add(canonicalOwner);
        this.#assertExpectedOpen(document.expectedOpen);
        return { ...document, owner: canonicalOwner };
      });
      const next = new Map([...this.#documents].map(([key, state]) => [key, { ...state }]));

      for (const document of documents.sort((left, right) => compareText(left.owner, right.owner))) {
        const documentOwner = document.owner;
        owner = documentOwner;
        const state = next.get(documentOwner) ?? this.#initialState(documentOwner);
        this.#assertOpenIdentity(state, document.expectedOpen);
        if (state.savedText !== document.text) {
          state.savedText = document.text;
          state.savedRevision += 1;
        }
        if (state.overlayVersion === undefined) {
          state.nextLifetime += 1;
          state.overlayLifetime = state.nextLifetime;
          state.overlayVersion = 0;
          state.overlayText = document.text;
        } else if (state.overlayText !== document.text) {
          state.overlayText = document.text;
          state.overlayVersion += 1;
        }
        next.set(documentOwner, state);
      }
      for (const document of forget.sort((left, right) => compareText(left.owner, right.owner))) {
        const documentOwner = document.owner;
        owner = documentOwner;
        const state = next.get(documentOwner);
        if (!state) refuse("FADENO_ANALYZER_DOCUMENT_UNKNOWN");
        this.#assertOpenIdentity(state, document.expectedOpen);
        next.delete(documentOwner);
      }

      this.#documents = next;
      this.#epoch += 1;
      this.#snapshot = this.#createSnapshot(operationId, "reconcile");
      this.#publication.invalidate();
      this.#explain.invalidate();
      return frozen({ accepted: true as const, operationId, snapshot: this.#snapshot });
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      const state = owner === undefined ? undefined : this.#documents.get(owner);
      return frozen({
        accepted: false as const,
        operationId,
        code: error.code,
        currentEpoch: this.#epoch,
        currentDocumentVersion: state?.overlayVersion ?? null,
        currentLifetime: state?.overlayLifetime ?? null,
      });
    }
  }

  #operate(
    operation: Exclude<AnalyzerDocumentOnlySnapshot["operation"], "initialize">,
    document: string,
    transition: (owner: string) => void,
  ): AnalyzerOperationResult {
    const operationId = `${this.#sessionId}:operation-${++this.#operationSequence}`;
    let owner: string | undefined;
    try {
      owner = this.#canonicalOwner(document);
      transition(owner);
      this.#epoch += 1;
      this.#snapshot = this.#createSnapshot(operationId, operation);
      this.#publication.invalidate();
      this.#explain.invalidate();
      return frozen({ accepted: true as const, operationId, snapshot: this.#snapshot });
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      const state = owner === undefined ? undefined : this.#documents.get(owner);
      return frozen({
        accepted: false as const,
        operationId,
        code: error.code,
        currentEpoch: this.#epoch,
        currentDocumentVersion: state?.overlayVersion ?? null,
        currentLifetime: state?.overlayLifetime ?? null,
      });
    }
  }

  #requireOpen(owner: string, lifetime: number): DocumentState {
    assertVersion(lifetime);
    const state = this.#documents.get(owner);
    if (!state || state.overlayVersion === undefined || state.overlayText === undefined || state.overlayLifetime === undefined) {
      refuse("FADENO_ANALYZER_DOCUMENT_CLOSED");
    }
    if (lifetime !== state.overlayLifetime) refuse("FADENO_ANALYZER_LIFETIME");
    return state;
  }

  #assertExpectedOpen(value: AnalyzerReconcileOpenIdentity | null): void {
    if (value === null) return;
    if (!value || typeof value !== "object") refuse("FADENO_ANALYZER_RECONCILE_INPUT");
    assertVersion(value.lifetime);
    assertVersion(value.version);
  }

  #assertOpenIdentity(state: DocumentState, expected: AnalyzerReconcileOpenIdentity | null): void {
    if (expected === null) {
      if (state.overlayVersion !== undefined) refuse("FADENO_ANALYZER_DOCUMENT_OPEN");
      return;
    }
    if (state.overlayVersion === undefined || state.overlayLifetime === undefined) {
      refuse("FADENO_ANALYZER_DOCUMENT_CLOSED");
    }
    if (state.overlayLifetime !== expected.lifetime) refuse("FADENO_ANALYZER_LIFETIME");
    if (state.overlayVersion !== expected.version) refuse("FADENO_ANALYZER_CLOSE_VERSION");
  }

  #initialState(owner: string): DocumentState {
    const state: DocumentState = { owner, savedRevision: 0, nextLifetime: 0 };
    if (existsSync(owner)) {
      const status = lstatSync(owner);
      if (!status.isFile()) refuse(status.isDirectory() ? "FADENO_ANALYZER_DOCUMENT_DIRECTORY" : "FADENO_ANALYZER_DOCUMENT_TYPE");
      state.savedText = this.#readOwnedFile(owner);
    }
    return state;
  }

  #readOwnedFile(owner: string): string {
    if (!existsSync(owner) || !lstatSync(owner).isFile()) refuse("FADENO_ANALYZER_SAVED_MISMATCH");
    try {
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(readFileSync(owner));
    } catch {
      refuse("FADENO_ANALYZER_DOCUMENT_ENCODING");
    }
  }

  #canonicalOwner(document: string): string {
    if (typeof document !== "string" || document.length === 0 || document.includes("\0")) {
      refuse("FADENO_ANALYZER_DOCUMENT_SCHEME");
    }
    let candidate: string;
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(document)) {
      let url: URL;
      try { url = new URL(document); } catch { refuse("FADENO_ANALYZER_DOCUMENT_SCHEME"); }
      if (url.protocol !== "file:") refuse("FADENO_ANALYZER_DOCUMENT_SCHEME");
      if (url.host !== "") refuse("FADENO_ANALYZER_URI_AUTHORITY");
      if (url.search !== "") refuse("FADENO_ANALYZER_URI_QUERY");
      if (url.hash !== "") refuse("FADENO_ANALYZER_URI_FRAGMENT");
      try { candidate = resolve(fileURLToPath(url)); } catch { refuse("FADENO_ANALYZER_DOCUMENT_SCHEME"); }
    } else {
      candidate = resolve(this.#root, document);
    }
    let containment = relative(this.#inputRoot, candidate);
    if (containment.startsWith("..") || isAbsolute(containment)) containment = relative(this.#root, candidate);
    if (containment === "") refuse("FADENO_ANALYZER_DOCUMENT_ROOT");
    if (containment.startsWith("..") || isAbsolute(containment)) refuse("FADENO_ANALYZER_DOCUMENT_ESCAPE");
    candidate = join(this.#root, containment);
    const parts = containment.split(sep);
    let cursor = this.#root;
    let missing = false;
    for (const [index, part] of parts.entries()) {
      cursor = join(cursor, part);
      if (missing || !existsSync(cursor)) {
        missing = true;
        continue;
      }
      const status = lstatSync(cursor);
      if (status.isSymbolicLink()) refuse("FADENO_ANALYZER_DOCUMENT_SYMLINK");
      const last = index === parts.length - 1;
      if (!last && !status.isDirectory()) refuse("FADENO_ANALYZER_DOCUMENT_PARENT");
      if (last && status.isDirectory()) refuse("FADENO_ANALYZER_DOCUMENT_DIRECTORY");
      if (last && !status.isFile()) refuse("FADENO_ANALYZER_DOCUMENT_TYPE");
    }
    return candidate;
  }

  #createSnapshot(operationId: string, operation: AnalyzerDocumentOnlySnapshot["operation"]): AnalyzerDocumentOnlySnapshot {
    const documents: AnalyzerDocumentSnapshot[] = [];
    const versions: AnalyzerDocumentVersion[] = [];
    for (const state of [...this.#documents.values()].sort((left, right) => compareText(left.owner, right.owner))) {
      const open = state.overlayVersion === undefined || state.overlayLifetime === undefined
        ? null
        : frozen({ version: state.overlayVersion, lifetime: state.overlayLifetime });
      if (!open && state.savedText === undefined) continue;
      const effective = open
        ? frozen({ source: "overlay" as const, text: state.overlayText! })
        : frozen({ source: "saved" as const, text: state.savedText! });
      const uri = pathToFileURL(state.owner).href;
      documents.push(frozen({
        path: relative(this.#root, state.owner).split(sep).join("/"),
        uri,
        savedRevision: state.savedRevision,
        open,
        effective,
      }));
      if (open) versions.push(frozen({ uri, version: open.version, lifetime: open.lifetime }));
    }
    return frozen({
      analyzerVersion: 1 as const,
      schemaVersion: 1 as const,
      sessionId: this.#sessionId,
      operationId,
      operation,
      workspaceEpoch: this.#epoch,
      requestedFacets: frozen([]) as readonly [],
      documentVersions: frozen(versions),
      ownership: frozen({ mode: "single-root" as const, root: this.#rootUri }),
      documents: frozen(documents),
      completeness: "complete" as const,
      interruption: null,
      truncated: false as const,
    });
  }
}
