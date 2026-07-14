import type { ActionDeclaration, RenderChild } from "../index.ts";
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
import { readActionFieldToken, readActionState } from "./action.ts";
import type { ActionFormRendering, ActionRequestContext } from "./action-request.ts";

const encoder = new TextEncoder();
const voidElements = new Set(["area", "br", "col", "hr", "img", "input", "link", "meta", "source", "wbr"]);
const maximumBoundaryBytes = 256 * 1024;

export interface RenderDocumentOptions {
  readonly request: Request;
  readonly status?: number;
  readonly frameworkExecutable?: boolean;
  readonly cleanup?: () => void;
  readonly action?: Readonly<{
    context: ActionRequestContext;
    routeId: string;
    generation: string;
    returnLocation: string;
  }>;
}

type ActiveActionForm = Readonly<{
  declaration: ActionDeclaration<Record<string, unknown>>;
  rendering: ActionFormRendering;
  selectedValue?: string | number;
}>;

function optionValue(properties: Readonly<Record<string, unknown>>, children: RenderChild): string | undefined {
  const explicit = properties["value"];
  if (typeof explicit === "string" || (typeof explicit === "number" && Number.isFinite(explicit))) return String(explicit);
  if (typeof children === "string" || (typeof children === "number" && Number.isFinite(children))) return String(children);
  if (Array.isArray(children)) {
    let value = "";
    for (const child of children) {
      if (typeof child === "string" || (typeof child === "number" && Number.isFinite(child))) value += String(child);
      else if (child !== null && child !== undefined && child !== false && child !== true) return undefined;
    }
    return value;
  }
  return undefined;
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
  action: RenderDocumentOptions["action"],
  form: ActiveActionForm | null,
): Promise<readonly string[]> {
  const chunks: string[] = [];
  let bytes = 0;
  for await (const chunk of renderChild(child, context, signal, nonce, action, form)) {
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
  action: RenderDocumentOptions["action"],
  form: ActiveActionForm | null,
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
  const work = Promise.resolve(child).then((value) => collect(value, context, cancellation.signal, nonce, action, form));
  try {
    return timeout === undefined ? await work : await Promise.race([work, timedOut]);
  } catch {
    void work.catch(() => undefined);
    return collect(payload.fallback, context, parentSignal, nonce, action, form);
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
  action: RenderDocumentOptions["action"],
  form: ActiveActionForm | null,
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
    for (const item of child) yield* renderChild(item, context, signal, nonce, action, form);
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
    yield* renderChild(payload.children, context, signal, nonce, action, form);
    return;
  }
  if (payload.kind === "async") {
    yield* renderChild(await payload.value, context, signal, nonce, action, form);
    return;
  }
  if (payload.kind === "boundary") {
    for (const chunk of await renderBoundary(payload, context, signal, nonce, action, form)) yield chunk;
    return;
  }
  if (payload.kind === "framework-executable") {
    if (nonce === undefined) throw new TypeError("FADENO_RENDER_NONCE_REQUIRED");
    if (!/^[A-Za-z0-9_-]+$/u.test(nonce)) throw new TypeError("FADENO_RENDER_NONCE_VALUE");
    yield `<script nonce="${nonce}">${payload.source}</script>`;
    return;
  }
  let properties = payload.properties;
  let childForm = form;
  let children = payload.children;
  let fieldError: string | undefined;
  if (payload.element === "form") {
    if (form) throw new TypeError("FADENO_ACTION_NESTED_FORM");
    const declarationState = readActionState(properties["action"]);
    if (declarationState) {
      if (!action || action.generation !== action.context.applicationGeneration) throw new TypeError("FADENO_ACTION_RUNTIME");
      if (properties["method"] !== undefined || properties["enctype"] !== undefined) throw new TypeError("FADENO_ACTION_FORM_OWNERSHIP");
      const rendering = action.context.renderForm(
        declarationState.declaration,
        action.routeId,
        action.returnLocation,
      );
      childForm = Object.freeze({ declaration: declarationState.declaration, rendering });
      properties = Object.freeze({
        ...properties,
        action: rendering.actionUrl,
        method: "post",
        enctype: rendering.encoding,
      });
    }
  } else if (properties["name"] !== undefined && readActionFieldToken(properties["name"])) {
    const field = readActionFieldToken(properties["name"]);
    if (!field || !form || field.action !== form.declaration || !["button", "input", "textarea", "select"].includes(payload.element)) {
      throw new TypeError("FADENO_ACTION_FIELD_TOKEN");
    }
    const generatedName = action?.context.fieldName(properties["name"] as never);
    if (!generatedName) throw new TypeError("FADENO_ACTION_RUNTIME");
    const descriptor = readActionState(form.declaration)?.descriptors[field.logicalName];
    if (!descriptor) throw new TypeError("FADENO_ACTION_FIELD_TOKEN");
    const inputType = String(properties["type"] ?? "text").toLowerCase();
    if (payload.element === "select" && properties["multiple"] === true) {
      throw new TypeError("FADENO_ACTION_MULTI_VALUE_UNSUPPORTED");
    }
    if (descriptor.kind === "checkbox" && (payload.element !== "input" || inputType !== "checkbox")) {
      throw new TypeError("FADENO_ACTION_FIELD_CONTROL");
    }
    const submitted = form.rendering.failure?.fields[field.logicalName];
    fieldError = form.rendering.failure?.fieldErrors[field.logicalName];
    const next: Record<string, unknown> = { ...properties, name: generatedName };
    if (fieldError) {
      next["aria-invalid"] = "true";
      next["aria-describedby"] = `fadeno-error-${generatedName}`;
    }
    if (payload.element === "input") {
      if (descriptor.kind === "checkbox") {
        next["value"] = "on";
        if (typeof submitted === "boolean") next["checked"] = submitted;
      }
      else if (
        !["file", "password"].includes(inputType) &&
        (typeof submitted === "string" || typeof submitted === "number")
      ) next["value"] = submitted;
    } else if (payload.element === "textarea" && typeof submitted === "string") children = submitted;
    else if (payload.element === "select" && (typeof submitted === "string" || typeof submitted === "number")) {
      childForm = Object.freeze({ ...form, selectedValue: submitted });
    }
    properties = Object.freeze(next);
  } else if (payload.element === "option" && form?.selectedValue !== undefined) {
    const value = optionValue(properties, children);
    if (value !== undefined) properties = Object.freeze({ ...properties, selected: value === String(form.selectedValue) });
  }
  const attributes = renderAttributes(payload.element, properties);
  yield `<${payload.element}${attributes}>`;
  if (payload.element === "form" && childForm) {
    yield `<input type="hidden" name="${proofFieldName()}" value="${encodeAttribute("input", "value", childForm.rendering.proof)}">`;
    const formErrors = childForm.rendering.failure?.formErrors ?? [];
    if (formErrors.length > 0) {
      yield "<ul role=\"alert\">";
      for (const error of formErrors) yield `<li>${encodeText(error, "html-text")}</li>`;
      yield "</ul>";
    }
  }
  if (voidElements.has(payload.element)) {
    if (fieldError && childForm) yield `<p id="fadeno-error-${action?.context.fieldName(payload.properties["name"] as never)}">${encodeText(fieldError, "html-text")}</p>`;
    return;
  }
  yield* renderChild(children, childContext(payload.element), signal, nonce, action, childForm);
  yield `</${payload.element}>`;
  if (fieldError && childForm) yield `<p id="fadeno-error-${action?.context.fieldName(payload.properties["name"] as never)}">${encodeText(fieldError, "html-text")}</p>`;
}

function proofFieldName(): string { return "__fadeno_proof"; }

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
    yield* renderChild(node, "html-text", options.request.signal, head.nonce, options.action, null);
  })();
  return new Response(stream, { status: head.status, headers: head.headers });
}
