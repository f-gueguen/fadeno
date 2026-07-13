import type { RenderChild } from "../index.ts";
import {
  classifySink,
  encodeAttribute,
  encodeBoolean,
  encodeEnumerated,
  encodeText,
  encodeUrl,
  type TextContext,
  type UrlSink,
} from "./rendering-security.ts";
import { readRenderNode } from "./render-node.ts";
import { readUnsafeHtml } from "./unsafe-html.ts";
import { StreamingLifecycle } from "./streaming-lifecycle.ts";
import { captureRequestFailureObserver, reportFrameworkFailure } from "./failure-observer.ts";
import { readResourceError } from "./resource.ts";

const encoder = new TextEncoder();
const voidElements = new Set(["area", "br", "col", "hr", "img", "input", "link", "meta", "source", "wbr"]);
const maximumBoundaryBytes = 256 * 1024;

export interface RenderDocumentOptions {
  readonly request: Request;
  readonly status?: number;
  readonly frameworkExecutable?: boolean;
  readonly cleanup?: () => void;
}

function childContext(element: string): TextContext {
  return classifySink(element) as TextContext;
}

function ordinaryValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new TypeError("FADENO_RENDER_ATTRIBUTE_VALUE");
}

function renderAttributes(element: string, properties: Readonly<Record<string, unknown>>): string {
  let output = "";
  for (const attribute of Object.keys(properties).sort()) {
    const value = properties[attribute];
    if (value === undefined || value === null) continue;
    const sink = classifySink(element, attribute);
    if (sink === "boolean-attribute") {
      const encoded = encodeBoolean(element, attribute, value as boolean);
      if (encoded) output += ` ${encoded}`;
      continue;
    }
    let encoded: string;
    if (sink === "url-attribute") encoded = encodeUrl(value as string, `${element}.${attribute}` as UrlSink);
    else if (sink === "enumerated-attribute") encoded = encodeEnumerated(element, attribute, value as string);
    else encoded = encodeAttribute(element, attribute, ordinaryValue(value));
    output += ` ${attribute}="${encoded}"`;
  }
  return output;
}

function abortError(): DOMException {
  return new DOMException("Rendering cancelled", "AbortError");
}

async function collect(
  child: RenderChild,
  context: TextContext,
  signal: AbortSignal,
  nonce: string | undefined,
): Promise<readonly string[]> {
  const chunks: string[] = [];
  let bytes = 0;
  for await (const chunk of renderChild(child, context, signal, nonce)) {
    bytes += encoder.encode(chunk).byteLength;
    if (bytes > maximumBoundaryBytes) throw new TypeError("FADENO_RENDER_BOUNDARY_LIMIT");
    chunks.push(chunk);
  }
  return chunks;
}

async function renderBoundary(
  payload: Extract<NonNullable<ReturnType<typeof readRenderNode>>, { kind: "boundary" }>,
  context: TextContext,
  parentSignal: AbortSignal,
  nonce: string | undefined,
): Promise<readonly string[]> {
  const cancellation = new AbortController();
  const cancelFromParent = (): void => cancellation.abort(parentSignal.reason ?? abortError());
  parentSignal.addEventListener("abort", cancelFromParent, { once: true });
  if (parentSignal.aborted) cancelFromParent();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timeoutFailure: ((reason: unknown) => void) | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => { timeoutFailure = reject; });
  if (payload.timeoutMilliseconds !== undefined) {
    if (!Number.isFinite(payload.timeoutMilliseconds) || payload.timeoutMilliseconds <= 0) {
      throw new TypeError("FADENO_RENDER_BOUNDARY_TIMEOUT");
    }
    timeout = setTimeout(() => {
      const error = new DOMException("Boundary timed out", "TimeoutError");
      cancellation.abort(error);
      timeoutFailure?.(error);
    }, payload.timeoutMilliseconds);
  }
  const child = typeof payload.children === "function" ? payload.children(cancellation.signal) : payload.children;
  const work = Promise.resolve(child).then((value) => collect(value, context, cancellation.signal, nonce));
  try {
    return timeout === undefined ? await work : await Promise.race([work, timedOut]);
  } catch {
    void work.catch(() => undefined);
    return collect(payload.fallback, context, parentSignal, nonce);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    parentSignal.removeEventListener("abort", cancelFromParent);
    if (!cancellation.signal.aborted) cancellation.abort("boundary-complete");
  }
}

async function* renderChild(
  child: RenderChild,
  context: TextContext,
  signal: AbortSignal,
  nonce: string | undefined,
): AsyncGenerator<string, void, void> {
  if (signal.aborted) throw abortError();
  if (child === undefined || child === null || typeof child === "boolean") return;
  if (typeof child === "string") {
    yield encodeText(child, context);
    return;
  }
  if (typeof child === "number") {
    if (!Number.isFinite(child)) throw new TypeError("FADENO_RENDER_NUMBER");
    yield encodeText(String(child), context);
    return;
  }
  if (typeof child === "symbol" || typeof child === "bigint" || typeof child === "function") {
    throw new TypeError("FADENO_RENDER_CHILD");
  }
  if (Array.isArray(child)) {
    for (const item of child) yield* renderChild(item, context, signal, nonce);
    return;
  }
  const raw = readUnsafeHtml(child);
  if (raw) {
    yield raw.html;
    return;
  }
  const payload = readRenderNode(child);
  if (!payload) throw new TypeError("FADENO_RENDER_CHILD");
  if (payload.kind === "fragment") {
    yield* renderChild(payload.children, context, signal, nonce);
    return;
  }
  if (payload.kind === "async") {
    yield* renderChild(await payload.value, context, signal, nonce);
    return;
  }
  if (payload.kind === "boundary") {
    for (const chunk of await renderBoundary(payload, context, signal, nonce)) yield chunk;
    return;
  }
  if (payload.kind === "framework-executable") {
    if (nonce === undefined) throw new TypeError("FADENO_RENDER_NONCE_REQUIRED");
    if (!/^[A-Za-z0-9_-]+$/u.test(nonce)) throw new TypeError("FADENO_RENDER_NONCE_VALUE");
    yield `<script nonce="${nonce}">${payload.source}</script>`;
    return;
  }
  const attributes = renderAttributes(payload.element, payload.properties);
  yield `<${payload.element}${attributes}>`;
  if (voidElements.has(payload.element)) return;
  yield* renderChild(payload.children, childContext(payload.element), signal, nonce);
  yield `</${payload.element}>`;
}

function assertDocument(node: RenderChild): void {
  const payload = readRenderNode(node);
  if (payload?.kind !== "element" || payload.element !== "html") {
    throw new TypeError("FADENO_RENDER_DOCUMENT_ROOT");
  }
}

function contentSecurityPolicy(nonce: string | undefined): string {
  const script = nonce === undefined ? "script-src 'none'; " : `script-src 'nonce-${nonce}'; `;
  return `default-src 'none'; ${script}base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
}

export function renderDocument(node: RenderChild, options: RenderDocumentOptions): Response {
  assertDocument(node);
  const failureObserver = captureRequestFailureObserver(options.request);
  let terminalCause: unknown;
  let terminalIncidentId: string | undefined;
  let iterator: AsyncGenerator<string, void, void> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let pulling = false;
  const sink = {
    write(chunk: Uint8Array): void {
      if (!controller) throw new TypeError("FADENO_RENDER_STREAM_CONTROLLER");
      controller.enqueue(chunk);
    },
    close(): void { controller?.close(); },
    abort(reason: string): void { controller?.error(new TypeError(`FADENO_RENDER_STREAM_${reason.toUpperCase().replaceAll("-", "_")}`)); },
  };
  const lifecycle = new StreamingLifecycle({
    sink,
    signal: options.request.signal,
    ...(options.cleanup ? { cleanup: options.cleanup } : {}),
    reporter: {
      report(code) {
        if (terminalIncidentId) {
          reportFrameworkFailure(
            failureObserver,
            options.request,
            terminalIncidentId,
            "post-publication",
            `FADENO_RENDER_${code.toUpperCase().replaceAll("-", "_")}`,
            terminalCause,
          );
        }
      },
    },
  });
  const stream = new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    async pull() {
      if (pulling) throw new TypeError("FADENO_RENDER_STREAM_PULL");
      pulling = true;
      try {
        if (!iterator) throw new TypeError("FADENO_RENDER_STREAM_ITERATOR");
        const next = await iterator.next();
        if (next.done === true) await lifecycle.complete();
        else await lifecycle.write(encoder.encode(next.value as string));
      } catch (cause) {
        terminalCause = cause;
        await iterator?.return(undefined).catch(() => undefined);
        if (readResourceError(cause)) await lifecycle.fail("expected");
        else {
          terminalIncidentId ??= globalThis.crypto.randomUUID();
          await lifecycle.fail("unexpected");
        }
      } finally {
        pulling = false;
      }
    },
    async cancel() {
      await iterator?.return(undefined).catch(() => undefined);
      await lifecycle.cancel("disconnect");
    },
  }, { highWaterMark: 0 });
  const head = lifecycle.publishHead({
    status: options.status ?? 200,
    executableMarkup: options.frameworkExecutable === true,
    headers: (nonce) => ({
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": contentSecurityPolicy(nonce),
      "x-content-type-options": "nosniff",
    }),
  });
  iterator = (async function* document(): AsyncGenerator<string, void, void> {
    yield "<!doctype html>";
    yield* renderChild(node, "html-text", options.request.signal, head.nonce);
  })();
  return new Response(stream, { status: head.status, headers: head.headers });
}
