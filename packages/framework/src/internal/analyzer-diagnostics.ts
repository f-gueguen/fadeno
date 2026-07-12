import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TextEncoder } from "node:util";

import type { AnalyzerDocumentOnlySnapshot, AnalyzerDocumentSnapshot, AnalyzerTextEdit } from "./analyzer-session.ts";
import type { AnalyzerGraphSnapshot } from "./analyzer-graph.ts";

export const ANALYZER_DIAGNOSTIC_NAMESPACE = "fadeno.diagnostics" as const;
export const ANALYZER_DIAGNOSTIC_VERSION = 1 as const;

export type AnalyzerDiagnosticCode =
  | "FADENO_CONFIG_ROOT_MISSING"
  | "FADENO_ROUTE_ROUTE_ROLE_COLLISION"
  | "FADENO_ROUTE_ROUTE_ROLE_OWNER"
  | "FADENO_ANALYZER_INTERNAL_FAILURE";

export type AnalyzerCorrectionFixId =
  | "FADENO_FIX_CONFIG_ROOT"
  | "FADENO_FIX_REVIEW_ROUTE_ROLE_COLLISION";

export type AnalyzerNullRangeReason = "configuration-entry" | "filesystem-entry";

export interface AnalyzerDiagnosticLocation {
  readonly uri: string;
  readonly path: string;
  readonly range: Readonly<{ start: number; end: number }> | null;
  readonly rangeReason: AnalyzerNullRangeReason | null;
}

export interface AnalyzerDiagnosticInput {
  readonly key: string;
  readonly code: AnalyzerDiagnosticCode;
  readonly parameters: Readonly<Record<string, string>>;
  readonly primaryLocation: AnalyzerDiagnosticLocation;
  readonly relatedLocations?: readonly AnalyzerDiagnosticLocation[];
  readonly causedByKeys?: readonly string[];
  readonly correctionFixIds?: readonly AnalyzerCorrectionFixId[];
  readonly internalFailure?: Readonly<{ incidentId: string }> | null;
}

export interface AnalyzerCorrectionEdit {
  readonly uri: string;
  readonly path: string;
  readonly version: number;
  readonly lifetime: number;
  readonly range: Readonly<{ start: number; end: number }>;
  readonly expectedText: string;
  readonly text: string;
}

export interface AnalyzerCorrectionInput {
  readonly fixId: AnalyzerCorrectionFixId;
  readonly parameters: Readonly<Record<string, string>>;
  readonly safety: "automatic" | "review";
  readonly preferred: boolean;
  readonly diagnosticKeys: readonly string[];
  readonly edits: readonly AnalyzerCorrectionEdit[];
}

export interface AnalyzerSkippedWorkInput {
  readonly id: string;
  readonly causedByKeys: readonly string[];
}

export interface AnalyzerDiagnosticBatchInput {
  readonly graph: AnalyzerGraphSnapshot;
  readonly documents: readonly AnalyzerDocumentSnapshot[];
  readonly diagnostics: readonly AnalyzerDiagnosticInput[];
  readonly corrections: readonly AnalyzerCorrectionInput[];
  readonly skippedWork: readonly AnalyzerSkippedWorkInput[];
}

export interface AnalyzerDiagnosticRecord {
  readonly instanceId: string;
  readonly code: AnalyzerDiagnosticCode;
  readonly severity: "error";
  readonly module: Readonly<{ namespace: string; version: 1 }>;
  readonly phase: string;
  readonly parameters: Readonly<Record<string, string>>;
  readonly primaryLocation: AnalyzerDiagnosticLocation;
  readonly relatedLocations: readonly AnalyzerDiagnosticLocation[];
  readonly causedBy: readonly string[];
  readonly correctionFixIds: readonly AnalyzerCorrectionFixId[];
  readonly internalFailure: Readonly<{ incidentId: string }> | null;
  readonly redaction: Readonly<{ state: "none" | "redacted"; fields: readonly string[] }>;
  readonly explanationRef: string;
}

export interface AnalyzerCorrectionIntent {
  readonly fixId: AnalyzerCorrectionFixId;
  readonly parameters: Readonly<Record<string, string>>;
  readonly safety: "automatic" | "review";
  readonly preferred: boolean;
  readonly diagnosticInstanceIds: readonly string[];
  readonly edits: readonly AnalyzerCorrectionEdit[];
  readonly applicability: AnalyzerDiagnosticBatch["identity"];
}

export interface AnalyzerDiagnosticBatch {
  readonly namespace: typeof ANALYZER_DIAGNOSTIC_NAMESPACE;
  readonly version: typeof ANALYZER_DIAGNOSTIC_VERSION;
  readonly identity: Readonly<{
    sessionId: string;
    operationId: string;
    workspaceEpoch: number;
    configurationEpoch: number;
    documentVersions: AnalyzerDocumentOnlySnapshot["documentVersions"];
    ownership: Readonly<{ mode: "single-root"; root: string; configurationFingerprint: string }>;
    documents: readonly Readonly<{ uri: string; path: string; length: number }>[];
  }>;
  readonly diagnostics: readonly AnalyzerDiagnosticRecord[];
  readonly corrections: readonly AnalyzerCorrectionIntent[];
  readonly skippedWork: readonly Readonly<{ id: string; causedBy: readonly string[] }>[];
  readonly completeness: "complete";
  readonly redaction: Readonly<{ state: "none" | "redacted" }>;
  readonly truncated: false;
}

export type AnalyzerCorrectionApplicationResult =
  | Readonly<{
    accepted: true;
    fixId: AnalyzerCorrectionFixId;
    uri: string;
    path: string;
    lifetime: number;
    version: number;
    edits: readonly AnalyzerTextEdit[];
    before: string;
    after: string;
  }>
  | Readonly<{
    accepted: false;
    fixId: string;
    code:
      | "FADENO_ANALYZER_CORRECTION_ID"
      | "FADENO_ANALYZER_CORRECTION_REVIEW"
      | "FADENO_ANALYZER_CORRECTION_STALE";
  }>;

const encoder = new TextEncoder();
const keyPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const workPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const configuredPathPattern = /^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/u;
const routePattern = /^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/u;
const incidentPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const maximumBatchBytes = 262_144;

function validConfiguredPath(value: string): boolean {
  return configuredPathPattern.test(value) && value.split("/").every((segment) => segment !== "." && segment !== "..");
}

type Definition = Readonly<{
  module: string;
  phase: string;
  parameterKeys: readonly string[];
  validate(parameters: Readonly<Record<string, string>>): boolean;
  summary(parameters: Readonly<Record<string, string>>): string;
  explanation: string;
  internal: boolean;
}>;

function diagnosticDefinition(value: Definition): Definition {
  return Object.freeze(value);
}

const definitions: Readonly<Record<AnalyzerDiagnosticCode, Definition>> = Object.freeze({
  FADENO_CONFIG_ROOT_MISSING: diagnosticDefinition({
    module: "fadeno.configuration", phase: "ownership", parameterKeys: ["configuredRoot"],
    validate: ({ configuredRoot }) => typeof configuredRoot === "string" && validConfiguredPath(configuredRoot),
    summary: ({ configuredRoot }) => `Configured route root ${configuredRoot} does not exist.`,
    explanation: "https://fadeno.dev/diagnostics/config/root-missing", internal: false,
  }),
  FADENO_ROUTE_ROUTE_ROLE_COLLISION: diagnosticDefinition({
    module: "fadeno.routes", phase: "discovery", parameterKeys: ["route"],
    validate: ({ route }) => typeof route === "string" && routePattern.test(route),
    summary: ({ route }) => `Route ${route} has conflicting owners.`,
    explanation: "https://fadeno.dev/diagnostics/routes/route-role-collision", internal: false,
  }),
  FADENO_ROUTE_ROUTE_ROLE_OWNER: diagnosticDefinition({
    module: "fadeno.routes", phase: "discovery", parameterKeys: ["role", "route"],
    validate: ({ role, route }) => (role === "handler" || role === "page") && typeof route === "string" && routePattern.test(route),
    summary: ({ role, route }) => `${role === "handler" ? "Handler" : "Page"} ownership conflicts at route ${route}.`,
    explanation: "https://fadeno.dev/diagnostics/routes/route-role-collision", internal: false,
  }),
  FADENO_ANALYZER_INTERNAL_FAILURE: diagnosticDefinition({
    module: "fadeno.analyzer", phase: "internal", parameterKeys: ["operation"],
    validate: ({ operation }) => operation === "route-analysis",
    summary: () => "Framework analysis could not complete.",
    explanation: "https://fadeno.dev/diagnostics/analyzer/internal-failure", internal: true,
  }),
});

export function isAnalyzerDiagnosticCode(value: unknown): value is AnalyzerDiagnosticCode {
  return typeof value === "string" && Object.hasOwn(definitions, value);
}

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertSortedUnique(values: readonly string[]): void {
  if (values.some((value, index) => index > 0 && compareText(values[index - 1]!, value) >= 0)) refuse();
}

function refuse(): never {
  throw new TypeError("FADENO_ANALYZER_DIAGNOSTIC");
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort(compareText);
  const expected = [...keys].sort(compareText);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) refuse();
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) refuse();
  const result = value as Record<string, unknown>;
  exactKeys(result, keys);
  return result;
}

function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) refuse();
  return value;
}

function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) refuse();
  return value as number;
}

function text(value: unknown): string {
  if (typeof value !== "string") refuse();
  return value;
}

function parameters(value: unknown, definition: Definition): Readonly<Record<string, string>> {
  const source = record(value, definition.parameterKeys);
  const result: Record<string, string> = {};
  for (const key of definition.parameterKeys) result[key] = text(source[key]);
  if (!definition.validate(result)) refuse();
  return frozen(result);
}

function rootPath(root: string): string {
  try {
    const url = new URL(root);
    if (url.protocol !== "file:" || url.host !== "" || url.search !== "" || url.hash !== "") refuse();
    const path = fileURLToPath(url);
    if (!path.endsWith(sep) || pathToFileURL(path).href !== root) refuse();
    return path;
  } catch {
    refuse();
  }
}

function ownedUri(root: string, path: string, uri: string): void {
  if (path.length === 0 || path.includes("\\") || path.includes("\0") || path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) refuse();
  const base = rootPath(root);
  const candidate = resolve(base, ...path.split("/"));
  const containment = relative(base, candidate);
  if (containment === "" || containment.startsWith("..") || isAbsolute(containment) || containment.split(sep).join("/") !== path) refuse();
  if (pathToFileURL(candidate).href !== uri) refuse();
}

function location(value: unknown, identity: AnalyzerDiagnosticBatch["identity"]): AnalyzerDiagnosticLocation {
  const source = record(value, ["uri", "path", "range", "rangeReason"]);
  const uri = text(source["uri"]);
  const path = text(source["path"]);
  ownedUri(identity.ownership.root, path, uri);
  const document = identity.documents.find((entry) => entry.uri === uri && entry.path === path);
  if (!document) refuse();
  if (source["range"] === null) {
    if (source["rangeReason"] !== "configuration-entry" && source["rangeReason"] !== "filesystem-entry") refuse();
    return frozen({ uri, path, range: null, rangeReason: source["rangeReason"] });
  }
  if (source["rangeReason"] !== null) refuse();
  const range = record(source["range"], ["start", "end"]);
  const start = integer(range["start"]);
  const end = integer(range["end"]);
  if (end < start || end > document.length) refuse();
  return frozen({ uri, path, range: frozen({ start, end }), rangeReason: null });
}

function identity(value: unknown): AnalyzerDiagnosticBatch["identity"] {
  const source = record(value, [
    "sessionId", "operationId", "workspaceEpoch", "configurationEpoch", "documentVersions", "ownership", "documents",
  ]);
  const sessionId = text(source["sessionId"]);
  const operationId = text(source["operationId"]);
  const operationSequence = operationId.slice(`${sessionId}:operation-`.length);
  if (
    !incidentPattern.test(sessionId) || !operationId.startsWith(`${sessionId}:operation-`) ||
    !/^[1-9][0-9]*$/u.test(operationSequence) || !Number.isSafeInteger(Number(operationSequence))
  ) refuse();
  const ownershipSource = record(source["ownership"], ["mode", "root", "configurationFingerprint"]);
  if (ownershipSource["mode"] !== "single-root") refuse();
  const root = text(ownershipSource["root"]);
  rootPath(root);
  const configurationFingerprint = text(ownershipSource["configurationFingerprint"]);
  if (!/^[0-9a-f]{64}$/u.test(configurationFingerprint)) refuse();
  const versions = array(source["documentVersions"], 4_096).map((entry) => {
    const item = record(entry, ["uri", "version", "lifetime"]);
    const lifetime = integer(item["lifetime"]);
    if (lifetime === 0) refuse();
    return frozen({ uri: text(item["uri"]), version: integer(item["version"]), lifetime });
  });
  const documents = array(source["documents"], 4_096).map((entry) => {
    const item = record(entry, ["uri", "path", "length"]);
    const document = frozen({ uri: text(item["uri"]), path: text(item["path"]), length: integer(item["length"]) });
    ownedUri(root, document.path, document.uri);
    return document;
  });
  if (documents.some((document, index) => index > 0 && compareText(documents[index - 1]!.path, document.path) >= 0)) refuse();
  if (versions.some((version, index) => index > 0 && compareText(versions[index - 1]!.uri, version.uri) >= 0)) refuse();
  if (versions.some((version) => !documents.some((document) => document.uri === version.uri))) refuse();
  return frozen({
    sessionId, operationId, workspaceEpoch: integer(source["workspaceEpoch"]),
    configurationEpoch: integer(source["configurationEpoch"]), documentVersions: frozen(versions),
    ownership: frozen({ mode: "single-root" as const, root, configurationFingerprint }), documents: frozen(documents),
  });
}

function sameIdentity(left: AnalyzerDiagnosticBatch["identity"], right: AnalyzerDiagnosticBatch["identity"]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateBatch(value: unknown): AnalyzerDiagnosticBatch {
  const source = record(value, [
    "namespace", "version", "identity", "diagnostics", "corrections", "skippedWork", "completeness", "redaction", "truncated",
  ]);
  if (source["namespace"] !== ANALYZER_DIAGNOSTIC_NAMESPACE || source["version"] !== ANALYZER_DIAGNOSTIC_VERSION) refuse();
  if (source["completeness"] !== "complete" || source["truncated"] !== false) refuse();
  const batchIdentity = identity(source["identity"]);
  const instanceIds = new Set<string>();
  const diagnostics = array(source["diagnostics"], 256).map((entry, index) => {
    const item = record(entry, [
      "instanceId", "code", "severity", "module", "phase", "parameters", "primaryLocation", "relatedLocations", "causedBy",
      "correctionFixIds", "internalFailure", "redaction", "explanationRef",
    ]);
    const instanceId = text(item["instanceId"]);
    if (instanceId !== `${batchIdentity.operationId}:diagnostic-${index + 1}` || instanceIds.has(instanceId)) refuse();
    instanceIds.add(instanceId);
    if (!Object.hasOwn(definitions, text(item["code"]))) refuse();
    const code = item["code"] as AnalyzerDiagnosticCode;
    const definition = definitions[code];
    if (item["severity"] !== "error") refuse();
    const module = record(item["module"], ["namespace", "version"]);
    if (module["namespace"] !== definition.module || module["version"] !== 1 || item["phase"] !== definition.phase) refuse();
    const normalizedParameters = parameters(item["parameters"], definition);
    const relatedLocations = array(item["relatedLocations"], 32).map((value) => location(value, batchIdentity));
    assertSortedUnique(relatedLocations.map((value) => `${value.path}:${value.range?.start ?? -1}:${value.range?.end ?? -1}`));
    const causedBy = array(item["causedBy"], 32).map(text);
    const correctionFixIds = array(item["correctionFixIds"], 16).map(text) as AnalyzerCorrectionFixId[];
    assertSortedUnique(causedBy);
    assertSortedUnique(correctionFixIds);
    const internalFailure = item["internalFailure"] === null ? null : record(item["internalFailure"], ["incidentId"]);
    if (definition.internal !== (internalFailure !== null)) refuse();
    const normalizedInternal = internalFailure === null ? null : frozen({ incidentId: text(internalFailure["incidentId"]) });
    if (normalizedInternal && !incidentPattern.test(normalizedInternal.incidentId)) refuse();
    const redaction = record(item["redaction"], ["state", "fields"]);
    const expectedState: "none" | "redacted" = definition.internal ? "redacted" : "none";
    const expectedFields = definition.internal ? ["details"] : [];
    if (redaction["state"] !== expectedState || JSON.stringify(redaction["fields"]) !== JSON.stringify(expectedFields)) refuse();
    if (item["explanationRef"] !== definition.explanation) refuse();
    return frozen({
      instanceId, code, severity: "error" as const, module: frozen({ namespace: definition.module, version: 1 as const }),
      phase: definition.phase, parameters: normalizedParameters, primaryLocation: location(item["primaryLocation"], batchIdentity),
      relatedLocations: frozen(relatedLocations), causedBy: frozen(causedBy), correctionFixIds: frozen(correctionFixIds),
      internalFailure: normalizedInternal, redaction: frozen({ state: expectedState, fields: frozen(expectedFields) }),
      explanationRef: definition.explanation,
    });
  });
  for (const diagnostic of diagnostics) {
    if (diagnostic.causedBy.some((id) => id === diagnostic.instanceId || !instanceIds.has(id))) refuse();
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(diagnostics.map((diagnostic) => [diagnostic.instanceId, diagnostic]));
  const visit = (id: string): void => {
    if (visiting.has(id)) refuse();
    if (visited.has(id)) return;
    visiting.add(id);
    for (const cause of byId.get(id)?.causedBy ?? []) visit(cause);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of instanceIds) visit(id);
  const fixIds = new Set<string>();
  let previousFixId: string | undefined;
  const corrections = array(source["corrections"], 64).map((entry) => {
    const item = record(entry, ["fixId", "parameters", "safety", "preferred", "diagnosticInstanceIds", "edits", "applicability"]);
    const fixId = text(item["fixId"]) as AnalyzerCorrectionFixId;
    if (
      (fixId !== "FADENO_FIX_CONFIG_ROOT" && fixId !== "FADENO_FIX_REVIEW_ROUTE_ROLE_COLLISION") ||
      fixIds.has(fixId) || previousFixId !== undefined && compareText(previousFixId, fixId) >= 0
    ) refuse();
    fixIds.add(fixId);
    previousFixId = fixId;
    const safety = item["safety"];
    const preferred = item["preferred"];
    const expectedAutomatic = fixId === "FADENO_FIX_CONFIG_ROOT";
    if (safety !== (expectedAutomatic ? "automatic" : "review") || preferred !== expectedAutomatic) refuse();
    const parameterDefinition = fixId === "FADENO_FIX_CONFIG_ROOT"
      ? diagnosticDefinition({
        ...definitions.FADENO_CONFIG_ROOT_MISSING,
        parameterKeys: ["replacement"],
        validate: ({ replacement }) => typeof replacement === "string" && validConfiguredPath(replacement),
      })
      : definitions.FADENO_ROUTE_ROUTE_ROLE_COLLISION;
    const normalizedParameters = parameters(item["parameters"], parameterDefinition);
    const diagnosticInstanceIds = array(item["diagnosticInstanceIds"], 32).map(text);
    assertSortedUnique(diagnosticInstanceIds);
    if (diagnosticInstanceIds.length === 0 || diagnosticInstanceIds.some((id) => !instanceIds.has(id))) refuse();
    const edits = array(item["edits"], 64).map((entry) => {
      const edit = record(entry, ["uri", "path", "version", "lifetime", "range", "expectedText", "text"]);
      const uri = text(edit["uri"]);
      const path = text(edit["path"]);
      ownedUri(batchIdentity.ownership.root, path, uri);
      const range = record(edit["range"], ["start", "end"]);
      const start = integer(range["start"]);
      const end = integer(range["end"]);
      const document = batchIdentity.documents.find((entry) => entry.uri === uri && entry.path === path);
      if (!document || end < start || end > document.length) refuse();
      const lifetime = integer(edit["lifetime"]);
      if (lifetime === 0) refuse();
      const documentVersion = batchIdentity.documentVersions.find((entry) => entry.uri === uri);
      if (!documentVersion || documentVersion.version !== edit["version"] || documentVersion.lifetime !== lifetime) refuse();
      return frozen({
        uri, path, version: integer(edit["version"]), lifetime,
        range: frozen({ start, end }), expectedText: text(edit["expectedText"]), text: text(edit["text"]),
      });
    });
    if (expectedAutomatic) {
      if (edits.length !== 1 || diagnosticInstanceIds.length !== 1 || edits[0]!.text !== JSON.stringify(normalizedParameters["replacement"])) refuse();
      const diagnostic = byId.get(diagnosticInstanceIds[0]!);
      if (
        !diagnostic || diagnostic.code !== "FADENO_CONFIG_ROOT_MISSING" || diagnostic.primaryLocation.range === null ||
        edits[0]!.uri !== diagnostic.primaryLocation.uri || edits[0]!.path !== diagnostic.primaryLocation.path ||
        JSON.stringify(edits[0]!.range) !== JSON.stringify(diagnostic.primaryLocation.range) ||
        edits[0]!.expectedText !== JSON.stringify(diagnostic.parameters["configuredRoot"])
      ) refuse();
    } else if (edits.length !== 0) refuse();
    const applicability = identity(item["applicability"]);
    if (!sameIdentity(applicability, batchIdentity)) refuse();
    return frozen({
      fixId, parameters: normalizedParameters, safety: safety as "automatic" | "review", preferred: preferred as boolean,
      diagnosticInstanceIds: frozen(diagnosticInstanceIds), edits: frozen(edits), applicability,
    });
  });
  for (const diagnostic of diagnostics) {
    if (diagnostic.correctionFixIds.some((fixId) => {
      const correction = corrections.find((candidate) => candidate.fixId === fixId);
      return !correction?.diagnosticInstanceIds.includes(diagnostic.instanceId);
    })) refuse();
  }
  for (const correction of corrections) {
    for (const id of correction.diagnosticInstanceIds) {
      const diagnostic = byId.get(id);
      if (!diagnostic?.correctionFixIds.includes(correction.fixId)) refuse();
      if (
        correction.fixId === "FADENO_FIX_CONFIG_ROOT" && diagnostic.code !== "FADENO_CONFIG_ROOT_MISSING" ||
        correction.fixId === "FADENO_FIX_REVIEW_ROUTE_ROLE_COLLISION" &&
          diagnostic.code !== "FADENO_ROUTE_ROUTE_ROLE_COLLISION" && diagnostic.code !== "FADENO_ROUTE_ROUTE_ROLE_OWNER"
      ) refuse();
    }
  }
  const skippedWork = array(source["skippedWork"], 256).map((entry) => {
    const item = record(entry, ["id", "causedBy"]);
    const id = text(item["id"]);
    if (!workPattern.test(id)) refuse();
    const causedBy = array(item["causedBy"], 32).map(text);
    assertSortedUnique(causedBy);
    if (causedBy.length === 0 || causedBy.some((cause) => !instanceIds.has(cause))) refuse();
    return frozen({ id, causedBy: frozen(causedBy) });
  });
  assertSortedUnique(skippedWork.map(({ id }) => id));
  const redaction = record(source["redaction"], ["state"]);
  const expectedBatchRedaction: "none" | "redacted" = diagnostics.some(({ redaction }) => redaction.state === "redacted") ? "redacted" : "none";
  if (redaction["state"] !== expectedBatchRedaction) refuse();
  const batch = frozen({
    namespace: ANALYZER_DIAGNOSTIC_NAMESPACE, version: ANALYZER_DIAGNOSTIC_VERSION, identity: batchIdentity,
    diagnostics: frozen(diagnostics), corrections: frozen(corrections), skippedWork: frozen(skippedWork),
    completeness: "complete" as const, redaction: frozen({ state: expectedBatchRedaction }), truncated: false as const,
  });
  if (encoder.encode(JSON.stringify(batch)).byteLength > maximumBatchBytes) refuse();
  return batch;
}

export function createAnalyzerDiagnosticBatch(input: AnalyzerDiagnosticBatchInput): AnalyzerDiagnosticBatch {
  const graph = input.graph;
  const documents = [...input.documents].sort((left, right) => compareText(left.path, right.path));
  const inputVersions = documents.filter(({ open }) => open !== null).map(({ uri, open }) => ({
    uri, version: open!.version, lifetime: open!.lifetime,
  })).sort((left, right) => compareText(left.uri, right.uri));
  if (JSON.stringify(inputVersions) !== JSON.stringify(graph.documentVersions)) refuse();
  const batchIdentity = frozen({
    sessionId: graph.sessionId, operationId: graph.operationId, workspaceEpoch: graph.workspaceEpoch,
    configurationEpoch: graph.configurationEpoch, documentVersions: graph.documentVersions,
    ownership: graph.ownership, documents: frozen(documents.map(({ uri, path, effective }) => frozen({ uri, path, length: effective.text.length }))),
  });
  const orderedDiagnostics = [...input.diagnostics].sort((left, right) => compareText(left.key, right.key));
  if (orderedDiagnostics.some(({ key }, index) => !keyPattern.test(key) || (index > 0 && key === orderedDiagnostics[index - 1]!.key))) refuse();
  const instanceByKey = new Map(orderedDiagnostics.map(({ key }, index) => [key, `${graph.operationId}:diagnostic-${index + 1}`]));
  const diagnostics = orderedDiagnostics.map((diagnostic) => {
    const definition = definitions[diagnostic.code];
    if (!definition) refuse();
    return {
      instanceId: instanceByKey.get(diagnostic.key), code: diagnostic.code, severity: "error", module: { namespace: definition.module, version: 1 },
      phase: definition.phase, parameters: diagnostic.parameters, primaryLocation: diagnostic.primaryLocation,
      relatedLocations: [...(diagnostic.relatedLocations ?? [])].sort((left, right) => compareText(
        `${left.path}:${left.range?.start ?? -1}:${left.range?.end ?? -1}`,
        `${right.path}:${right.range?.start ?? -1}:${right.range?.end ?? -1}`,
      )),
      causedBy: (diagnostic.causedByKeys ?? []).map((key) => instanceByKey.get(key) ?? key).sort(compareText),
      correctionFixIds: [...(diagnostic.correctionFixIds ?? [])].sort(compareText), internalFailure: diagnostic.internalFailure ?? null,
      redaction: { state: definition.internal ? "redacted" : "none", fields: definition.internal ? ["details"] : [] },
      explanationRef: definition.explanation,
    };
  });
  const corrections = [...input.corrections].sort((left, right) => compareText(left.fixId, right.fixId)).map((correction) => ({
    ...correction,
    diagnosticInstanceIds: correction.diagnosticKeys.map((key) => instanceByKey.get(key) ?? key).sort(compareText),
    applicability: batchIdentity,
  })).map(({ diagnosticKeys: _diagnosticKeys, ...correction }) => correction);
  const skippedWork = [...input.skippedWork].sort((left, right) => compareText(left.id, right.id)).map(({ id, causedByKeys }) => ({
    id, causedBy: causedByKeys.map((key) => instanceByKey.get(key) ?? key).sort(compareText),
  }));
  const redacted = diagnostics.some(({ redaction }) => redaction.state === "redacted");
  return validateBatch({
    namespace: ANALYZER_DIAGNOSTIC_NAMESPACE, version: ANALYZER_DIAGNOSTIC_VERSION, identity: batchIdentity,
    diagnostics, corrections, skippedWork, completeness: "complete", redaction: { state: redacted ? "redacted" : "none" }, truncated: false,
  });
}

export function formatAnalyzerDiagnosticBatchHuman(batch: AnalyzerDiagnosticBatch): string {
  const validated = validateBatch(batch);
  const corrections = new Map(validated.corrections.map((correction) => [correction.fixId, correction]));
  const lines: string[] = [];
  for (const diagnostic of validated.diagnostics) {
    lines.push(`${diagnostic.code}: ${definitions[diagnostic.code].summary(diagnostic.parameters)}`);
    const renderLocation = (prefix: string, value: AnalyzerDiagnosticLocation): void => {
      lines.push(value.range
        ? `  ${prefix} ${value.path}:${value.range.start}-${value.range.end}`
        : `  ${prefix} ${value.path} (range unavailable: ${value.rangeReason})`);
    };
    renderLocation("at", diagnostic.primaryLocation);
    for (const related of diagnostic.relatedLocations) renderLocation("related", related);
    if (diagnostic.causedBy.length > 0) lines.push(`  caused by: ${diagnostic.causedBy.join(", ")}`);
    for (const fixId of diagnostic.correctionFixIds) {
      const correction = corrections.get(fixId)!;
      lines.push(`  correction: ${fixId} (${correction.safety}${correction.preferred ? ", preferred" : ""})`);
    }
    if (diagnostic.internalFailure) lines.push(`  incident: ${diagnostic.internalFailure.incidentId}`);
    lines.push(`  explanation: ${diagnostic.explanationRef}`);
  }
  for (const skipped of validated.skippedWork) lines.push(`SKIPPED ${skipped.id}: ${skipped.causedBy.join(", ")}`);
  return `${lines.join("\n")}${lines.length === 0 ? "" : "\n"}`;
}

export function serializeAnalyzerDiagnosticBatch(batch: AnalyzerDiagnosticBatch): string {
  try {
    const serialized = JSON.stringify({ format: "fadeno-private-analyzer-diagnostics", serializationVersion: 1, batch: validateBatch(batch) });
    deserializeAnalyzerDiagnosticBatch(serialized);
    return serialized;
  } catch {
    throw new TypeError("FADENO_ANALYZER_DIAGNOSTIC_SERIALIZATION");
  }
}

export function deserializeAnalyzerDiagnosticBatch(serialized: string): AnalyzerDiagnosticBatch {
  try {
    if (typeof serialized !== "string" || encoder.encode(serialized).byteLength > maximumBatchBytes) refuse();
    const envelope = record(JSON.parse(serialized), ["format", "serializationVersion", "batch"]);
    if (envelope["format"] !== "fadeno-private-analyzer-diagnostics" || envelope["serializationVersion"] !== 1) refuse();
    return validateBatch(envelope["batch"]);
  } catch {
    throw new TypeError("FADENO_ANALYZER_DIAGNOSTIC_SERIALIZATION");
  }
}

export function prepareAnalyzerCorrectionApplication(
  batch: AnalyzerDiagnosticBatch,
  fixId: string,
  current: Readonly<{
    snapshot: AnalyzerDocumentOnlySnapshot;
    configurationEpoch: number;
    configurationFingerprint: string;
    publicationOperationId: string | null;
  }>,
): AnalyzerCorrectionApplicationResult {
  const validated = validateBatch(batch);
  const correction = validated.corrections.find((candidate) => candidate.fixId === fixId);
  if (!correction) return frozen({ accepted: false as const, fixId, code: "FADENO_ANALYZER_CORRECTION_ID" as const });
  const expectedIdentity = correction.applicability;
  if (current.publicationOperationId !== expectedIdentity.operationId) {
    return frozen({ accepted: false as const, fixId, code: "FADENO_ANALYZER_CORRECTION_STALE" as const });
  }
  const currentDocuments = [...current.snapshot.documents].sort((left, right) => compareText(left.path, right.path));
  const currentIdentity = {
    sessionId: current.snapshot.sessionId,
    operationId: current.publicationOperationId,
    workspaceEpoch: current.snapshot.workspaceEpoch,
    configurationEpoch: current.configurationEpoch,
    documentVersions: current.snapshot.documentVersions,
    ownership: {
      mode: "single-root", root: current.snapshot.ownership.root,
      configurationFingerprint: current.configurationFingerprint,
    },
    documents: currentDocuments.map(({ uri, path, effective }) => ({ uri, path, length: effective.text.length })),
  };
  if (!sameIdentity(expectedIdentity, identity(currentIdentity))) {
    return frozen({ accepted: false as const, fixId, code: "FADENO_ANALYZER_CORRECTION_STALE" as const });
  }
  if (correction.safety !== "automatic") {
    return frozen({ accepted: false as const, fixId, code: "FADENO_ANALYZER_CORRECTION_REVIEW" as const });
  }
  if (correction.edits.length === 0 || correction.edits.some(({ uri }) => uri !== correction.edits[0]!.uri)) {
    return frozen({ accepted: false as const, fixId, code: "FADENO_ANALYZER_CORRECTION_STALE" as const });
  }
  const target = current.snapshot.documents.find(({ uri }) => uri === correction.edits[0]!.uri);
  if (!target?.open) return frozen({ accepted: false as const, fixId, code: "FADENO_ANALYZER_CORRECTION_STALE" as const });
  const first = correction.edits[0]!;
  if (target.open.version !== first.version || target.open.lifetime !== first.lifetime || target.path !== first.path) {
    return frozen({ accepted: false as const, fixId, code: "FADENO_ANALYZER_CORRECTION_STALE" as const });
  }
  let after = target.effective.text;
  const edits = correction.edits.map(({ range, text }) => frozen({ start: range.start, end: range.end, text }));
  for (const [index, edit] of edits.entries()) {
    if (edit.start > edit.end || edit.end > after.length) {
      return frozen({ accepted: false as const, fixId, code: "FADENO_ANALYZER_CORRECTION_STALE" as const });
    }
    if (after.slice(edit.start, edit.end) !== correction.edits[index]!.expectedText) {
      return frozen({ accepted: false as const, fixId, code: "FADENO_ANALYZER_CORRECTION_STALE" as const });
    }
    after = `${after.slice(0, edit.start)}${edit.text}${after.slice(edit.end)}`;
  }
  return frozen({
    accepted: true as const, fixId: correction.fixId, uri: target.uri, path: target.path,
    lifetime: target.open.lifetime, version: target.open.version + 1, edits: frozen(edits), before: target.effective.text, after,
  });
}
