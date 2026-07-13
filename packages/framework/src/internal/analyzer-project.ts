import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { loadConfigWithSource } from "./config.ts";
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
import { AnalyzerSession, type AnalyzerDocumentSnapshot, type AnalyzerOperationResult } from "./analyzer-session.ts";
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function accepted(result: AnalyzerOperationResult): void {
  if ("code" in result) throw new TypeError(result.code);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function nodeSuffix(path: string): string {
  return sha256(path).slice(0, 16);
}

function artifactId(name: RouteArtifactName): string {
  return `generated:routes-${name.replaceAll(".", "-")}`;
}

function applicationRefuse(code: "DIAGNOSTIC" | "PUBLICATION" | "STALE"): never {
  throw new TypeError(`FADENO_ANALYZER_APPLICATION_${code}`);
}

export function routeArtifactPlanFromPublication(
  publication: AnalyzerPublicationSnapshot,
  plan: RouteArtifactPlan,
): RouteArtifactPlan {
  const names = Object.keys(plan.files).sort(compareText) as RouteArtifactName[];
  if (names.length !== 7 || publication.artifacts.length !== names.length) applicationRefuse("PUBLICATION");
  const files: Partial<Record<RouteArtifactName, string>> = {};
  const seenPaths = new Set<string>();
  for (const name of names) {
    const expectedId = artifactId(name);
    const expectedPath = `.fadeno/routes/${name}`;
    const artifact = publication.artifacts.find(({ id }) => id === expectedId);
    if (!artifact || artifact.path !== expectedPath || artifact.ownerNodeId !== "route:artifact-plan" || seenPaths.has(artifact.path)) {
      applicationRefuse("PUBLICATION");
    }
    seenPaths.add(artifact.path);
    const value = artifact.value;
    if (typeof value !== "object" || value === null || Array.isArray(value)) applicationRefuse("PUBLICATION");
    const record = value as Record<string, unknown>;
    if (JSON.stringify(Object.keys(record).sort(compareText)) !== JSON.stringify(["bytes", "encoding", "sha256"]) ||
        record["encoding"] !== "utf8" || typeof record["bytes"] !== "string" ||
        typeof record["sha256"] !== "string" || sha256(record["bytes"]) !== record["sha256"] ||
        record["bytes"] !== plan.files[name]) applicationRefuse("PUBLICATION");
    const ownership = artifact.provenance.generatedArtifactOwnership;
    if (artifact.provenance.module.namespace !== "fadeno.routes" || artifact.provenance.module.version !== 1 ||
        artifact.provenance.module.transformation !== "artifact-plan" || ownership?.artifactId !== expectedId ||
        ownership.ownerNodeId !== "route:artifact-plan" || ownership.path !== expectedPath ||
        artifact.provenance.sourceToArtifacts.length === 0 || artifact.provenance.artifactToSources.length === 0 ||
        artifact.provenance.sourceToArtifacts.some(({ artifactId: id }) => id !== expectedId) ||
        artifact.provenance.artifactToSources.some(({ artifactId: id }) => id !== expectedId)) applicationRefuse("PUBLICATION");
    files[name] = record["bytes"];
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
  readonly #managedPaths = new Set<string>();
  #configurationFingerprint: string | null = null;
  #configurationSourceSha256: string | null = null;
  #applicationToken: object | null = null;

  constructor(projectRoot: string) {
    this.#root = resolve(projectRoot);
    this.#session = new AnalyzerSession(this.#root);
  }

  async analyze(): Promise<PrivateProjectAnalysis> {
    this.#applicationToken = null;
    const { config, source: configSource } = await loadConfigWithSource(this.#root);
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
    this.#synchronizeDocuments(desired);
    this.#assertInputsCurrent(desired);
    this.#assertRouteAnalysisCurrent(config, routePlan, routeCollision);
    if (this.#configurationFingerprint !== configFingerprint || this.#configurationSourceSha256 !== configurationSourceSha256) {
      accepted(this.#session.reloadConfiguration(configFingerprint));
      this.#configurationFingerprint = configFingerprint;
      this.#configurationSourceSha256 = configurationSourceSha256;
    }

    const documents = this.#session.currentSnapshot.documents.filter(({ path }) => this.#managedPaths.has(path));
    const documentByPath = new Map(documents.map((document) => [document.path, document]));
    const definitions = this.#definitions(routePlan, Object.keys(desiredSources), documentByPath);
    let diagnostics: AnalyzerDiagnosticBatch | null = null;
    const publicationResult = await this.#session.startPublication({
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
    }).result;
    if (publicationResult.status !== "published" || diagnostics === null) {
      throw new TypeError("FADENO_ANALYZER_PROJECT_PUBLICATION");
    }
    const publication = publicationResult.snapshot;
    const batch = diagnostics as AnalyzerDiagnosticBatch;
    const applicationToken = Object.freeze({ operationId: publication.operationId });
    this.#applicationToken = applicationToken;
    return Object.freeze({
      publication,
      diagnostics: batch,
      routePlan,
      apply: (options: PrivateProjectApplicationOptions = {}) => {
        if (this.#applicationToken !== applicationToken || this.#session.currentPublicationSnapshot !== publication) applicationRefuse("STALE");
        if (routePlan === null || batch.diagnostics.length > 0 || batch.corrections.length > 0 || batch.skippedWork.length > 0) {
          applicationRefuse("DIAGNOSTIC");
        }
        const publishedPlan = routeArtifactPlanFromPublication(publication, routePlan);
        const assertFresh = (): void => {
          if (this.#applicationToken !== applicationToken || this.#session.currentPublicationSnapshot !== publication) applicationRefuse("STALE");
          this.#assertInputsCurrent(desired);
          this.#assertRouteAnalysisCurrent(config, routePlan, null);
        };
        return applyRouteArtifactPlan(this.#root, publishedPlan, { ...options, assertFresh });
      },
      explain: async (detail: "semantic" | "deep") => this.#session.startExplain({
        detail,
        ...(detail === "deep" ? { activateDeep: true } : {}),
        requestedFacets: [{ namespace: "fadeno.routes.explain" }],
        collect: ({ publication: current, budgets }) => [
          createRouteExplainContribution(current, batch, detail, budgets),
        ],
      }).result,
    });
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
    for (const path of [...this.#managedPaths].sort(compareText)) {
      if (desired.has(path)) continue;
      const current = this.#session.currentSnapshot.documents.find((document) => document.path === path);
      if (current?.open) accepted(this.#session.close(join(this.#root, path), current.open.lifetime, current.open.version));
      if (!existsSync(join(this.#root, path))) accepted(this.#session.remove(join(this.#root, path)));
      this.#managedPaths.delete(path);
    }
    for (const [path, text] of [...desired].sort(([left], [right]) => compareText(left, right))) {
      const absolute = join(this.#root, path);
      const current = this.#session.currentSnapshot.documents.find((document) => document.path === path);
      if (!current?.open) accepted(this.#session.open(absolute, 0, text));
      else if (current.effective.text !== text) {
        accepted(this.#session.replace(absolute, current.open.lifetime, current.open.version + 1, text));
      }
      this.#managedPaths.add(path);
    }
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
      id: "route:artifact-plan",
      ownerUri: config.uri,
      definitionVersion: 1,
      dependencies,
      module: { namespace: "fadeno.routes", version: 1, transformation: "artifact-plan" },
      compute: (context) => {
        for (const [name, bytes] of Object.entries(plan.files).sort(([left], [right]) => compareText(left, right))) {
          context.emitArtifact({
            id: artifactId(name as RouteArtifactName),
            path: `.fadeno/routes/${name}`,
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
