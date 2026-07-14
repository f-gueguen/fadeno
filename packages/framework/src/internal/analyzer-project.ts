import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { FadenoConfig } from "../index.ts";
import { loadConfigFromSource, readConfigSource } from "./config.ts";
import {
  PrivateAnalyzerOperationCoordinator,
  type PrivateAnalyzerOperationHandle,
} from "./analyzer-coordinator.ts";
import {
  PrivateCompilerValidationError,
  PrivateCompilerValidator,
  type PrivateCompilerValidation,
} from "./analyzer-compiler.ts";
import { normalizeAnalyzerFacetValue } from "./analyzer-facets.ts";
import {
  ANALYZER_DIAGNOSTIC_NAMESPACE,
  createAnalyzerDiagnosticBatch,
  type AnalyzerCorrectionInput,
  type AnalyzerDiagnosticBatch,
  type AnalyzerDiagnosticInput,
} from "./analyzer-diagnostics.ts";
import type { AnalyzerExplainResult } from "./analyzer-explain.ts";
import type { AnalyzerGraphNodeDefinition } from "./analyzer-graph.ts";
import type { AnalyzerPublicationSnapshot } from "./analyzer-publication.ts";
import { createRouteExplainContribution } from "./analyzer-route-explain.ts";
import {
  AnalyzerSession,
  type AnalyzerDocumentOnlySnapshot,
  type AnalyzerDocumentSnapshot,
  type AnalyzerOperationResult,
  type AnalyzerRefusalCode,
  type AnalyzerTextEdit,
} from "./analyzer-session.ts";
import {
  ROUTE_ARTIFACT_DESCRIPTORS,
  ROUTE_ARTIFACT_MODULE,
  ROUTE_ARTIFACT_NAMES,
  ROUTE_ARTIFACT_OWNER_NODE_ID,
} from "./routing/artifact-contract.ts";
import { RouteContractError, type RouteRoleCollisionFact } from "./routing/discovery.ts";
import {
  beginRouteArtifactApplication,
  createRouteArtifactPlan,
  verifyRouteArtifactPlanFreshness,
  type RouteArtifactApplicationTransaction,
  type RouteArtifactApplicationOptions,
  type RouteArtifactName,
  type RouteArtifactPlan,
  type RouteGenerationResult,
} from "./routing/generator.ts";

export type PrivateProjectApplicationOptions = Omit<
  RouteArtifactApplicationOptions,
  "assertFresh" | "retainRecovery" | "retainTransaction"
>;

type PrivateProjectInternalApplicationOptions = PrivateProjectApplicationOptions & Readonly<{
  retainRecovery?(recover: () => void): void;
  retainTransaction?(transaction: RouteArtifactApplicationTransaction): void;
}>;

export interface PrivateProjectAnalysis {
  readonly input: "saved" | "overlay";
  readonly publication: AnalyzerPublicationSnapshot;
  readonly diagnostics: AnalyzerDiagnosticBatch;
  readonly routePlan: RouteArtifactPlan | null;
  apply(options?: PrivateProjectApplicationOptions): RouteGenerationResult;
  explain(detail: "semantic" | "deep"): Promise<AnalyzerExplainResult>;
}

export type PrivateProjectAnalysisHandle = PrivateAnalyzerOperationHandle<PrivateProjectAnalysis>;

type PrivateProjectDocumentBase = Readonly<{
  workspaceRoots: readonly string[];
  document: string;
}>;

export type PrivateProjectDocumentOperation =
  | (PrivateProjectDocumentBase & Readonly<{ kind: "open"; version: number; text: string }>)
  | (PrivateProjectDocumentBase & Readonly<{
    kind: "change";
    lifetime: number;
    version: number;
    edits: readonly AnalyzerTextEdit[];
  }>)
  | (PrivateProjectDocumentBase & Readonly<{ kind: "replace"; lifetime: number; version: number; text: string }>)
  | (PrivateProjectDocumentBase & Readonly<{ kind: "save"; text: string }>)
  | (PrivateProjectDocumentBase & Readonly<{ kind: "close"; lifetime: number; version: number }>);

export type PrivateProjectDocumentRefusalCode = AnalyzerRefusalCode
  | "FADENO_ANALYZER_PROJECT_DOCUMENT_OPERATION"
  | "FADENO_ANALYZER_PROJECT_DOCUMENT_UNMANAGED"
  | "FADENO_ANALYZER_WORKSPACE_ROOTS";

export type PrivateProjectDocumentRefusal = Readonly<{
  accepted: false;
  operationId: string;
  code: PrivateProjectDocumentRefusalCode;
  currentEpoch: number;
  currentDocumentVersion: number | null;
  currentLifetime: number | null;
}>;

export interface PrivateProjectDocumentEvent {
  readonly operationId: string;
  readonly documentOperationId: string;
  readonly requestId: string;
  readonly operation: PrivateProjectDocumentOperation["kind"];
  readonly documentVersion: number | null;
  readonly documentLifetime: number | null;
  readonly workspaceEpoch: number;
  readonly document: AnalyzerDocumentSnapshot;
  readonly documentSnapshot: AnalyzerDocumentOnlySnapshot;
  readonly input: "saved" | "overlay";
  readonly publication: AnalyzerPublicationSnapshot;
  readonly diagnostics: AnalyzerDiagnosticBatch;
  readonly routePlan: RouteArtifactPlan | null;
  readonly requestedFacets: AnalyzerPublicationSnapshot["requestedFacets"];
  readonly completeness: AnalyzerPublicationSnapshot["completeness"];
  readonly interruption: AnalyzerPublicationSnapshot["interruption"];
  readonly truncated: AnalyzerPublicationSnapshot["truncated"];
}

export type PrivateProjectDocumentAccepted = Readonly<{
  accepted: true;
  operationId: string;
  documentOperationId: string;
  transitionSnapshot: AnalyzerDocumentOnlySnapshot;
  event: PrivateAnalyzerOperationHandle<PrivateProjectDocumentEvent>;
}>;

export type PrivateProjectDocumentResult = PrivateProjectDocumentAccepted | PrivateProjectDocumentRefusal;

export interface PrivateProjectAnalyzerOptions {
  readonly session?: AnalyzerSession;
  readonly compiler?: PrivateCompilerValidator;
}

export interface PrivateProjectRefreshOptions {
  readonly application?: PrivateProjectApplicationOptions;
  readonly beforeCommit?: () => void;
  readonly onCompilerDiagnostic?: (error: PrivateCompilerValidationError) => void | Promise<void>;
}

export type PrivateProjectRefresh = Readonly<{
  requestId: string;
  generation: number;
  publication: AnalyzerPublicationSnapshot;
  application: RouteGenerationResult;
  compiler: PrivateCompilerValidation;
}>;

export type PrivateProjectRefreshHandle = PrivateAnalyzerOperationHandle<PrivateProjectRefresh>;

export class PrivateProjectDiagnosticError extends TypeError {
  readonly diagnostics: AnalyzerDiagnosticBatch;

  constructor(diagnostics: AnalyzerDiagnosticBatch) {
    super("FADENO_ANALYZER_APPLICATION_DIAGNOSTIC");
    this.name = "PrivateProjectDiagnosticError";
    this.diagnostics = diagnostics;
  }
}

const beginApplication = Symbol("beginApplication");
const assertAnalysisFresh = Symbol("assertAnalysisFresh");

type PrivateProjectInternalAnalysis = PrivateProjectAnalysis & Readonly<{
  [beginApplication](options?: PrivateProjectInternalApplicationOptions): RouteArtifactApplicationTransaction;
  [assertAnalysisFresh](): void;
}>;

interface PrivateProjectAnalysisToken {
  readonly requestId: string;
  readonly operationId: string;
  readonly documentSnapshot: AnalyzerDocumentOnlySnapshot;
  readonly publication: AnalyzerPublicationSnapshot;
}

interface PrivateProjectInputCapture {
  readonly config: FadenoConfig;
  readonly configSource: string;
  readonly savedInputs: Readonly<Record<string, string>>;
  readonly effectiveInputs: Readonly<Record<string, string>>;
  readonly sourceOverrides: Readonly<Record<string, string>>;
  readonly routePlan: RouteArtifactPlan | null;
  readonly routeCollision: RouteRoleCollisionFact | null;
  readonly documentSnapshot: AnalyzerDocumentOnlySnapshot;
  readonly input: "saved" | "overlay";
}

type ManagedDocument = Readonly<{ savedRevision: number; savedText: string }>;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function accepted(result: AnalyzerOperationResult): AnalyzerDocumentOnlySnapshot {
  if ("code" in result) throw new TypeError(result.code);
  return result.snapshot;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function frozenRecord(entries: Iterable<readonly [string, string]>): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(entries));
}

function nodeSuffix(path: string): string {
  return sha256(path).slice(0, 16);
}

function applicationRefuse(code: "DIAGNOSTIC" | "OVERLAY" | "PUBLICATION" | "STALE"): never {
  throw new TypeError(`FADENO_ANALYZER_APPLICATION_${code}`);
}

function projectRefuse(code: "CLOSED" | "STALE"): never {
  throw new TypeError(`FADENO_ANALYZER_PROJECT_${code}`);
}

export function routeArtifactPlanFromPublication(
  publication: AnalyzerPublicationSnapshot,
  plan: RouteArtifactPlan,
): RouteArtifactPlan {
  if (JSON.stringify(Object.keys(plan.files).sort(compareText)) !== JSON.stringify([...ROUTE_ARTIFACT_NAMES].sort(compareText)) ||
      publication.artifacts.length !== ROUTE_ARTIFACT_DESCRIPTORS.length) applicationRefuse("PUBLICATION");
  const files: Partial<Record<RouteArtifactName, string>> = {};
  const seenPaths = new Set<string>();
  for (const descriptor of ROUTE_ARTIFACT_DESCRIPTORS) {
    const artifact = publication.artifacts.find(({ id }) => id === descriptor.id);
    if (!artifact || artifact.path !== descriptor.path || artifact.ownerNodeId !== ROUTE_ARTIFACT_OWNER_NODE_ID || seenPaths.has(artifact.path)) {
      applicationRefuse("PUBLICATION");
    }
    seenPaths.add(artifact.path);
    const value = artifact.value;
    if (typeof value !== "object" || value === null || Array.isArray(value)) applicationRefuse("PUBLICATION");
    const record = value as Record<string, unknown>;
    if (JSON.stringify(Object.keys(record).sort(compareText)) !== JSON.stringify(["bytes", "encoding", "sha256"]) ||
        record["encoding"] !== "utf8" || typeof record["bytes"] !== "string" ||
        typeof record["sha256"] !== "string" || sha256(record["bytes"]) !== record["sha256"] ||
        record["bytes"] !== plan.files[descriptor.name]) applicationRefuse("PUBLICATION");
    const ownership = artifact.provenance.generatedArtifactOwnership;
    if (artifact.provenance.module.namespace !== ROUTE_ARTIFACT_MODULE.namespace ||
        artifact.provenance.module.version !== ROUTE_ARTIFACT_MODULE.version ||
        artifact.provenance.module.transformation !== ROUTE_ARTIFACT_MODULE.transformation || ownership?.artifactId !== descriptor.id ||
        ownership.ownerNodeId !== ROUTE_ARTIFACT_OWNER_NODE_ID || ownership.path !== descriptor.path ||
        artifact.provenance.sourceToArtifacts.length === 0 || artifact.provenance.artifactToSources.length === 0 ||
        artifact.provenance.sourceToArtifacts.some(({ artifactId: id }) => id !== descriptor.id) ||
        artifact.provenance.artifactToSources.some(({ artifactId: id }) => id !== descriptor.id)) applicationRefuse("PUBLICATION");
    files[descriptor.name] = record["bytes"];
  }
  return Object.freeze({
    manifest: plan.manifest,
    sourceSha256: plan.sourceSha256,
    sources: plan.sources,
    files: Object.freeze(files as Record<RouteArtifactName, string>),
  });
}

function location(document: AnalyzerDocumentSnapshot) {
  return Object.freeze({
    uri: document.uri,
    path: document.path,
    range: null,
    rangeReason: "filesystem-entry" as const,
  });
}

export class PrivateProjectAnalyzer {
  readonly #root: string;
  readonly #session: AnalyzerSession;
  readonly #coordinator = new PrivateAnalyzerOperationCoordinator();
  #compiler: PrivateCompilerValidator | null;
  #closePromise: Promise<void> | null = null;
  #pendingRollback: RouteArtifactApplicationTransaction | null = null;
  readonly #managedDocuments = new Map<string, ManagedDocument>();
  readonly #lifecycleDocuments = new Set<string>();
  #documentOperationSequence = 0;
  #configurationFingerprint: string | null = null;
  #configurationSourceSha256: string | null = null;
  #currentAnalysisToken: PrivateProjectAnalysisToken | null = null;
  #latestAnalysisRequestId: string | null = null;
  #pendingApplicationRecovery: (() => void) | null = null;
  #pendingCleanup: RouteArtifactApplicationTransaction | null = null;

  constructor(projectRoot: string, options: PrivateProjectAnalyzerOptions = {}) {
    this.#root = resolve(projectRoot);
    this.#session = options.session ?? new AnalyzerSession(this.#root);
    if (options.compiler && !options.compiler.ownsProject(this.#root)) {
      throw new TypeError("FADENO_ANALYZER_COMPILER_CONFIG");
    }
    this.#compiler = options.compiler ?? null;
  }

  ownsProject(projectRoot: string): boolean {
    return resolve(projectRoot) === this.#root;
  }

  analyze(): PrivateProjectAnalysisHandle {
    const handle = this.#coordinator.start("analysis", (requestId, { signal }) => {
      this.#recoverPendingApplicationRecovery();
      this.#recoverPendingRollback();
      this.#recoverPendingCleanup();
      return this.#analyze(requestId, signal);
    });
    this.#currentAnalysisToken = null;
    this.#latestAnalysisRequestId = handle.requestId;
    return handle;
  }

  refresh(options: PrivateProjectRefreshOptions = {}): PrivateProjectRefreshHandle {
    const handle = this.#coordinator.start("analysis", async (requestId, { signal, generation }) => {
      this.#recoverPendingApplicationRecovery();
      this.#recoverPendingRollback();
      this.#recoverPendingCleanup();
      const analysis = await this.#analyze(requestId, signal);
      if (analysis.diagnostics.diagnostics.length > 0) {
        throw new PrivateProjectDiagnosticError(analysis.diagnostics);
      }
      signal.throwIfAborted();
      let transaction: RouteArtifactApplicationTransaction | null = null;
      try {
        transaction = analysis[beginApplication]({
          ...options.application,
          retainRecovery: (recover) => { this.#pendingApplicationRecovery = recover; },
          retainTransaction: (retained) => {
            transaction = retained;
            this.#pendingApplicationRecovery = null;
          },
        });
        this.#pendingApplicationRecovery = null;
        signal.throwIfAborted();
        const validator = this.#compilerValidator();
        const compiler = await validator.validate({
          requestId,
          generation,
          publicationOperationId: analysis.publication.operationId,
          artifactSourceSha256: transaction.result.sourceSha256,
          signal,
        });
        signal.throwIfAborted();
        analysis[assertAnalysisFresh]();
        options.beforeCommit?.();
        signal.throwIfAborted();
        analysis[assertAnalysisFresh]();
        await validator.assertCurrent(compiler, signal);
        signal.throwIfAborted();
        analysis[assertAnalysisFresh]();
        transaction.assertPending();
        const application = transaction.commit();
        if (transaction.cleanupPending) this.#pendingCleanup = transaction;
        return Object.freeze({ requestId, generation, publication: analysis.publication, application, compiler });
      } catch (error) {
        if (
          error instanceof PrivateCompilerValidationError &&
          error.code === "FADENO_ANALYZER_COMPILER_DIAGNOSTIC"
        ) {
          await options.onCompilerDiagnostic?.(error);
        }
        if (transaction?.state === "pending") {
          try {
            transaction.rollback();
          } catch {
            this.#pendingRollback = transaction;
            this.#recoverPendingRollback();
          }
        }
        if (transaction?.state === "committed" && transaction.cleanupPending) this.#pendingCleanup = transaction;
        if (!transaction) this.#recoverPendingApplicationRecovery();
        throw error;
      }
    });
    this.#currentAnalysisToken = null;
    this.#latestAnalysisRequestId = handle.requestId;
    return handle;
  }

  document(operation: PrivateProjectDocumentOperation): PrivateProjectDocumentResult {
    if (this.#coordinator.state !== "accepting") throw new TypeError("FADENO_ANALYZER_PROJECT_CLOSED");
    const operationId = `fadeno-project-document-${++this.#documentOperationSequence}`;
    const refuse = (
      code: PrivateProjectDocumentRefusalCode,
      currentDocumentVersion: number | null = null,
      currentLifetime: number | null = null,
    ): PrivateProjectDocumentRefusal => Object.freeze({
      accepted: false as const,
      operationId,
      code,
      currentEpoch: this.#session.currentSnapshot.workspaceEpoch,
      currentDocumentVersion,
      currentLifetime,
    });
    if (!operation || !Array.isArray(operation.workspaceRoots) || operation.workspaceRoots.length !== 1 ||
        typeof operation.workspaceRoots[0] !== "string" || !this.ownsProject(operation.workspaceRoots[0])) {
      return refuse("FADENO_ANALYZER_WORKSPACE_ROOTS");
    }
    if (!(["open", "change", "replace", "save", "close"] as readonly unknown[]).includes(operation.kind)) {
      return refuse("FADENO_ANALYZER_PROJECT_DOCUMENT_OPERATION");
    }
    const identity = this.#session.identify(operation.document);
    if (!identity.accepted) {
      return refuse(identity.code, identity.currentDocumentVersion, identity.currentLifetime);
    }
    const existing = identity.document;
    const currentVersion = existing?.open?.version ?? null;
    const currentLifetime = existing?.open?.lifetime ?? null;
    if (identity.backing === "missing" && operation.kind !== "close" && operation.kind !== "save") {
      return refuse("FADENO_ANALYZER_PROJECT_DOCUMENT_UNMANAGED", currentVersion, currentLifetime);
    }
    if (operation.kind === "open") {
      if (!this.#managedDocuments.has(identity.path)) {
        return refuse("FADENO_ANALYZER_PROJECT_DOCUMENT_UNMANAGED", currentVersion, currentLifetime);
      }
    } else if (!this.#lifecycleDocuments.has(identity.path) ||
        (operation.kind !== "close" && !this.#managedDocuments.has(identity.path))) {
      return refuse("FADENO_ANALYZER_PROJECT_DOCUMENT_UNMANAGED", currentVersion, currentLifetime);
    }

    let transition: AnalyzerOperationResult;
    switch (operation.kind) {
      case "open":
        transition = this.#session.open(operation.document, operation.version, operation.text);
        break;
      case "change":
        transition = this.#session.change(operation.document, operation.lifetime, operation.version, operation.edits);
        break;
      case "replace":
        transition = this.#session.replace(operation.document, operation.lifetime, operation.version, operation.text);
        break;
      case "save":
        transition = this.#session.save(operation.document, operation.text);
        break;
      case "close":
        transition = this.#session.close(operation.document, operation.lifetime, operation.version);
        break;
    }
    if (!transition.accepted) {
      return refuse(transition.code, transition.currentDocumentVersion, transition.currentLifetime);
    }
    if (operation.kind === "open") this.#lifecycleDocuments.add(identity.path);
    if (operation.kind === "close") this.#lifecycleDocuments.delete(identity.path);
    const transitioned = transition.snapshot.documents.find(({ path }) => path === identity.path);
    if (!transitioned) throw new TypeError("FADENO_ANALYZER_PROJECT_DOCUMENT_UNMANAGED");
    const managed = this.#managedDocuments.get(identity.path);
    if (managed && operation.kind === "save") {
      this.#managedDocuments.set(identity.path, Object.freeze({
        savedRevision: transitioned.savedRevision,
        savedText: operation.text,
      }));
    }

    const documentOperationId = transition.operationId;
    const transitionSnapshot = transition.snapshot;
    const documentVersion = operation.kind === "save"
      ? transitioned.open?.version ?? null
      : operation.version;
    const documentLifetime = operation.kind === "open" || operation.kind === "save"
      ? transitioned.open?.lifetime ?? null
      : operation.lifetime;
    const handle = this.#coordinator.start("analysis", async (requestId, { signal }) => {
      this.#recoverPendingApplicationRecovery();
      this.#recoverPendingRollback();
      this.#recoverPendingCleanup();
      const analysis = await this.#analyze(requestId, signal);
      signal.throwIfAborted();
      const documentSnapshot = this.#session.currentSnapshot;
      const document = documentSnapshot.documents.find(({ path }) => path === identity.path);
      if (!document) throw new TypeError("FADENO_ANALYZER_PROJECT_DOCUMENT_UNMANAGED");
      const publication = analysis.publication;
      return Object.freeze({
        operationId,
        documentOperationId,
        requestId,
        operation: operation.kind,
        documentVersion,
        documentLifetime,
        workspaceEpoch: documentSnapshot.workspaceEpoch,
        document,
        documentSnapshot,
        input: analysis.input,
        publication,
        diagnostics: analysis.diagnostics,
        routePlan: analysis.routePlan,
        requestedFacets: publication.requestedFacets,
        completeness: publication.completeness,
        interruption: publication.interruption,
        truncated: publication.truncated,
      });
    });
    this.#currentAnalysisToken = null;
    this.#latestAnalysisRequestId = handle.requestId;
    return Object.freeze({
      accepted: true as const,
      operationId,
      documentOperationId,
      transitionSnapshot,
      event: handle,
    });
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#currentAnalysisToken = null;
    this.#latestAnalysisRequestId = null;
    this.#closePromise = this.#coordinator.close().then(async () => {
      let rollbackFailure: unknown = null;
      try { this.#recoverPendingApplicationRecovery(); } catch (error) { rollbackFailure = error; }
      try { this.#recoverPendingRollback(); } catch (error) { rollbackFailure ??= error; }
      try { this.#recoverPendingCleanup(); } catch (error) { rollbackFailure ??= error; }
      await this.#compiler?.close();
      if (rollbackFailure) throw rollbackFailure;
    });
    return this.#closePromise;
  }

  #compilerValidator(): PrivateCompilerValidator {
    return this.#compiler ??= new PrivateCompilerValidator(this.#root);
  }

  #recoverPendingRollback(): void {
    if (!this.#pendingRollback) return;
    try {
      this.#pendingRollback.rollback();
      this.#pendingRollback = null;
    } catch (error) {
      throw new TypeError("FADENO_ANALYZER_APPLICATION_ROLLBACK", { cause: error });
    }
  }

  #recoverPendingApplicationRecovery(): void {
    if (!this.#pendingApplicationRecovery) return;
    try {
      this.#pendingApplicationRecovery();
      this.#pendingApplicationRecovery = null;
    } catch (error) {
      throw new TypeError("FADENO_ANALYZER_APPLICATION_RECOVERY", { cause: error });
    }
  }

  #recoverPendingCleanup(): void {
    if (!this.#pendingCleanup) return;
    try {
      this.#pendingCleanup.cleanup();
      this.#pendingCleanup = null;
    } catch (error) {
      throw new TypeError("FADENO_ANALYZER_APPLICATION_CLEANUP", { cause: error });
    }
  }

  #captureInputs(signal: AbortSignal): PrivateProjectInputCapture {
    signal.throwIfAborted();
    const initialSnapshot = this.#session.currentSnapshot;
    const initialByPath = new Map(initialSnapshot.documents.map((document) => [document.path, document]));
    if (initialSnapshot.documents.some((document) =>
      document.open && this.#managedDocuments.has(document.path) && !this.#lifecycleDocuments.has(document.path))) {
      throw new TypeError("FADENO_ANALYZER_DOCUMENT_OPEN");
    }
    const configPath = "fadeno.config.ts";
    const savedConfigSource = readConfigSource(this.#root);
    const configDocument = initialByPath.get(configPath);
    if (configDocument?.open && !this.#lifecycleDocuments.has(configPath)) {
      throw new TypeError("FADENO_ANALYZER_DOCUMENT_OPEN");
    }
    const configSource = configDocument?.open ? configDocument.effective.text : savedConfigSource;
    const { config } = loadConfigFromSource(this.#root, configSource);
    signal.throwIfAborted();

    let routePlan: RouteArtifactPlan | null = null;
    let routeCollision: RouteRoleCollisionFact | null = null;
    try {
      routePlan = createRouteArtifactPlan(this.#root, config);
    } catch (error) {
      if (!(error instanceof RouteContractError) || !error.routeRoleCollision) throw error;
      routeCollision = error.routeRoleCollision;
    }
    if (!config.routes?.root) throw new TypeError("FADENO_ANALYZER_PROJECT_ROUTES_REQUIRED");

    const sourcePaths = routePlan
      ? Object.keys(routePlan.sources)
      : (routeCollision?.owners ?? []).map(({ path }) => path);
    const mutableSourceOverrides = new Map<string, string>();
    for (const path of sourcePaths) {
      const document = initialByPath.get(path);
      if (!document?.open) continue;
      if (!this.#lifecycleDocuments.has(path)) throw new TypeError("FADENO_ANALYZER_DOCUMENT_OPEN");
      mutableSourceOverrides.set(path, document.effective.text);
    }
    const sourceOverrides = frozenRecord(mutableSourceOverrides);
    if (routePlan && Object.keys(sourceOverrides).length > 0) {
      routePlan = createRouteArtifactPlan(this.#root, config, sourceOverrides);
    }

    const savedInputs = new Map<string, string>([[configPath, savedConfigSource]]);
    const effectiveInputs = new Map<string, string>([[configPath, configSource]]);
    const effectiveSources = routePlan?.sources ?? Object.freeze(Object.fromEntries(
      sourcePaths.map((path) => [path, sourceOverrides[path] ?? readFileSync(join(this.#root, path), "utf8")]),
    ));
    for (const path of sourcePaths) {
      savedInputs.set(path, readFileSync(join(this.#root, path), "utf8"));
      effectiveInputs.set(path, effectiveSources[path]!);
    }

    signal.throwIfAborted();
    this.#synchronizeDocuments(savedInputs);
    const configFingerprint = sha256(JSON.stringify(config));
    const configurationSourceSha256 = sha256(configSource);
    if (this.#configurationFingerprint !== configFingerprint || this.#configurationSourceSha256 !== configurationSourceSha256) {
      accepted(this.#session.reloadConfiguration(configFingerprint));
      this.#configurationFingerprint = configFingerprint;
      this.#configurationSourceSha256 = configurationSourceSha256;
    }
    const documentSnapshot = this.#session.currentSnapshot;
    const documentByPath = new Map(documentSnapshot.documents.map((document) => [document.path, document]));
    for (const [path, text] of effectiveInputs) {
      const document = documentByPath.get(path);
      if (!document || document.effective.text !== text) {
        throw new TypeError("FADENO_ANALYZER_PROJECT_INPUT_CHANGED");
      }
    }
    const input = [...effectiveInputs.keys()].some((path) => documentByPath.get(path)?.open !== null)
      ? "overlay" as const
      : "saved" as const;
    const capture: PrivateProjectInputCapture = Object.freeze({
      config,
      configSource,
      savedInputs: frozenRecord(savedInputs),
      effectiveInputs: frozenRecord(effectiveInputs),
      sourceOverrides,
      routePlan,
      routeCollision,
      documentSnapshot,
      input,
    });
    this.#assertCaptureCurrent(capture);
    return capture;
  }

  async #analyze(requestId: string, signal: AbortSignal): Promise<PrivateProjectInternalAnalysis> {
    const capture = this.#captureInputs(signal);
    const { routePlan, routeCollision } = capture;
    signal.throwIfAborted();

    const sessionDocuments = capture.documentSnapshot.documents;
    const documents = sessionDocuments.filter(({ path }) => this.#managedDocuments.has(path));
    const documentByPath = new Map(documents.map((document) => [document.path, document]));
    const sourcePaths = Object.keys(capture.effectiveInputs).filter((path) => path !== "fadeno.config.ts");
    const definitions = this.#definitions(routePlan, sourcePaths, documentByPath);
    let diagnostics: AnalyzerDiagnosticBatch | null = null;
    const publicationHandle = this.#session.startPublication({
      definitions,
      requestedFacets: [{ namespace: ANALYZER_DIAGNOSTIC_NAMESPACE }],
      materialize: ({ graph }) => {
        this.#assertCaptureCurrent(capture);
        const diagnosticInput = this.#diagnosticInput(routeCollision, documentByPath);
        diagnostics = createAnalyzerDiagnosticBatch({ graph, documents: sessionDocuments, ...diagnosticInput });
        return [{
          namespace: ANALYZER_DIAGNOSTIC_NAMESPACE,
          version: 1,
          value: normalizeAnalyzerFacetValue(diagnostics),
        }];
      },
    });
    const cancelPublication = (): void => publicationHandle.cancel();
    if (signal.aborted) publicationHandle.cancel();
    else signal.addEventListener("abort", cancelPublication, { once: true });
    let publicationResult;
    try {
      publicationResult = await publicationHandle.result;
    } finally {
      signal.removeEventListener("abort", cancelPublication);
    }
    signal.throwIfAborted();
    if (publicationResult.status !== "published" || diagnostics === null) {
      throw new TypeError(`FADENO_ANALYZER_PROJECT_${publicationResult.status.toUpperCase()}`);
    }
    const publication = publicationResult.snapshot;
    const batch = diagnostics as AnalyzerDiagnosticBatch;
    const analysisToken: PrivateProjectAnalysisToken = Object.freeze({
      requestId,
      operationId: publication.operationId,
      documentSnapshot: this.#session.currentSnapshot,
      publication,
    });
    if (!signal.aborted && this.#coordinator.state === "accepting" && this.#latestAnalysisRequestId === requestId) {
      this.#currentAnalysisToken = analysisToken;
    }
    const assertOwned = (): void => {
      if (this.#coordinator.state !== "accepting") projectRefuse("CLOSED");
      if (
        this.#currentAnalysisToken !== analysisToken ||
        this.#session.currentSnapshot !== analysisToken.documentSnapshot ||
        this.#session.currentPublicationSnapshot !== publication
      ) applicationRefuse("STALE");
    };
    const assertFresh = (): void => {
      assertOwned();
      this.#assertCaptureCurrent(capture);
    };
    const begin = (options: PrivateProjectInternalApplicationOptions = {}): RouteArtifactApplicationTransaction => {
      assertOwned();
      if (capture.input === "overlay") applicationRefuse("OVERLAY");
      if (routePlan === null || batch.diagnostics.length > 0 || batch.corrections.length > 0 || batch.skippedWork.length > 0) {
        applicationRefuse("DIAGNOSTIC");
      }
      const publishedPlan = routeArtifactPlanFromPublication(publication, routePlan);
      return beginRouteArtifactApplication(this.#root, publishedPlan, { ...options, assertFresh });
    };
    return Object.freeze({
      input: capture.input,
      publication,
      diagnostics: batch,
      routePlan,
      apply: (options: PrivateProjectApplicationOptions = {}) => begin(options).commit(),
      explain: (detail: "semantic" | "deep") => this.#explain(analysisToken, batch, detail),
      [beginApplication]: begin,
      [assertAnalysisFresh]: assertFresh,
    });
  }

  async #explain(
    analysisToken: PrivateProjectAnalysisToken,
    diagnostics: AnalyzerDiagnosticBatch,
    detail: "semantic" | "deep",
  ): Promise<AnalyzerExplainResult> {
    if (this.#coordinator.state !== "accepting") projectRefuse("CLOSED");
    if (
      this.#currentAnalysisToken !== analysisToken ||
      this.#session.currentSnapshot !== analysisToken.documentSnapshot ||
      this.#session.currentPublicationSnapshot !== analysisToken.publication
    ) projectRefuse("STALE");
    return this.#coordinator.start("explanation", async () => {
      if (
        this.#session.currentSnapshot !== analysisToken.documentSnapshot ||
        this.#session.currentPublicationSnapshot !== analysisToken.publication
      ) projectRefuse("STALE");
      const result = await this.#session.startExplain({
        detail,
        ...(detail === "deep" ? { activateDeep: true } : {}),
        requestedFacets: [{ namespace: "fadeno.routes.explain" }],
        collect: ({ publication: current, budgets }) => [
          createRouteExplainContribution(current, diagnostics, detail, budgets),
        ],
      }).result;
      if (
        this.#session.currentSnapshot !== analysisToken.documentSnapshot ||
        this.#session.currentPublicationSnapshot !== analysisToken.publication
      ) projectRefuse("STALE");
      return result;
    }).result;
  }

  #assertCaptureCurrent(capture: PrivateProjectInputCapture): void {
    if (this.#session.currentSnapshot !== capture.documentSnapshot) {
      throw new TypeError("FADENO_ANALYZER_PROJECT_INPUT_CHANGED");
    }
    try {
      for (const [path, text] of Object.entries(capture.savedInputs)) {
        if (readFileSync(join(this.#root, path), "utf8") !== text) {
          throw new TypeError("FADENO_ANALYZER_PROJECT_INPUT_CHANGED");
        }
      }
    } catch (error) {
      if (error instanceof TypeError && error.message === "FADENO_ANALYZER_PROJECT_INPUT_CHANGED") throw error;
      throw new TypeError("FADENO_ANALYZER_PROJECT_INPUT_CHANGED");
    }
    const currentByPath = new Map(capture.documentSnapshot.documents.map((document) => [document.path, document]));
    for (const [path, text] of Object.entries(capture.effectiveInputs)) {
      if (currentByPath.get(path)?.effective.text !== text) {
        throw new TypeError("FADENO_ANALYZER_PROJECT_INPUT_CHANGED");
      }
    }
    if (capture.routePlan) {
      verifyRouteArtifactPlanFreshness(this.#root, capture.config, capture.routePlan, capture.sourceOverrides);
      return;
    }
    try {
      createRouteArtifactPlan(this.#root, capture.config, capture.sourceOverrides);
    } catch (error) {
      if (error instanceof RouteContractError && error.routeRoleCollision &&
          JSON.stringify(error.routeRoleCollision) === JSON.stringify(capture.routeCollision)) return;
      throw error;
    }
    throw new TypeError("FADENO_ANALYZER_PROJECT_INPUT_CHANGED");
  }

  #synchronizeDocuments(desired: ReadonlyMap<string, string>): void {
    const currentByPath = new Map(this.#session.currentSnapshot.documents.map((document) => [document.path, document]));
    const forgotten = [...this.#managedDocuments]
      .filter(([path]) => !desired.has(path) && currentByPath.get(path)?.open === null)
      .sort(([left], [right]) => compareText(left, right))
      .map(([path, managed]) => {
        const current = currentByPath.get(path);
        if (!current) throw new TypeError("FADENO_ANALYZER_DOCUMENT_UNKNOWN");
        return { document: join(this.#root, path), expectedSavedRevision: managed.savedRevision };
      });
    let changed = forgotten.length > 0;
    const documents = [...desired]
      .sort(([left], [right]) => compareText(left, right))
      .map(([path, text]) => {
        const current = currentByPath.get(path);
        const managed = this.#managedDocuments.get(path);
        if (current?.open && !this.#lifecycleDocuments.has(path)) {
          throw new TypeError("FADENO_ANALYZER_DOCUMENT_OPEN");
        }
        const expectedSavedRevision = managed?.savedRevision ?? null;
        if (
          expectedSavedRevision === null || !current ||
          current.savedRevision !== expectedSavedRevision || managed?.savedText !== text
        ) changed = true;
        return {
          document: join(this.#root, path),
          text,
          expectedSavedRevision,
          ...(current?.open ? { preserveOverlay: true as const } : {}),
        };
      });
    const snapshot = changed
      ? accepted(this.#session.reconcile({ documents, forget: forgotten }))
      : this.#session.currentSnapshot;
    const reconciledByPath = new Map(snapshot.documents.map((document) => [document.path, document]));
    const nextManaged = new Map<string, ManagedDocument>();
    for (const [path, savedText] of desired) {
      const document = reconciledByPath.get(path);
      if (!document) throw new TypeError("FADENO_ANALYZER_RECONCILE_OWNERSHIP");
      nextManaged.set(path, Object.freeze({ savedRevision: document.savedRevision, savedText }));
    }
    this.#managedDocuments.clear();
    for (const [path, managed] of nextManaged) this.#managedDocuments.set(path, managed);
  }

  #definitions(
    plan: RouteArtifactPlan | null,
    sourcePaths: readonly string[],
    documents: ReadonlyMap<string, AnalyzerDocumentSnapshot>,
  ): readonly AnalyzerGraphNodeDefinition[] {
    const sourceDefinitions = [...sourcePaths].sort(compareText).map((path): AnalyzerGraphNodeDefinition => ({
      id: `route:source-${nodeSuffix(path)}`,
      ownerUri: documents.get(path)!.uri,
      definitionVersion: 1,
      dependencies: [],
      module: { namespace: "fadeno.routes", version: 1, transformation: "source" },
      compute: ({ owner }) => ({ kind: "route-source", path: owner.path }),
    }));
    if (!plan) return Object.freeze(sourceDefinitions);
    const dependencies = sourceDefinitions.map(({ id }) => id).sort(compareText);
    const config = documents.get("fadeno.config.ts")!;
    const planDefinition: AnalyzerGraphNodeDefinition = {
      id: ROUTE_ARTIFACT_OWNER_NODE_ID,
      ownerUri: config.uri,
      definitionVersion: 1,
      dependencies,
      module: ROUTE_ARTIFACT_MODULE,
      compute: (context) => {
        for (const descriptor of ROUTE_ARTIFACT_DESCRIPTORS) {
          const bytes = plan.files[descriptor.name];
          context.emitArtifact({
            id: descriptor.id,
            path: descriptor.path,
            value: { encoding: "utf8", sha256: sha256(bytes), bytes },
          });
        }
        return { kind: "route-artifact-plan", sourceSha256: plan.sourceSha256 };
      },
    };
    return Object.freeze([...sourceDefinitions, planDefinition]);
  }

  #diagnosticInput(
    collision: RouteRoleCollisionFact | null,
    documents: ReadonlyMap<string, AnalyzerDocumentSnapshot>,
  ): Readonly<{
    diagnostics: readonly AnalyzerDiagnosticInput[];
    corrections: readonly AnalyzerCorrectionInput[];
    skippedWork: readonly Readonly<{ id: string; causedByKeys: readonly string[] }>[];
  }> {
    if (!collision) return { diagnostics: [], corrections: [], skippedWork: [] };
    const { owners, route } = collision;
    const ownerDiagnostics: AnalyzerDiagnosticInput[] = owners.map(({ path, role }) => ({
      key: `${role}-owner`,
      code: "FADENO_ROUTE_ROUTE_ROLE_OWNER",
      parameters: { role, route },
      primaryLocation: location(documents.get(path)!),
      relatedLocations: owners.filter((owner) => owner.path !== path).map((owner) => location(documents.get(owner.path)!)),
      correctionFixIds: ["FADENO_FIX_REVIEW_ROUTE_ROLE_COLLISION"],
    }));
    const diagnosticKeys = [...ownerDiagnostics.map(({ key }) => key), "route-collision"];
    return {
      diagnostics: [...ownerDiagnostics, {
        key: "route-collision",
        code: "FADENO_ROUTE_ROUTE_ROLE_COLLISION",
        parameters: { route },
        primaryLocation: location(documents.get(owners[0]!.path)!),
        relatedLocations: [location(documents.get(owners[1]!.path)!)],
        causedByKeys: ownerDiagnostics.map(({ key }) => key),
        correctionFixIds: ["FADENO_FIX_REVIEW_ROUTE_ROLE_COLLISION"],
      }],
      corrections: [{
        fixId: "FADENO_FIX_REVIEW_ROUTE_ROLE_COLLISION",
        parameters: { route },
        safety: "review",
        preferred: false,
        diagnosticKeys,
        edits: [],
      }],
      skippedWork: [{ id: "manifest-publication", causedByKeys: ["route-collision"] }],
    };
  }
}
