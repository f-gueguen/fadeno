import { isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeAnalyzerFacetValue, type AnalyzerFacetContribution, type AnalyzerFacetValue } from "./analyzer-facets.ts";
import type { AnalyzerDiagnosticBatch } from "./analyzer-diagnostics.ts";
import type { AnalyzerPublicationSnapshot } from "./analyzer-publication.ts";

export const ROUTE_EXPLAIN_NAMESPACE = "fadeno.routes.explain" as const;
export const ROUTE_EXPLAIN_VERSION = 1 as const;

type RouteExplainRecord = Readonly<{
  id: string;
  parentId: string | null;
  causedBy: readonly string[];
  kind: "decision" | "ownership" | "skipped" | "outcome" | "forensic";
  fields: AnalyzerFacetValue;
}>;

export interface RouteExplainValue {
  readonly family: "static-analysis";
  readonly module: typeof ROUTE_EXPLAIN_NAMESPACE;
  readonly version: typeof ROUTE_EXPLAIN_VERSION;
  readonly publicationOperationId: string;
  readonly publicationGeneration: number;
  readonly detail: "semantic" | "deep";
  readonly records: readonly RouteExplainRecord[];
}

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function projectPath(root: string, uri: string): string {
  const rootPath = fileURLToPath(root);
  const candidate = fileURLToPath(uri);
  const value = relative(rootPath, candidate);
  if (value === "" || value.startsWith("..") || isAbsolute(value)) throw new TypeError("FADENO_ANALYZER_ROUTE_EXPLAIN_OWNERSHIP");
  return value.split(sep).join("/");
}

function record(
  id: string,
  kind: RouteExplainRecord["kind"],
  fields: AnalyzerFacetValue,
  parentId: string | null = null,
  causedBy: readonly string[] = [],
): RouteExplainRecord {
  return frozen({ id, parentId, causedBy: frozen([...causedBy].sort(compareText)), kind, fields: normalizeAnalyzerFacetValue(fields) });
}

export function createRouteExplainContribution(
  publication: AnalyzerPublicationSnapshot,
  diagnostics: AnalyzerDiagnosticBatch | null,
  detail: "semantic" | "deep",
): AnalyzerFacetContribution {
  if (
    diagnostics && (
      diagnostics.identity.operationId !== publication.operationId ||
      diagnostics.identity.workspaceEpoch !== publication.workspaceEpoch ||
      diagnostics.identity.configurationEpoch !== publication.configurationEpoch
    )
  ) throw new TypeError("FADENO_ANALYZER_ROUTE_EXPLAIN_DIAGNOSTICS");
  const records: RouteExplainRecord[] = [];
  const refused = (diagnostics?.diagnostics.length ?? 0) > 0;
  records.push(record("route-decision", "decision", {
    decision: refused ? "refuse-static-route-plan" : "publish-static-route-plan",
    graphGeneration: publication.graph.generation,
  }));
  for (const result of publication.graph.results) {
    const ownershipId = `ownership-${result.id.replaceAll(":", "-")}`;
    records.push(record(ownershipId, "ownership", {
      nodeId: result.id,
      ownerPath: projectPath(publication.ownership.root, result.provenance.primaryOrigin.uri),
      artifactIds: result.artifacts.map(({ id }) => id).sort(compareText),
    }, "route-decision"));
    if (detail === "deep") {
      records.push(record(`${ownershipId}-forensic`, "forensic", {
        namespace: result.provenance.module.namespace,
        version: result.provenance.module.version,
        transformation: result.provenance.module.transformation,
        relatedSourceCount: result.provenance.relatedOrigins.length,
      }, ownershipId));
    }
  }
  for (const skipped of diagnostics?.skippedWork ?? []) {
    records.push(record(`skipped-${skipped.id}`, "skipped", {
      workId: skipped.id,
      diagnosticInstanceIds: skipped.causedBy,
    }, "route-decision", skipped.causedBy));
  }
  records.push(record("route-outcome", "outcome", {
    status: refused ? "static-refused" : "static-ready",
    diagnosticCodes: diagnostics?.diagnostics.map(({ code }) => code).sort(compareText) ?? [],
    artifactIds: publication.artifacts.map(({ id }) => id).sort(compareText),
  }, "route-decision", diagnostics?.diagnostics.map(({ instanceId }) => instanceId) ?? []));
  records.sort((left, right) => compareText(left.id, right.id));
  const value = normalizeAnalyzerFacetValue({
    family: "static-analysis",
    module: ROUTE_EXPLAIN_NAMESPACE,
    version: ROUTE_EXPLAIN_VERSION,
    publicationOperationId: publication.operationId,
    publicationGeneration: publication.publicationGeneration,
    detail,
    records,
  });
  return frozen({ namespace: ROUTE_EXPLAIN_NAMESPACE, version: ROUTE_EXPLAIN_VERSION, value });
}
