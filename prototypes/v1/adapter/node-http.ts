import { once } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";

import { nodeHttpAdapterCapabilities } from "./capabilities.ts";

export type WebHandler = (request: Request) => Response | Promise<Response>;

export interface NodeHttpAdapter {
  readonly origin: string;
  close(): Promise<void>;
}

export interface ListenNodeHttpAdapterOptions {
  readonly handler: WebHandler;
  readonly hostname?: string;
}

function assertSupportedRuntime(): void {
  const [major = 0, minor = 0, patch = 0] = process.versions.node.split(".").map(Number);
  const [requiredMajor, requiredMinor, requiredPatch] = nodeHttpAdapterCapabilities.minimumVersion.split(".").map(Number) as [number, number, number];
  const current = major * 1_000_000 + minor * 1_000 + patch;
  const required = requiredMajor * 1_000_000 + requiredMinor * 1_000 + requiredPatch;
  if (current < required) {
    throw new Error(`FADENO_ADAPTER_NODE_VERSION: requires Node ${nodeHttpAdapterCapabilities.minimumVersion} or newer`);
  }
}

function requestTarget(rawTarget: string | undefined): string {
  if (!rawTarget || !rawTarget.startsWith("/") || rawTarget.startsWith("//")) {
    throw new Error("FADENO_ADAPTER_REQUEST_TARGET");
  }
  return rawTarget;
}

function requestBody(request: IncomingMessage): ReadableStream<Uint8Array> | undefined {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  return Readable.toWeb(request) as ReadableStream<Uint8Array>;
}

function toWebRequest(request: IncomingMessage, origin: string, signal: AbortSignal): Request {
  const body = requestBody(request);
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method ?? "GET",
    headers: request.headers as HeadersInit,
    signal,
  };
  if (body) {
    init.body = body;
    init.duplex = "half";
  }
  return new Request(new URL(requestTarget(request.url), origin), init);
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

async function waitForDrain(target: ServerResponse): Promise<void> {
  await Promise.race([
    once(target, "drain"),
    once(target, "close").then(() => { throw new DOMException("Client disconnected", "AbortError"); }),
  ]);
}

async function writeWebResponse(response: Response, target: ServerResponse): Promise<void> {
  copyResponseHead(response, target);
  if (!response.body) {
    target.end();
    return;
  }

  const reader = response.body.getReader();
  let completed = false;
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
    if (!completed) await reader.cancel("client disconnected").catch(() => undefined);
    reader.releaseLock();
  }
}

function handleRequest(handler: WebHandler, origin: () => string, request: IncomingMessage, response: ServerResponse): void {
  const cancellation = new AbortController();
  request.once("close", () => {
    if (!request.complete) cancellation.abort(new DOMException("Request body disconnected", "AbortError"));
  });
  response.once("close", () => {
    if (!response.writableEnded) cancellation.abort(new DOMException("Client disconnected", "AbortError"));
  });

  void (async () => {
    try {
      const webRequest = toWebRequest(request, origin(), cancellation.signal);
      const webResponse = await handler(webRequest);
      await writeWebResponse(webResponse, response);
    } catch (error: unknown) {
      response.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  })();
}

function listen(server: Server, hostname: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(0, hostname, () => {
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

export async function listenNodeHttpAdapter(options: ListenNodeHttpAdapterOptions): Promise<NodeHttpAdapter> {
  assertSupportedRuntime();
  const hostname = options.hostname ?? "127.0.0.1";
  let origin: string | undefined;
  const server = createServer({ highWaterMark: 16 * 1024 }, (request, response) => {
    handleRequest(options.handler, () => {
      if (!origin) throw new Error("FADENO_ADAPTER_NOT_LISTENING");
      return origin;
    }, request, response);
  });
  await listen(server, hostname);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("FADENO_ADAPTER_ADDRESS");
  origin = `http://${hostname}:${address.port}`;
  return {
    origin,
    close: () => close(server),
  };
}
