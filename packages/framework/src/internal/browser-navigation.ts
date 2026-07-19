import {
  admitPrivateUpdateBytes,
  V2_PATCH_PROTOCOL_LIMITS,
  type PrivateDecodedUpdateOutcome,
} from "./browser-update.ts";

const mediaType = "application/vnd.fadeno.private-update+json; version=1";
const generationMeta = "fadeno-application-generation";
const epochMeta = "fadeno-document-epoch";
const identityPattern = /^[A-Za-z0-9][A-Za-z0-9:._/-]*$/u;
const marker = "fadeno.private.navigation.v1";

type Metadata = Readonly<{ generation: string; epoch: string }>;
type ActiveOperation = Readonly<{
  id: string;
  sequence: number;
  destination: URL;
  currentTruthUrl: string;
  generation: string;
  documentEpoch: string;
  cancellation: AbortController;
}>;

export interface PrivateBrowserNavigation {
  close(): void;
}

export type PrivateLinkNavigationFlow = Readonly<{
  schema: "fadeno.private.link-navigation-flow";
  version: 1;
  status: "applied" | "cancelled" | "refused";
  code: string;
  redaction: "applied";
  decisions: readonly string[];
  ownership: Readonly<{ browser: readonly string[]; server: readonly string[] }>;
  skipped: readonly string[];
  outcome: "enhanced-document" | "native-navigation" | "none";
}>;

const flows: PrivateLinkNavigationFlow[] = [];

function recordFlow(input: Omit<PrivateLinkNavigationFlow, "schema" | "version" | "redaction">): void {
  flows.push(Object.freeze({
    schema: "fadeno.private.link-navigation-flow",
    version: 1,
    redaction: "applied",
    ...input,
  }));
  if (flows.length > 64) flows.shift();
}

export function readPrivateLinkNavigationFlows(): readonly PrivateLinkNavigationFlow[] {
  return Object.freeze(flows.map((flow) => Object.freeze({
    ...flow,
    decisions: Object.freeze([...flow.decisions]),
    ownership: Object.freeze({
      browser: Object.freeze([...flow.ownership.browser]),
      server: Object.freeze([...flow.ownership.server]),
    }),
    skipped: Object.freeze([...flow.skipped]),
  })));
}

function metadata(owner: Document): Metadata | undefined {
  const generation = owner.querySelectorAll(`meta[name="${generationMeta}"]`);
  const epoch = owner.querySelectorAll(`meta[name="${epochMeta}"]`);
  if (generation.length !== 1 || epoch.length !== 1) return undefined;
  const generationValue = generation[0]?.getAttribute("content") ?? "";
  const epochValue = epoch[0]?.getAttribute("content") ?? "";
  if (!identityPattern.test(generationValue)
    || !identityPattern.test(epochValue)
    || new TextEncoder().encode(generationValue).byteLength > 128
    || new TextEncoder().encode(epochValue).byteLength > 128) return undefined;
  return Object.freeze({ generation: generationValue, epoch: epochValue });
}

export function privateSafeLinkDestination(anchor: HTMLAnchorElement): URL | undefined {
  if (!anchor.hasAttribute("href")
    || anchor.hasAttribute("download")
    || !["", "_self"].includes(anchor.getAttribute("target")?.toLowerCase() ?? "")
    || anchor.relList.contains("external")) return undefined;
  let destination: URL;
  try { destination = new URL(anchor.href, location.href); }
  catch { return undefined; }
  const current = new URL(location.href);
  const loopback = current.protocol === "http:" && new Set(["127.0.0.1", "localhost", "[::1]"]).has(current.hostname);
  if (!(current.protocol === "https:" || loopback)
    || destination.protocol !== current.protocol
    || destination.origin !== current.origin
    || destination.username !== ""
    || destination.password !== "") return undefined;
  if (destination.hash !== "") return undefined;
  if (destination.pathname === current.pathname
    && destination.search === current.search
    && destination.hash !== current.hash) return undefined;
  return destination;
}

function dirtyControl(control: Element): boolean {
  if (control instanceof HTMLInputElement) {
    if (["checkbox", "radio"].includes(control.type)) return control.checked !== control.defaultChecked;
    if (["button", "submit", "reset", "image", "hidden"].includes(control.type)) return false;
    return control.value !== control.defaultValue;
  }
  if (control instanceof HTMLTextAreaElement) return control.value !== control.defaultValue;
  if (control instanceof HTMLSelectElement) {
    return [...control.options].some((option) => option.selected !== option.defaultSelected);
  }
  return false;
}

export function privateLinkPreservationSafe(initiator?: HTMLAnchorElement): boolean {
  if (scrollX !== 0 || scrollY !== 0) return false;
  if ([...document.querySelectorAll("input, textarea, select")].some(dirtyControl)) return false;
  if (document.querySelector("details[open], dialog[open], audio, video, [data-fadeno-client-owned], [data-fadeno-island], [contenteditable]:not([contenteditable=\"false\"])") !== null) return false;
  try { if (document.querySelector(":popover-open") !== null) return false; } catch { /* unsupported selector has no open popover state */ }
  const selection = document.getSelection();
  if (selection && !selection.isCollapsed) return false;
  const active = document.activeElement;
  const runtimeFocus = active instanceof HTMLElement
    && active === (document.querySelector("h1") ?? document.querySelector("main"))
    && active.getAttribute("data-fadeno-navigation-focus") === "";
  if (active && active !== document.body && active !== document.documentElement && active !== initiator && !runtimeFocus) return false;
  for (const element of document.querySelectorAll("*")) {
    if (element.scrollTop !== 0 || element.scrollLeft !== 0) return false;
  }
  return true;
}

async function boundedBytes(response: Response, signal: AbortSignal): Promise<Uint8Array | undefined> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) return undefined;
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > V2_PATCH_PROTOCOL_LIMITS.maximumBytes) return undefined;
      chunks.push(next.value);
    }
  } finally {
    if (signal.aborted || total > V2_PATCH_PROTOCOL_LIMITS.maximumBytes) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function nextDocument(outcome: Extract<PrivateDecodedUpdateOutcome, { kind: "document" | "expected-error" }>, generation: string): Document | undefined {
  if (outcome.root.identity !== "fadeno-document-root") return undefined;
  const parsed = new DOMParser().parseFromString(outcome.root.html, "text/html");
  const nextMetadata = metadata(parsed);
  if (!parsed.documentElement || !parsed.head || !parsed.body
    || parsed.querySelectorAll("html").length !== 1
    || parsed.title !== outcome.title
    || !nextMetadata
    || nextMetadata.generation !== generation) return undefined;
  return parsed;
}

function replaceAttributes(target: Element, source: Element): void {
  for (const name of target.getAttributeNames()) target.removeAttribute(name);
  for (const name of source.getAttributeNames()) target.setAttribute(name, source.getAttribute(name) ?? "");
}

function focusNewDocument(): void {
  const target = document.querySelector<HTMLElement>("h1") ?? document.querySelector<HTMLElement>("main") ?? document.body;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.setAttribute("data-fadeno-navigation-focus", "");
  target.focus({ preventScroll: true });
}

function applyDocument(next: Document, url: string, replace: boolean): void {
  const oldHead = document.head.cloneNode(true) as HTMLHeadElement;
  const oldBody = document.body.cloneNode(true) as HTMLBodyElement;
  const oldAttributes = document.documentElement.cloneNode(false) as HTMLElement;
  try {
    replaceAttributes(document.documentElement, next.documentElement);
    document.head.replaceChildren(...[...next.head.childNodes].map((node) => document.importNode(node, true)));
    document.body.replaceChildren(...[...next.body.childNodes].map((node) => document.importNode(node, true)));
    focusNewDocument();
    const state = Object.freeze({ [marker]: true });
    if (replace) history.replaceState(state, "", url);
    else history.pushState(state, "", url);
  } catch (cause) {
    replaceAttributes(document.documentElement, oldAttributes);
    document.head.replaceChildren(...[...oldHead.childNodes].map((node) => document.importNode(node, true)));
    document.body.replaceChildren(...[...oldBody.childNodes].map((node) => document.importNode(node, true)));
    throw cause;
  }
}

function markedHistoryState(value: unknown): boolean {
  return typeof value === "object" && value !== null && Reflect.get(value, marker) === true;
}

export function startPrivateLinkNavigation(): PrivateBrowserNavigation | undefined {
  let currentMetadata = metadata(document);
  if (!currentMetadata || history.state !== null) return undefined;
  let active: ActiveOperation | undefined;
  let sequence = 0;
  let closed = false;
  const consumedResultIds: string[] = [];
  history.replaceState(Object.freeze({ [marker]: true }), "", location.href);

  const fallback = (destination: URL, replace: boolean): void => {
    if (replace) location.replace(destination.href);
    else location.assign(destination.href);
  };

  const navigate = async (destination: URL, replace: boolean, initiator?: HTMLAnchorElement): Promise<void> => {
    if (closed || !currentMetadata || !privateLinkPreservationSafe(initiator)) {
      fallback(destination, replace);
      return;
    }
    active?.cancellation.abort(new DOMException("Navigation superseded", "AbortError"));
    sequence += 1;
    const operation: ActiveOperation = Object.freeze({
      id: `nav:${globalThis.crypto.randomUUID()}`,
      sequence,
      destination,
      currentTruthUrl: location.href,
      generation: currentMetadata.generation,
      documentEpoch: currentMetadata.epoch,
      cancellation: new AbortController(),
    });
    active = operation;
    try {
      const response = await fetch(destination.href, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "manual",
        signal: operation.cancellation.signal,
        headers: {
          accept: mediaType,
          "x-fadeno-current-url": operation.currentTruthUrl,
          "x-fadeno-document-epoch": operation.documentEpoch,
          "x-fadeno-operation-id": operation.id,
          "x-fadeno-operation-sequence": String(operation.sequence),
        },
      });
      if (!response.ok || response.headers.get("content-type") !== mediaType) throw new TypeError("FADENO_UPDATE_TRANSPORT");
      const bytes = await boundedBytes(response, operation.cancellation.signal);
      if (!bytes) throw new TypeError("FADENO_UPDATE_LIMIT");
      const admission = admitPrivateUpdateBytes(bytes, {
        origin: location.origin,
        currentTruthUrl: operation.currentTruthUrl,
        transport: Object.freeze({ requestCache: "no-store", responseCacheControl: response.headers.get("cache-control") }),
        generation: operation.generation,
        documentEpoch: operation.documentEpoch,
        currentOperation: Object.freeze({ id: operation.id, sequence: operation.sequence, kind: "navigation", url: operation.destination.href }),
        consumedResultIds: Object.freeze([...consumedResultIds]),
        requestCommitted: false,
      }, { signal: operation.cancellation.signal });
      if (active !== operation || operation.cancellation.signal.aborted || admission.decision.status !== "accepted" || !admission.outcome || !admission.resultId) {
        throw new TypeError(admission.decision.code);
      }
      if (!privateLinkPreservationSafe(initiator)) throw new TypeError("FADENO_UPDATE_PRESERVATION");
      if (admission.outcome.kind === "redirect") {
        const redirect = new URL(admission.outcome.location, location.origin);
        fallback(redirect, replace);
        return;
      }
      if (admission.outcome.kind === "recover") {
        fallback(new URL(operation.currentTruthUrl), true);
        return;
      }
      const next = nextDocument(admission.outcome, operation.generation);
      if (!next) throw new TypeError("FADENO_UPDATE_DOCUMENT_SHELL");
      applyDocument(next, operation.destination.href, replace);
      consumedResultIds.push(admission.resultId);
      if (consumedResultIds.length > 256) consumedResultIds.shift();
      currentMetadata = metadata(document);
      if (!currentMetadata) throw new TypeError("FADENO_UPDATE_DOCUMENT_METADATA");
      recordFlow({
        status: "applied",
        code: admission.decision.code,
        decisions: Object.freeze([
          "eligible same-origin GET acquired browser operation ownership",
          "exact native server response was projected once",
          "current generation, epoch, operation, URL, cache, and result were admitted",
          "document, title, URL, history, and focus committed",
        ]),
        ownership: Object.freeze({
          browser: Object.freeze(["activation", "operation", "history", "focus"]),
          server: Object.freeze(["authorization", "route", "resources", "rendered outcome"]),
        }),
        skipped: Object.freeze(["form interception", "general state reconciliation", "transported script execution"]),
        outcome: "enhanced-document",
      });
    } catch {
      if (active === operation && !operation.cancellation.signal.aborted) {
        recordFlow({
          status: "refused",
          code: "FADENO_UPDATE_NATIVE_RECOVERY",
          decisions: Object.freeze(["enhanced GET could not commit", "native destination retained"]),
          ownership: Object.freeze({
            browser: Object.freeze(["activation", "operation"]),
            server: Object.freeze(["authorization", "rendered outcome"]),
          }),
          skipped: Object.freeze(["document commit"]),
          outcome: "native-navigation",
        });
        fallback(destination, replace);
      } else if (operation.cancellation.signal.aborted) {
        recordFlow({
          status: "cancelled",
          code: "FADENO_UPDATE_CANCELLED",
          decisions: Object.freeze(["older operation was superseded", "obsolete result was not published"]),
          ownership: Object.freeze({
            browser: Object.freeze(["operation", "cancellation"]),
            server: Object.freeze(["request cancellation"]),
          }),
          skipped: Object.freeze(["document commit", "history commit", "focus commit"]),
          outcome: "none",
        });
      }
    } finally {
      if (active === operation) active = undefined;
    }
  };

  const click = (event: MouseEvent): void => {
    if (closed || event.defaultPrevented || !event.isTrusted || event.button !== 0
      || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(target instanceof HTMLAnchorElement)) return;
    const destination = privateSafeLinkDestination(target);
    if (!destination || !currentMetadata || !privateLinkPreservationSafe(target)) return;
    event.preventDefault();
    void navigate(destination, false, target);
  };
  const popstate = (): void => {
    if (!markedHistoryState(history.state)) return;
    void navigate(new URL(location.href), true);
  };
  document.addEventListener("click", click);
  globalThis.addEventListener("popstate", popstate);
  return Object.freeze({
    close() {
      if (closed) return;
      closed = true;
      active?.cancellation.abort(new DOMException("Browser runtime closed", "AbortError"));
      document.removeEventListener("click", click);
      globalThis.removeEventListener("popstate", popstate);
    },
  });
}
