import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";

import { loadConfig } from "./config.ts";
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
import { FadenoDiagnosticError } from "./diagnostic.ts";
import {
  createRouteArtifactPlan,
  type RouteArtifactName,
  type RouteArtifactPlan,
} from "./routing/generator.ts";

export interface PrivateProjectAnalysis {
  readonly publication: AnalyzerPublicationSnapshot;
  readonly diagnostics: AnalyzerDiagnosticBatch;
  readonly routePlan: RouteArtifactPlan | null;
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

function location(document: AnalyzerDocumentSnapshot) {
  return Object.freeze({
    uri: document.uri,
    path: document.path,
    range: null,
    rangeReason: "filesystem-entry" as const,
  });
}

function routeId(configuredRoot: string, source: string): string {
  const directory = posix.relative(configuredRoot, posix.dirname(source));
  return directory === "" ? "/" : `/${directory}`;
}

export class PrivateProjectAnalyzer {
  readonly #root: string;
  readonly #session: AnalyzerSession;
  readonly #managedPaths = new Set<string>();
  #configurationFingerprint: string | null = null;

  constructor(projectRoot: string) {
    this.#root = resolve(projectRoot);
    this.#session = new AnalyzerSession(this.#root);
  }

  async analyze(): Promise<PrivateProjectAnalysis> {
    const configPath = join(this.#root, "fadeno.config.ts");
    const configSource = readFileSync(configPath, "utf8");
    const config = await loadConfig(this.#root);
    if (readFileSync(configPath, "utf8") !== configSource) {
      throw new TypeError("FADENO_ANALYZER_PROJECT_CONFIGURATION_CHANGED");
    }
    const configFingerprint = sha256(JSON.stringify(config));
    let routePlan: RouteArtifactPlan | null = null;
    let routeFailure: FadenoDiagnosticError | null = null;
    try {
      routePlan = createRouteArtifactPlan(this.#root, config);
    } catch (error) {
      if (!(error instanceof FadenoDiagnosticError) || error.id !== "FADENO_ROUTE_ROUTE_ROLE_COLLISION") throw error;
      routeFailure = error;
    }

    const desiredSources = routePlan?.sources ?? Object.freeze(Object.fromEntries(
      (routeFailure?.locations ?? []).map((path) => [path, readFileSync(join(this.#root, path), "utf8")]),
    ));
    const desired = new Map<string, string>([
      ["fadeno.config.ts", configSource],
      ...Object.entries(desiredSources),
    ]);
    this.#synchronizeDocuments(desired);
    this.#assertInputsCurrent(desired);
    if (this.#configurationFingerprint !== configFingerprint) {
      accepted(this.#session.reloadConfiguration(configFingerprint));
      this.#configurationFingerprint = configFingerprint;
    }

    const documents = this.#session.currentSnapshot.documents;
    const documentByPath = new Map(documents.map((document) => [document.path, document]));
    const definitions = this.#definitions(routePlan, Object.keys(desiredSources), documentByPath);
    let diagnostics: AnalyzerDiagnosticBatch | null = null;
    const publicationResult = await this.#session.startPublication({
      definitions,
      requestedFacets: [{ namespace: ANALYZER_DIAGNOSTIC_NAMESPACE }],
      materialize: ({ graph }) => {
        this.#assertInputsCurrent(desired);
        const diagnosticInput = this.#diagnosticInput(routeFailure, config.routes?.root, documentByPath);
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
    return Object.freeze({
      publication,
      diagnostics: batch,
      routePlan,
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
    failure: FadenoDiagnosticError | null,
    configuredRoot: string | undefined,
    documents: ReadonlyMap<string, AnalyzerDocumentSnapshot>,
  ): Readonly<{
    diagnostics: readonly AnalyzerDiagnosticInput[];
    corrections: readonly AnalyzerCorrectionInput[];
    skippedWork: readonly Readonly<{ id: string; causedByKeys: readonly string[] }>[];
  }> {
    if (!failure) return { diagnostics: [], corrections: [], skippedWork: [] };
    if (failure.id !== "FADENO_ROUTE_ROUTE_ROLE_COLLISION" || !configuredRoot || failure.locations.length !== 2) {
      throw failure;
    }
    const owners = failure.locations.map((path) => ({ path, role: path.endsWith("handler.ts") ? "handler" as const : "page" as const }));
    const route = routeId(configuredRoot, owners[0]!.path);
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
