import { isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeAnalyzerFacetValue, type AnalyzerFacetContribution, type AnalyzerFacetValue } from "./analyzer-facets.ts";
import type { AnalyzerDiagnosticBatch } from "./analyzer-diagnostics.ts";
import type { AnalyzerExplainBudgets } from "./analyzer-explain.ts";
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

export type RouteExplainTruncationReason = "bytes" | "records" | "depth" | "children";

export interface RouteExplainProcessedContribution {
  readonly contribution: AnalyzerFacetContribution;
  readonly truncation: RouteExplainTruncationReason | null;
}

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function refuse(): never {
  throw new TypeError("FADENO_ANALYZER_ROUTE_EXPLAIN");
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) refuse();
  const source = value as Record<string, unknown>;
  const actual = Object.keys(source).sort(compareText);
  const expected = [...keys].sort(compareText);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) refuse();
  return source;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) refuse();
  const result = [...value] as string[];
  if (result.some((entry, index) => index > 0 && compareText(result[index - 1]!, entry) >= 0)) refuse();
  return result;
}

function validateFields(kind: RouteExplainRecord["kind"], value: unknown): AnalyzerFacetValue {
  const keys = kind === "decision" ? ["decision", "graphGeneration"]
    : kind === "ownership" ? ["artifactIds", "nodeId", "ownerPath"]
      : kind === "skipped" ? ["diagnosticInstanceIds", "workId"]
        : kind === "outcome" ? ["artifactIds", "diagnosticCodes", "status"]
          : ["namespace", "relatedSourceCount", "transformation", "version"];
  const fields = object(value, keys);
  if (kind === "decision") {
    if (fields["decision"] !== "publish-static-route-plan" && fields["decision"] !== "refuse-static-route-plan") refuse();
    if (!Number.isSafeInteger(fields["graphGeneration"]) || (fields["graphGeneration"] as number) < 1) refuse();
  } else if (kind === "ownership") {
    if (typeof fields["nodeId"] !== "string" || typeof fields["ownerPath"] !== "string") refuse();
    const path = fields["ownerPath"];
    if ((path as string).startsWith("/") || (path as string).includes("\\") || (path as string).split("/").some((part) => part === "" || part === "." || part === "..")) refuse();
    strings(fields["artifactIds"]);
  } else if (kind === "skipped") {
    if (typeof fields["workId"] !== "string") refuse();
    strings(fields["diagnosticInstanceIds"]);
  } else if (kind === "outcome") {
    if (fields["status"] !== "static-ready" && fields["status"] !== "static-refused") refuse();
    strings(fields["artifactIds"]);
    strings(fields["diagnosticCodes"]);
  } else {
    if (
      typeof fields["namespace"] !== "string" || typeof fields["transformation"] !== "string" ||
      !Number.isSafeInteger(fields["version"]) || (fields["version"] as number) < 1 ||
      !Number.isSafeInteger(fields["relatedSourceCount"]) || (fields["relatedSourceCount"] as number) < 0
    ) refuse();
  }
  return normalizeAnalyzerFacetValue(fields);
}

function validateContribution(input: AnalyzerFacetContribution): AnalyzerFacetContribution {
  if (input.namespace !== ROUTE_EXPLAIN_NAMESPACE || input.version !== ROUTE_EXPLAIN_VERSION) refuse();
  const value = object(input.value, ["family", "module", "version", "publicationOperationId", "publicationGeneration", "detail", "records"]);
  if (
    value["family"] !== "static-analysis" || value["module"] !== ROUTE_EXPLAIN_NAMESPACE || value["version"] !== ROUTE_EXPLAIN_VERSION ||
    typeof value["publicationOperationId"] !== "string" || !Number.isSafeInteger(value["publicationGeneration"]) ||
    (value["publicationGeneration"] as number) < 1 || (value["detail"] !== "semantic" && value["detail"] !== "deep") ||
    !Array.isArray(value["records"])
  ) refuse();
  const ids = new Set<string>();
  const records = (value["records"] as unknown[]).map((entry, index) => {
    const source = object(entry, ["id", "parentId", "causedBy", "kind", "fields"]);
    if (typeof source["id"] !== "string" || !/^[a-z][a-z0-9-]*$/u.test(source["id"]) || ids.has(source["id"] as string)) refuse();
    if (index > 0 && compareText((value["records"] as any[])[index - 1].id, source["id"] as string) >= 0) refuse();
    ids.add(source["id"] as string);
    if (source["parentId"] !== null && typeof source["parentId"] !== "string") refuse();
    if (!["decision", "ownership", "skipped", "outcome", "forensic"].includes(source["kind"] as string)) refuse();
    if (value["detail"] === "semantic" && source["kind"] === "forensic") refuse();
    return frozen({
      id: source["id"] as string, parentId: source["parentId"] as string | null,
      causedBy: frozen(strings(source["causedBy"])), kind: source["kind"] as RouteExplainRecord["kind"],
      fields: validateFields(source["kind"] as RouteExplainRecord["kind"], source["fields"]),
    });
  });
  for (const current of records) {
    if (current.parentId !== null && (!ids.has(current.parentId) || current.parentId === current.id)) refuse();
    if (current.causedBy.some((id) => !ids.has(id) || id === current.id)) refuse();
  }
  const byId = new Map(records.map((current) => [current.id, current]));
  for (const current of records) depthOf(current, byId);
  const normalized = normalizeAnalyzerFacetValue({ ...value, records });
  return frozen({ namespace: ROUTE_EXPLAIN_NAMESPACE, version: ROUTE_EXPLAIN_VERSION, value: normalized });
}

function depthOf(record: RouteExplainRecord, byId: Map<string, RouteExplainRecord>, visiting = new Set<string>()): number {
  if (visiting.has(record.id)) refuse();
  if (record.parentId === null) return 1;
  visiting.add(record.id);
  const parent = byId.get(record.parentId);
  if (!parent) refuse();
  const depth = 1 + depthOf(parent, byId, visiting);
  visiting.delete(record.id);
  return depth;
}

export function processRouteExplainContribution(
  input: AnalyzerFacetContribution,
  budgets: AnalyzerExplainBudgets,
  detail: "semantic" | "deep",
): RouteExplainProcessedContribution {
  const validated = validateContribution(input);
  const value = validated.value as unknown as RouteExplainValue;
  if (value.detail !== detail) refuse();
  const byId = new Map(value.records.map((current) => [current.id, current]));
  const kept: RouteExplainRecord[] = [];
  const children = new Map<string, number>();
  let truncation: RouteExplainTruncationReason | null = null;
  for (const current of value.records) {
    if (kept.length >= budgets.records) { truncation = "records"; break; }
    if (depthOf(current, byId) > budgets.depth) { truncation = "depth"; continue; }
    if (current.parentId !== null) {
      const count = children.get(current.parentId) ?? 0;
      if (count >= budgets.children) { truncation = "children"; continue; }
      children.set(current.parentId, count + 1);
    }
    const candidate = normalizeAnalyzerFacetValue({ ...value, records: [...kept, current] });
    if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > budgets.bytes) { truncation = "bytes"; break; }
    kept.push(current);
  }
  const contribution = frozen({
    namespace: ROUTE_EXPLAIN_NAMESPACE,
    version: ROUTE_EXPLAIN_VERSION,
    value: normalizeAnalyzerFacetValue({ ...value, records: kept }),
  });
  return frozen({ contribution, truncation });
}

export function serializeRouteExplainContribution(input: AnalyzerFacetContribution): string {
  try {
    const value = JSON.stringify({ format: "fadeno-private-route-explain", serializationVersion: 1, contribution: validateContribution(input) });
    deserializeRouteExplainContribution(value);
    return value;
  } catch { throw new TypeError("FADENO_ANALYZER_ROUTE_EXPLAIN_SERIALIZATION"); }
}

export function deserializeRouteExplainContribution(serialized: string): AnalyzerFacetContribution {
  try {
    const envelope = object(JSON.parse(serialized), ["format", "serializationVersion", "contribution"]);
    if (envelope["format"] !== "fadeno-private-route-explain" || envelope["serializationVersion"] !== 1) refuse();
    return validateContribution(envelope["contribution"] as AnalyzerFacetContribution);
  } catch { throw new TypeError("FADENO_ANALYZER_ROUTE_EXPLAIN_SERIALIZATION"); }
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
