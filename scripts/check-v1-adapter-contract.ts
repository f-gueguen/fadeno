import { setTimeout as delay } from "node:timers/promises";
import { Agent, request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { connect } from "node:net";

import { nodeHttpAdapterCapabilities } from "../prototypes/v1/adapter/capabilities.ts";
import { listenNodeHttpAdapter, type WebHandler } from "../prototypes/v1/adapter/node-http.ts";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

interface HttpResult {
  readonly body: string;
  readonly headers: IncomingHttpHeaders;
  readonly rawHeaders: readonly string[];
  readonly status: number | undefined;
}

interface ExchangeOptions {
  readonly agent?: Agent;
  readonly body?: readonly string[];
  readonly headers?: Record<string, string>;
  readonly method?: string;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function within<T>(promise: Promise<T>, label: string, milliseconds = 3_000): Promise<T> {
  const timeout = new AbortController();
  try {
    return await Promise.race([
      promise,
      delay(milliseconds, undefined, { signal: timeout.signal }).then(() => { throw new Error(`FADENO_ADAPTER_TIMEOUT:${label}`); }),
    ]);
  } finally {
    timeout.abort();
  }
}

function exchange(origin: string, path: string, options: ExchangeOptions = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(`${origin}${path}`, {
      agent: options.agent,
      method: options.method,
      headers: options.headers,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({
        body: Buffer.concat(chunks).toString("utf8"),
        headers: response.headers,
        rawHeaders: response.rawHeaders,
        status: response.statusCode,
      }));
    });
    request.once("error", reject);
    for (const chunk of options.body ?? []) request.write(chunk);
    request.end();
  });
}

async function withAdapter<T>(handler: WebHandler, run: (origin: string) => Promise<T>): Promise<T> {
  const adapter = await listenNodeHttpAdapter({ handler });
  try {
    return await run(adapter.origin);
  } finally {
    await adapter.close();
  }
}

async function verifyRequestResponseAndCookies(): Promise<void> {
  let observed: Request | undefined;
  await withAdapter(async (request) => {
    if (request.method === "GET" || request.method === "HEAD") {
      if (request.body !== null) throw new Error("FADENO_ADAPTER_SAFE_METHOD_BODY");
      return new Response(null, { status: 204 });
    }
    observed = request;
    const body = request.body ? await request.text() : "";
    const headers = new Headers({ "content-type": "text/plain", "x-adapter": "node-http" });
    headers.append("set-cookie", "first=1; Path=/; HttpOnly");
    headers.append("set-cookie", "second=2; Path=/; SameSite=Lax");
    return new Response(`${request.method} ${request.url} ${request.headers.get("x-test")} ${body}`, { status: 201, headers });
  }, async (origin) => {
    const result = await exchange(origin, "/items?mode=test", {
      method: "POST",
      headers: { host: "attacker.invalid", "x-forwarded-host": "forwarded.invalid", "x-test": "preserved" },
      body: ["first-", "second"],
    });
    if (!observed || result.status !== 201 || result.headers["x-adapter"] !== "node-http") throw new Error("FADENO_ADAPTER_RESPONSE");
    if (result.body !== `POST ${origin}/items?mode=test preserved first-second`) throw new Error("FADENO_ADAPTER_REQUEST");
    const cookieHeaders = result.rawHeaders.filter((_value, index, all) => index > 0 && all[index - 1]?.toLowerCase() === "set-cookie");
    if (cookieHeaders.length !== 2) throw new Error("FADENO_ADAPTER_SET_COOKIE");
    if ((await exchange(origin, "/get")).status !== 204) throw new Error("FADENO_ADAPTER_GET_BODY");
    if ((await exchange(origin, "/head", { method: "HEAD" })).status !== 204) throw new Error("FADENO_ADAPTER_HEAD_BODY");
  });
}

async function verifyAbsoluteRequestTargetRefusal(): Promise<void> {
  let handlerCalls = 0;
  await withAdapter(() => {
    handlerCalls += 1;
    return new Response("unexpected");
  }, async (origin) => {
    const url = new URL(origin);
    const targets = [
      "http://attacker.invalid/path",
      "/\\attacker.invalid/path",
      "/path#fragment",
    ];
    for (const target of targets) {
      const callsBefore = handlerCalls;
      const closed = deferred<void>();
      const socket = connect(Number(url.port), url.hostname, () => {
        socket.write("GET " + target + " HTTP/1.1\r\nHost: attacker.invalid\r\nConnection: close\r\n\r\n");
      });
      socket.on("data", () => undefined);
      socket.once("error", () => closed.resolve());
      socket.once("close", () => closed.resolve());
      await within(closed.promise, "request-target-refusal");
      if (handlerCalls !== callsBefore) throw new Error("FADENO_ADAPTER_REQUEST_TARGET");
    }
  });
}

async function verifyIpv6AuthorityWhenAvailable(): Promise<void> {
  let observedOrigin: string | undefined;
  let adapter;
  try {
    adapter = await listenNodeHttpAdapter({
      hostname: "::1",
      handler: (request) => {
        observedOrigin = new URL(request.url).origin;
        return new Response("ipv6");
      },
    });
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EADDRNOTAVAIL" || code === "EAFNOSUPPORT") return;
    throw error;
  }
  try {
    if (!adapter.origin.startsWith("http://[::1]:")) throw new Error("FADENO_ADAPTER_IPV6_AUTHORITY");
    if ((await exchange(adapter.origin, "/ipv6")).body !== "ipv6" || observedOrigin !== adapter.origin) {
      throw new Error("FADENO_ADAPTER_IPV6_REQUEST");
    }
  } finally {
    await adapter.close();
  }
}

async function verifyStreamedUpload(): Promise<void> {
  const firstRead = deferred<string>();
  await withAdapter(async (request) => {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("FADENO_ADAPTER_UPLOAD_BODY");
    const first = await reader.read();
    if (first.done) throw new Error("FADENO_ADAPTER_UPLOAD_FIRST");
    firstRead.resolve(new TextDecoder().decode(first.value));
    const remainder: Uint8Array[] = [];
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      remainder.push(next.value);
    }
    const length = remainder.reduce((total, chunk) => total + chunk.byteLength, 0);
    const joined = new Uint8Array(length);
    let offset = 0;
    for (const chunk of remainder) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new Response(new TextDecoder().decode(joined));
  }, async (origin) => {
    const completed = deferred<HttpResult>();
    const request = httpRequest(`${origin}/upload`, { method: "POST" }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => completed.resolve({ body: Buffer.concat(chunks).toString(), headers: response.headers, rawHeaders: response.rawHeaders, status: response.statusCode }));
    });
    request.once("error", completed.reject);
    request.write("first-");
    if (await within(firstRead.promise, "upload-first-read") !== "first-") throw new Error("FADENO_ADAPTER_UPLOAD_BUFFERED");
    request.end("second");
    if ((await within(completed.promise, "upload-complete")).body !== "second") throw new Error("FADENO_ADAPTER_UPLOAD_REMAINDER");
  });
}

async function verifyEarlyFlush(): Promise<void> {
  const releaseSecond = deferred<void>();
  const firstSeen = deferred<void>();
  let phase = 0;
  await withAdapter(() => new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (phase === 0) {
        phase = 1;
        controller.enqueue(new TextEncoder().encode("first-"));
        return;
      }
      await releaseSecond.promise;
      controller.enqueue(new TextEncoder().encode("second"));
      controller.close();
    },
  })), async (origin) => {
    const completed = deferred<string>();
    const request = httpRequest(origin, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        if (Buffer.concat(chunks).toString() === "first-") firstSeen.resolve();
      });
      response.on("end", () => completed.resolve(Buffer.concat(chunks).toString()));
    });
    request.once("error", completed.reject);
    request.end();
    await within(firstSeen.promise, "early-flush");
    releaseSecond.resolve();
    if (await within(completed.promise, "early-flush-complete") !== "first-second") throw new Error("FADENO_ADAPTER_FLUSH_ORDER");
  });
}

async function verifyBackpressure(): Promise<void> {
  const chunk = new Uint8Array(64 * 1024);
  const totalChunks = 1_024;
  let pulls = 0;
  await withAdapter(() => new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(chunk);
      if (pulls === totalChunks) controller.close();
    },
  })), async (origin) => {
    const paused = deferred<void>();
    const completed = deferred<void>();
    const request = httpRequest(origin, (response) => {
      response.pause();
      paused.resolve();
      response.once("error", completed.reject);
      response.once("end", completed.resolve);
      setTimeout(() => response.resume(), 100);
    });
    request.once("error", completed.reject);
    request.end();
    await within(paused.promise, "backpressure-paused");
    await delay(50);
    if (pulls >= totalChunks) throw new Error("FADENO_ADAPTER_BACKPRESSURE");
    await within(completed.promise, "backpressure-complete", 10_000);
    if (pulls !== totalChunks) throw new Error("FADENO_ADAPTER_BACKPRESSURE_COMPLETION");
  });
}

async function verifyDisconnectCancellation(): Promise<void> {
  const handlerEntered = deferred<void>();
  const pulling = deferred<void>();
  const pausedClient = deferred<() => void>();
  const aborted = deferred<void>();
  const cancelled = deferred<void>();
  let pulls = 0;
  await withAdapter((request) => {
    request.signal.addEventListener("abort", () => aborted.resolve(), { once: true });
    handlerEntered.resolve();
    return new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        pulling.resolve();
        controller.enqueue(new Uint8Array(64 * 1024));
      },
      cancel() { cancelled.resolve(); },
    }));
  }, async (origin) => {
    const request = httpRequest(origin, (response) => {
      response.pause();
      response.on("error", () => undefined);
      pausedClient.resolve(() => response.destroy());
    });
    request.on("error", () => undefined);
    request.end();
    await within(handlerEntered.promise, "disconnect-handler");
    await within(pulling.promise, "disconnect-pull");
    const destroyClient = await within(pausedClient.promise, "disconnect-client-paused");
    let stableChecks = 0;
    let previousPulls = -1;
    for (let attempt = 0; attempt < 100 && stableChecks < 3; attempt += 1) {
      await delay(20);
      if (pulls === previousPulls) stableChecks += 1;
      else stableChecks = 0;
      previousPulls = pulls;
    }
    if (stableChecks < 3 || pulls < 2) throw new Error("FADENO_ADAPTER_DISCONNECT_NOT_BACKPRESSURED");
    destroyClient();
    await within(aborted.promise, "disconnect-abort");
    await within(cancelled.promise, "disconnect-cancel");
  });
}

async function verifySuccessfulKeepAliveDoesNotAbort(): Promise<void> {
  const signals: AbortSignal[] = [];
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  await withAdapter((request) => {
    signals.push(request.signal);
    return new Response("ok");
  }, async (origin) => {
    await exchange(origin, "/first", { agent });
    await exchange(origin, "/second", { agent });
    agent.destroy();
    await delay(20);
    if (signals.length !== 2 || signals.some((signal) => signal.aborted)) throw new Error("FADENO_ADAPTER_SUCCESS_ABORTED");
  });
}

async function verifyAbortedUpload(): Promise<void> {
  const firstRead = deferred<void>();
  const aborted = deferred<void>();
  await withAdapter(async (request) => {
    request.signal.addEventListener("abort", () => aborted.resolve(), { once: true });
    const reader = request.body?.getReader();
    if (!reader) throw new Error("FADENO_ADAPTER_ABORT_UPLOAD_BODY");
    await reader.read();
    firstRead.resolve();
    await aborted.promise;
    return new Response(null, { status: 499 });
  }, async (origin) => {
    const request = httpRequest(`${origin}/upload`, { method: "POST" });
    request.on("error", () => undefined);
    request.write("partial");
    await within(firstRead.promise, "abort-upload-first");
    request.destroy();
    await within(aborted.promise, "abort-upload-signal");
  });
}

async function verifyGracefulShutdown(): Promise<void> {
  const release = deferred<void>();
  const firstSeen = deferred<void>();
  let phase = 0;
  const adapter = await listenNodeHttpAdapter({ handler: () => new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (phase === 0) {
        phase = 1;
        controller.enqueue(new TextEncoder().encode("active-"));
        return;
      }
      await release.promise;
      controller.enqueue(new TextEncoder().encode("complete"));
      controller.close();
    },
  })) });
  try {
    const active = deferred<string>();
    const request = httpRequest(adapter.origin, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        firstSeen.resolve();
      });
      response.on("end", () => active.resolve(Buffer.concat(chunks).toString()));
    });
    request.once("error", active.reject);
    request.end();
    await within(firstSeen.promise, "shutdown-active");
    let shutdownResolved = false;
    const shutdown = adapter.close().then(() => { shutdownResolved = true; });
    await delay(30);
    if (shutdownResolved) throw new Error("FADENO_ADAPTER_SHUTDOWN_DROPPED_ACTIVE");
    let refused = false;
    try { await exchange(adapter.origin, "/new"); } catch { refused = true; }
    if (!refused) throw new Error("FADENO_ADAPTER_SHUTDOWN_ACCEPTED_NEW");
    release.resolve();
    if (await within(active.promise, "shutdown-active-complete") !== "active-complete") throw new Error("FADENO_ADAPTER_SHUTDOWN_BODY");
    await within(shutdown, "shutdown-drain");
  } finally {
    release.resolve();
    await adapter.close();
  }
}

async function verifyIdleKeepAliveShutdown(): Promise<void> {
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  const adapter = await listenNodeHttpAdapter({ handler: () => new Response("idle") });
  try {
    await exchange(adapter.origin, "/idle", { agent });
    await within(adapter.close(), "shutdown-idle");
  } finally {
    agent.destroy();
  }
}

const expectedCapabilities = {
  runtime: "node",
  minimumVersion: "22.17.0",
  webRequestResponse: true,
  requestBodyStreaming: true,
  responseBodyStreaming: true,
  responseBackpressure: true,
  disconnectCancellation: true,
  responseTrailers: false,
  requestSizeEnforcement: "none",
  trustedProxyHeaders: false,
  gracefulShutdown: "drain",
};
if (JSON.stringify(nodeHttpAdapterCapabilities) !== JSON.stringify(expectedCapabilities)) throw new Error("FADENO_ADAPTER_CAPABILITIES");
if (process.argv.includes("--require-minimum") && process.versions.node !== nodeHttpAdapterCapabilities.minimumVersion) {
  throw new Error(`FADENO_ADAPTER_MINIMUM_RUNTIME: expected ${nodeHttpAdapterCapabilities.minimumVersion}, received ${process.versions.node}`);
}

await verifyRequestResponseAndCookies();
await verifyAbsoluteRequestTargetRefusal();
await verifyIpv6AuthorityWhenAvailable();
await verifyStreamedUpload();
await verifyEarlyFlush();
await verifyBackpressure();
await verifyDisconnectCancellation();
await verifySuccessfulKeepAliveDoesNotAbort();
await verifyAbortedUpload();
await verifyGracefulShutdown();
await verifyIdleKeepAliveShutdown();

console.log(`V1 Node adapter contract passed (${process.versions.node}; request/response, stream, backpressure, cancellation, shutdown)`);
