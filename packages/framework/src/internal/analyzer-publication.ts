import {
  ANALYZER_FACET_LIMITS,
  createAnalyzerFacetSnapshot,
  normalizeAnalyzerFacetValue,
  type AnalyzerFacetContribution,
  type AnalyzerFacetRequest,
} from "./analyzer-facets.ts";
import type {
  AnalyzerDocumentOnlySnapshot,
} from "./analyzer-session.ts";
import type {
  AnalyzerConstructionProvenance,
  AnalyzerGraphNodeDefinition,
  AnalyzerGraphOperationResult,
  AnalyzerGraphSnapshot,
} from "./analyzer-graph.ts";
import {
  ANALYZER_GRAPH_LIMITS,
  deserializeAnalyzerGraphSnapshot,
  serializeAnalyzerGraphSnapshot,
} from "./analyzer-graph.ts";
import { TextEncoder } from "node:util";

export interface AnalyzerPublicationAuthority {
  readonly snapshot: AnalyzerDocumentOnlySnapshot;
  readonly configurationEpoch: number;
  readonly configurationFingerprint: string;
}

export interface AnalyzerPublicationContext {
  readonly graph: AnalyzerGraphSnapshot;
  readonly signal: AbortSignal;
}

export interface AnalyzerPublicationRequest {
  readonly definitions: readonly AnalyzerGraphNodeDefinition[];
  readonly requestedFacets: readonly AnalyzerFacetRequest[];
  readonly materialize: (
    context: AnalyzerPublicationContext,
  ) => readonly AnalyzerFacetContribution[] | Promise<readonly AnalyzerFacetContribution[]>;
}

export interface AnalyzerPublishedArtifact {
  readonly id: string;
  readonly path: string;
  readonly ownerNodeId: string;
  readonly value: AnalyzerFacetContribution["value"];
  readonly provenance: AnalyzerConstructionProvenance;
}

export interface AnalyzerPublicationSnapshot {
  readonly analyzerVersion: 1;
  readonly schemaVersion: 4;
  readonly sessionId: string;
  readonly operationId: string;
  readonly operation: "publish";
  readonly workspaceEpoch: number;
  readonly configurationEpoch: number;
  readonly publicationGeneration: number;
  readonly requestedFacets: readonly AnalyzerFacetRequest[];
  readonly documentVersions: AnalyzerDocumentOnlySnapshot["documentVersions"];
  readonly ownership: Readonly<{
    mode: "single-root";
    root: string;
    configurationFingerprint: string;
  }>;
  readonly graph: AnalyzerGraphSnapshot;
  readonly facets: readonly AnalyzerFacetContribution[];
  readonly artifacts: readonly AnalyzerPublishedArtifact[];
  readonly removedArtifacts: AnalyzerGraphSnapshot["removedArtifacts"];
  readonly completeness: "complete";
  readonly interruption: null;
  readonly truncated: false;
}

export type AnalyzerPublicationResult =
  | Readonly<{ status: "published"; operationId: string; snapshot: AnalyzerPublicationSnapshot }>
  | Readonly<{
    status: "cancelled" | "superseded" | "stale" | "refused";
    operationId: string;
    code: string;
    currentPublicationGeneration: number;
  }>;

export interface AnalyzerPublicationHandle {
  readonly operationId: string;
  readonly signal: AbortSignal;
  readonly result: Promise<AnalyzerPublicationResult>;
  cancel(): void;
}

interface Ticket {
  readonly operationId: string;
  readonly authority: AnalyzerPublicationAuthority;
  readonly controller: AbortController;
  state: "active" | "cancelled" | "superseded" | "stale";
}

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function authorityIdentity(authority: AnalyzerPublicationAuthority): string {
  return JSON.stringify({
    sessionId: authority.snapshot.sessionId,
    workspaceEpoch: authority.snapshot.workspaceEpoch,
    documentVersions: authority.snapshot.documentVersions,
    root: authority.snapshot.ownership.root,
    configurationEpoch: authority.configurationEpoch,
    configurationFingerprint: authority.configurationFingerprint,
  });
}

export class AnalyzerPublicationCoordinator {
  readonly #authority: () => AnalyzerPublicationAuthority;
  readonly #preview: (operationId: string, definitions: readonly AnalyzerGraphNodeDefinition[]) => AnalyzerGraphOperationResult;
  readonly #commit: (
    operationId: string,
    definitions: readonly AnalyzerGraphNodeDefinition[],
    expected: AnalyzerGraphSnapshot,
  ) => AnalyzerGraphOperationResult;
  #active: Ticket | null = null;
  #published: AnalyzerPublicationSnapshot | null = null;
  #publicationGeneration = 0;

  constructor(
    authority: () => AnalyzerPublicationAuthority,
    preview: (operationId: string, definitions: readonly AnalyzerGraphNodeDefinition[]) => AnalyzerGraphOperationResult,
    commit: (
      operationId: string,
      definitions: readonly AnalyzerGraphNodeDefinition[],
      expected: AnalyzerGraphSnapshot,
    ) => AnalyzerGraphOperationResult,
  ) {
    this.#authority = authority;
    this.#preview = preview;
    this.#commit = commit;
  }

  get currentSnapshot(): AnalyzerPublicationSnapshot | null {
    return this.#published;
  }

  invalidate(): void {
    if (this.#active?.state !== "active") return;
    this.#active.state = "stale";
    this.#active.controller.abort(new DOMException("Stale", "AbortError"));
  }

  start(operationId: string, request: AnalyzerPublicationRequest): AnalyzerPublicationHandle {
    if (this.#active?.state === "active") {
      this.#active.state = "superseded";
      this.#active.controller.abort(new DOMException("Superseded", "AbortError"));
    }
    const ticket: Ticket = {
      operationId,
      authority: this.#authority(),
      controller: new AbortController(),
      state: "active",
    };
    this.#active = ticket;
    const capturedRequest = frozen({
      definitions: frozen([...request.definitions]),
      requestedFacets: frozen(request.requestedFacets.map(({ namespace }) => frozen({ namespace }))),
      materialize: request.materialize,
    });
    const result = Promise.resolve().then(() => this.#execute(ticket, capturedRequest));
    return frozen({
      operationId,
      signal: ticket.controller.signal,
      result,
      cancel: () => {
        if (ticket.state !== "active") return;
        ticket.state = "cancelled";
        ticket.controller.abort(new DOMException("Cancelled", "AbortError"));
      },
    });
  }

  async #execute(
    ticket: Ticket,
    request: AnalyzerPublicationRequest,
  ): Promise<AnalyzerPublicationResult> {
    const terminal = (): AnalyzerPublicationResult | null => {
      if (ticket.state === "cancelled") return this.#discard(ticket, "cancelled", "FADENO_ANALYZER_CANCELLED");
      if (ticket.state === "stale") return this.#discard(ticket, "stale", "FADENO_ANALYZER_STALE");
      if (ticket.state === "superseded" || this.#active !== ticket) {
        return this.#discard(ticket, "superseded", "FADENO_ANALYZER_SUPERSEDED");
      }
      if (authorityIdentity(this.#authority()) !== authorityIdentity(ticket.authority)) {
        return this.#discard(ticket, "stale", "FADENO_ANALYZER_STALE");
      }
      return null;
    };
    let stopped = terminal();
    if (stopped) return stopped;
    const graphResult = this.#preview(ticket.operationId, request.definitions);
    if ("code" in graphResult) return this.#discard(ticket, "refused", graphResult.code);
    stopped = terminal();
    if (stopped) return stopped;
    if (request.requestedFacets.some(({ namespace }) => namespace === "fadeno.graph")) {
      return this.#discard(ticket, "refused", "FADENO_ANALYZER_PUBLICATION_FACET");
    }
    let contributions: readonly AnalyzerFacetContribution[];
    try {
      const materialized = Promise.resolve(request.materialize(frozen({
        graph: graphResult.snapshot,
        signal: ticket.controller.signal,
      }))).then(
        (value) => ({ kind: "materialized" as const, value }),
        () => ({ kind: "failed" as const }),
      );
      const aborted = new Promise<Readonly<{ kind: "aborted" }>>((resolve) => {
        if (ticket.controller.signal.aborted) resolve({ kind: "aborted" });
        else ticket.controller.signal.addEventListener("abort", () => resolve({ kind: "aborted" }), { once: true });
      });
      const outcome = await Promise.race([materialized, aborted]);
      if (outcome.kind === "aborted") {
        stopped = terminal();
        if (stopped) return stopped;
        return this.#discard(ticket, "cancelled", "FADENO_ANALYZER_CANCELLED");
      }
      if (outcome.kind === "failed") throw new Error("FADENO_ANALYZER_MATERIALIZE");
      contributions = outcome.value;
    } catch {
      stopped = terminal();
      if (stopped) return stopped;
      return this.#discard(ticket, "refused", "FADENO_ANALYZER_MATERIALIZE");
    }
    stopped = terminal();
    if (stopped) return stopped;
    const facetResult = createAnalyzerFacetSnapshot(
      ticket.authority.snapshot,
      ticket.operationId,
      request.requestedFacets,
      contributions,
    );
    if ("code" in facetResult) return this.#discard(ticket, "refused", facetResult.code);
    const requestedFacets = [frozen({ namespace: "fadeno.graph" }), ...facetResult.snapshot.requestedFacets]
      .sort((left, right) => compareText(left.namespace, right.namespace));
    const artifacts = graphResult.snapshot.results.flatMap((node) => node.artifacts.map((artifact) => frozen({
      id: artifact.id,
      path: artifact.path,
      ownerNodeId: node.id,
      value: artifact.value,
      provenance: artifact.provenance,
    }))).sort((left, right) => compareText(left.id, right.id));
    const nextArtifacts = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
    const removedArtifacts = (this.#published?.artifacts ?? []).filter((previous) => {
      const next = nextArtifacts.get(previous.id);
      return !next || next.path !== previous.path || next.ownerNodeId !== previous.ownerNodeId;
    }).map(({ id, path, ownerNodeId }) => frozen({ id, path, ownerNodeId }));
    const snapshot = frozen({
      analyzerVersion: 1 as const,
      schemaVersion: 4 as const,
      sessionId: ticket.authority.snapshot.sessionId,
      operationId: ticket.operationId,
      operation: "publish" as const,
      workspaceEpoch: ticket.authority.snapshot.workspaceEpoch,
      configurationEpoch: ticket.authority.configurationEpoch,
      publicationGeneration: this.#publicationGeneration + 1,
      requestedFacets: frozen(requestedFacets),
      documentVersions: ticket.authority.snapshot.documentVersions,
      ownership: frozen({
        mode: "single-root" as const,
        root: ticket.authority.snapshot.ownership.root,
        configurationFingerprint: ticket.authority.configurationFingerprint,
      }),
      graph: graphResult.snapshot,
      facets: facetResult.snapshot.facets,
      artifacts: frozen(artifacts),
      removedArtifacts: frozen(removedArtifacts),
      completeness: "complete" as const,
      interruption: null,
      truncated: false as const,
    });
    stopped = terminal();
    if (stopped) return stopped;
    const committedGraph = this.#commit(ticket.operationId, request.definitions, graphResult.snapshot);
    if ("code" in committedGraph) return this.#discard(ticket, "stale", "FADENO_ANALYZER_STALE");
    this.#publicationGeneration += 1;
    this.#published = snapshot;
    if (this.#active === ticket) this.#active = null;
    return frozen({ status: "published" as const, operationId: ticket.operationId, snapshot });
  }

  #discard(
    ticket: Ticket,
    status: "cancelled" | "superseded" | "stale" | "refused",
    code: string,
  ): AnalyzerPublicationResult {
    if (this.#active === ticket) this.#active = null;
    return frozen({
      status,
      operationId: ticket.operationId,
      code,
      currentPublicationGeneration: this.#publicationGeneration,
    });
  }
}

const maximumPublicationBytes = 9_000_000;
const namespacePattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/u;
const graphIdPattern = /^[a-z][a-z0-9]*(?::[a-z][a-z0-9-]*)+$/u;

function validArtifactPath(path: string): boolean {
  if (path.length === 0 || path.startsWith("/") || path.includes("\\") || path.includes("\0")) return false;
  return path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function serializationRefuse(): never {
  throw new TypeError("FADENO_ANALYZER_PUBLICATION_SERIALIZATION");
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) serializationRefuse();
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort(compareText);
  const expected = [...keys].sort(compareText);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) serializationRefuse();
  return record;
}

function deepFreeze(value: unknown): unknown {
  if (Array.isArray(value)) {
    for (const entry of value) deepFreeze(entry);
    return Object.freeze(value);
  }
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    return Object.freeze(value);
  }
  return value;
}

export function serializeAnalyzerPublicationSnapshot(snapshot: AnalyzerPublicationSnapshot): string {
  try {
    const serialized = JSON.stringify({
      format: "fadeno-private-analyzer-snapshot",
      serializationVersion: 1,
      snapshot,
    });
    if (new TextEncoder().encode(serialized).byteLength > maximumPublicationBytes) serializationRefuse();
    deserializeAnalyzerPublicationSnapshot(serialized);
    return serialized;
  } catch { serializationRefuse(); }
}

export function deserializeAnalyzerPublicationSnapshot(serialized: string): AnalyzerPublicationSnapshot {
  try {
    if (typeof serialized !== "string" || new TextEncoder().encode(serialized).byteLength > maximumPublicationBytes) serializationRefuse();
    const envelope = exactRecord(JSON.parse(serialized) as unknown, ["format", "serializationVersion", "snapshot"]);
    if (envelope["format"] !== "fadeno-private-analyzer-snapshot" || envelope["serializationVersion"] !== 1) serializationRefuse();
    const snapshot = exactRecord(envelope["snapshot"], [
      "analyzerVersion", "schemaVersion", "sessionId", "operationId", "operation", "workspaceEpoch",
      "configurationEpoch", "publicationGeneration", "requestedFacets", "documentVersions", "ownership",
      "graph", "facets", "artifacts", "removedArtifacts", "completeness", "interruption", "truncated",
    ]);
    if (
      snapshot["analyzerVersion"] !== 1 || snapshot["schemaVersion"] !== 4 || snapshot["operation"] !== "publish" ||
      !Number.isSafeInteger(snapshot["publicationGeneration"]) || (snapshot["publicationGeneration"] as number) < 1 ||
      snapshot["completeness"] !== "complete" || snapshot["interruption"] !== null || snapshot["truncated"] !== false
    ) serializationRefuse();
    const graphSerialized = serializeAnalyzerGraphSnapshot(snapshot["graph"] as AnalyzerGraphSnapshot);
    const graph = deserializeAnalyzerGraphSnapshot(graphSerialized);
    const identityPairs: readonly [unknown, unknown][] = [
      [snapshot["sessionId"], graph.sessionId],
      [snapshot["operationId"], graph.operationId],
      [snapshot["workspaceEpoch"], graph.workspaceEpoch],
      [snapshot["configurationEpoch"], graph.configurationEpoch],
      [JSON.stringify(snapshot["documentVersions"]), JSON.stringify(graph.documentVersions)],
    ];
    if (identityPairs.some(([left, right]) => left !== right)) serializationRefuse();
    const ownership = exactRecord(snapshot["ownership"], ["mode", "root", "configurationFingerprint"]);
    if (
      ownership["mode"] !== "single-root" || ownership["root"] !== graph.ownership.root ||
      ownership["configurationFingerprint"] !== graph.ownership.configurationFingerprint
    ) serializationRefuse();
    if (!Array.isArray(snapshot["requestedFacets"]) || !Array.isArray(snapshot["facets"]) || !Array.isArray(snapshot["artifacts"])) {
      serializationRefuse();
    }
    if (
      snapshot["requestedFacets"].length > ANALYZER_FACET_LIMITS.maximumFacets + 1 ||
      snapshot["facets"].length > ANALYZER_FACET_LIMITS.maximumFacets
    ) serializationRefuse();
    const requested = new Set<string>();
    let previousNamespace: string | undefined;
    for (const value of snapshot["requestedFacets"] as unknown[]) {
      const request = exactRecord(value, ["namespace"]);
      const namespace = request["namespace"];
      if (
        typeof namespace !== "string" || !namespacePattern.test(namespace) || requested.has(namespace) ||
        (previousNamespace !== undefined && compareText(previousNamespace, namespace) >= 0)
      ) serializationRefuse();
      requested.add(namespace);
      previousNamespace = namespace;
    }
    if (!requested.has("fadeno.graph")) serializationRefuse();
    let previousFacet: string | undefined;
    let aggregateFacetBytes = 0;
    for (const value of snapshot["facets"] as unknown[]) {
      const facet = exactRecord(value, ["namespace", "version", "value"]);
      const namespace = facet["namespace"];
      if (
        typeof namespace !== "string" || namespace === "fadeno.graph" || !requested.has(namespace) ||
        !Number.isSafeInteger(facet["version"]) || (facet["version"] as number) < 1 ||
        (previousFacet !== undefined && compareText(previousFacet, namespace) >= 0) ||
        JSON.stringify(normalizeAnalyzerFacetValue(facet["value"])) !== JSON.stringify(facet["value"])
      ) serializationRefuse();
      aggregateFacetBytes += new TextEncoder().encode(JSON.stringify(value)).byteLength;
      if (aggregateFacetBytes > ANALYZER_FACET_LIMITS.maximumTotalBytes) serializationRefuse();
      previousFacet = namespace;
    }
    const expectedArtifacts = graph.results.flatMap((node) => node.artifacts.map((artifact) => ({
      id: artifact.id, path: artifact.path, ownerNodeId: node.id, value: artifact.value, provenance: artifact.provenance,
    }))).sort((left, right) => compareText(left.id, right.id));
    if (JSON.stringify(snapshot["artifacts"]) !== JSON.stringify(expectedArtifacts)) serializationRefuse();
    if (!Array.isArray(snapshot["removedArtifacts"])) serializationRefuse();
    if (snapshot["removedArtifacts"].length > ANALYZER_GRAPH_LIMITS.maximumArtifacts) serializationRefuse();
    let previousRemoved: string | undefined;
    const removedIds = new Set<string>();
    for (const value of snapshot["removedArtifacts"] as unknown[]) {
      const removed = exactRecord(value, ["id", "path", "ownerNodeId"]);
      if (
        typeof removed["id"] !== "string" || !graphIdPattern.test(removed["id"]) || removedIds.has(removed["id"]) ||
        typeof removed["path"] !== "string" || !validArtifactPath(removed["path"]) ||
        typeof removed["ownerNodeId"] !== "string" || !graphIdPattern.test(removed["ownerNodeId"])
      ) {
        serializationRefuse();
      }
      removedIds.add(removed["id"]);
      const key = `${removed["id"]}:${removed["path"]}`;
      if (previousRemoved !== undefined && compareText(previousRemoved, key) >= 0) serializationRefuse();
      previousRemoved = key;
    }
    return deepFreeze(envelope["snapshot"]) as AnalyzerPublicationSnapshot;
  } catch { serializationRefuse(); }
}
