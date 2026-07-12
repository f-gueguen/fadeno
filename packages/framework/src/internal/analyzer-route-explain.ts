import { isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeAnalyzerFacetValue, type AnalyzerFacetContribution, type AnalyzerFacetValue } from "./analyzer-facets.ts";
import { isAnalyzerDiagnosticCode, type AnalyzerDiagnosticBatch } from "./analyzer-diagnostics.ts";
import type { AnalyzerExplainBudgets } from "./analyzer-explain.ts";
import type { AnalyzerPublicationSnapshot } from "./analyzer-publication.ts";

export const ROUTE_EXPLAIN_NAMESPACE = "fadeno.routes.explain" as const;
export const ROUTE_EXPLAIN_VERSION = 1 as const;

type RouteExplainRecord = Readonly<{
  id: string;
  parentId: string | null;
  causedBy: readonly string[];
  kind: "decision" | "cause" | "ownership" | "skipped" | "outcome" | "forensic";
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
    : kind === "cause" ? ["code", "diagnosticInstanceId"]
    : kind === "ownership" ? ["artifactIds", "nodeId", "ownerPath"]
      : kind === "skipped" ? ["diagnosticInstanceIds", "workId"]
        : kind === "outcome" ? ["artifactIds", "diagnosticCodes", "status"]
          : ["namespace", "relatedSourceCount", "transformation", "version"];
  const fields = object(value, keys);
  if (kind === "decision") {
    if (fields["decision"] !== "publish-static-route-plan" && fields["decision"] !== "refuse-static-route-plan") refuse();
    if (!Number.isSafeInteger(fields["graphGeneration"]) || (fields["graphGeneration"] as number) < 1) refuse();
  } else if (kind === "cause") {
    if (!isAnalyzerDiagnosticCode(fields["code"]) || typeof fields["diagnosticInstanceId"] !== "string") refuse();
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
    if (!["decision", "cause", "ownership", "skipped", "outcome", "forensic"].includes(source["kind"] as string)) refuse();
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
  const dependencyDepths = new Map<string, number>();
  for (const current of records) dependencyDepthOf(current, byId, dependencyDepths);
  const normalized = normalizeAnalyzerFacetValue({ ...value, records });
  return frozen({ namespace: ROUTE_EXPLAIN_NAMESPACE, version: ROUTE_EXPLAIN_VERSION, value: normalized });
}

function dependencyDepthOf(
  record: RouteExplainRecord,
  byId: Map<string, RouteExplainRecord>,
  memo: Map<string, number>,
  visiting = new Set<string>(),
): number {
  const cached = memo.get(record.id);
  if (cached !== undefined) return cached;
  if (visiting.has(record.id)) refuse();
  visiting.add(record.id);
  const dependencies = [record.parentId, ...record.causedBy].filter((id): id is string => id !== null);
  let depth = 1;
  for (const dependencyId of dependencies) {
    const dependency = byId.get(dependencyId);
    if (!dependency) refuse();
    depth = Math.max(depth, 1 + dependencyDepthOf(dependency, byId, memo, visiting));
  }
  visiting.delete(record.id);
  memo.set(record.id, depth);
  return depth;
}

export function processRouteExplainContribution(
  input: AnalyzerFacetContribution,
  budgets: AnalyzerExplainBudgets,
  detail: "semantic" | "deep",
  publication: Pick<AnalyzerPublicationSnapshot, "operationId" | "publicationGeneration">,
): RouteExplainProcessedContribution {
  const validated = validateContribution(input);
  const value = validated.value as unknown as RouteExplainValue;
  if (
    value.detail !== detail || value.publicationOperationId !== publication.operationId ||
    value.publicationGeneration !== publication.publicationGeneration
  ) refuse();
  const byId = new Map(value.records.map((current) => [current.id, current]));
  const dependencyDepths = new Map<string, number>();
  for (const current of value.records) dependencyDepthOf(current, byId, dependencyDepths);
  const ordered = [...value.records].sort((left, right) =>
    dependencyDepths.get(left.id)! - dependencyDepths.get(right.id)! || compareText(left.id, right.id));
  const kept: RouteExplainRecord[] = [];
  const keptIds = new Set<string>();
  const children = new Map<string, number>();
  let truncation: RouteExplainTruncationReason | null = null;
  for (const current of ordered) {
    const dependencies = [current.parentId, ...current.causedBy].filter((id): id is string => id !== null);
    if (dependencies.some((id) => !keptIds.has(id))) continue;
    if (kept.length >= budgets.records) { truncation ??= "records"; continue; }
    if (dependencyDepths.get(current.id)! > budgets.depth) { truncation ??= "depth"; continue; }
    if (current.parentId !== null) {
      const count = children.get(current.parentId) ?? 0;
      if (count >= budgets.children) { truncation ??= "children"; continue; }
    }
    const candidateRecords = [...kept, current].sort((left, right) => compareText(left.id, right.id));
    const candidate = normalizeAnalyzerFacetValue({ ...value, records: candidateRecords });
    if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > budgets.bytes) { truncation ??= "bytes"; continue; }
    kept.push(current);
    keptIds.add(current.id);
    if (current.parentId !== null) children.set(current.parentId, (children.get(current.parentId) ?? 0) + 1);
  }
  const contribution = frozen({
    namespace: ROUTE_EXPLAIN_NAMESPACE,
    version: ROUTE_EXPLAIN_VERSION,
    value: normalizeAnalyzerFacetValue({ ...value, records: kept.sort((left, right) => compareText(left.id, right.id)) }),
  });
  return frozen({ contribution: validateContribution(contribution), truncation });
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

export function formatRouteExplainHuman(input: AnalyzerFacetContribution): string {
  const value = validateContribution(input).value as unknown as RouteExplainValue;
  const lines = [`Static route explanation (${value.detail})`];
  const kindOrder: readonly RouteExplainRecord["kind"][] = ["decision", "cause", "ownership", "skipped", "outcome", "forensic"];
  for (const kind of kindOrder) {
    for (const current of value.records.filter((record) => record.kind === kind)) {
      const fields = current.fields as Readonly<Record<string, AnalyzerFacetValue>>;
      if (kind === "decision") lines.push(`decision: ${String(fields["decision"])}`);
      else if (kind === "cause") lines.push(`cause: ${String(fields["code"])}`);
      else if (kind === "ownership") lines.push(`ownership: ${String(fields["nodeId"])} <- ${String(fields["ownerPath"])}`);
      else if (kind === "skipped") lines.push(`skipped: ${String(fields["workId"])}`);
      else if (kind === "outcome") lines.push(`outcome: ${String(fields["status"])}`);
      else lines.push(`forensic: ${String(fields["namespace"])}:${String(fields["transformation"])}`);
    }
  }
  return `${lines.join("\n")}\n`;
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
      diagnostics.identity.sessionId !== publication.sessionId ||
      diagnostics.identity.operationId !== publication.operationId ||
      diagnostics.identity.workspaceEpoch !== publication.workspaceEpoch ||
      diagnostics.identity.configurationEpoch !== publication.configurationEpoch ||
      diagnostics.identity.ownership.mode !== publication.ownership.mode ||
      diagnostics.identity.ownership.root !== publication.ownership.root ||
      diagnostics.identity.ownership.configurationFingerprint !== publication.ownership.configurationFingerprint ||
      JSON.stringify(diagnostics.identity.documentVersions) !== JSON.stringify(publication.documentVersions)
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
  const causeId = (instanceId: string) => `cause-${instanceId.replaceAll(":", "-")}`;
  for (const diagnostic of diagnostics?.diagnostics ?? []) {
    records.push(record(causeId(diagnostic.instanceId), "cause", {
      code: diagnostic.code,
      diagnosticInstanceId: diagnostic.instanceId,
    }, "route-decision", diagnostic.causedBy.map(causeId)));
  }
  for (const skipped of diagnostics?.skippedWork ?? []) {
    records.push(record(`skipped-${skipped.id}`, "skipped", {
      workId: skipped.id,
      diagnosticInstanceIds: skipped.causedBy,
    }, "route-decision", skipped.causedBy.map(causeId)));
  }
  records.push(record("route-outcome", "outcome", {
    status: refused ? "static-refused" : "static-ready",
    diagnosticCodes: diagnostics?.diagnostics.map(({ code }) => code).sort(compareText) ?? [],
    artifactIds: publication.artifacts.map(({ id }) => id).sort(compareText),
  }, "route-decision", diagnostics?.diagnostics.map(({ instanceId }) => causeId(instanceId)) ?? []));
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
