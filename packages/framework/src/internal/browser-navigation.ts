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
const unsafeTraversalPersistenceKey = "fadeno.private.navigation.unsafe-traversal.v1";
const historyStateVersion = 1;
const pendingTraversalRecoveryDelayMs = 50;
const maximumRecoveryUrlBytes = 8_192;

type Metadata = Readonly<{ generation: string; epoch: string }>;
type PrivateHistoryState = Readonly<{
  version: 1;
  session: string;
  entry: string;
  scrollX: number;
  scrollY: number;
  elementScroll: boolean;
}>;
type ActiveOperation = Readonly<{
  id: string;
  sequence: number;
  destination: URL;
  currentTruthUrl: string;
  generation: string;
  documentEpoch: string;
  cancellation: AbortController;
}>;

class PrivateDocumentCommitFailure extends Error {
  readonly destinationSelected: boolean;
  readonly restoreFocus: () => void;

  constructor(destinationSelected: boolean, restoreFocus: () => void, cause: unknown) {
    super("FADENO_UPDATE_DOCUMENT_COMMIT", { cause });
    this.name = "PrivateDocumentCommitFailure";
    this.destinationSelected = destinationSelected;
    this.restoreFocus = restoreFocus;
  }
}

export interface PrivateBrowserNavigation {
  close(): void;
}

export interface PrivateUnsafeHistoryEntryTracker {
  mark(entry: string): void;
  requiresReload(entry: string): boolean;
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
const startedDocuments = new WeakSet<Document>();
const applicationRecoveryDocuments = new WeakSet<Document>();

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

export function createPrivateUnsafeHistoryEntryTracker(
  maximumEntries = 256,
): PrivateUnsafeHistoryEntryTracker {
  if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1) {
    throw new TypeError("FADENO_HISTORY_UNSAFE_ENTRY_LIMIT");
  }
  const entries = new Set<string>();
  let overflowed = false;
  return Object.freeze({
    mark(entry: string): void {
      if (overflowed) return;
      entries.add(entry);
      if (entries.size > maximumEntries) {
        entries.clear();
        overflowed = true;
      }
    },
    requiresReload(entry: string): boolean {
      return overflowed || entries.has(entry);
    },
  });
}

function createPrivateUnsafeTraversalPersistence(): Readonly<{
  requireRecovery(session: string, entry: string, url: string, reason: "unsafe-scroll" | "application-owned"): void;
  recoveryReason(session: string, entry: string, url: string): "unsafe-scroll" | "application-owned" | "overflow" | undefined;
  clearRecovery(session: string, entry: string, url: string): void;
  consumeApplicationRecovery(url: string): boolean;
}> {
  type Recovery = Readonly<{
    session: string;
    entry: string;
    url: string;
    reason: "unsafe-scroll" | "application-owned";
  }>;
  type Record = Readonly<{ version: 2; recoveries: readonly Recovery[]; overflowed: boolean }>;
  const maximumRecoveries = 256;
  const validIdentity = (value: unknown): value is string => typeof value === "string"
    && identityPattern.test(value)
    && new TextEncoder().encode(value).byteLength <= 128;
  const validRecoveryUrl = (value: unknown): value is string => typeof value === "string"
    && new TextEncoder().encode(value).byteLength <= maximumRecoveryUrlBytes;
  const validRecovery = (value: unknown): value is Recovery => typeof value === "object" && value !== null
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(["entry", "reason", "session", "url"])
    && validIdentity(Reflect.get(value, "session"))
    && validIdentity(Reflect.get(value, "entry"))
    && validRecoveryUrl(Reflect.get(value, "url"))
    && ["unsafe-scroll", "application-owned"].includes(String(Reflect.get(value, "reason")));
  const decode = (value: string | null): Record | undefined => {
    if (value === null) return Object.freeze({ version: 2, recoveries: Object.freeze([]), overflowed: false });
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed !== "object" || parsed === null
        || JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify(["overflowed", "recoveries", "version"])
        || Reflect.get(parsed, "version") !== 2
        || typeof Reflect.get(parsed, "overflowed") !== "boolean"
        || !Array.isArray(Reflect.get(parsed, "recoveries"))) return undefined;
      const recoveries = Reflect.get(parsed, "recoveries") as unknown[];
      if (recoveries.length > maximumRecoveries || !recoveries.every(validRecovery)
        || new Set(recoveries.map((recovery) => `${Reflect.get(recovery, "session")}\0${Reflect.get(recovery, "entry")}\0${Reflect.get(recovery, "url")}`)).size !== recoveries.length) return undefined;
      return Object.freeze({
        version: 2,
        recoveries: Object.freeze(recoveries.map((recovery) => Object.freeze({ ...(recovery as Recovery) }))),
        overflowed: Reflect.get(parsed, "overflowed") as boolean,
      });
    } catch { return undefined; }
  };
  let record: Record;
  try {
    record = decode(sessionStorage.getItem(unsafeTraversalPersistenceKey))
      ?? Object.freeze({ version: 2, recoveries: Object.freeze([]), overflowed: true });
    sessionStorage.setItem(unsafeTraversalPersistenceKey, JSON.stringify(record));
  } catch {
    record = Object.freeze({ version: 2, recoveries: Object.freeze([]), overflowed: true });
  }
  const persist = (): void => {
    try { sessionStorage.setItem(unsafeTraversalPersistenceKey, JSON.stringify(record)); }
    catch {
      record = Object.freeze({ version: 2, recoveries: Object.freeze([]), overflowed: true });
      try { sessionStorage.setItem(unsafeTraversalPersistenceKey, JSON.stringify(record)); } catch { /* reload will probe again */ }
    }
  };
  return Object.freeze({
    requireRecovery(session, entry, url, reason): void {
      if (record.overflowed || !validIdentity(session) || !validIdentity(entry)) return;
      if (!validRecoveryUrl(url)) {
        record = Object.freeze({ version: 2, recoveries: Object.freeze([]), overflowed: true });
        persist();
        return;
      }
      const existing = record.recoveries.find((recovery) => recovery.session === session && recovery.entry === entry && recovery.url === url);
      if (existing?.reason === "application-owned" || existing?.reason === reason) return;
      const recovery = Object.freeze({ session, entry, url, reason });
      const retained = record.recoveries.filter((candidate) => candidate !== existing);
      record = retained.length >= maximumRecoveries
        ? Object.freeze({ version: 2, recoveries: Object.freeze([]), overflowed: true })
        : Object.freeze({ version: 2, recoveries: Object.freeze([...retained, recovery]), overflowed: false });
      persist();
    },
    recoveryReason(session, entry, url) {
      if (record.overflowed) return "overflow";
      return record.recoveries.find((recovery) => recovery.session === session && recovery.entry === entry && recovery.url === url)?.reason;
    },
    clearRecovery(session, entry, url): void {
      if (record.overflowed) return;
      const recoveries = record.recoveries.filter((recovery) => recovery.session !== session || recovery.entry !== entry || recovery.url !== url);
      if (recoveries.length === record.recoveries.length) return;
      record = Object.freeze({ version: 2, recoveries: Object.freeze(recoveries), overflowed: false });
      persist();
    },
    consumeApplicationRecovery(url): boolean {
      if (record.overflowed) return true;
      const recoveries = record.recoveries.filter((recovery) => recovery.reason !== "application-owned" || recovery.url !== url);
      if (recoveries.length === record.recoveries.length) return false;
      record = Object.freeze({ version: 2, recoveries: Object.freeze(recoveries), overflowed: false });
      persist();
      return true;
    },
  });
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

export function privateLinkPreservationSafe(
  initiator?: HTMLAnchorElement,
  options: Readonly<{ allowDocumentScroll?: boolean }> = {},
): boolean {
  if (!options.allowDocumentScroll && (scrollX !== 0 || scrollY !== 0)) return false;
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
  const documentScroller = document.scrollingElement;
  for (const element of document.querySelectorAll("*")) {
    if (options.allowDocumentScroll && element === documentScroller) continue;
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

function descendantPath(root: Node, descendant: Node): readonly number[] | undefined {
  const reversed: number[] = [];
  let current: Node | null = descendant;
  while (current !== root) {
    const parent: Node | null = current.parentNode;
    if (!parent) return undefined;
    const index = [...parent.childNodes].indexOf(current as ChildNode);
    if (index < 0) return undefined;
    reversed.push(index);
    current = parent;
  }
  return Object.freeze(reversed.reverse());
}

function descendantAtPath(root: Node, path: readonly number[]): HTMLElement | undefined {
  let current: Node = root;
  for (const index of path) {
    const child = current.childNodes.item(index);
    if (!child) return undefined;
    current = child;
  }
  return current instanceof HTMLElement ? current : undefined;
}

function createHistoryState(
  x: number,
  y: number,
  elementScroll: boolean,
  session: string,
  entry = `history:${globalThis.crypto.randomUUID()}`,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    [marker]: true,
    version: historyStateVersion,
    session,
    entry,
    scrollX: x,
    scrollY: y,
    elementScroll,
  });
}

function privateHistoryState(value: unknown): PrivateHistoryState | undefined {
  if (typeof value !== "object" || value === null
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([marker, "elementScroll", "entry", "scrollX", "scrollY", "session", "version"].sort())
    || Reflect.get(value, marker) !== true
    || Reflect.get(value, "version") !== historyStateVersion) return undefined;
  const x = Reflect.get(value, "scrollX");
  const y = Reflect.get(value, "scrollY");
  const session = Reflect.get(value, "session");
  const entry = Reflect.get(value, "entry");
  const elementScroll = Reflect.get(value, "elementScroll");
  if (typeof session !== "string" || !identityPattern.test(session) || new TextEncoder().encode(session).byteLength > 128
    || typeof entry !== "string" || !identityPattern.test(entry) || new TextEncoder().encode(entry).byteLength > 128
    || typeof x !== "number" || typeof y !== "number"
    || !Number.isFinite(x) || !Number.isFinite(y)
    || x < 0 || y < 0 || x > Number.MAX_SAFE_INTEGER || y > Number.MAX_SAFE_INTEGER
    || typeof elementScroll !== "boolean") return undefined;
  return Object.freeze({ version: 1, session, entry, scrollX: x, scrollY: y, elementScroll });
}

function samePrivateHistoryState(left: PrivateHistoryState, right: PrivateHistoryState): boolean {
  return left.version === right.version
    && left.session === right.session
    && left.entry === right.entry
    && left.scrollX === right.scrollX
    && left.scrollY === right.scrollY
    && left.elementScroll === right.elementScroll;
}

function applyDocument(
  next: Document,
  url: string,
  replace: boolean,
  historySession: string,
  previousScrollRestoration: ScrollRestoration,
  validateHistory: (state: PrivateHistoryState, url: string) => boolean,
  writeHistory: Readonly<{
    replace(state: Readonly<Record<string, unknown>>, url: string): void;
    push(state: Readonly<Record<string, unknown>>, url: string): void;
  }>,
  oldFocusPath: readonly number[] | undefined,
): void {
  const oldHead = document.head.cloneNode(true) as HTMLHeadElement;
  const oldBody = document.body.cloneNode(true) as HTMLBodyElement;
  const oldAttributes = document.documentElement.cloneNode(false) as HTMLElement;
  const oldScroll = Object.freeze({ x: scrollX, y: scrollY });
  const restoreFocus = (): void => {
    try {
      if (oldFocusPath) descendantAtPath(document.body, oldFocusPath)?.focus({ preventScroll: true });
    } catch { /* native replacement recovery still owns focus */ }
  };
  const selectedEntry = replace ? privateHistoryState(history.state)?.entry : undefined;
  if (replace && !selectedEntry) throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
  const state = createHistoryState(0, 0, false, historySession, selectedEntry);
  const expectedState = privateHistoryState(state);
  if (!expectedState) throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
  let destinationSelected = false;
  try {
    if (!replace) history.scrollRestoration = previousScrollRestoration;
    if (replace) writeHistory.replace(state, url);
    else writeHistory.push(state, url);
    destinationSelected = true;
    history.scrollRestoration = "manual";
    replaceAttributes(document.documentElement, next.documentElement);
    document.head.replaceChildren(...[...next.head.childNodes].map((node) => document.importNode(node, true)));
    document.body.replaceChildren(...[...next.body.childNodes].map((node) => document.importNode(node, true)));
    focusNewDocument();
    scrollTo({ left: 0, top: 0, behavior: "instant" });
    const committedState = privateHistoryState(history.state);
    if (!committedState
      || !samePrivateHistoryState(committedState, expectedState)
      || !validateHistory(committedState, url)
      || scrollX !== 0
      || scrollY !== 0) throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
  } catch (cause) {
    try {
      try { history.scrollRestoration = "manual"; } catch { /* native fallback will restore ownership */ }
      replaceAttributes(document.documentElement, oldAttributes);
      document.head.replaceChildren(...[...oldHead.childNodes].map((node) => document.importNode(node, true)));
      document.body.replaceChildren(...[...oldBody.childNodes].map((node) => document.importNode(node, true)));
      restoreFocus();
      scrollTo({ left: oldScroll.x, top: oldScroll.y, behavior: "instant" });
    } catch { /* native replacement recovery owns any incomplete local rollback */ }
    throw new PrivateDocumentCommitFailure(destinationSelected, restoreFocus, cause);
  }
}

export function startPrivateLinkNavigation(): PrivateBrowserNavigation | undefined {
  if (document.readyState !== "complete") {
    let closed = false;
    let activeNavigation: PrivateBrowserNavigation | undefined;
    const activate = (): void => {
      if (!closed) activeNavigation = startPrivateLinkNavigation();
    };
    globalThis.addEventListener("pageshow", activate, { once: true });
    return Object.freeze({
      close(): void {
        if (closed) return;
        closed = true;
        globalThis.removeEventListener("pageshow", activate);
        activeNavigation?.close();
      },
    });
  }
  const currentUrl = new URL(location.href);
  const trustworthyLoopback = currentUrl.protocol === "http:"
    && new Set(["127.0.0.1", "localhost", "[::1]"]).has(currentUrl.hostname);
  if (!(currentUrl.protocol === "https:" || trustworthyLoopback)
    || typeof globalThis.crypto?.randomUUID !== "function") return undefined;
  let currentMetadata = metadata(document);
  const existingHistoryState = history.state;
  const existingPrivateState = existingHistoryState === null
    ? undefined
    : privateHistoryState(existingHistoryState);
  if (!currentMetadata || (existingHistoryState !== null && !existingPrivateState)) return undefined;
  const firstStartupForDocument = !startedDocuments.has(document);
  let active: ActiveOperation | undefined;
  let sequence = 0;
  let closed = false;
  let closing = false;
  let traversing = false;
  let traversalSequence = 0;
  let pendingElementScroll = false;
  let historyWriteFailed = false;
  const consumedResultIds: string[] = [];
  const previousScrollRestoration = history.scrollRestoration;
  const historySession = existingPrivateState && !firstStartupForDocument
    ? existingPrivateState.session
    : `session:${globalThis.crypto.randomUUID()}`;
  const unsafeTraversalPersistence = createPrivateUnsafeTraversalPersistence();
  if (applicationRecoveryDocuments.has(document)) return undefined;
  if (firstStartupForDocument && unsafeTraversalPersistence.consumeApplicationRecovery(location.href)) {
    applicationRecoveryDocuments.add(document);
    return undefined;
  }
  const existingRecovery = existingPrivateState
    ? unsafeTraversalPersistence.recoveryReason(existingPrivateState.session, existingPrivateState.entry, location.href)
    : undefined;
  if (existingRecovery === "application-owned" || existingRecovery === "overflow") return undefined;
  const ownedHistoryEntries = new Map<string, Readonly<{ state: PrivateHistoryState; url: string }>>();
  const applicationOwnedHistoryEntries = new Set<string>();
  let historyOwnershipOverflowed = false;
  let internalHistoryWrite = false;
  let historyPushSequence = 0;
  const originalReplaceState = history.replaceState;
  const originalPushState = history.pushState;
  const applicationHistoryKey = (session: string, entry: string, url: string): string => `${session}\0${entry}\0${url}`;
  const retainApplicationHistoryMutation = (): void => {
    if (internalHistoryWrite || closed) return;
    const state = privateHistoryState(history.state);
    if (!state) return;
    if (applicationOwnedHistoryEntries.size >= 256) {
      applicationOwnedHistoryEntries.clear();
      historyOwnershipOverflowed = true;
    } else {
      applicationOwnedHistoryEntries.add(applicationHistoryKey(state.session, state.entry, location.href));
    }
    unsafeTraversalPersistence.requireRecovery(state.session, state.entry, location.href, "application-owned");
  };
  const runtimeReplaceState = (data: unknown, unused: string, url?: string | URL | null): void => {
    originalReplaceState.call(history, data, unused, url);
    retainApplicationHistoryMutation();
  };
  const runtimePushState = (data: unknown, unused: string, url?: string | URL | null): void => {
    originalPushState.call(history, data, unused, url);
    historyPushSequence += 1;
    retainApplicationHistoryMutation();
  };
  history.replaceState = runtimeReplaceState;
  history.pushState = runtimePushState;
  const writeHistory = Object.freeze({
    replace(state: Readonly<Record<string, unknown>>, url: string): void {
      internalHistoryWrite = true;
      try { history.replaceState(state, "", url); }
      finally { internalHistoryWrite = false; }
    },
    push(state: Readonly<Record<string, unknown>>, url: string): void {
      internalHistoryWrite = true;
      try { history.pushState(state, "", url); }
      finally { internalHistoryWrite = false; }
    },
  });
  const rememberHistoryState = (state: PrivateHistoryState, url: string): void => {
    if (historyOwnershipOverflowed) return;
    if (!ownedHistoryEntries.has(state.entry) && ownedHistoryEntries.size >= 256) {
      ownedHistoryEntries.clear();
      historyOwnershipOverflowed = true;
      return;
    }
    ownedHistoryEntries.set(state.entry, Object.freeze({ state, url }));
  };
  const ownsHistoryState = (state: PrivateHistoryState | undefined, url: string): boolean => {
    if (!state || historyOwnershipOverflowed) return false;
    const owned = ownedHistoryEntries.get(state.entry);
    return !applicationOwnedHistoryEntries.has(applicationHistoryKey(state.session, state.entry, url))
      && owned?.url === url
      && samePrivateHistoryState(owned.state, state);
  };
  const restoreScrollRestoration = (): void => {
    try { history.scrollRestoration = previousScrollRestoration; } catch { /* native owner remains authoritative */ }
  };
  try {
    history.scrollRestoration = "manual";
    if (existingHistoryState === null || firstStartupForDocument) {
      const elementScroll = [...document.querySelectorAll("*")].some((element) => element !== document.scrollingElement
        && (element.scrollTop !== 0 || element.scrollLeft !== 0));
      writeHistory.replace(createHistoryState(scrollX, scrollY, elementScroll, historySession), location.href);
    }
    const acquiredState = privateHistoryState(history.state);
    if (!acquiredState || acquiredState.session !== historySession) throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
    rememberHistoryState(acquiredState, location.href);
    if (existingPrivateState && existingRecovery === "unsafe-scroll" && firstStartupForDocument) {
      unsafeTraversalPersistence.clearRecovery(existingPrivateState.session, existingPrivateState.entry, location.href);
    }
  } catch {
    if (history.replaceState === runtimeReplaceState) history.replaceState = originalReplaceState;
    if (history.pushState === runtimePushState) history.pushState = originalPushState;
    restoreScrollRestoration();
    return undefined;
  }
  startedDocuments.add(document);
  let displayedHistoryEntry = privateHistoryState(history.state)?.entry;
  let selectedHistoryEntry = displayedHistoryEntry;
  let displayedTruthUrl = location.href;
  let selectedPushRecovery: Readonly<{
    destination: URL;
    truthUrl: string;
    restoreFocus: (() => void) | undefined;
  }> | undefined;
  const unsafeHistoryEntries = createPrivateUnsafeHistoryEntryTracker();

  const markHistoryUnsafe = (entry: string | undefined): void => {
    if (!entry) return;
    unsafeHistoryEntries.mark(entry);
  };

  const requestsUnloadConfirmation = (event: BeforeUnloadEvent): boolean => {
    const returnValue = Reflect.get(event, "returnValue") as unknown;
    return event.defaultPrevented
      || (typeof returnValue === "string" && returnValue !== "")
      || returnValue === false;
  };
  const observeCancelledDeparture = (guard: () => boolean, repair: () => void): void => {
    let departureCommitted = false;
    const pageHidden = (): void => { departureCommitted = true; };
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (!requestsUnloadConfirmation(event)) return;
      setTimeout(() => {
        globalThis.removeEventListener("pagehide", pageHidden);
        if (!closed && !departureCommitted && guard()) repair();
      }, 0);
    };
    globalThis.addEventListener("pagehide", pageHidden, { once: true });
    globalThis.addEventListener("beforeunload", beforeUnload, { once: true });
  };
  const repairDisplayedTruth = (
    truthUrl: string,
    code: string,
    decision: string,
  ): void => {
    const elementScroll = [...document.querySelectorAll("*")].some((element) => element !== document.scrollingElement
      && (element.scrollTop !== 0 || element.scrollLeft !== 0));
    try {
      const repairedState = createHistoryState(scrollX, scrollY, elementScroll, historySession);
      const repairedPrivateState = privateHistoryState(repairedState);
      if (!repairedPrivateState) throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
      writeHistory.replace(repairedState, truthUrl);
      history.scrollRestoration = "manual";
      rememberHistoryState(repairedPrivateState, truthUrl);
      displayedHistoryEntry = repairedPrivateState.entry;
      selectedHistoryEntry = repairedPrivateState.entry;
      displayedTruthUrl = truthUrl;
      if (scrollX !== 0 || scrollY !== 0 || elementScroll) markHistoryUnsafe(repairedPrivateState.entry);
      recordFlow({
        status: "refused",
        code,
        decisions: Object.freeze([decision, "selected history repaired to displayed document truth"]),
        ownership: Object.freeze({ browser: Object.freeze(["history", "document", "scroll"]), server: Object.freeze([]) }),
        skipped: Object.freeze(["selected destination commit"]),
        outcome: "none",
      });
    } catch {
      historyWriteFailed = true;
      restoreScrollRestoration();
    }
  };
  let recoveringTraversal: number | undefined;
  const recoverSelectedTraversal = (traversal: number, delay = 0): void => {
    active?.cancellation.abort(new DOMException("History traversal requires native recovery", "AbortError"));
    recoveringTraversal = traversal;
    const beginRecovery = (): void => {
      if (closed || traversal !== traversalSequence || recoveringTraversal !== traversal) return;
      restoreScrollRestoration();
      const truthUrl = displayedTruthUrl;
      observeCancelledDeparture(
        () => traversal === traversalSequence && recoveringTraversal === traversal && displayedTruthUrl === truthUrl,
        () => {
          traversalSequence += 1;
          traversing = false;
          recoveringTraversal = undefined;
          repairDisplayedTruth(
            truthUrl,
            "FADENO_UPDATE_NATIVE_RECOVERY_CANCELLED",
            "native traversal reload was cancelled",
          );
        },
      );
      location.replace(location.href);
    };
    if (delay === 0) beginRecovery();
    else setTimeout(beginRecovery, delay);
  };

  const flushCurrentScroll = (force: boolean): boolean => {
    if (closed || traversing || historyWriteFailed) return false;
    const state = privateHistoryState(history.state);
    if (!state || !ownsHistoryState(state, location.href)) return false;
    if (state.elementScroll) {
      pendingElementScroll = false;
      return false;
    }
    const elementScroll = pendingElementScroll;
    if (state.scrollX !== 0 || state.scrollY !== 0) {
      if (!elementScroll) return true;
    }
    if (!force) {
      if (scrollX === 0 && scrollY === 0 && !elementScroll) return true;
    }
    try {
      writeHistory.replace(
        createHistoryState(scrollX, scrollY, elementScroll, historySession, state.entry),
        location.href,
      );
      const writtenState = privateHistoryState(history.state);
      if (!writtenState) throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
      rememberHistoryState(writtenState, location.href);
      selectedHistoryEntry = writtenState.entry;
      pendingElementScroll = false;
      return true;
    } catch {
      historyWriteFailed = true;
      return false;
    }
  };

  const recordCurrentScroll = (event: Event): void => {
    if (closed) return;
    const target = event?.target;
    const elementOwnsScroll = target instanceof Element
      && target !== document.documentElement
      && target !== document.body
      && (target.scrollTop !== 0 || target.scrollLeft !== 0);
    if (traversing) {
      if (scrollX !== 0 || scrollY !== 0 || elementOwnsScroll) {
        markHistoryUnsafe(displayedHistoryEntry);
        if (displayedHistoryEntry) unsafeTraversalPersistence.requireRecovery(historySession, displayedHistoryEntry, displayedTruthUrl, "unsafe-scroll");
        if (active) recoverSelectedTraversal(traversalSequence, pendingTraversalRecoveryDelayMs);
      }
      return;
    }
    pendingElementScroll ||= elementOwnsScroll;
    if (scrollX !== 0 || scrollY !== 0 || elementOwnsScroll) markHistoryUnsafe(displayedHistoryEntry);
    void flushCurrentScroll(false);
  };

  const fallback = (
    destination: URL,
    replace: boolean,
    repairSelectedCommit = false,
    restoreFocus?: () => void,
  ): void => {
    restoreScrollRestoration();
    const truthUrl = displayedTruthUrl;
    const selectedUrl = location.href;
    observeCancelledDeparture(
      () => displayedTruthUrl === truthUrl && location.href === selectedUrl,
      () => {
        if (repairSelectedCommit) {
          traversalSequence += 1;
          traversing = false;
          recoveringTraversal = undefined;
        }
        repairDisplayedTruth(
          truthUrl,
          "FADENO_UPDATE_NATIVE_FALLBACK_CANCELLED",
          repairSelectedCommit
            ? "native post-selection recovery was cancelled"
            : "native fallback was cancelled",
        );
        restoreFocus?.();
      },
    );
    if (replace) location.replace(destination.href);
    else location.assign(destination.href);
  };

  const recoverSelectedPush = (destination: URL, selectedPushCount: number, restoreFocus?: () => void): void => {
    restoreScrollRestoration();
    selectedPushRecovery = Object.freeze({ destination, truthUrl: displayedTruthUrl, restoreFocus });
    history.go(-selectedPushCount);
  };

  const supersedeTraversalForNativeActivation = (code: string, decision: string): boolean => {
    if (!traversing) return false;
    active?.cancellation.abort(new DOMException("Native activation superseded traversal", "AbortError"));
    traversalSequence += 1;
    traversing = false;
    recoveringTraversal = undefined;
    repairDisplayedTruth(displayedTruthUrl, code, decision);
    return true;
  };

  const navigate = async (
    destination: URL,
    replace: boolean,
    initiator?: HTMLAnchorElement,
    selectedHistoryState?: PrivateHistoryState,
  ): Promise<void> => {
    const operationFocusPath = document.activeElement instanceof HTMLElement
      ? descendantPath(document.body, document.activeElement)
      : undefined;
    active?.cancellation.abort(new DOMException("Navigation superseded", "AbortError"));
    if (closed || !currentMetadata || !privateLinkPreservationSafe(initiator, { allowDocumentScroll: true })) {
      fallback(destination, replace);
      return;
    }
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
    let destinationSelected = false;
    let historyPushesBeforeCommit = historyPushSequence;
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
      if (!privateLinkPreservationSafe(initiator, { allowDocumentScroll: true })) throw new TypeError("FADENO_UPDATE_PRESERVATION");
      if (selectedHistoryState) {
        const currentHistoryState = privateHistoryState(history.state);
        if (location.href !== operation.currentTruthUrl
          || !currentHistoryState
          || !samePrivateHistoryState(currentHistoryState, selectedHistoryState)
          || !ownsHistoryState(currentHistoryState, operation.currentTruthUrl)) {
          throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
        }
      }
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
      if (initiator && !flushCurrentScroll(true)) throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
      historyPushesBeforeCommit = historyPushSequence;
      applyDocument(
        next,
        operation.destination.href,
        replace,
        historySession,
        previousScrollRestoration,
        (state, url) => location.href === url
          && !historyOwnershipOverflowed
          && !applicationOwnedHistoryEntries.has(applicationHistoryKey(state.session, state.entry, url)),
        writeHistory,
        operationFocusPath,
      );
      destinationSelected = true;
      const committedState = privateHistoryState(history.state);
      if (!committedState) throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
      rememberHistoryState(committedState, location.href);
      displayedHistoryEntry = committedState.entry;
      selectedHistoryEntry = committedState.entry;
      displayedTruthUrl = location.href;
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
          "destination scroll committed at the native top boundary without transition work",
        ]),
        ownership: Object.freeze({
          browser: Object.freeze(["activation", "operation", "history", "focus", "scroll"]),
          server: Object.freeze(["authorization", "route", "resources", "rendered outcome"]),
        }),
        skipped: Object.freeze(["form interception", "general state reconciliation", "transported script execution", "animation"]),
        outcome: "enhanced-document",
      });
    } catch (cause) {
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
        const documentCommitFailure = cause instanceof PrivateDocumentCommitFailure ? cause : undefined;
        const selectedCommitFailure = destinationSelected || documentCommitFailure?.destinationSelected === true;
        const selectedPushCount = historyPushSequence - historyPushesBeforeCommit;
        if (selectedCommitFailure && !replace && selectedPushCount > 0) {
          recoverSelectedPush(destination, selectedPushCount, documentCommitFailure?.restoreFocus);
        } else {
          fallback(destination, replace || selectedCommitFailure, selectedCommitFailure, documentCommitFailure?.restoreFocus);
        }
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
    const browsingContext = target.getAttribute("target")?.toLowerCase() ?? "";
    if (!target.hasAttribute("download") && ["", "_self"].includes(browsingContext)
      && supersedeTraversalForNativeActivation(
        "FADENO_UPDATE_NATIVE_CLICK_SUPERSESSION",
        "native same-context click superseded a traversal",
      )) return;
    const destination = privateSafeLinkDestination(target);
    if (!destination || !currentMetadata || !privateLinkPreservationSafe(target, { allowDocumentScroll: true })) return;
    const state = privateHistoryState(history.state);
    if (!state || !ownsHistoryState(state, location.href) || state.elementScroll) return;
    if (!flushCurrentScroll(true)) return;
    event.preventDefault();
    void navigate(destination, false, target, state);
  };
  const submit = (event: SubmitEvent): void => {
    if (closed || event.defaultPrevented || !event.isTrusted || !(event.target instanceof HTMLFormElement)) return;
    if (event.target.method.toLowerCase() === "dialog") return;
    const submitterTarget = event.submitter instanceof HTMLElement ? event.submitter.getAttribute("formtarget") : null;
    const browsingContext = (submitterTarget ?? event.target.getAttribute("target") ?? "").toLowerCase();
    if (!["", "_self"].includes(browsingContext)) return;
    supersedeTraversalForNativeActivation(
      "FADENO_UPDATE_NATIVE_FORM_SUPERSESSION",
      "native same-context form submission superseded a traversal",
    );
  };
  const popstate = (): void => {
    if (selectedPushRecovery) {
      const recovery = selectedPushRecovery;
      selectedPushRecovery = undefined;
      traversalSequence += 1;
      traversing = false;
      recoveringTraversal = undefined;
      const rollbackUrl = location.href;
      restoreScrollRestoration();
      setTimeout(() => {
        if (closed || location.href !== rollbackUrl) return;
        try {
          const stagedState = createHistoryState(scrollX, scrollY, false, historySession);
          const stagedPrivateState = privateHistoryState(stagedState);
          if (!stagedPrivateState) throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
          writeHistory.push(stagedState, recovery.destination.href);
          rememberHistoryState(stagedPrivateState, recovery.destination.href);
          observeCancelledDeparture(
            () => location.href === recovery.destination.href,
            () => {
              repairDisplayedTruth(
                recovery.truthUrl,
                "FADENO_UPDATE_NATIVE_FALLBACK_CANCELLED",
                "native post-selection recovery was cancelled",
              );
              recovery.restoreFocus?.();
            },
          );
          location.replace(recovery.destination.href);
        } catch {
          fallback(recovery.destination, false);
        }
      }, 0);
      return;
    }
    const outgoingElementScroll = [...document.querySelectorAll("*")].some((element) => element !== document.scrollingElement
      && (element.scrollTop !== 0 || element.scrollLeft !== 0));
    if (scrollX !== 0 || scrollY !== 0 || pendingElementScroll || outgoingElementScroll) {
      markHistoryUnsafe(displayedHistoryEntry);
      if (displayedHistoryEntry) unsafeTraversalPersistence.requireRecovery(historySession, displayedHistoryEntry, displayedTruthUrl, "unsafe-scroll");
    }
    pendingElementScroll = false;
    traversalSequence += 1;
    const traversal = traversalSequence;
    const state = privateHistoryState(history.state);
    const repeatedSelection = state?.entry === selectedHistoryEntry;
    selectedHistoryEntry = state?.entry;
    traversing = true;
    if (!state || repeatedSelection || !ownsHistoryState(state, location.href) || state.session !== historySession
      || unsafeTraversalPersistence.recoveryReason(state.session, state.entry, location.href) !== undefined || unsafeHistoryEntries.requiresReload(state.entry)
      || state.scrollX !== 0 || state.scrollY !== 0 || state.elementScroll) {
      recoverSelectedTraversal(traversal);
      return;
    }
    void navigate(new URL(location.href), true, undefined, state).finally(() => {
      if (traversal === traversalSequence && recoveringTraversal !== traversal) traversing = false;
    });
  };
  const finishClose = (): void => {
    if (closed) return;
    closed = true;
    closing = false;
    document.removeEventListener("click", click);
    document.removeEventListener("submit", submit);
    document.removeEventListener("scroll", recordCurrentScroll, true);
    if (history.replaceState === runtimeReplaceState) history.replaceState = originalReplaceState;
    if (history.pushState === runtimePushState) history.pushState = originalPushState;
    globalThis.removeEventListener("popstate", popstate);
    globalThis.removeEventListener("pagehide", pagehide);
    globalThis.removeEventListener("pageshow", pageshow);
    restoreScrollRestoration();
  };
  const pagehide = (): void => {
    if (closing) finishClose();
    else restoreScrollRestoration();
  };
  const pageshow = (event: PageTransitionEvent): void => {
    if (!closed && event.persisted) {
      try { history.scrollRestoration = "manual"; }
      catch { historyWriteFailed = true; }
    }
  };
  document.addEventListener("click", click);
  document.addEventListener("submit", submit);
  document.addEventListener("scroll", recordCurrentScroll, true);
  globalThis.addEventListener("popstate", popstate);
  globalThis.addEventListener("pagehide", pagehide);
  globalThis.addEventListener("pageshow", pageshow);
  return Object.freeze({
    close() {
      if (closed || closing) return;
      if (!traversing) {
        active?.cancellation.abort(new DOMException("Browser runtime closed", "AbortError"));
        finishClose();
        return;
      }
      closing = true;
      active?.cancellation.abort(new DOMException("Browser runtime closed", "AbortError"));
      document.removeEventListener("click", click);
      document.removeEventListener("submit", submit);
      document.removeEventListener("scroll", recordCurrentScroll, true);
      const truthUrl = displayedTruthUrl;
      const selectedUrl = location.href;
      observeCancelledDeparture(
        () => closing && displayedTruthUrl === truthUrl && location.href === selectedUrl,
        () => {
          traversalSequence += 1;
          traversing = false;
          recoveringTraversal = undefined;
          repairDisplayedTruth(
            truthUrl,
            "FADENO_UPDATE_NATIVE_CLOSE_CANCELLED",
            "native close recovery was cancelled",
          );
          finishClose();
        },
      );
      restoreScrollRestoration();
      try { location.reload(); }
      catch {
        repairDisplayedTruth(
          truthUrl,
          "FADENO_UPDATE_NATIVE_CLOSE_CANCELLED",
          "native close recovery could not start",
        );
        finishClose();
      }
    },
  });
}
