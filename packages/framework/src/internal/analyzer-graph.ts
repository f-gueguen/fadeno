import {
  normalizeAnalyzerFacetValue,
  type AnalyzerFacetValue,
} from "./analyzer-facets.ts";
import type {
  AnalyzerDocumentOnlySnapshot,
  AnalyzerDocumentSnapshot,
} from "./analyzer-session.ts";
import { isAbsolute, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TextEncoder } from "node:util";

export type AnalyzerGraphRefusalCode =
  | "FADENO_ANALYZER_GRAPH_DEFINITION"
  | "FADENO_ANALYZER_GRAPH_DUPLICATE"
  | "FADENO_ANALYZER_GRAPH_OWNER"
  | "FADENO_ANALYZER_GRAPH_DEPENDENCY"
  | "FADENO_ANALYZER_GRAPH_CYCLE"
  | "FADENO_ANALYZER_GRAPH_ARTIFACT"
  | "FADENO_ANALYZER_GRAPH_VALUE"
  | "FADENO_ANALYZER_GRAPH_LIMIT"
  | "FADENO_ANALYZER_GRAPH_COMPUTE";

export const ANALYZER_GRAPH_LIMITS = Object.freeze({
  maximumNodes: 4_096,
  maximumDependenciesPerNode: 256,
  maximumArtifacts: 4_096,
  maximumSnapshotBytes: 8_388_608,
});

export interface AnalyzerGraphModuleIdentity {
  readonly namespace: string;
  readonly version: number;
  readonly transformation: string;
}

export interface AnalyzerGraphArtifactInput {
  readonly id: string;
  readonly path: string;
  readonly value: AnalyzerFacetValue;
}

export interface AnalyzerGraphComputeContext {
  readonly owner: Readonly<{ uri: string; path: string; text: string }>;
  readonly dependencies: readonly Readonly<{ id: string; value: AnalyzerFacetValue }>[];
  emitArtifact(input: AnalyzerGraphArtifactInput): void;
}

export interface AnalyzerGraphNodeDefinition {
  readonly id: string;
  readonly ownerUri: string;
  readonly definitionVersion: number;
  readonly dependencies: readonly string[];
  readonly module: AnalyzerGraphModuleIdentity;
  readonly compute: (context: AnalyzerGraphComputeContext) => AnalyzerFacetValue;
}

export interface AnalyzerSourceOrigin {
  readonly uri: string;
  readonly range: Readonly<{ start: number; end: number }>;
}

export interface AnalyzerConstructionProvenance {
  readonly primaryOrigin: AnalyzerSourceOrigin;
  readonly relatedOrigins: readonly AnalyzerSourceOrigin[];
  readonly module: AnalyzerGraphModuleIdentity;
  readonly generatedArtifactOwnership: Readonly<{
    artifactId: string;
    ownerNodeId: string;
    path: string;
  }> | null;
  readonly sourceToArtifacts: readonly Readonly<{ sourceUri: string; artifactId: string }>[];
  readonly artifactToSources: readonly Readonly<{ artifactId: string; sourceUri: string }>[];
}

export interface AnalyzerGraphArtifact {
  readonly id: string;
  readonly path: string;
  readonly value: AnalyzerFacetValue;
  readonly provenance: AnalyzerConstructionProvenance;
}

export interface AnalyzerGraphNodeResult {
  readonly id: string;
  readonly generation: number;
  readonly value: AnalyzerFacetValue;
  readonly provenance: AnalyzerConstructionProvenance;
  readonly artifacts: readonly AnalyzerGraphArtifact[];
}

export type AnalyzerInvalidationReason =
  | Readonly<{ kind: "initial"; nodeId: string }>
  | Readonly<{ kind: "document"; ownerUri: string }>
  | Readonly<{ kind: "definition"; nodeId: string }>
  | Readonly<{ kind: "configuration"; configurationEpoch: number }>
  | Readonly<{ kind: "dependency"; dependencyId: string }>;

export interface AnalyzerGraphSnapshot {
  readonly analyzerVersion: 1;
  readonly schemaVersion: 3;
  readonly sessionId: string;
  readonly operationId: string;
  readonly operation: "recompute";
  readonly workspaceEpoch: number;
  readonly configurationEpoch: number;
  readonly generation: number;
  readonly requestedFacets: readonly Readonly<{ namespace: "fadeno.graph" }>[];
  readonly documentVersions: AnalyzerDocumentOnlySnapshot["documentVersions"];
  readonly ownership: Readonly<{
    mode: "single-root";
    root: string;
    configurationFingerprint: string;
  }>;
  readonly affected: readonly string[];
  readonly workOrder: readonly string[];
  readonly invalidations: readonly Readonly<{
    nodeId: string;
    reasons: readonly AnalyzerInvalidationReason[];
  }>[];
  readonly results: readonly AnalyzerGraphNodeResult[];
  readonly removedNodes: readonly Readonly<{
    nodeId: string;
    ownerUri: string;
    reason: "definition-removed" | "owner-disappeared";
  }>[];
  readonly removedArtifacts: readonly Readonly<{ id: string; path: string; ownerNodeId: string }>[];
  readonly completeness: "complete";
  readonly interruption: null;
  readonly truncated: false;
}

export type AnalyzerGraphOperationResult =
  | Readonly<{ accepted: true; operationId: string; snapshot: AnalyzerGraphSnapshot }>
  | Readonly<{
    accepted: false;
    operationId: string;
    code: AnalyzerGraphRefusalCode;
    currentEpoch: number;
    currentGeneration: number;
  }>;

interface GraphAuthority {
  readonly snapshot: AnalyzerDocumentOnlySnapshot;
  readonly configurationEpoch: number;
  readonly configurationFingerprint: string;
}

interface NormalizedDefinition extends AnalyzerGraphNodeDefinition {
  readonly dependencies: readonly string[];
  readonly module: Readonly<AnalyzerGraphModuleIdentity>;
}

class GraphRefusal extends Error {
  readonly code: AnalyzerGraphRefusalCode;

  constructor(code: AnalyzerGraphRefusalCode) {
    super(code);
    this.code = code;
  }
}

function refuse(code: AnalyzerGraphRefusalCode): never {
  throw new GraphRefusal(code);
}

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertPositiveInteger(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) refuse("FADENO_ANALYZER_GRAPH_DEFINITION");
}

const nodeIdPattern = /^[a-z][a-z0-9]*(?::[a-z][a-z0-9-]*)+$/u;
const modulePattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/u;
const transformationPattern = /^[a-z][a-z0-9-]*$/u;
const artifactPathPattern = /^(?!\/)(?!.*(?:^|\/)\.\.?\/)(?!.*\\)[^\0]+$/u;

function validArtifactPath(path: string): boolean {
  if (!artifactPathPattern.test(path)) return false;
  const segments = path.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function normalizeDefinitions(
  definitions: readonly AnalyzerGraphNodeDefinition[],
  documents: ReadonlyMap<string, AnalyzerDocumentSnapshot>,
): ReadonlyMap<string, NormalizedDefinition> {
  if (!Array.isArray(definitions)) refuse("FADENO_ANALYZER_GRAPH_DEFINITION");
  if (definitions.length > ANALYZER_GRAPH_LIMITS.maximumNodes) refuse("FADENO_ANALYZER_GRAPH_LIMIT");
  const normalized = new Map<string, NormalizedDefinition>();
  for (const definition of definitions) {
    if (typeof definition !== "object" || definition === null || typeof definition.compute !== "function") {
      refuse("FADENO_ANALYZER_GRAPH_LIMIT");
    }
    if (!nodeIdPattern.test(definition.id) || typeof definition.ownerUri !== "string") refuse("FADENO_ANALYZER_GRAPH_DEFINITION");
    if (normalized.has(definition.id)) refuse("FADENO_ANALYZER_GRAPH_DUPLICATE");
    if (!documents.has(definition.ownerUri)) refuse("FADENO_ANALYZER_GRAPH_OWNER");
    assertPositiveInteger(definition.definitionVersion);
    if (!Array.isArray(definition.dependencies)) refuse("FADENO_ANALYZER_GRAPH_DEFINITION");
    if (definition.dependencies.length > ANALYZER_GRAPH_LIMITS.maximumDependenciesPerNode) {
      refuse("FADENO_ANALYZER_GRAPH_LIMIT");
    }
    const dependencies = [...definition.dependencies];
    if (dependencies.some((dependency) => !nodeIdPattern.test(dependency))) refuse("FADENO_ANALYZER_GRAPH_DEPENDENCY");
    dependencies.sort(compareText);
    if (new Set(dependencies).size !== dependencies.length || dependencies.includes(definition.id)) {
      refuse(dependencies.includes(definition.id) ? "FADENO_ANALYZER_GRAPH_CYCLE" : "FADENO_ANALYZER_GRAPH_DUPLICATE");
    }
    const module = definition.module;
    if (
      typeof module !== "object" || module === null || !modulePattern.test(module.namespace) ||
      !transformationPattern.test(module.transformation)
    ) refuse("FADENO_ANALYZER_GRAPH_DEFINITION");
    assertPositiveInteger(module.version);
    normalized.set(definition.id, frozen({
      id: definition.id,
      ownerUri: definition.ownerUri,
      definitionVersion: definition.definitionVersion,
      dependencies: frozen(dependencies),
      module: frozen({ namespace: module.namespace, version: module.version, transformation: module.transformation }),
      compute: definition.compute,
    }));
  }
  for (const definition of normalized.values()) {
    if (definition.dependencies.some((dependency) => !normalized.has(dependency))) refuse("FADENO_ANALYZER_GRAPH_DEPENDENCY");
  }
  return normalized;
}

function topologicalOrder(definitions: ReadonlyMap<string, NormalizedDefinition>): readonly string[] {
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const definition of definitions.values()) {
    indegree.set(definition.id, definition.dependencies.length);
    for (const dependency of definition.dependencies) {
      const list = dependents.get(dependency) ?? [];
      list.push(definition.id);
      dependents.set(dependency, list);
    }
  }
  for (const list of dependents.values()) list.sort(compareText);
  const ready = [...indegree].filter(([, count]) => count === 0).map(([id]) => id).sort(compareText);
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const dependent of dependents.get(id) ?? []) {
      const next = indegree.get(dependent)! - 1;
      indegree.set(dependent, next);
      if (next === 0) {
        ready.push(dependent);
        ready.sort(compareText);
      }
    }
  }
  if (order.length !== definitions.size) refuse("FADENO_ANALYZER_GRAPH_CYCLE");
  return frozen(order);
}

function definitionChanged(previous: NormalizedDefinition | undefined, next: NormalizedDefinition): boolean {
  return !previous || previous.ownerUri !== next.ownerUri || previous.definitionVersion !== next.definitionVersion ||
    JSON.stringify(previous.dependencies) !== JSON.stringify(next.dependencies) ||
    JSON.stringify(previous.module) !== JSON.stringify(next.module);
}

function documentFingerprint(document: AnalyzerDocumentSnapshot): string {
  return JSON.stringify(document);
}

function reasonKey(reason: AnalyzerInvalidationReason): string {
  if (reason.kind === "document") return `${reason.kind}:${reason.ownerUri}`;
  if (reason.kind === "configuration") return `${reason.kind}:${reason.configurationEpoch}`;
  if (reason.kind === "dependency") return `${reason.kind}:${reason.dependencyId}`;
  return `${reason.kind}:${reason.nodeId}`;
}

function normalizeGraphValue(value: unknown): AnalyzerFacetValue {
  try {
    return normalizeAnalyzerFacetValue(value);
  } catch {
    refuse("FADENO_ANALYZER_GRAPH_VALUE");
  }
}

function originFor(document: AnalyzerDocumentSnapshot): AnalyzerSourceOrigin {
  return frozen({ uri: document.uri, range: frozen({ start: 0, end: document.effective.text.length }) });
}

function relatedOrigins(
  dependencies: readonly AnalyzerGraphNodeResult[],
  primaryOrigin: AnalyzerSourceOrigin,
): readonly AnalyzerSourceOrigin[] {
  const primaryKey = `${primaryOrigin.uri}:${primaryOrigin.range.start}:${primaryOrigin.range.end}`;
  const byUri = new Map<string, AnalyzerSourceOrigin>();
  for (const dependency of dependencies) {
    for (const origin of [dependency.provenance.primaryOrigin, ...dependency.provenance.relatedOrigins]) {
      const key = `${origin.uri}:${origin.range.start}:${origin.range.end}`;
      if (key !== primaryKey) byUri.set(key, origin);
    }
  }
  return frozen([...byUri.values()].sort((left, right) => compareText(left.uri, right.uri)));
}

export class AnalyzerDependencyGraph {
  readonly #authority: () => GraphAuthority;
  #definitions = new Map<string, NormalizedDefinition>();
  #results = new Map<string, AnalyzerGraphNodeResult>();
  #documentFingerprints = new Map<string, string>();
  #configurationEpoch = -1;
  #generation = 0;
  #snapshot: AnalyzerGraphSnapshot | null = null;

  constructor(authority: () => GraphAuthority) {
    this.#authority = authority;
  }

  get currentSnapshot(): AnalyzerGraphSnapshot | null {
    return this.#snapshot;
  }

  analyze(operationId: string, definitions: readonly AnalyzerGraphNodeDefinition[]): AnalyzerGraphOperationResult {
    const authority = this.#authority();
    try {
      const documents = new Map(authority.snapshot.documents.map((document) => [document.uri, document]));
      const nextDefinitions = normalizeDefinitions(definitions, documents);
      const fullOrder = topologicalOrder(nextDefinitions);
      const nextFingerprints = new Map([...documents].map(([uri, document]) => [uri, documentFingerprint(document)]));
      const reasons = new Map<string, Map<string, AnalyzerInvalidationReason>>();
      const addReason = (nodeId: string, reason: AnalyzerInvalidationReason): boolean => {
        const nodeReasons = reasons.get(nodeId) ?? new Map<string, AnalyzerInvalidationReason>();
        const key = reasonKey(reason);
        const added = !nodeReasons.has(key);
        nodeReasons.set(key, reason);
        reasons.set(nodeId, nodeReasons);
        return added;
      };

      for (const definition of nextDefinitions.values()) {
        if (this.#generation === 0) addReason(definition.id, frozen({ kind: "initial", nodeId: definition.id }));
        if (definitionChanged(this.#definitions.get(definition.id), definition)) {
          addReason(definition.id, frozen({ kind: "definition", nodeId: definition.id }));
        }
        if (this.#documentFingerprints.get(definition.ownerUri) !== nextFingerprints.get(definition.ownerUri)) {
          addReason(definition.id, frozen({ kind: "document", ownerUri: definition.ownerUri }));
        }
        if (authority.configurationEpoch !== this.#configurationEpoch) {
          addReason(definition.id, frozen({ kind: "configuration", configurationEpoch: authority.configurationEpoch }));
        }
      }

      const dependents = new Map<string, string[]>();
      for (const definition of nextDefinitions.values()) {
        for (const dependency of definition.dependencies) {
          const list = dependents.get(dependency) ?? [];
          list.push(definition.id);
          dependents.set(dependency, list);
        }
      }
      for (const list of dependents.values()) list.sort(compareText);
      const queue = [...reasons.keys()].sort(compareText);
      const visitedEdges = new Set<string>();
      while (queue.length > 0) {
        const dependencyId = queue.shift()!;
        for (const dependent of dependents.get(dependencyId) ?? []) {
          const edge = `${dependencyId}->${dependent}`;
          if (visitedEdges.has(edge)) continue;
          visitedEdges.add(edge);
          addReason(dependent, frozen({ kind: "dependency", dependencyId }));
          queue.push(dependent);
          queue.sort(compareText);
        }
      }

      const affected = fullOrder.filter((id) => reasons.has(id));
      const nextGeneration = this.#generation + 1;
      const candidateResults = new Map(this.#results);
      const removedNodes = [...this.#definitions.values()]
        .filter(({ id }) => !nextDefinitions.has(id))
        .map((definition) => frozen({
          nodeId: definition.id,
          ownerUri: definition.ownerUri,
          reason: (documents.has(definition.ownerUri) ? "definition-removed" : "owner-disappeared") as "definition-removed" | "owner-disappeared",
        }))
        .sort((left, right) => compareText(left.nodeId, right.nodeId));
      for (const { nodeId } of removedNodes) candidateResults.delete(nodeId);

      const occupiedArtifactIds = new Map<string, string>();
      const occupiedArtifactPaths = new Map<string, string>();
      let artifactCount = 0;
      for (const [nodeId, result] of candidateResults) {
        if (reasons.has(nodeId)) continue;
        for (const artifact of result.artifacts) {
          occupiedArtifactIds.set(artifact.id, nodeId);
          occupiedArtifactPaths.set(artifact.path, nodeId);
          artifactCount += 1;
        }
      }

      for (const nodeId of affected) {
        const definition = nextDefinitions.get(nodeId)!;
        const owner = documents.get(definition.ownerUri)!;
        const dependencyResults = definition.dependencies.map((dependency) => {
          const result = candidateResults.get(dependency);
          if (!result) refuse("FADENO_ANALYZER_GRAPH_DEPENDENCY");
          return result;
        });
        const primaryOrigin = originFor(owner);
        const related = relatedOrigins(dependencyResults, primaryOrigin);
        const artifacts: AnalyzerGraphArtifact[] = [];
        const emitArtifact = (input: AnalyzerGraphArtifactInput): void => {
          if (
            typeof input !== "object" || input === null || !nodeIdPattern.test(input.id) ||
            typeof input.path !== "string" || !validArtifactPath(input.path)
          ) refuse("FADENO_ANALYZER_GRAPH_ARTIFACT");
          artifactCount += 1;
          if (artifactCount > ANALYZER_GRAPH_LIMITS.maximumArtifacts) refuse("FADENO_ANALYZER_GRAPH_LIMIT");
          if (occupiedArtifactIds.has(input.id) || occupiedArtifactPaths.has(input.path)) refuse("FADENO_ANALYZER_GRAPH_ARTIFACT");
          occupiedArtifactIds.set(input.id, nodeId);
          occupiedArtifactPaths.set(input.path, nodeId);
          const sourceUris = [primaryOrigin, ...related].map((origin) => origin.uri);
          const provenance = frozen({
            primaryOrigin,
            relatedOrigins: related,
            module: definition.module,
            generatedArtifactOwnership: frozen({ artifactId: input.id, ownerNodeId: nodeId, path: input.path }),
            sourceToArtifacts: frozen(sourceUris.map((sourceUri) => frozen({ sourceUri, artifactId: input.id }))),
            artifactToSources: frozen(sourceUris.map((sourceUri) => frozen({ artifactId: input.id, sourceUri }))),
          });
          artifacts.push(frozen({ id: input.id, path: input.path, value: normalizeGraphValue(input.value), provenance }));
        };
        let computed: unknown;
        try {
          computed = definition.compute(frozen({
            owner: frozen({ uri: owner.uri, path: owner.path, text: owner.effective.text }),
            dependencies: frozen(dependencyResults.map((result) => frozen({ id: result.id, value: result.value }))),
            emitArtifact,
          }));
        } catch (error) {
          if (error instanceof GraphRefusal) throw error;
          refuse("FADENO_ANALYZER_GRAPH_COMPUTE");
        }
        artifacts.sort((left, right) => compareText(left.id, right.id));
        const sourceOrigins = [primaryOrigin, ...related];
        const provenance = frozen({
          primaryOrigin,
          relatedOrigins: related,
          module: definition.module,
          generatedArtifactOwnership: null,
          sourceToArtifacts: frozen(sourceOrigins.flatMap((origin) => artifacts.map((artifact) => frozen({
            sourceUri: origin.uri,
            artifactId: artifact.id,
          })))),
          artifactToSources: frozen(artifacts.flatMap((artifact) => sourceOrigins.map((origin) => frozen({
            artifactId: artifact.id,
            sourceUri: origin.uri,
          })))),
        });
        candidateResults.set(nodeId, frozen({
          id: nodeId,
          generation: nextGeneration,
          value: normalizeGraphValue(computed),
          provenance,
          artifacts: frozen(artifacts),
        }));
      }

      const previousArtifacts = new Map<string, Readonly<{ id: string; path: string; ownerNodeId: string }>>();
      for (const result of this.#results.values()) {
        for (const artifact of result.artifacts) previousArtifacts.set(artifact.id, frozen({ id: artifact.id, path: artifact.path, ownerNodeId: result.id }));
      }
      const nextArtifacts = new Map<string, Readonly<{ id: string; path: string; ownerNodeId: string }>>();
      for (const result of candidateResults.values()) {
        for (const artifact of result.artifacts) nextArtifacts.set(artifact.id, frozen({ id: artifact.id, path: artifact.path, ownerNodeId: result.id }));
      }
      const removedArtifacts = [...previousArtifacts.values()].filter((previous) => {
        const next = nextArtifacts.get(previous.id);
        return !next || next.path !== previous.path || next.ownerNodeId !== previous.ownerNodeId;
      }).sort((left, right) => compareText(`${left.id}:${left.path}`, `${right.id}:${right.path}`));
      const invalidations = affected.map((nodeId) => frozen({
        nodeId,
        reasons: frozen([...reasons.get(nodeId)!.values()].sort((left, right) => compareText(reasonKey(left), reasonKey(right)))),
      }));
      const snapshot = frozen({
        analyzerVersion: 1 as const,
        schemaVersion: 3 as const,
        sessionId: authority.snapshot.sessionId,
        operationId,
        operation: "recompute" as const,
        workspaceEpoch: authority.snapshot.workspaceEpoch,
        configurationEpoch: authority.configurationEpoch,
        generation: nextGeneration,
        requestedFacets: frozen([frozen({ namespace: "fadeno.graph" as const })]),
        documentVersions: frozen([...authority.snapshot.documentVersions].sort((left, right) => compareText(left.uri, right.uri))),
        ownership: frozen({
          mode: "single-root" as const,
          root: authority.snapshot.ownership.root,
          configurationFingerprint: authority.configurationFingerprint,
        }),
        affected: frozen([...affected]),
        workOrder: frozen([...affected]),
        invalidations: frozen(invalidations),
        results: frozen([...candidateResults.values()].sort((left, right) => compareText(left.id, right.id))),
        removedNodes: frozen(removedNodes),
        removedArtifacts: frozen(removedArtifacts),
        completeness: "complete" as const,
        interruption: null,
        truncated: false as const,
      });
      if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > ANALYZER_GRAPH_LIMITS.maximumSnapshotBytes) {
        refuse("FADENO_ANALYZER_GRAPH_LIMIT");
      }

      this.#definitions = new Map(nextDefinitions);
      this.#results = candidateResults;
      this.#documentFingerprints = nextFingerprints;
      this.#configurationEpoch = authority.configurationEpoch;
      this.#generation = nextGeneration;
      this.#snapshot = snapshot;
      return frozen({ accepted: true as const, operationId, snapshot });
    } catch (error) {
      if (!(error instanceof GraphRefusal)) throw error;
      return frozen({
        accepted: false as const,
        operationId,
        code: error.code,
        currentEpoch: authority.snapshot.workspaceEpoch,
        currentGeneration: this.#generation,
      });
    }
  }
}

function serializationRefuse(): never {
  throw new TypeError("FADENO_ANALYZER_GRAPH_SERIALIZATION");
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) serializationRefuse();
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort(compareText);
  const expected = [...keys].sort(compareText);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) serializationRefuse();
  return record;
}

function serializedInteger(value: unknown, positive = false): number {
  if (!Number.isSafeInteger(value) || (value as number) < (positive ? 1 : 0)) serializationRefuse();
  return value as number;
}

function serializedString(value: unknown): string {
  if (typeof value !== "string") serializationRefuse();
  return value;
}

function serializedArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) serializationRefuse();
  return value;
}

function validateOwnedUri(value: unknown, rootPath: string): string {
  const uri = serializedString(value);
  let candidate: string;
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:" || url.host !== "" || url.search !== "" || url.hash !== "") serializationRefuse();
    candidate = fileURLToPath(url);
  } catch { serializationRefuse(); }
  if (pathToFileURL(candidate).href !== uri) serializationRefuse();
  const containment = relative(rootPath, candidate);
  if (containment === "" || containment.startsWith("..") || isAbsolute(containment)) serializationRefuse();
  return uri;
}

function validateSerializedOrigin(value: unknown, rootPath: string): Readonly<{ uri: string; start: number; end: number }> {
  const origin = exactRecord(value, ["uri", "range"]);
  const uri = validateOwnedUri(origin["uri"], rootPath);
  const range = exactRecord(origin["range"], ["start", "end"]);
  const start = serializedInteger(range["start"]);
  const end = serializedInteger(range["end"]);
  if (end < start) serializationRefuse();
  return { uri, start, end };
}

function validateSerializedModule(value: unknown): void {
  const module = exactRecord(value, ["namespace", "version", "transformation"]);
  if (!modulePattern.test(serializedString(module["namespace"])) || !transformationPattern.test(serializedString(module["transformation"]))) {
    serializationRefuse();
  }
  serializedInteger(module["version"], true);
}

function validateSerializedRelations(value: unknown, keys: readonly [string, string]): readonly Readonly<Record<string, string>>[] {
  const result: Readonly<Record<string, string>>[] = [];
  for (const relation of serializedArray(value)) {
    const record = exactRecord(relation, keys);
    result.push({ [keys[0]]: serializedString(record[keys[0]]), [keys[1]]: serializedString(record[keys[1]]) });
  }
  return result;
}

function validateSerializedProvenance(
  value: unknown,
  rootPath: string,
  artifactIds: readonly string[],
  artifact?: Readonly<{ id: string; path: string; ownerNodeId: string }>,
): void {
  const provenance = exactRecord(value, [
    "primaryOrigin", "relatedOrigins", "module", "generatedArtifactOwnership", "sourceToArtifacts", "artifactToSources",
  ]);
  const primary = validateSerializedOrigin(provenance["primaryOrigin"], rootPath);
  const related = serializedArray(provenance["relatedOrigins"]).map((origin) => validateSerializedOrigin(origin, rootPath));
  const sourceUris = [primary.uri, ...related.map(({ uri }) => uri)];
  if (new Set(sourceUris).size !== sourceUris.length) serializationRefuse();
  const relatedKeys = related.map(({ uri, start, end }) => `${uri}:${start}:${end}`);
  if (relatedKeys.some((key, index) => index > 0 && compareText(relatedKeys[index - 1]!, key) >= 0)) serializationRefuse();
  validateSerializedModule(provenance["module"]);
  if (artifact) {
    const ownership = exactRecord(provenance["generatedArtifactOwnership"], ["artifactId", "ownerNodeId", "path"]);
    if (
      ownership["artifactId"] !== artifact.id || ownership["ownerNodeId"] !== artifact.ownerNodeId || ownership["path"] !== artifact.path
    ) serializationRefuse();
  } else if (provenance["generatedArtifactOwnership"] !== null) serializationRefuse();
  const sourceToArtifacts = validateSerializedRelations(provenance["sourceToArtifacts"], ["sourceUri", "artifactId"]);
  const artifactToSources = validateSerializedRelations(provenance["artifactToSources"], ["artifactId", "sourceUri"]);
  const expectedSourceToArtifacts = sourceUris.flatMap((sourceUri) => artifactIds.map((artifactId) => ({ sourceUri, artifactId })));
  const expectedArtifactToSources = artifactIds.flatMap((artifactId) => sourceUris.map((sourceUri) => ({ artifactId, sourceUri })));
  if (
    JSON.stringify(sourceToArtifacts) !== JSON.stringify(expectedSourceToArtifacts) ||
    JSON.stringify(artifactToSources) !== JSON.stringify(expectedArtifactToSources)
  ) serializationRefuse();
}

function validateSerializedGraphSnapshot(value: unknown): AnalyzerGraphSnapshot {
  const snapshot = exactRecord(value, [
    "analyzerVersion", "schemaVersion", "sessionId", "operationId", "operation", "workspaceEpoch",
    "configurationEpoch", "generation", "requestedFacets", "documentVersions", "ownership", "affected",
    "workOrder", "invalidations", "results", "removedNodes", "removedArtifacts", "completeness", "interruption", "truncated",
  ]);
  if (
    snapshot["analyzerVersion"] !== 1 || snapshot["schemaVersion"] !== 3 || snapshot["operation"] !== "recompute" ||
    snapshot["completeness"] !== "complete" || snapshot["interruption"] !== null || snapshot["truncated"] !== false
  ) serializationRefuse();
  const sessionId = serializedString(snapshot["sessionId"]);
  const operationId = serializedString(snapshot["operationId"]);
  const operationSuffix = operationId.slice(`${sessionId}:operation-`.length);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(sessionId) ||
    !operationId.startsWith(`${sessionId}:operation-`) ||
    !/^[1-9][0-9]*$/u.test(operationSuffix) || !Number.isSafeInteger(Number(operationSuffix))
  ) serializationRefuse();
  serializedInteger(snapshot["workspaceEpoch"]);
  serializedInteger(snapshot["configurationEpoch"]);
  const generation = serializedInteger(snapshot["generation"], true);
  const requests = serializedArray(snapshot["requestedFacets"]);
  if (requests.length !== 1 || exactRecord(requests[0], ["namespace"])["namespace"] !== "fadeno.graph") serializationRefuse();
  const ownership = exactRecord(snapshot["ownership"], ["mode", "root", "configurationFingerprint"]);
  if (ownership["mode"] !== "single-root" || !/^[0-9a-f]{64}$/u.test(serializedString(ownership["configurationFingerprint"]))) {
    serializationRefuse();
  }
  let rootPath: string;
  try {
    const root = new URL(serializedString(ownership["root"]));
    if (root.protocol !== "file:" || root.host !== "" || root.search !== "" || root.hash !== "") serializationRefuse();
    rootPath = fileURLToPath(root);
  } catch { serializationRefuse(); }
  if (!rootPath.endsWith(sep) || pathToFileURL(rootPath).href !== ownership["root"]) serializationRefuse();
  const seenVersions = new Set<string>();
  let previousVersionUri: string | undefined;
  for (const value of serializedArray(snapshot["documentVersions"])) {
    const version = exactRecord(value, ["uri", "version", "lifetime"]);
    const uri = validateOwnedUri(version["uri"], rootPath);
    serializedInteger(version["version"]);
    serializedInteger(version["lifetime"], true);
    if (seenVersions.has(uri) || (previousVersionUri !== undefined && compareText(previousVersionUri, uri) >= 0)) serializationRefuse();
    seenVersions.add(uri);
    previousVersionUri = uri;
  }
  const affected = serializedArray(snapshot["affected"]).map((value) => {
    const id = serializedString(value);
    if (!nodeIdPattern.test(id)) serializationRefuse();
    return id;
  });
  const workOrder = serializedArray(snapshot["workOrder"]).map((value) => {
    const id = serializedString(value);
    if (!nodeIdPattern.test(id)) serializationRefuse();
    return id;
  });
  if (JSON.stringify(affected) !== JSON.stringify(workOrder) || new Set(affected).size !== affected.length) serializationRefuse();
  const invalidations = serializedArray(snapshot["invalidations"]);
  if (invalidations.length !== affected.length) serializationRefuse();
  for (const [index, value] of invalidations.entries()) {
    const invalidation = exactRecord(value, ["nodeId", "reasons"]);
    if (invalidation["nodeId"] !== affected[index]) serializationRefuse();
    const reasons = serializedArray(invalidation["reasons"]);
    if (reasons.length === 0) serializationRefuse();
    let previousReason: string | undefined;
    for (const reasonValue of reasons) {
      const reason = reasonValue as Record<string, unknown>;
      if (reason["kind"] === "document") {
        exactRecord(reason, ["kind", "ownerUri"]);
        validateOwnedUri(reason["ownerUri"], rootPath);
      }
      else if (reason["kind"] === "configuration") {
        exactRecord(reason, ["kind", "configurationEpoch"]);
        if (serializedInteger(reason["configurationEpoch"]) !== snapshot["configurationEpoch"]) serializationRefuse();
      } else if (reason["kind"] === "dependency") {
        exactRecord(reason, ["kind", "dependencyId"]);
        if (!nodeIdPattern.test(serializedString(reason["dependencyId"]))) serializationRefuse();
      } else if (reason["kind"] === "definition" || reason["kind"] === "initial") {
        exactRecord(reason, ["kind", "nodeId"]);
        if (reason["nodeId"] !== invalidation["nodeId"]) serializationRefuse();
      }
      else serializationRefuse();
      const key = reason["kind"] === "document" ? `document:${String(reason["ownerUri"])}`
        : reason["kind"] === "configuration" ? `configuration:${String(reason["configurationEpoch"])}`
          : reason["kind"] === "dependency" ? `dependency:${String(reason["dependencyId"])}`
            : `${String(reason["kind"])}:${String(reason["nodeId"])}`;
      if (previousReason !== undefined && compareText(previousReason, key) >= 0) serializationRefuse();
      previousReason = key;
    }
  }
  const seenResults = new Set<string>();
  const seenArtifacts = new Set<string>();
  const seenArtifactPaths = new Set<string>();
  let previousResult: string | undefined;
  for (const value of serializedArray(snapshot["results"])) {
    const result = exactRecord(value, ["id", "generation", "value", "provenance", "artifacts"]);
    const id = serializedString(result["id"]);
    if (!nodeIdPattern.test(id) || seenResults.has(id) || (previousResult !== undefined && compareText(previousResult, id) >= 0)) serializationRefuse();
    seenResults.add(id);
    previousResult = id;
    if (serializedInteger(result["generation"], true) > generation) serializationRefuse();
    if (JSON.stringify(normalizeAnalyzerFacetValue(result["value"])) !== JSON.stringify(result["value"])) serializationRefuse();
    let previousArtifact: string | undefined;
    const resultArtifactIds: string[] = [];
    for (const artifactValue of serializedArray(result["artifacts"])) {
      const artifact = exactRecord(artifactValue, ["id", "path", "value", "provenance"]);
      const artifactId = serializedString(artifact["id"]);
      const path = serializedString(artifact["path"]);
      if (
        !nodeIdPattern.test(artifactId) || !validArtifactPath(path) || seenArtifacts.has(artifactId) || seenArtifactPaths.has(path) ||
        (previousArtifact !== undefined && compareText(previousArtifact, artifactId) >= 0)
      ) serializationRefuse();
      seenArtifacts.add(artifactId);
      seenArtifactPaths.add(path);
      resultArtifactIds.push(artifactId);
      previousArtifact = artifactId;
      if (JSON.stringify(normalizeAnalyzerFacetValue(artifact["value"])) !== JSON.stringify(artifact["value"])) serializationRefuse();
      validateSerializedProvenance(artifact["provenance"], rootPath, [artifactId], { id: artifactId, path, ownerNodeId: id });
    }
    validateSerializedProvenance(result["provenance"], rootPath, resultArtifactIds);
  }
  if (affected.some((id) => !seenResults.has(id))) serializationRefuse();
  for (const value of invalidations) {
    const invalidation = value as Record<string, unknown>;
    for (const reason of invalidation["reasons"] as Record<string, unknown>[]) {
      if (reason["kind"] === "dependency" && !seenResults.has(reason["dependencyId"] as string)) serializationRefuse();
    }
  }
  const removedNodeIds = new Set<string>();
  let previousRemovedNode: string | undefined;
  for (const value of serializedArray(snapshot["removedNodes"])) {
    const removed = exactRecord(value, ["nodeId", "ownerUri", "reason"]);
    const nodeId = serializedString(removed["nodeId"]);
    if (
      !nodeIdPattern.test(nodeId) || removedNodeIds.has(nodeId) || seenResults.has(nodeId) ||
      (previousRemovedNode !== undefined && compareText(previousRemovedNode, nodeId) >= 0) ||
      (removed["reason"] !== "definition-removed" && removed["reason"] !== "owner-disappeared")
    ) serializationRefuse();
    validateOwnedUri(removed["ownerUri"], rootPath);
    removedNodeIds.add(nodeId);
    previousRemovedNode = nodeId;
  }
  const removedArtifactIds = new Set<string>();
  let previousRemovedArtifact: string | undefined;
  for (const value of serializedArray(snapshot["removedArtifacts"])) {
    const removed = exactRecord(value, ["id", "path", "ownerNodeId"]);
    const id = serializedString(removed["id"]);
    const path = serializedString(removed["path"]);
    const key = `${id}:${path}`;
    if (
      !nodeIdPattern.test(id) || !validArtifactPath(path) || !nodeIdPattern.test(serializedString(removed["ownerNodeId"])) ||
      removedArtifactIds.has(id) || (previousRemovedArtifact !== undefined && compareText(previousRemovedArtifact, key) >= 0)
    ) serializationRefuse();
    removedArtifactIds.add(id);
    previousRemovedArtifact = key;
  }
  return deepFreezeGraph(value) as AnalyzerGraphSnapshot;
}

function deepFreezeGraph(value: unknown): unknown {
  if (Array.isArray(value)) {
    for (const entry of value) deepFreezeGraph(entry);
    return Object.freeze(value);
  }
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) deepFreezeGraph(entry);
    return Object.freeze(value);
  }
  return value;
}

export function serializeAnalyzerGraphSnapshot(snapshot: AnalyzerGraphSnapshot): string {
  try {
    const serialized = JSON.stringify({
      format: "fadeno-private-analyzer-snapshot",
      serializationVersion: 1,
      snapshot,
    });
    if (new TextEncoder().encode(serialized).byteLength > ANALYZER_GRAPH_LIMITS.maximumSnapshotBytes) serializationRefuse();
    deserializeAnalyzerGraphSnapshot(serialized);
    return serialized;
  } catch {
    serializationRefuse();
  }
}

export function deserializeAnalyzerGraphSnapshot(serialized: string): AnalyzerGraphSnapshot {
  try {
    if (typeof serialized !== "string" || new TextEncoder().encode(serialized).byteLength > ANALYZER_GRAPH_LIMITS.maximumSnapshotBytes) {
      serializationRefuse();
    }
    const envelope = exactRecord(JSON.parse(serialized) as unknown, ["format", "serializationVersion", "snapshot"]);
    if (envelope["format"] !== "fadeno-private-analyzer-snapshot" || envelope["serializationVersion"] !== 1) serializationRefuse();
    return validateSerializedGraphSnapshot(envelope["snapshot"]);
  } catch {
    serializationRefuse();
  }
}
