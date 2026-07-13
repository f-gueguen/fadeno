const maximumInputDepth = 32;
const maximumInputEntries = 4_096;
const maximumInputKeyBytes = 1_024;
const maximumInputBytes = 64 * 1_024;
const maximumRequestReads = 1_024;

interface PrivatePlainObject {
  readonly [key: string]: PrivatePlainInput;
}

type PrivatePlainInput = null | boolean | number | string | readonly PrivatePlainInput[] | PrivatePlainObject;

export type PrivateResourceResult<Value> =
  | Readonly<{ status: "value"; value: Value }>
  | Readonly<{ status: "expected-error"; code: string; httpStatus: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503 }>;

export type PrivateResourceLoader<Input extends PrivatePlainInput, Value> = (
  context: Readonly<{ input: Input; request: Request; signal: AbortSignal }>,
) => Value | PrivateResourceResult<Value> | Promise<Value | PrivateResourceResult<Value>>;

export type PrivateResourceDeclaration<Input extends PrivatePlainInput, Value> = Readonly<{
  declaration: object;
  load: PrivateResourceLoader<Input, Value>;
}>;

export type PrivateResourceDependency = Readonly<{
  declaration: object;
  inputKey: string;
}>;

export type PrivateResourceFlow = Readonly<{
  operation: "resource-read";
  outcome: "value" | "expected-error" | "unexpected-error" | "cancelled" | "refused";
  cache: "miss" | "request-hit" | "none";
  ownership: "request";
  dependencyRecorded: boolean;
  cause: string;
}>;

export class PrivateResourceExpectedError extends Error {
  readonly code: string;
  readonly httpStatus: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503;

  constructor(code: string, httpStatus: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503) {
    super("FADENO_RESOURCE_EXPECTED");
    this.name = "PrivateResourceExpectedError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function ordinaryObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function encodeInput(value: unknown): string {
  const active = new Set<object>();
  let entries = 0;

  function visit(current: unknown, depth: number): unknown {
    entries += 1;
    if (entries > maximumInputEntries || depth > maximumInputDepth) throw new TypeError("FADENO_RESOURCE_INPUT_LIMIT");
    if (current === null) return ["null"];
    if (typeof current === "boolean") return ["boolean", current];
    if (typeof current === "string") return ["string", current];
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new TypeError("FADENO_RESOURCE_INPUT");
      return ["number", Object.is(current, -0) ? "0" : String(current)];
    }
    if (typeof current !== "object") throw new TypeError("FADENO_RESOURCE_INPUT");
    if (active.has(current)) throw new TypeError("FADENO_RESOURCE_INPUT");
    active.add(current);
    try {
      if (Array.isArray(current)) {
        if (Object.getOwnPropertySymbols(current).length > 0) throw new TypeError("FADENO_RESOURCE_INPUT");
        for (let index = 0; index < current.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError("FADENO_RESOURCE_INPUT");
        }
        const names = Object.getOwnPropertyNames(current);
        if (names.some((name) => name !== "length" && !/^(0|[1-9][0-9]*)$/u.test(name))) {
          throw new TypeError("FADENO_RESOURCE_INPUT");
        }
        return ["array", current.map((item) => visit(item, depth + 1))];
      }
      if (!ordinaryObject(current) || Object.getOwnPropertySymbols(current).length > 0) {
        throw new TypeError("FADENO_RESOURCE_INPUT");
      }
      const properties: [string, unknown][] = [];
      for (const name of Object.getOwnPropertyNames(current).sort(compareText)) {
        if (Buffer.byteLength(name, "utf8") > maximumInputKeyBytes) throw new TypeError("FADENO_RESOURCE_INPUT_LIMIT");
        const descriptor = Object.getOwnPropertyDescriptor(current, name);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError("FADENO_RESOURCE_INPUT");
        properties.push([name, visit(descriptor.value, depth + 1)]);
      }
      return ["object", properties];
    } finally {
      active.delete(current);
    }
  }

  const encoded = JSON.stringify(visit(value, 0));
  if (Buffer.byteLength(encoded, "utf8") > maximumInputBytes) throw new TypeError("FADENO_RESOURCE_INPUT_LIMIT");
  return encoded;
}

function validExpectedResult(value: unknown): value is Extract<PrivateResourceResult<unknown>, { status: "expected-error" }> {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate["status"] === "expected-error" && typeof candidate["code"] === "string" &&
    /^[A-Z][A-Z0-9_]{0,127}$/u.test(candidate["code"]) &&
    [400, 401, 403, 404, 409, 422, 429, 503].includes(candidate["httpStatus"] as number) &&
    Object.keys(candidate).length === 3;
}

function valueResult<Value>(value: Value): Readonly<{ status: "value"; value: Value }> {
  return Object.freeze({ status: "value" as const, value });
}

export function definePrivateResource<Input extends PrivatePlainInput, Value>(
  load: PrivateResourceLoader<Input, Value>,
): PrivateResourceDeclaration<Input, Value> {
  if (typeof load !== "function") throw new TypeError("FADENO_RESOURCE_DECLARATION");
  return Object.freeze({ declaration: Object.freeze(Object.create(null) as object), load });
}

export function privateExpectedResourceError(
  code: string,
  httpStatus: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503,
): Extract<PrivateResourceResult<never>, { status: "expected-error" }> {
  const result = Object.freeze({ status: "expected-error" as const, code, httpStatus });
  if (!validExpectedResult(result)) throw new TypeError("FADENO_RESOURCE_EXPECTED_ERROR");
  return result;
}

export function assertPrivateResourceCachePolicy(policy: string): asserts policy is "request" {
  if (policy !== "request") throw new TypeError("FADENO_RESOURCE_CACHE_POLICY");
}

export function classifyPrivateResourceBoundary(cause: unknown): "expected" | "unexpected" | "cancelled" {
  if (cause instanceof PrivateResourceExpectedError) return "expected";
  if (cause instanceof DOMException && cause.name === "AbortError") return "cancelled";
  return "unexpected";
}

export class PrivateResourceRequestScope {
  readonly #request: Request;
  readonly #cache = new Map<object, Map<string, Promise<Readonly<{ status: "value"; value: unknown }>>>>();
  readonly #dependencies: PrivateResourceDependency[] = [];
  readonly #flows: PrivateResourceFlow[] = [];
  #reads = 0;

  constructor(request: Request) {
    if (!(request instanceof Request)) throw new TypeError("FADENO_RESOURCE_REQUEST");
    this.#request = request;
  }

  get dependencies(): readonly PrivateResourceDependency[] {
    return Object.freeze([...this.#dependencies]);
  }

  get flows(): readonly PrivateResourceFlow[] {
    return Object.freeze([...this.#flows]);
  }

  async read<Input extends PrivatePlainInput, Value>(
    resource: PrivateResourceDeclaration<Input, Value>,
    input: Input,
  ): Promise<Value> {
    if (!resource || typeof resource !== "object" || typeof resource.load !== "function" || typeof resource.declaration !== "object") {
      this.#record("refused", "none", false, "invalid-declaration");
      throw new TypeError("FADENO_RESOURCE_DECLARATION");
    }
    if (this.#request.signal.aborted) {
      this.#record("cancelled", "none", false, "request-aborted");
      throw new DOMException("FADENO_RESOURCE_ABORTED", "AbortError");
    }
    let inputKey: string;
    try {
      inputKey = encodeInput(input);
    } catch (error) {
      this.#record("refused", "none", false, "unsupported-input");
      throw error;
    }
    let declarationCache = this.#cache.get(resource.declaration);
    const existing = declarationCache?.get(inputKey);
    if (existing) {
      this.#record("value", "request-hit", true, "equivalent-input");
      return (await existing).value as Value;
    }
    this.#reads += 1;
    if (this.#reads > maximumRequestReads) {
      this.#record("refused", "none", false, "request-read-limit");
      throw new TypeError("FADENO_RESOURCE_READ_LIMIT");
    }
    if (!declarationCache) {
      declarationCache = new Map();
      this.#cache.set(resource.declaration, declarationCache);
    }
    this.#dependencies.push(Object.freeze({ declaration: resource.declaration, inputKey }));
    const promise = this.#load(resource, input);
    declarationCache.set(inputKey, promise as Promise<Readonly<{ status: "value"; value: unknown }>>);
    return (await promise).value;
  }

  async #load<Input extends PrivatePlainInput, Value>(
    resource: PrivateResourceDeclaration<Input, Value>,
    input: Input,
  ): Promise<Readonly<{ status: "value"; value: Value }>> {
    try {
      const loaded = await resource.load(Object.freeze({ input, request: this.#request, signal: this.#request.signal }));
      if (this.#request.signal.aborted) throw new DOMException("FADENO_RESOURCE_ABORTED", "AbortError");
      if (validExpectedResult(loaded)) {
        this.#record("expected-error", "miss", true, loaded.code);
        throw new PrivateResourceExpectedError(loaded.code, loaded.httpStatus);
      }
      const result = loaded !== null && typeof loaded === "object" && (loaded as { status?: unknown }).status === "value"
        ? loaded as Readonly<{ status: "value"; value: Value }>
        : valueResult(loaded as Value);
      this.#record("value", "miss", true, "loader-completed");
      return result;
    } catch (error) {
      if (error instanceof PrivateResourceExpectedError) throw error;
      if (this.#request.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        this.#record("cancelled", "miss", true, "request-aborted");
        throw new DOMException("FADENO_RESOURCE_ABORTED", "AbortError");
      }
      this.#record("unexpected-error", "miss", true, "loader-threw");
      throw error;
    }
  }

  #record(
    outcome: PrivateResourceFlow["outcome"],
    cache: PrivateResourceFlow["cache"],
    dependencyRecorded: boolean,
    cause: string,
  ): void {
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
