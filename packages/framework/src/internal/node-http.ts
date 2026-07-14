import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { Readable } from "node:stream";

import type { Handler } from "../index.js";
import { bindRequestFailureObserver, type FrameworkFailureObserver } from "./failure-observer.ts";
import { nodeHttpCapabilities } from "./node-http-capabilities.ts";
import { createActionServerRuntime, type ActionServerRuntime } from "./action-server.ts";

export interface NodeHttpServer {
  readonly origin: string;
  close(): Promise<void>;
}

export interface ListenNodeHttpOptions {
  readonly handler: Handler;
  readonly hostname?: string;
  readonly port?: number;
  readonly canonicalOrigin?: string;
  readonly applicationGeneration?: string;
  readonly failureObserver?: FrameworkFailureObserver;
}

function assertSupportedRuntime(): void {
  const [major = 0, minor = 0, patch = 0] = process.versions.node.split(".").map(Number);
  const [requiredMajor, requiredMinor, requiredPatch] = nodeHttpCapabilities.minimumVersion.split(".").map(Number) as [number, number, number];
  const current = major * 1_000_000 + minor * 1_000 + patch;
  const required = requiredMajor * 1_000_000 + requiredMinor * 1_000 + requiredPatch;
  if (current < required) {
    throw new Error(`FADENO_ADAPTER_NODE_VERSION: requires Node ${nodeHttpCapabilities.minimumVersion} or newer`);
  }
}

function requestUrl(rawTarget: string | undefined, origin: string): URL {
  if (!rawTarget || !rawTarget.startsWith("/") || rawTarget.startsWith("//")) {
    throw new Error("FADENO_ADAPTER_REQUEST_TARGET");
  }
  const url = new URL(rawTarget, origin);
  if (url.origin !== origin || url.hash || rawTarget.includes("\\")) {
    throw new Error("FADENO_ADAPTER_REQUEST_TARGET");
  }
  return url;
}

function requestBody(request: IncomingMessage): ReadableStream<Uint8Array> | undefined {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  return Readable.toWeb(request) as ReadableStream<Uint8Array>;
}

function requestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.append(name, value);
    }
  }
  return headers;
}

function toWebRequest(request: IncomingMessage, origin: string, signal: AbortSignal): Request {
  const body = requestBody(request);
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method ?? "GET",
    headers: requestHeaders(request),
    signal,
  };
  if (body) {
    init.body = body;
    init.duplex = "half";
  }
  return new Request(requestUrl(request.url, origin), init);
}

function copyResponseHead(response: Response, target: ServerResponse): void {
  target.statusCode = response.status;
  if (response.statusText) target.statusMessage = response.statusText;
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") target.setHeader(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) target.setHeader("set-cookie", cookies);
}

function waitForDrain(target: ServerResponse): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      target.off("drain", onDrain);
      target.off("close", onClose);
      target.off("error", onError);
    };
    const onDrain = (): void => { cleanup(); resolve(); };
    const onClose = (): void => { cleanup(); reject(new DOMException("Client disconnected", "AbortError")); };
    const onError = (error: Error): void => { cleanup(); reject(error); };
    if (target.destroyed) {
      reject(new DOMException("Client disconnected", "AbortError"));
      return;
    }
    target.once("drain", onDrain);
    target.once("close", onClose);
    target.once("error", onError);
    if (target.destroyed) onClose();
  });
}

async function writeWebResponse(response: Response, target: ServerResponse): Promise<void> {
  copyResponseHead(response, target);
  if (!response.body) {
    target.end();
    return;
  }

  const reader = response.body.getReader();
  let completed = false;
  const cancelOnDisconnect = (): void => {
    if (!target.writableEnded) void reader.cancel("client disconnected").catch(() => undefined);
  };
  target.once("close", cancelOnDisconnect);
  try {
    while (!target.destroyed) {
      const next = await reader.read();
      if (next.done) {
        completed = true;
        target.end();
        return;
      }
      if (!target.write(next.value)) await waitForDrain(target);
    }
  } finally {
    target.off("close", cancelOnDisconnect);
    if (!completed) await reader.cancel("client disconnected").catch(() => undefined);
    reader.releaseLock();
  }
}

function handleRequest(
  handler: Handler,
  actionRuntime: ActionServerRuntime | null,
  failureObserver: FrameworkFailureObserver | undefined,
  requestOrigin: () => string,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const cancellation = new AbortController();
  request.once("close", () => {
    if (!request.complete) cancellation.abort(new DOMException("Request body disconnected", "AbortError"));
  });
  response.once("close", () => {
    if (!response.writableEnded) cancellation.abort(new DOMException("Client disconnected", "AbortError"));
  });

  void (async () => {
    try {
      const webRequest = toWebRequest(request, requestOrigin(), cancellation.signal);
      const invoke = async (nextRequest: Request): Promise<Response> => {
        const releaseObserver = bindRequestFailureObserver(nextRequest, failureObserver);
        try { return await handler(nextRequest); } finally { releaseObserver(); }
      };
      const webResponse = actionRuntime
        ? await actionRuntime.serve(webRequest, invoke)
        : await invoke(webRequest);
      await writeWebResponse(webResponse, response);
    } catch (error: unknown) {
      response.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  })();
}

function listen(server: Server, hostname: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(port, hostname, () => {
      server.off("error", onError);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeIdleConnections();
  });
}

export async function listenNodeHttp(options: ListenNodeHttpOptions): Promise<NodeHttpServer> {
  assertSupportedRuntime();
  const hostname = options.hostname ?? "127.0.0.1";
  const port = options.port ?? 0;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error("FADENO_ADAPTER_PORT");
  }
  let origin: string | undefined;
  const sessionKeys = process.env["FADENO_SESSION_KEYS"];
  const actionRuntime = createActionServerRuntime({
    ...(options.canonicalOrigin === undefined ? {} : { canonicalOrigin: options.canonicalOrigin }),
    ...(options.applicationGeneration === undefined ? {} : { applicationGeneration: options.applicationGeneration }),
    ...(sessionKeys === undefined ? {} : { sessionKeys }),
  });
  let draining = false;
  const server = createServer({ highWaterMark: 16 * 1024 }, (request, response) => {
    response.once("finish", () => {
      if (draining) server.closeIdleConnections();
    });
    handleRequest(options.handler, actionRuntime, options.failureObserver, () => {
      if (!origin) throw new Error("FADENO_ADAPTER_NOT_LISTENING");
      return options.canonicalOrigin ?? origin;
    }, request, response);
  });
  await listen(server, hostname, port);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("FADENO_ADAPTER_ADDRESS");
  const authorityHost = isIP(hostname) === 6 ? `[${hostname}]` : hostname;
  origin = `http://${authorityHost}:${address.port}`;
  let shutdown: Promise<void> | undefined;
  return {
    origin,
    close: () => {
      draining = true;
      shutdown ??= close(server);
      return shutdown;
    },
  };
}
