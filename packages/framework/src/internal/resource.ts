import type {
  ResourceDeclaration,
  ResourceError,
  ResourceInput,
  ResourceInputObject,
  ResourceLoader,
  ResourceStatus,
} from "../index.ts";

const maximumInputDepth = 32;
const maximumInputEntries = 4_096;
const maximumInputKeyBytes = 1_024;
const maximumInputBytes = 64 * 1_024;
const maximumRequestReads = 1_024;
const maximumRequestCalls = 4_096;
const byteEncoder = new TextEncoder();

export type ResourceObservation = Readonly<
  | { status: "pending" }
  | { status: "value"; comparisonKey: string | null }
  | { status: "expected-error"; code: string; httpStatus: ResourceStatus }
  | { status: "unexpected-error" }
  | { status: "cancelled" }
>;

export type ResourceDependency = Readonly<{
  resource: ResourceDeclaration<ResourceInput, unknown>;
  input: ResourceInput;
  inputKey: string;
  observation: ResourceObservation;
}>;

export type ResourceFlow = Readonly<{
  operation: "resource-read";
  outcome: "value" | "expected-error" | "unexpected-error" | "cancelled" | "refused";
  cache: "miss" | "request-hit" | "none";
  ownership: "request";
  dependencyRecorded: boolean;
  cause: string;
}>;

class ResourceExpectedError extends Error {
  readonly code: string;
  readonly status: ResourceStatus;

  constructor(code: string, status: ResourceStatus) {
    if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(code) || ![400, 401, 403, 404, 409, 422, 429, 503].includes(status)) {
      throw new TypeError("FADENO_RESOURCE_EXPECTED_ERROR");
    }
    super("FADENO_RESOURCE_EXPECTED");
    this.name = "ResourceError";
    this.code = code;
    this.status = status;
  }
}

const loaders = new WeakMap<object, ResourceLoader<ResourceInput, unknown>>();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function ordinaryObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function byteLength(value: string): number {
  return byteEncoder.encode(value).byteLength;
}

function normalizeInput(value: unknown): Readonly<{ input: ResourceInput; key: string }> {
  const active = new Set<object>();
  let entries = 0;
  let scalarBytes = 0;

  function addScalarBytes(bytes: number): void {
    if (bytes > maximumInputBytes - scalarBytes) throw new TypeError("FADENO_RESOURCE_INPUT_LIMIT");
    scalarBytes += bytes;
  }

  function visit(current: unknown, depth: number): Readonly<{ canonical: unknown; input: ResourceInput }> {
    entries += 1;
    if (entries > maximumInputEntries || depth > maximumInputDepth) throw new TypeError("FADENO_RESOURCE_INPUT_LIMIT");
    if (current === null) return { canonical: ["null"], input: null };
    if (typeof current === "boolean") return { canonical: ["boolean", current], input: current };
    if (typeof current === "string") {
      if (current.length > maximumInputBytes - scalarBytes) throw new TypeError("FADENO_RESOURCE_INPUT_LIMIT");
      addScalarBytes(byteLength(current));
      return { canonical: ["string", current], input: current };
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new TypeError("FADENO_RESOURCE_INPUT");
      const normalized = Object.is(current, -0) ? 0 : current;
      return { canonical: ["number", String(normalized)], input: normalized };
    }
    if (typeof current !== "object") throw new TypeError("FADENO_RESOURCE_INPUT");
    if (active.has(current)) throw new TypeError("FADENO_RESOURCE_INPUT");
    active.add(current);
    try {
      if (Array.isArray(current)) {
        if (Object.getPrototypeOf(current) !== Array.prototype) throw new TypeError("FADENO_RESOURCE_INPUT");
        if (current.length > maximumInputEntries - entries) throw new TypeError("FADENO_RESOURCE_INPUT_LIMIT");
        for (const name in current) {
          if (!Object.hasOwn(current, name) || !/^(0|[1-9][0-9]*)$/u.test(name) || Number(name) >= current.length) {
            throw new TypeError("FADENO_RESOURCE_INPUT");
          }
        }
        const canonical: unknown[] = [];
        const input: ResourceInput[] = [];
        for (let index = 0; index < current.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError("FADENO_RESOURCE_INPUT");
          const item = visit(descriptor.value, depth + 1);
          canonical.push(item.canonical);
          input.push(item.input);
        }
        return { canonical: ["array", canonical], input: Object.freeze(input) };
      }
      if (!ordinaryObject(current)) throw new TypeError("FADENO_RESOURCE_INPUT");
      const properties: [string, unknown][] = [];
      for (const name in current) {
        if (!Object.hasOwn(current, name)) throw new TypeError("FADENO_RESOURCE_INPUT");
        if (properties.length >= maximumInputEntries - entries) throw new TypeError("FADENO_RESOURCE_INPUT_LIMIT");
        if (name.length > maximumInputKeyBytes || name.length > maximumInputBytes - scalarBytes) {
          throw new TypeError("FADENO_RESOURCE_INPUT_LIMIT");
        }
        const nameBytes = byteLength(name);
        if (nameBytes > maximumInputKeyBytes) throw new TypeError("FADENO_RESOURCE_INPUT_LIMIT");
        addScalarBytes(nameBytes);
        const descriptor = Object.getOwnPropertyDescriptor(current, name);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError("FADENO_RESOURCE_INPUT");
        properties.push([name, descriptor.value]);
      }
      properties.sort(([left], [right]) => compareText(left, right));
      const canonical: [string, unknown][] = [];
      const input: [string, ResourceInput][] = [];
      for (const [name, child] of properties) {
        const item = visit(child, depth + 1);
        canonical.push([name, item.canonical]);
        input.push([name, item.input]);
      }
      return { canonical: ["object", canonical], input: Object.freeze(Object.fromEntries(input)) as ResourceInputObject };
    } finally {
      active.delete(current);
    }
  }

  const normalized = visit(value, 0);
  const encoded = JSON.stringify(normalized.canonical);
  if (byteLength(encoded) > maximumInputBytes) throw new TypeError("FADENO_RESOURCE_INPUT_LIMIT");
  try { structuredClone(value); } catch { throw new TypeError("FADENO_RESOURCE_INPUT"); }
  return Object.freeze({ input: normalized.input, key: encoded });
}

export function createResourceDeclaration<Input extends ResourceInput, Value>(
  options: Readonly<{ read: ResourceLoader<Input, Value> }>,
): ResourceDeclaration<Input, Value> {
  const read = options !== null && typeof options === "object"
    ? Object.getOwnPropertyDescriptor(options, "read")
    : undefined;
  if (
    options === null || typeof options !== "object" || !ordinaryObject(options) ||
    Object.getOwnPropertySymbols(options).length > 0 || Object.getOwnPropertyNames(options).length !== 1 ||
    !read || !("value" in read) || !read.enumerable || typeof read.value !== "function"
  ) throw new TypeError("FADENO_RESOURCE_DECLARATION");
  const resource = Object.freeze(Object.create(null) as object) as ResourceDeclaration<Input, Value>;
  loaders.set(resource, read.value as ResourceLoader<ResourceInput, unknown>);
  return resource;
}

export function createResourceError(options: Readonly<{ code: string; status: ResourceStatus }>): ResourceError {
  if (
    options === null || typeof options !== "object" || !ordinaryObject(options) ||
    Object.getOwnPropertySymbols(options).length > 0 || Object.getOwnPropertyNames(options).sort(compareText).join("\0") !== "code\0status"
  ) throw new TypeError("FADENO_RESOURCE_EXPECTED_ERROR");
  const code = Object.getOwnPropertyDescriptor(options, "code");
  const status = Object.getOwnPropertyDescriptor(options, "status");
  if (!code || !("value" in code) || !code.enumerable || !status || !("value" in status) || !status.enumerable) {
    throw new TypeError("FADENO_RESOURCE_EXPECTED_ERROR");
  }
  return Object.freeze(new ResourceExpectedError(code.value as string, status.value as ResourceStatus)) as ResourceError;
}

export function assertResourceCachePolicy(policy: string): asserts policy is "request" {
  if (policy !== "request") throw new TypeError("FADENO_RESOURCE_CACHE_POLICY");
}

export function readResourceError(cause: unknown): Readonly<{ code: string; status: ResourceStatus }> | undefined {
  return cause instanceof ResourceExpectedError ? Object.freeze({ code: cause.code, status: cause.status }) : undefined;
}

export function classifyResourceFailure(cause: unknown): "expected" | "unexpected" | "cancelled" {
  if (cause instanceof ResourceExpectedError) return "expected";
  if (cause instanceof DOMException && cause.name === "AbortError") return "cancelled";
  return "unexpected";
}

interface MutableResourceDependency {
  readonly resource: ResourceDeclaration<ResourceInput, unknown>;
  readonly input: ResourceInput;
  readonly inputKey: string;
  observation: ResourceObservation;
}

const dependencyEvidence = new WeakSet<object>();

function freezeDependency(dependency: MutableResourceDependency): ResourceDependency {
  const frozen = Object.freeze({
    resource: dependency.resource,
    input: dependency.input,
    inputKey: dependency.inputKey,
    observation: dependency.observation,
  });
  dependencyEvidence.add(frozen);
  return frozen;
}

export class ResourceRequestScope {
  readonly #request: Request;
  readonly #cache = new Map<object, Map<string, Promise<Readonly<{ status: "value"; value: unknown }>>>>();
  readonly #dependencies: MutableResourceDependency[] = [];
  readonly #flows: ResourceFlow[] = [];
  readonly #closure = new AbortController();
  readonly #signal: AbortSignal;
  #closed = false;
  #reads = 0;
  #calls = 0;

  constructor(request: Request) {
    if (!(request instanceof Request)) throw new TypeError("FADENO_RESOURCE_REQUEST");
    this.#request = request;
    this.#signal = AbortSignal.any([request.signal, this.#closure.signal]);
  }

  get dependencies(): readonly ResourceDependency[] {
    return Object.freeze(this.#dependencies.map(freezeDependency));
  }

  get flows(): readonly ResourceFlow[] {
    return Object.freeze([...this.#flows]);
  }

  get closed(): boolean { return this.#closed; }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#closure.abort("resource-scope-closed");
    for (const dependency of this.#dependencies) {
      if (dependency.observation.status === "pending") dependency.observation = Object.freeze({ status: "cancelled" });
    }
    this.#cache.clear();
    this.#dependencies.length = 0;
    this.#flows.length = 0;
  }

  async read<Input extends ResourceInput, Value>(
    resource: ResourceDeclaration<Input, Value>,
    input: Input,
  ): Promise<Value> {
    if (this.#closed) throw new TypeError("FADENO_RESOURCE_SCOPE_CLOSED");
    this.#calls += 1;
    if (this.#calls > maximumRequestCalls) throw new TypeError("FADENO_RESOURCE_CALL_LIMIT");
    if (!resource || typeof resource !== "object" || !loaders.has(resource)) {
      this.#record("refused", "none", false, "invalid-declaration");
      throw new TypeError("FADENO_RESOURCE_DECLARATION");
    }
    if (this.#signal.aborted) {
      this.#record("cancelled", "none", false, "request-aborted");
      throw new DOMException("FADENO_RESOURCE_ABORTED", "AbortError");
    }
    let normalized: Readonly<{ input: ResourceInput; key: string }>;
    try {
      normalized = normalizeInput(input);
    } catch (error) {
      this.#record("refused", "none", false, "unsupported-input");
      throw error;
    }
    let declarationCache = this.#cache.get(resource);
    const existing = declarationCache?.get(normalized.key);
    if (existing) {
      try {
        const result = await existing;
        this.#record("value", "request-hit", true, "equivalent-input");
        return result.value as Value;
      } catch (error) {
        const boundary = classifyResourceFailure(error);
        this.#record(
          boundary === "expected" ? "expected-error" : boundary === "cancelled" ? "cancelled" : "unexpected-error",
          "request-hit",
          true,
          "equivalent-input",
        );
        throw error;
      }
    }
    this.#reads += 1;
    if (this.#reads > maximumRequestReads) {
      this.#record("refused", "none", false, "request-read-limit");
      throw new TypeError("FADENO_RESOURCE_READ_LIMIT");
    }
    if (!declarationCache) {
      declarationCache = new Map();
      this.#cache.set(resource, declarationCache);
    }
    const dependency: MutableResourceDependency = {
      resource: resource as ResourceDeclaration<ResourceInput, unknown>,
      input: normalized.input,
      inputKey: normalized.key,
      observation: Object.freeze({ status: "pending" }),
    };
    this.#dependencies.push(dependency);
    const promise = this.#load(resource, normalized.input as Input, dependency);
    declarationCache.set(normalized.key, promise as Promise<Readonly<{ status: "value"; value: unknown }>>);
    return (await promise).value;
  }

  async #load<Input extends ResourceInput, Value>(
    resource: ResourceDeclaration<Input, Value>,
    input: Input,
    dependency: MutableResourceDependency,
  ): Promise<Readonly<{ status: "value"; value: Value }>> {
    try {
      const loader = loaders.get(resource) as ResourceLoader<Input, Value> | undefined;
      if (!loader) throw new TypeError("FADENO_RESOURCE_DECLARATION");
      const loaded = await loader(Object.freeze({ input, request: this.#request, signal: this.#signal }));
      if (this.#signal.aborted) throw new DOMException("FADENO_RESOURCE_ABORTED", "AbortError");
      let comparisonKey: string | null = null;
      try { comparisonKey = normalizeInput(loaded).key; } catch { /* unsupported values conservatively refuse comparison */ }
      dependency.observation = Object.freeze({ status: "value", comparisonKey });
      this.#record("value", "miss", true, "loader-completed");
      return Object.freeze({ status: "value" as const, value: loaded as Value });
    } catch (error) {
      if (error instanceof ResourceExpectedError) {
        dependency.observation = Object.freeze({ status: "expected-error", code: error.code, httpStatus: error.status });
        this.#record("expected-error", "miss", true, error.code);
        throw error;
      }
      if (this.#signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        dependency.observation = Object.freeze({ status: "cancelled" });
        this.#record("cancelled", "miss", true, "request-aborted");
        throw new DOMException("FADENO_RESOURCE_ABORTED", "AbortError");
      }
      dependency.observation = Object.freeze({ status: "unexpected-error" });
      this.#record("unexpected-error", "miss", true, "loader-threw");
      throw error;
    }
  }

  #record(
    outcome: ResourceFlow["outcome"],
    cache: ResourceFlow["cache"],
    dependencyRecorded: boolean,
    cause: string,
  ): void {
    if (this.#closed) return;
    this.#flows.push(Object.freeze({
      operation: "resource-read",
      outcome,
      cache,
      ownership: "request",
      dependencyRecorded,
      cause,
    }));
  }
}

export type ResourceComparison = Readonly<{
  resource: ResourceDeclaration<ResourceInput, unknown>;
  inputKey: string;
  decision: "unchanged" | "changed" | "refused";
  reason: string;
}>;

export type ResourceKeepDecision = Readonly<{
  resource: ResourceDeclaration<ResourceInput, unknown>;
  decision: "verified" | "unsafe" | "not-active";
  reasons: readonly string[];
}>;

export type ResourceRevalidationReport = Readonly<{
  complete: boolean;
  baseline: "all-active-dependencies";
  dependencies: readonly ResourceDependency[];
  comparisons: readonly ResourceComparison[];
  keeps: readonly ResourceKeepDecision[];
}>;

function compareObservations(before: ResourceObservation, after: ResourceObservation): Readonly<{
  decision: ResourceComparison["decision"];
  reason: string;
}> {
  if (before.status === "value" && after.status === "value") {
    if (before.comparisonKey === null || after.comparisonKey === null) return { decision: "refused", reason: "unsupported-value" };
    return before.comparisonKey === after.comparisonKey
      ? { decision: "unchanged", reason: "equivalent-value" }
      : { decision: "changed", reason: "value-changed" };
  }
  if (before.status === "expected-error" && after.status === "expected-error") {
    return before.code === after.code && before.httpStatus === after.httpStatus
      ? { decision: "unchanged", reason: "equivalent-expected-error" }
      : { decision: "changed", reason: "expected-error-changed" };
  }
  if (before.status === "pending" || before.status === "cancelled" || before.status === "unexpected-error") {
    return { decision: "refused", reason: "invalid-baseline" };
  }
  if (after.status === "pending" || after.status === "cancelled" || after.status === "unexpected-error") {
    return { decision: "refused", reason: "incomplete-revalidation" };
  }
  return { decision: "changed", reason: "outcome-changed" };
}

function validateRevalidationInput(
  dependencies: readonly ResourceDependency[],
  keeps: readonly ResourceDeclaration<ResourceInput, unknown>[],
): void {
  if (!Array.isArray(dependencies) || dependencies.length === 0 || dependencies.length > maximumRequestReads) {
    throw new TypeError("FADENO_RESOURCE_REVALIDATION_INPUT");
  }
  const identities = new Map<object, Set<string>>();
  for (const dependency of dependencies) {
    if (!dependency || typeof dependency !== "object" || !dependencyEvidence.has(dependency) || !loaders.has(dependency.resource)) {
      throw new TypeError("FADENO_RESOURCE_REVALIDATION_INPUT");
    }
    const normalized = normalizeInput(dependency.input);
    if (
      normalized.key !== dependency.inputKey ||
      (dependency.observation.status !== "value" && dependency.observation.status !== "expected-error")
    ) {
      throw new TypeError("FADENO_RESOURCE_REVALIDATION_INPUT");
    }
    let keys = identities.get(dependency.resource);
    if (!keys) {
      keys = new Set();
      identities.set(dependency.resource, keys);
    }
    if (keys.has(dependency.inputKey)) throw new TypeError("FADENO_RESOURCE_REVALIDATION_INPUT");
    keys.add(dependency.inputKey);
  }
  if (!Array.isArray(keeps) || keeps.length > maximumRequestReads || new Set(keeps).size !== keeps.length) {
    throw new TypeError("FADENO_RESOURCE_REVALIDATION_KEEPS");
  }
  for (const resource of keeps) {
    if (!resource || typeof resource !== "object" || !loaders.has(resource)) throw new TypeError("FADENO_RESOURCE_REVALIDATION_KEEPS");
  }
}

export async function revalidateResourceDependencies(
  request: Request,
  dependencies: readonly ResourceDependency[],
  keeps: readonly ResourceDeclaration<ResourceInput, unknown>[] = [],
): Promise<ResourceRevalidationReport> {
  validateRevalidationInput(dependencies, keeps);
  const scope = new ResourceRequestScope(request);
  try {
    for (const dependency of dependencies) {
      if (request.signal.aborted) throw new DOMException("FADENO_RESOURCE_ABORTED", "AbortError");
      await scope.read(dependency.resource, dependency.input).catch(() => undefined);
      if (request.signal.aborted) throw new DOMException("FADENO_RESOURCE_ABORTED", "AbortError");
    }
    const refreshed = scope.dependencies;
    if (refreshed.length !== dependencies.length) throw new TypeError("FADENO_RESOURCE_REVALIDATION_INCOMPLETE");
    const comparisons = Object.freeze(dependencies.map((before, index): ResourceComparison => {
      const after = refreshed[index];
      if (!after || after.resource !== before.resource || after.inputKey !== before.inputKey) {
        throw new TypeError("FADENO_RESOURCE_REVALIDATION_ORDER");
      }
      return Object.freeze({ resource: before.resource, inputKey: before.inputKey, ...compareObservations(before.observation, after.observation) });
    }));
    const comparisonsByResource = new Map<ResourceDeclaration<ResourceInput, unknown>, ResourceComparison[]>();
    for (const comparison of comparisons) {
      const owned = comparisonsByResource.get(comparison.resource);
      if (owned) owned.push(comparison);
      else comparisonsByResource.set(comparison.resource, [comparison]);
    }
    const keepDecisions = Object.freeze(keeps.map((resource): ResourceKeepDecision => {
      const owned = comparisonsByResource.get(resource) ?? [];
      if (owned.length === 0) return Object.freeze({ resource, decision: "not-active" as const, reasons: Object.freeze(["resource-not-active"]) });
      const unsafe = owned.filter(({ decision }) => decision !== "unchanged");
      return unsafe.length === 0
        ? Object.freeze({ resource, decision: "verified" as const, reasons: Object.freeze(["all-active-inputs-unchanged"]) })
        : Object.freeze({ resource, decision: "unsafe" as const, reasons: Object.freeze(unsafe.map(({ reason }) => reason)) });
    }));
    const complete = refreshed.every(({ observation }) => observation.status === "value" || observation.status === "expected-error");
    return Object.freeze({
      complete,
      baseline: "all-active-dependencies" as const,
      dependencies: refreshed,
      comparisons,
      keeps: keepDecisions,
    });
  } finally {
    scope.close();
  }
}
