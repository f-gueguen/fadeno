import { types } from "node:util";

const maximumInputDepth = 32;
const maximumInputEntries = 4_096;
const maximumInputKeyBytes = 1_024;
const maximumInputBytes = 64 * 1_024;
const maximumRequestReads = 1_024;
const maximumRequestCalls = 4_096;

interface PrivatePlainObject {
  readonly [key: string]: PrivatePlainInput;
}

type PrivatePlainInput = null | boolean | number | string | readonly PrivatePlainInput[] | PrivatePlainObject;

export type PrivateResourceLoader<Input extends PrivatePlainInput, Value> = (
  context: Readonly<{ input: Input; request: Request; signal: AbortSignal }>,
) => Value | Promise<Value>;

export type PrivateResourceDeclaration<Input extends PrivatePlainInput, Value> = Readonly<{
  declaration: object;
  read: PrivateResourceLoader<Input, Value>;
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
    if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(code) || ![400, 401, 403, 404, 409, 422, 429, 503].includes(httpStatus)) {
      throw new TypeError("FADENO_RESOURCE_EXPECTED_ERROR");
    }
    super("FADENO_RESOURCE_EXPECTED");
    this.name = "PrivateResourceExpectedError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const declarations = new WeakSet<object>();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function ordinaryObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeInput(value: unknown): Readonly<{ input: PrivatePlainInput; key: string }> {
  const active = new Set<object>();
  let entries = 0;
  let scalarBytes = 0;

  function addScalarBytes(bytes: number): void {
    if (bytes > maximumInputBytes - scalarBytes) throw new TypeError("FADENO_RESOURCE_INPUT_LIMIT");
    scalarBytes += bytes;
  }

  function visit(current: unknown, depth: number): Readonly<{ canonical: unknown; input: PrivatePlainInput }> {
    entries += 1;
    if (entries > maximumInputEntries || depth > maximumInputDepth) throw new TypeError("FADENO_RESOURCE_INPUT_LIMIT");
    if (current === null) return { canonical: ["null"], input: null };
    if (typeof current === "boolean") return { canonical: ["boolean", current], input: current };
    if (typeof current === "string") {
      if (current.length > maximumInputBytes - scalarBytes) throw new TypeError("FADENO_RESOURCE_INPUT_LIMIT");
      addScalarBytes(Buffer.byteLength(current, "utf8"));
      return { canonical: ["string", current], input: current };
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new TypeError("FADENO_RESOURCE_INPUT");
      const normalized = Object.is(current, -0) ? 0 : current;
      return { canonical: ["number", String(normalized)], input: normalized };
    }
    if (typeof current !== "object") throw new TypeError("FADENO_RESOURCE_INPUT");
    if (types.isProxy(current)) throw new TypeError("FADENO_RESOURCE_INPUT");
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
        const input: PrivatePlainInput[] = [];
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
        const nameBytes = Buffer.byteLength(name, "utf8");
        if (nameBytes > maximumInputKeyBytes) throw new TypeError("FADENO_RESOURCE_INPUT_LIMIT");
        addScalarBytes(nameBytes);
        const descriptor = Object.getOwnPropertyDescriptor(current, name);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError("FADENO_RESOURCE_INPUT");
        properties.push([name, descriptor.value]);
      }
      properties.sort(([left], [right]) => compareText(left, right));
      const canonical: [string, unknown][] = [];
      const input: [string, PrivatePlainInput][] = [];
      for (const [name, child] of properties) {
        const item = visit(child, depth + 1);
        canonical.push([name, item.canonical]);
        input.push([name, item.input]);
      }
      return { canonical: ["object", canonical], input: Object.freeze(Object.fromEntries(input)) as PrivatePlainObject };
    } finally {
      active.delete(current);
    }
  }

  const normalized = visit(value, 0);
  const encoded = JSON.stringify(normalized.canonical);
  if (Buffer.byteLength(encoded, "utf8") > maximumInputBytes) throw new TypeError("FADENO_RESOURCE_INPUT_LIMIT");
  return Object.freeze({ input: normalized.input, key: encoded });
}

export function definePrivateResource<Input extends PrivatePlainInput, Value>(
  options: Readonly<{ read: PrivateResourceLoader<Input, Value> }>,
): PrivateResourceDeclaration<Input, Value> {
  const read = options !== null && typeof options === "object" && !types.isProxy(options)
    ? Object.getOwnPropertyDescriptor(options, "read")
    : undefined;
  if (
    options === null || typeof options !== "object" || types.isProxy(options) || !ordinaryObject(options) ||
    Object.getOwnPropertySymbols(options).length > 0 || Object.getOwnPropertyNames(options).length !== 1 ||
    !read || !("value" in read) || !read.enumerable || typeof read.value !== "function"
  ) throw new TypeError("FADENO_RESOURCE_DECLARATION");
  const resource = Object.freeze({
    declaration: Object.freeze(Object.create(null) as object),
    read: read.value as PrivateResourceLoader<Input, Value>,
  });
  declarations.add(resource);
  return resource;
}

export function privateExpectedResourceError(
  code: string,
  httpStatus: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503,
): PrivateResourceExpectedError {
  return Object.freeze(new PrivateResourceExpectedError(code, httpStatus));
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
  #calls = 0;

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
    this.#calls += 1;
    if (this.#calls > maximumRequestCalls) throw new TypeError("FADENO_RESOURCE_CALL_LIMIT");
    if (!resource || typeof resource !== "object" || !declarations.has(resource)) {
      this.#record("refused", "none", false, "invalid-declaration");
      throw new TypeError("FADENO_RESOURCE_DECLARATION");
    }
    if (this.#request.signal.aborted) {
      this.#record("cancelled", "none", false, "request-aborted");
      throw new DOMException("FADENO_RESOURCE_ABORTED", "AbortError");
    }
    let normalized: Readonly<{ input: PrivatePlainInput; key: string }>;
    try {
      normalized = normalizeInput(input);
    } catch (error) {
      this.#record("refused", "none", false, "unsupported-input");
      throw error;
    }
    let declarationCache = this.#cache.get(resource.declaration);
    const existing = declarationCache?.get(normalized.key);
    if (existing) {
      try {
        const result = await existing;
        this.#record("value", "request-hit", true, "equivalent-input");
        return result.value as Value;
      } catch (error) {
        const boundary = classifyPrivateResourceBoundary(error);
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
      this.#cache.set(resource.declaration, declarationCache);
    }
    this.#dependencies.push(Object.freeze({ declaration: resource.declaration, inputKey: normalized.key }));
    const promise = this.#load(resource, normalized.input as Input);
    declarationCache.set(normalized.key, promise as Promise<Readonly<{ status: "value"; value: unknown }>>);
    return (await promise).value;
  }

  async #load<Input extends PrivatePlainInput, Value>(
    resource: PrivateResourceDeclaration<Input, Value>,
    input: Input,
  ): Promise<Readonly<{ status: "value"; value: Value }>> {
    try {
      const loaded = await resource.read(Object.freeze({ input, request: this.#request, signal: this.#request.signal }));
      if (this.#request.signal.aborted) throw new DOMException("FADENO_RESOURCE_ABORTED", "AbortError");
      this.#record("value", "miss", true, "loader-completed");
      return Object.freeze({ status: "value" as const, value: loaded as Value });
    } catch (error) {
      if (error instanceof PrivateResourceExpectedError) {
        this.#record("expected-error", "miss", true, error.code);
        throw error;
      }
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
