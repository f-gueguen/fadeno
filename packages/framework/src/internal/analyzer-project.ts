import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { loadConfigWithSource } from "./config.ts";
import {
  PrivateAnalyzerOperationCoordinator,
  type PrivateAnalyzerOperationHandle,
} from "./analyzer-coordinator.ts";
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
} from "./analyzer-session.ts";
import {
  ROUTE_ARTIFACT_DESCRIPTORS,
  ROUTE_ARTIFACT_MODULE,
  ROUTE_ARTIFACT_NAMES,
  ROUTE_ARTIFACT_OWNER_NODE_ID,
} from "./routing/artifact-contract.ts";
import { RouteContractError, type RouteRoleCollisionFact } from "./routing/discovery.ts";
import {
  applyRouteArtifactPlan,
  createRouteArtifactPlan,
  verifyRouteArtifactPlanFreshness,
  type RouteArtifactApplicationOptions,
  type RouteArtifactName,
  type RouteArtifactPlan,
  type RouteGenerationResult,
} from "./routing/generator.ts";

export type PrivateProjectApplicationOptions = Omit<RouteArtifactApplicationOptions, "assertFresh">;

export interface PrivateProjectAnalysis {
  readonly publication: AnalyzerPublicationSnapshot;
  readonly diagnostics: AnalyzerDiagnosticBatch;
  readonly routePlan: RouteArtifactPlan | null;
  apply(options?: PrivateProjectApplicationOptions): RouteGenerationResult;
  explain(detail: "semantic" | "deep"): Promise<AnalyzerExplainResult>;
}

export type PrivateProjectAnalysisHandle = PrivateAnalyzerOperationHandle<PrivateProjectAnalysis>;

export interface PrivateProjectAnalyzerOptions {
  readonly session?: AnalyzerSession;
}

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

function nodeSuffix(path: string): string {
  return sha256(path).slice(0, 16);
}

function applicationRefuse(code: "DIAGNOSTIC" | "PUBLICATION" | "STALE"): never {
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
  readonly #managedDocuments = new Map<string, number>();
  #configurationFingerprint: string | null = null;
  #configurationSourceSha256: string | null = null;
  #currentAnalysisToken: object | null = null;
  #latestAnalysisRequestId: string | null = null;

  constructor(projectRoot: string, options: PrivateProjectAnalyzerOptions = {}) {
    this.#root = resolve(projectRoot);
    this.#session = options.session ?? new AnalyzerSession(this.#root);
  }

  analyze(): PrivateProjectAnalysisHandle {
    const handle = this.#coordinator.start("analysis", (requestId, { signal }) => this.#analyze(requestId, signal));
    this.#currentAnalysisToken = null;
    this.#latestAnalysisRequestId = handle.requestId;
    return handle;
  }

  close(): Promise<void> {
    this.#currentAnalysisToken = null;
    this.#latestAnalysisRequestId = null;
    return this.#coordinator.close();
  }

  async #analyze(requestId: string, signal: AbortSignal): Promise<PrivateProjectAnalysis> {
    signal.throwIfAborted();
    const { config, source: configSource } = await loadConfigWithSource(this.#root);
    signal.throwIfAborted();
    const configFingerprint = sha256(JSON.stringify(config));
    const configurationSourceSha256 = sha256(configSource);
    let routePlan: RouteArtifactPlan | null = null;
    let routeCollision: RouteRoleCollisionFact | null = null;
    try {
      routePlan = createRouteArtifactPlan(this.#root, config);
    } catch (error) {
      if (!(error instanceof RouteContractError) || !error.routeRoleCollision) throw error;
      routeCollision = error.routeRoleCollision;
    }

    const configuredRoot = config.routes?.root;
    if (!configuredRoot) throw new TypeError("FADENO_ANALYZER_PROJECT_ROUTES_REQUIRED");
    const desiredSources = routePlan?.sources ?? Object.freeze(Object.fromEntries(
      (routeCollision?.owners ?? []).map(({ path }) => [path, readFileSync(join(this.#root, path), "utf8")]),
    ));
    const desired = new Map<string, string>([
      ["fadeno.config.ts", configSource],
      ...Object.entries(desiredSources),
    ]);
    signal.throwIfAborted();
    this.#synchronizeDocuments(desired);
    this.#assertInputsCurrent(desired);
    this.#assertRouteAnalysisCurrent(config, routePlan, routeCollision);
    if (this.#configurationFingerprint !== configFingerprint || this.#configurationSourceSha256 !== configurationSourceSha256) {
      accepted(this.#session.reloadConfiguration(configFingerprint));
      this.#configurationFingerprint = configFingerprint;
      this.#configurationSourceSha256 = configurationSourceSha256;
    }
    signal.throwIfAborted();

    const documents = this.#session.currentSnapshot.documents.filter(({ path }) => this.#managedDocuments.has(path));
    const documentByPath = new Map(documents.map((document) => [document.path, document]));
    const definitions = this.#definitions(routePlan, Object.keys(desiredSources), documentByPath);
    let diagnostics: AnalyzerDiagnosticBatch | null = null;
    const publicationHandle = this.#session.startPublication({
      definitions,
      requestedFacets: [{ namespace: ANALYZER_DIAGNOSTIC_NAMESPACE }],
      materialize: ({ graph }) => {
        this.#assertInputsCurrent(desired);
        this.#assertRouteAnalysisCurrent(config, routePlan, routeCollision);
        const diagnosticInput = this.#diagnosticInput(routeCollision, documentByPath);
        diagnostics = createAnalyzerDiagnosticBatch({ graph, documents, ...diagnosticInput });
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
    const analysisToken = Object.freeze({ requestId, operationId: publication.operationId });
    if (!signal.aborted && this.#coordinator.state === "accepting" && this.#latestAnalysisRequestId === requestId) {
      this.#currentAnalysisToken = analysisToken;
    }
    return Object.freeze({
      publication,
      diagnostics: batch,
      routePlan,
      apply: (options: PrivateProjectApplicationOptions = {}) => {
        if (this.#coordinator.state !== "accepting") projectRefuse("CLOSED");
        if (this.#currentAnalysisToken !== analysisToken || this.#session.currentPublicationSnapshot !== publication) applicationRefuse("STALE");
        if (routePlan === null || batch.diagnostics.length > 0 || batch.corrections.length > 0 || batch.skippedWork.length > 0) {
          applicationRefuse("DIAGNOSTIC");
        }
        const publishedPlan = routeArtifactPlanFromPublication(publication, routePlan);
        const assertFresh = (): void => {
          if (this.#coordinator.state !== "accepting") projectRefuse("CLOSED");
          if (this.#currentAnalysisToken !== analysisToken || this.#session.currentPublicationSnapshot !== publication) applicationRefuse("STALE");
          this.#assertInputsCurrent(desired);
          this.#assertRouteAnalysisCurrent(config, routePlan, null);
        };
        return applyRouteArtifactPlan(this.#root, publishedPlan, { ...options, assertFresh });
      },
      explain: (detail: "semantic" | "deep") => this.#explain(analysisToken, batch, detail),
    });
  }

  async #explain(
    analysisToken: object,
    diagnostics: AnalyzerDiagnosticBatch,
    detail: "semantic" | "deep",
  ): Promise<AnalyzerExplainResult> {
    if (this.#coordinator.state !== "accepting") projectRefuse("CLOSED");
    if (this.#currentAnalysisToken !== analysisToken) projectRefuse("STALE");
    return this.#coordinator.start("explanation", async () => this.#session.startExplain({
      detail,
      ...(detail === "deep" ? { activateDeep: true } : {}),
      requestedFacets: [{ namespace: "fadeno.routes.explain" }],
      collect: ({ publication: current, budgets }) => [
        createRouteExplainContribution(current, diagnostics, detail, budgets),
      ],
    }).result).result;
  }

  #assertInputsCurrent(expected: ReadonlyMap<string, string>): void {
    try {
      for (const [path, text] of expected) {
        if (readFileSync(join(this.#root, path), "utf8") !== text) {
          throw new TypeError("FADENO_ANALYZER_PROJECT_INPUT_CHANGED");
        }
      }
    } catch (error) {
      if (error instanceof TypeError && error.message === "FADENO_ANALYZER_PROJECT_INPUT_CHANGED") throw error;
      throw new TypeError("FADENO_ANALYZER_PROJECT_INPUT_CHANGED");
    }
  }

  #assertRouteAnalysisCurrent(
    config: Awaited<ReturnType<typeof loadConfigWithSource>>["config"],
    plan: RouteArtifactPlan | null,
    collision: RouteRoleCollisionFact | null,
  ): void {
    if (plan) {
      verifyRouteArtifactPlanFreshness(this.#root, config, plan);
      return;
    }
    try {
      createRouteArtifactPlan(this.#root, config);
    } catch (error) {
      if (error instanceof RouteContractError && error.routeRoleCollision &&
          JSON.stringify(error.routeRoleCollision) === JSON.stringify(collision)) return;
      throw error;
    }
    throw new TypeError("FADENO_ANALYZER_PROJECT_INPUT_CHANGED");
  }

  #synchronizeDocuments(desired: ReadonlyMap<string, string>): void {
    const currentByPath = new Map(this.#session.currentSnapshot.documents.map((document) => [document.path, document]));
    const forgotten = [...this.#managedDocuments]
      .filter(([path]) => !desired.has(path))
      .sort(([left], [right]) => compareText(left, right))
      .map(([path, savedRevision]) => {
        const current = currentByPath.get(path);
        if (!current) throw new TypeError("FADENO_ANALYZER_DOCUMENT_UNKNOWN");
        return { document: join(this.#root, path), expectedSavedRevision: savedRevision };
      });
    let changed = forgotten.length > 0;
    const documents = [...desired]
      .sort(([left], [right]) => compareText(left, right))
      .map(([path, text]) => {
        const current = currentByPath.get(path);
        const expectedSavedRevision = this.#managedDocuments.get(path) ?? null;
        if (
          expectedSavedRevision === null || !current || current.open !== null ||
          current.savedRevision !== expectedSavedRevision || current.effective.text !== text
        ) changed = true;
        return {
          document: join(this.#root, path),
          text,
          expectedSavedRevision,
        };
      });
    const snapshot = changed
      ? accepted(this.#session.reconcile({ documents, forget: forgotten }))
      : this.#session.currentSnapshot;
    const reconciledByPath = new Map(snapshot.documents.map((document) => [document.path, document]));
    const nextManaged = new Map<string, number>();
    for (const path of desired.keys()) {
      const document = reconciledByPath.get(path);
      if (!document || document.open !== null) throw new TypeError("FADENO_ANALYZER_RECONCILE_OWNERSHIP");
      nextManaged.set(path, document.savedRevision);
    }
    this.#managedDocuments.clear();
    for (const [path, savedRevision] of nextManaged) this.#managedDocuments.set(path, savedRevision);
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
