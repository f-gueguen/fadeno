import {
  admitPrivateUpdateBytes,
  V2_PATCH_PROTOCOL_LIMITS,
  type PrivateDecodedUpdateOutcome,
} from "./browser-update.ts";
import {
  privateFormEligibility,
  privateNativeGetFormDestination,
  privateFormPreservationSafe,
  privateFormRequest,
  type PrivateFormEligibility,
} from "./browser-form.ts";

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
  kind: "navigation" | "mutation";
  id: string;
  sequence: number;
  destination: URL;
  currentTruthUrl: string;
  generation: string;
  documentEpoch: string;
  cancellation: AbortController;
  recoverCancelledMutation: (() => void) | undefined;
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
  state(): "active" | "closing" | "closed";
  close(): void;
}

export interface PrivateUnsafeHistoryEntryTracker {
  mark(entry: string): void;
  requiresReload(entry: string): boolean;
}

export type PrivateFragmentReloadOwner = Readonly<{
  href: string;
  replace(destination: string): void;
  reload(): void;
}>;

export function privateReloadFragmentDestination(
  owner: PrivateFragmentReloadOwner,
  destination: URL,
  reloadCurrentEntry: () => void = () => owner.reload(),
): void {
  if (owner.href !== destination.href) owner.replace(destination.href);
  if (destination.hash === "" && destination.href.includes("#")) reloadCurrentEntry();
  else owner.reload();
}

export function privateFragmentReloadRecoveryMode(
  stageDestination: "replace" | "push" | "none",
  pushedDestination: boolean,
): "rollback-staged-entry" | "repair-current-entry" {
  return stageDestination === "push" && pushedDestination
    ? "rollback-staged-entry"
    : "repair-current-entry";
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

export type PrivateFormSubmissionFlow = Readonly<{
  schema: "fadeno.private.form-submission-flow";
  version: 1;
  status: "applied" | "cancelled" | "refused";
  code: string;
  operation: "navigation" | "mutation";
  redaction: "applied";
  decisions: readonly string[];
  ownership: Readonly<{ browser: readonly string[]; server: readonly string[] }>;
  skipped: readonly string[];
  outcome: "enhanced-document" | "enhanced-redirect" | "native-navigation" | "current-truth-reload" | "none";
}>;

const flows: PrivateLinkNavigationFlow[] = [];
const formFlows: PrivateFormSubmissionFlow[] = [];
const startedDocuments = new WeakSet<Document>();
const applicationRecoveryDocuments = new WeakMap<Document, number>();

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

function recordFormFlow(input: Omit<PrivateFormSubmissionFlow, "schema" | "version" | "redaction">): void {
  formFlows.push(Object.freeze({
    schema: "fadeno.private.form-submission-flow",
    version: 1,
    redaction: "applied",
    ...input,
  }));
  if (formFlows.length > 64) formFlows.shift();
}

export function readPrivateFormSubmissionFlows(): readonly PrivateFormSubmissionFlow[] {
  return Object.freeze(formFlows.map((flow) => Object.freeze({
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
  refresh(): boolean;
  requireRecovery(session: string, entry: string, url: string, reason: "unsafe-scroll" | "application-owned"): void;
  recoveryReason(session: string, entry: string, url: string): "unsafe-scroll" | "application-owned" | "overflow" | undefined;
  clearRecovery(session: string, entry: string, url: string): void;
  consumeApplicationRecovery(session: string | undefined, entry: string | undefined, url: string): boolean;
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
  const refresh = (): boolean => {
    try {
      const current = decode(sessionStorage.getItem(unsafeTraversalPersistenceKey));
      if (current) {
        record = current;
        return true;
      }
    } catch { /* fail closed below */ }
    record = Object.freeze({ version: 2, recoveries: Object.freeze([]), overflowed: true });
    persist();
    return false;
  };
  return Object.freeze({
    refresh,
    requireRecovery(session, entry, url, reason): void {
      if (!refresh()) return;
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
      if (!refresh()) return "overflow";
      if (record.overflowed) return "overflow";
      return record.recoveries.find((recovery) => recovery.session === session && recovery.entry === entry && recovery.url === url)?.reason;
    },
    clearRecovery(session, entry, url): void {
      if (!refresh()) return;
      if (record.overflowed) return;
      const recoveries = record.recoveries.filter((recovery) => recovery.session !== session || recovery.entry !== entry || recovery.url !== url);
      if (recoveries.length === record.recoveries.length) return;
      record = Object.freeze({ version: 2, recoveries: Object.freeze(recoveries), overflowed: false });
      persist();
    },
    consumeApplicationRecovery(session, entry, url): boolean {
      if (!refresh()) return true;
      if (record.overflowed) return true;
      const exact = session === undefined || entry === undefined
        ? undefined
        : record.recoveries.find((recovery) => recovery.reason === "application-owned"
          && recovery.session === session
          && recovery.entry === entry
          && recovery.url === url);
      if (!exact) return session === undefined || entry === undefined
        ? record.recoveries.some((recovery) => recovery.reason === "application-owned" && recovery.url === url)
        : false;
      const recoveries = record.recoveries.filter((recovery) => recovery !== exact);
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
    || !privateTargetOwnsCurrentBrowsingContext(anchor.getAttribute("target"))
    || anchor.hasAttribute("referrerpolicy")
    || anchor.relList.contains("external")
    || anchor.relList.contains("noreferrer")) return undefined;
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

function privateTargetOwnsCurrentBrowsingContext(target: string | null): boolean {
  if (target === null || target === "") return true;
  const keyword = target.toLowerCase();
  if (keyword === "_self") return true;
  if (keyword === "_parent") return globalThis.parent === globalThis.window;
  if (keyword === "_top") return globalThis.top === globalThis.window;
  if (keyword === "_blank") return false;
  return target === globalThis.window.name;
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

type PrivateFormHandoffControl = HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type PrivateSelectHandoffChild = Readonly<{
  child: Element;
  attributes: string;
  options: readonly HTMLOptionElement[];
}>;

function privateFormHandoffAttributes(element: Element): string {
  return JSON.stringify([...element.attributes]
    .map(({ name, value }) => [name, value] as const)
    .sort(([left], [right]) => left.localeCompare(right)));
}

function privateSelectHandoffStructure(select: HTMLSelectElement): readonly PrivateSelectHandoffChild[] {
  return Object.freeze([...select.children].map((child) => Object.freeze({
    child,
    attributes: privateFormHandoffAttributes(child),
    options: Object.freeze(child instanceof HTMLOptGroupElement
      ? [...child.children].filter((option): option is HTMLOptionElement => option instanceof HTMLOptionElement)
      : []),
  })));
}

function samePrivateSelectHandoffStructure(
  select: HTMLSelectElement,
  expected: readonly PrivateSelectHandoffChild[],
): boolean {
  const current = privateSelectHandoffStructure(select);
  return current.length === expected.length && expected.every((owner, index) => {
    const candidate = current[index];
    return candidate?.child === owner.child
      && candidate.attributes === owner.attributes
      && candidate.options.length === owner.options.length
      && owner.options.every((option, optionIndex) => candidate.options[optionIndex] === option);
  });
}

function privateFormHandoffControls(form: HTMLFormElement): readonly PrivateFormHandoffControl[] {
  return [...form.elements].filter((control): control is PrivateFormHandoffControl => control instanceof HTMLButtonElement
    || control instanceof HTMLInputElement
    || control instanceof HTMLSelectElement
    || control instanceof HTMLTextAreaElement);
}

function privateFormHandoffControlState(control: PrivateFormHandoffControl): string {
  const attributes = [...control.attributes]
    .map(({ name, value }) => [name, value] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  if (control instanceof HTMLInputElement) {
    return JSON.stringify({
      attributes,
      checked: control.checked,
      disabled: control.disabled,
      effectivelyDisabled: control.matches(":disabled"),
      files: [...(control.files ?? [])].map(({ lastModified, name, size, type }) => ({ lastModified, name, size, type })),
      value: control.value,
    });
  }
  if (control instanceof HTMLSelectElement) {
    return JSON.stringify({
      attributes,
      disabled: control.disabled,
      effectivelyDisabled: control.matches(":disabled"),
      options: [...control.options].map((option) => ({
        attributes: [...option.attributes]
          .map(({ name, value }) => [name, value] as const)
          .sort(([left], [right]) => left.localeCompare(right)),
        effectivelyDisabled: option.matches(":disabled"),
        selected: option.selected,
        text: option.text,
        value: option.value,
      })),
      value: control.value,
    });
  }
  return JSON.stringify({
    attributes,
    disabled: control.disabled,
    effectivelyDisabled: control.matches(":disabled"),
    text: control.textContent,
    value: control.value,
  });
}

function samePrivateFormHandoffFiles(
  control: PrivateFormHandoffControl,
  expected: readonly File[],
): boolean {
  const current = control instanceof HTMLInputElement ? [...(control.files ?? [])] : [];
  return current.length === expected.length && current.every((file, index) => file === expected[index]);
}

function privateFormHandoffSelectionState(activeElement: Element | null): string | undefined {
  if (!(activeElement instanceof HTMLInputElement) && !(activeElement instanceof HTMLTextAreaElement)) return undefined;
  return JSON.stringify({
    direction: activeElement.selectionDirection,
    end: activeElement.selectionEnd,
    start: activeElement.selectionStart,
  });
}

function privateFormHandoffPreservationCheck(
  eligibility: PrivateFormEligibility,
): () => boolean {
  const activeElement = document.activeElement;
  const activeSelection = privateFormHandoffSelectionState(activeElement);
  const controls = privateFormHandoffControls(eligibility.form).map((control) => Object.freeze({
    control,
    files: Object.freeze(control instanceof HTMLInputElement ? [...(control.files ?? [])] : []),
    options: Object.freeze(control instanceof HTMLSelectElement ? [...control.options] : []),
    selectStructure: Object.freeze(control instanceof HTMLSelectElement ? privateSelectHandoffStructure(control) : []),
    state: privateFormHandoffControlState(control),
  }));
  return () => {
    if (!privateFormPreservationSafe(eligibility, { allowDocumentScroll: true })
      || document.activeElement !== activeElement
      || privateFormHandoffSelectionState(activeElement) !== activeSelection) return false;
    const currentControls = privateFormHandoffControls(eligibility.form);
    return currentControls.length === controls.length && controls.every(({ control, files, options, selectStructure, state }, index) => currentControls[index] === control
      && privateFormHandoffControlState(control) === state
      && samePrivateFormHandoffFiles(control, files)
      && (!(control instanceof HTMLSelectElement)
        || (control.options.length === options.length
          && options.every((option, optionIndex) => control.options[optionIndex] === option)
          && samePrivateSelectHandoffStructure(control, selectStructure))));
  };
}

function sameResourceFragmentRedirect(destination: URL, currentTruthUrl: string): boolean {
  const currentTruth = new URL(currentTruthUrl);
  return destination.href.includes("#")
    && destination.origin === currentTruth.origin
    && destination.pathname === currentTruth.pathname
    && destination.search === currentTruth.search;
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

function focusNewDocument(): HTMLElement {
  const target = document.querySelector<HTMLElement>("h1") ?? document.querySelector<HTMLElement>("main") ?? document.body;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.setAttribute("data-fadeno-navigation-focus", "");
  target.focus({ preventScroll: true });
  return target;
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
  oldFocusedNode: HTMLElement | undefined,
): void {
  const expectedMetadata = metadata(next);
  if (!expectedMetadata) throw new TypeError("FADENO_UPDATE_DOCUMENT_SHELL");
  const oldHead = [...document.head.childNodes];
  const oldBody = [...document.body.childNodes];
  const oldAttributes = document.documentElement.cloneNode(false) as HTMLElement;
  const oldScroll = Object.freeze({ x: scrollX, y: scrollY });
  const currentSelection = document.getSelection();
  const oldSelection = currentSelection?.isCollapsed && currentSelection.rangeCount === 1
    ? (() => {
        const range = currentSelection.getRangeAt(0);
        return Object.freeze({
          startContainer: range.startContainer,
          startOffset: range.startOffset,
          endContainer: range.endContainer,
          endOffset: range.endOffset,
        });
      })()
    : undefined;
  const restoreFocus = (): void => {
    try {
      if (oldFocusedNode?.isConnected && document.body.contains(oldFocusedNode)) oldFocusedNode.focus({ preventScroll: true });
    } catch { /* native replacement recovery still owns focus */ }
  };
  const restoreSelection = (): void => {
    if (!oldSelection) return;
    try {
      const selection = document.getSelection();
      if (!selection
        || !oldSelection.startContainer.isConnected
        || !oldSelection.endContainer.isConnected) return;
      const range = document.createRange();
      range.setStart(oldSelection.startContainer, oldSelection.startOffset);
      range.setEnd(oldSelection.endContainer, oldSelection.endOffset);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch { /* native replacement recovery still owns selection */ }
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
    const destinationFocus = focusNewDocument();
    scrollTo({ left: 0, top: 0, behavior: "instant" });
    const committedState = privateHistoryState(history.state);
    const committedMetadata = metadata(document);
    if (!committedState
      || !samePrivateHistoryState(committedState, expectedState)
      || !validateHistory(committedState, url)
      || !committedMetadata
      || committedMetadata.generation !== expectedMetadata.generation
      || committedMetadata.epoch !== expectedMetadata.epoch
      || document.activeElement !== destinationFocus
      || history.scrollRestoration !== "manual"
      || scrollX !== 0
      || scrollY !== 0) throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
  } catch (cause) {
    try {
      try { history.scrollRestoration = "manual"; } catch { /* native fallback will restore ownership */ }
      replaceAttributes(document.documentElement, oldAttributes);
      document.head.replaceChildren(...oldHead);
      document.body.replaceChildren(...oldBody);
      restoreFocus();
      restoreSelection();
      scrollTo({ left: oldScroll.x, top: oldScroll.y, behavior: "instant" });
    } catch { /* native replacement recovery owns any incomplete local rollback */ }
    throw new PrivateDocumentCommitFailure(destinationSelected, restoreFocus, cause);
  }
}

export function startPrivateLinkNavigation(): PrivateBrowserNavigation | undefined {
  if (document.readyState === "loading") {
    let closed = false;
    let activated = false;
    let activeNavigation: PrivateBrowserNavigation | undefined;
    const activate = (): void => {
      if (closed || activated) return;
      activated = true;
      document.removeEventListener("DOMContentLoaded", activate);
      globalThis.removeEventListener("pageshow", activate);
      activeNavigation = startPrivateLinkNavigation();
    };
    document.addEventListener("DOMContentLoaded", activate, { once: true });
    globalThis.addEventListener("pageshow", activate, { once: true });
    return Object.freeze({
      state: () => activeNavigation?.state() ?? (closed ? "closed" : "active"),
      close(): void {
        if (closed) return;
        closed = true;
        document.removeEventListener("DOMContentLoaded", activate);
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
  let activeFormEligibility: Readonly<{
    operation: ActiveOperation;
    eligibility: PrivateFormEligibility;
  }> | undefined;
  let sequence = 0;
  let mutationTraversalRecovery: Readonly<{
    operation: ActiveOperation;
    currentTruthUrl: string;
    eligibility: PrivateFormEligibility;
  }> | undefined;
  let closed = false;
  let closing = false;
  let committing = false;
  let traversing = false;
  let traversalSequence = 0;
  let pendingElementScroll = false;
  let historyWriteFailed = false;
  const consumedResultIds: string[] = [];
  const consumeResultId = (resultId: string): void => {
    consumedResultIds.push(resultId);
    if (consumedResultIds.length > 256) consumedResultIds.shift();
  };
  const previousScrollRestoration = history.scrollRestoration;
  const historySession = `session:${globalThis.crypto.randomUUID()}`;
  const unsafeTraversalPersistence = createPrivateUnsafeTraversalPersistence();
  const documentLifetime = performance.timeOrigin;
  if (applicationRecoveryDocuments.get(document) === documentLifetime) return undefined;
  if (firstStartupForDocument && unsafeTraversalPersistence.consumeApplicationRecovery(
    existingPrivateState?.session,
    existingPrivateState?.entry,
    location.href,
  )) {
    applicationRecoveryDocuments.set(document, documentLifetime);
    return undefined;
  }
  const existingRecovery = existingPrivateState
    ? unsafeTraversalPersistence.recoveryReason(existingPrivateState.session, existingPrivateState.entry, location.href)
    : undefined;
  if (existingRecovery === "application-owned" || existingRecovery === "overflow") return undefined;
  const ownedHistoryEntries = new Map<string, Readonly<{ state: PrivateHistoryState; url: string; raw: unknown }>>();
  const applicationOwnedHistoryEntries = new Set<string>();
  let historyOwnershipOverflowed = false;
  let internalHistoryWrite = false;
  let historyPushSequence = 0;
  let knownHistoryLength = history.length;
  const originalReplaceState = history.replaceState;
  const originalPushState = history.pushState;
  const originalPrototypeReplaceState = History.prototype.replaceState;
  const originalPrototypePushState = History.prototype.pushState;
  const originalReplaceStateDescriptor = Object.getOwnPropertyDescriptor(history, "replaceState");
  const originalPushStateDescriptor = Object.getOwnPropertyDescriptor(history, "pushState");
  const originalPrototypeReplaceStateDescriptor = Object.getOwnPropertyDescriptor(History.prototype, "replaceState");
  const originalPrototypePushStateDescriptor = Object.getOwnPropertyDescriptor(History.prototype, "pushState");
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
    knownHistoryLength = history.length;
    retainApplicationHistoryMutation();
  };
  const runtimePushState = (data: unknown, unused: string, url?: string | URL | null): void => {
    originalPushState.call(history, data, unused, url);
    knownHistoryLength = history.length;
    historyPushSequence += 1;
    retainApplicationHistoryMutation();
  };
  const runtimePrototypeReplaceState = function replaceState(
    this: History,
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ): void {
    originalPrototypeReplaceState.call(this, data, unused, url);
    if (this !== history) return;
    knownHistoryLength = history.length;
    retainApplicationHistoryMutation();
  };
  const runtimePrototypePushState = function pushState(
    this: History,
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ): void {
    originalPrototypePushState.call(this, data, unused, url);
    if (this !== history) return;
    knownHistoryLength = history.length;
    historyPushSequence += 1;
    retainApplicationHistoryMutation();
  };
  const installHistoryMethod = (
    owner: object,
    name: "replaceState" | "pushState",
    value: History["replaceState"] | History["pushState"],
    descriptor: PropertyDescriptor | undefined,
  ): void => {
    if (descriptor && (!("value" in descriptor) || descriptor.writable !== true)) {
      throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
    }
    Object.defineProperty(owner, name, descriptor
      ? { ...descriptor, value }
      : { configurable: true, enumerable: false, writable: true, value });
  };
  const restoreHistoryMethod = (
    owner: object,
    name: "replaceState" | "pushState",
    installed: History["replaceState"] | History["pushState"],
    descriptor: PropertyDescriptor | undefined,
  ): void => {
    if (Reflect.get(owner, name) !== installed) return;
    if (descriptor) Object.defineProperty(owner, name, descriptor);
    else if (!Reflect.deleteProperty(owner, name)) throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
  };
  let historyMethodsInstalled = false;
  const releaseHistoryMethods = (): void => {
    try { restoreHistoryMethod(history, "replaceState", runtimeReplaceState, originalReplaceStateDescriptor); } catch { /* native method remains authoritative */ }
    try { restoreHistoryMethod(history, "pushState", runtimePushState, originalPushStateDescriptor); } catch { /* native method remains authoritative */ }
    try { restoreHistoryMethod(History.prototype, "replaceState", runtimePrototypeReplaceState, originalPrototypeReplaceStateDescriptor); } catch { /* native method remains authoritative */ }
    try { restoreHistoryMethod(History.prototype, "pushState", runtimePrototypePushState, originalPrototypePushStateDescriptor); } catch { /* native method remains authoritative */ }
    historyMethodsInstalled = false;
  };
  const acquireHistoryMethods = (): void => {
    installHistoryMethod(History.prototype, "replaceState", runtimePrototypeReplaceState, originalPrototypeReplaceStateDescriptor);
    installHistoryMethod(History.prototype, "pushState", runtimePrototypePushState, originalPrototypePushStateDescriptor);
    installHistoryMethod(history, "replaceState", runtimeReplaceState, originalReplaceStateDescriptor);
    installHistoryMethod(history, "pushState", runtimePushState, originalPushStateDescriptor);
    if (history.replaceState !== runtimeReplaceState || history.pushState !== runtimePushState
      || History.prototype.replaceState !== runtimePrototypeReplaceState
      || History.prototype.pushState !== runtimePrototypePushState) {
      throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
    }
    historyMethodsInstalled = true;
  };
  try {
    acquireHistoryMethods();
  } catch {
    releaseHistoryMethods();
    return undefined;
  }
  const writeHistory = Object.freeze({
    replace(state: Readonly<Record<string, unknown>>, url: string): void {
      internalHistoryWrite = true;
      try {
        history.replaceState(state, "", url);
        knownHistoryLength = history.length;
      }
      finally { internalHistoryWrite = false; }
    },
    push(state: Readonly<Record<string, unknown>>, url: string): void {
      internalHistoryWrite = true;
      try {
        history.pushState(state, "", url);
        knownHistoryLength = history.length;
      }
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
    ownedHistoryEntries.set(state.entry, Object.freeze({ state, url, raw: history.state }));
  };
  const ownsHistoryState = (state: PrivateHistoryState | undefined, url: string, refreshTraversalIdentity = false): boolean => {
    if (!state || historyOwnershipOverflowed || history.length !== knownHistoryLength || !historyMethodsInstalled
      || history.replaceState !== runtimeReplaceState || history.pushState !== runtimePushState
      || History.prototype.replaceState !== runtimePrototypeReplaceState
      || History.prototype.pushState !== runtimePrototypePushState) return false;
    const owned = ownedHistoryEntries.get(state.entry);
    const fieldsOwned = !applicationOwnedHistoryEntries.has(applicationHistoryKey(state.session, state.entry, url))
      && owned?.url === url
      && samePrivateHistoryState(owned.state, state);
    if (!fieldsOwned) return false;
    if (owned.raw === history.state) return true;
    if (!refreshTraversalIdentity) return false;
    ownedHistoryEntries.set(state.entry, Object.freeze({ state, url, raw: history.state }));
    return true;
  };
  const restoreScrollRestoration = (): void => {
    try { history.scrollRestoration = previousScrollRestoration; } catch { /* native owner remains authoritative */ }
  };
  try {
    history.scrollRestoration = "manual";
    if (history.scrollRestoration !== "manual") throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
    const liveElementScroll = [...document.querySelectorAll("*")].some((element) => element !== document.scrollingElement
      && (element.scrollTop !== 0 || element.scrollLeft !== 0));
    const elementScroll = !firstStartupForDocument && existingPrivateState?.elementScroll === true
      ? true
      : liveElementScroll;
    const recoveredX = !firstStartupForDocument && existingPrivateState && existingPrivateState.scrollX !== 0
      ? existingPrivateState.scrollX
      : scrollX;
    const recoveredY = !firstStartupForDocument && existingPrivateState && existingPrivateState.scrollY !== 0
      ? existingPrivateState.scrollY
      : scrollY;
    writeHistory.replace(createHistoryState(recoveredX, recoveredY, elementScroll, historySession), location.href);
    const acquiredState = privateHistoryState(history.state);
    if (!acquiredState || acquiredState.session !== historySession) throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
    rememberHistoryState(acquiredState, location.href);
    if (existingPrivateState && existingRecovery === "unsafe-scroll") {
      if (!firstStartupForDocument) {
        unsafeTraversalPersistence.requireRecovery(acquiredState.session, acquiredState.entry, location.href, "unsafe-scroll");
      }
      unsafeTraversalPersistence.clearRecovery(existingPrivateState.session, existingPrivateState.entry, location.href);
    }
  } catch {
    try { History.prototype.replaceState.call(history, existingHistoryState, "", currentUrl.href); } catch { /* startup remains refused */ }
    releaseHistoryMethods();
    restoreScrollRestoration();
    return undefined;
  }
  startedDocuments.add(document);
  let displayedHistoryEntry = privateHistoryState(history.state)?.entry;
  let selectedHistoryEntry = displayedHistoryEntry;
  let displayedTruthUrl = location.href;
  let nativeDepartureRecovery: Readonly<{
    operation: ActiveOperation;
    recover(): void;
  }> | undefined;
  let selectedPushRecovery: Readonly<{
    destination: URL;
    truthUrl: string;
    restoreFocus: (() => void) | undefined;
    stageDestination: boolean;
    recoverAfterRollback: boolean;
    recoverCancelledMutation: (() => void) | undefined;
  }> | undefined;
  const unsafeHistoryEntries = createPrivateUnsafeHistoryEntryTracker();

  const markHistoryUnsafe = (entry: string | undefined): void => {
    if (!entry) return;
    unsafeHistoryEntries.mark(entry);
  };
  const liveElementScroll = (): boolean => [...document.querySelectorAll("*")].some((element) => element !== document.scrollingElement
    && (element.scrollTop !== 0 || element.scrollLeft !== 0));

  const requestsUnloadConfirmation = (event: BeforeUnloadEvent): boolean => {
    const returnValue = Reflect.get(event, "returnValue") as unknown;
    return event.defaultPrevented
      || (typeof returnValue === "string" && returnValue !== "")
      || returnValue === false;
  };
  const observeCancelledDeparture = (
    guard: () => boolean,
    repair: () => void,
    recoverWithoutDeparture?: () => boolean,
  ): void => {
    let departureCommitted = false;
    let repaired = false;
    const cleanup = (): void => {
      globalThis.removeEventListener("pagehide", pageHidden);
      globalThis.removeEventListener("beforeunload", beforeUnload);
    };
    const repairOnce = (): void => {
      if (repaired) return;
      repaired = true;
      cleanup();
      repair();
    };
    const pageHidden = (): void => {
      departureCommitted = true;
      cleanup();
    };
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (!requestsUnloadConfirmation(event)) return;
      setTimeout(() => {
        if (!closed && !departureCommitted && guard()) repairOnce();
      }, 0);
    };
    globalThis.addEventListener("pagehide", pageHidden, { once: true });
    globalThis.addEventListener("beforeunload", beforeUnload, { once: true });
    if (recoverWithoutDeparture) setTimeout(() => {
      if (!closed && !departureCommitted && recoverWithoutDeparture()) repairOnce();
    }, 0);
  };
  const repairDisplayedTruth = (
    truthUrl: string,
    code: string,
    decision: string,
  ): void => {
    const displayedOwnedState = displayedHistoryEntry === undefined
      ? undefined
      : ownedHistoryEntries.get(displayedHistoryEntry)?.state;
    const retainedUnsafeScroll = displayedHistoryEntry !== undefined
      && (unsafeHistoryEntries.requiresReload(displayedHistoryEntry)
        || unsafeTraversalPersistence.recoveryReason(historySession, displayedHistoryEntry, displayedTruthUrl) === "unsafe-scroll"
        || displayedOwnedState?.scrollX !== 0
        || displayedOwnedState?.scrollY !== 0
        || displayedOwnedState?.elementScroll === true);
    const elementScroll = liveElementScroll();
    try {
      const repairedState = createHistoryState(scrollX, scrollY, elementScroll, historySession);
      const repairedPrivateState = privateHistoryState(repairedState);
      if (!repairedPrivateState) throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
      writeHistory.replace(repairedState, truthUrl);
      history.scrollRestoration = "manual";
      if (history.scrollRestoration !== "manual") throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
      rememberHistoryState(repairedPrivateState, truthUrl);
      displayedHistoryEntry = repairedPrivateState.entry;
      selectedHistoryEntry = repairedPrivateState.entry;
      displayedTruthUrl = truthUrl;
      if (retainedUnsafeScroll || scrollX !== 0 || scrollY !== 0 || elementScroll) {
        markHistoryUnsafe(repairedPrivateState.entry);
        unsafeTraversalPersistence.requireRecovery(historySession, repairedPrivateState.entry, truthUrl, "unsafe-scroll");
      }
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
    const recoverCancelledMutation = active?.recoverCancelledMutation;
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
          recoverCancelledMutation?.();
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
      && target !== document.scrollingElement
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
    recoverCancelledMutation?: () => void,
  ): void => {
    restoreScrollRestoration();
    const truthUrl = displayedTruthUrl;
    const selectedUrl = location.href;
    observeCancelledDeparture(
      () => displayedTruthUrl === truthUrl && location.href === selectedUrl,
      () => {
        if (recoverCancelledMutation) {
          if (repairSelectedCommit) {
            traversalSequence += 1;
            traversing = false;
            recoveringTraversal = undefined;
            repairDisplayedTruth(
              truthUrl,
              "FADENO_UPDATE_NATIVE_FALLBACK_CANCELLED",
              "native post-selection mutation recovery was cancelled",
            );
          }
          recoverCancelledMutation();
          restoreFocus?.();
          return;
        }
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

  const fallbackSameResourceFragmentRedirect = (
    destination: URL,
    recoverCancelledMutation: () => void,
    stageDestination: "replace" | "push" | "none" = "replace",
  ): void => {
    restoreScrollRestoration();
    const truthUrl = displayedTruthUrl;
    let recovered = false;
    let pushedDestination = false;
    let recoveryOperation: ActiveOperation | undefined;
    const recoverFragmentReload = (): void => {
      if (recovered) return;
      recovered = true;
      if (nativeDepartureRecovery?.operation === recoveryOperation) nativeDepartureRecovery = undefined;
      if (active === recoveryOperation) active = undefined;
      if (closing) {
        document.addEventListener("click", click);
        document.addEventListener("submit", submit);
        document.addEventListener("scroll", recordCurrentScroll, true);
        try {
          history.scrollRestoration = "manual";
          if (history.scrollRestoration !== "manual") throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
          closing = false;
        } catch {
          finishClose();
        }
      }
      if (privateFragmentReloadRecoveryMode(stageDestination, pushedDestination) === "rollback-staged-entry") {
        recoverSelectedPush(
          new URL(truthUrl),
          1,
          undefined,
          false,
          recoverCancelledMutation,
          true,
        );
        return;
      }
      repairDisplayedTruth(
        truthUrl,
        "FADENO_FORM_FRAGMENT_RELOAD_CANCELLED",
        "native same-resource fragment reload was cancelled",
      );
      recoverCancelledMutation();
    };
    recoveryOperation = Object.freeze({
      kind: "navigation",
      id: `fragment-reload:${globalThis.crypto.randomUUID()}`,
      sequence: ++sequence,
      destination,
      currentTruthUrl: truthUrl,
      generation: currentMetadata?.generation ?? "",
      documentEpoch: currentMetadata?.epoch ?? "",
      cancellation: new AbortController(),
      recoverCancelledMutation: recoverFragmentReload,
    });
    active = recoveryOperation;
    nativeDepartureRecovery = Object.freeze({ operation: recoveryOperation, recover: recoverFragmentReload });
    if (stageDestination !== "none") {
      try {
        const currentState = privateHistoryState(history.state);
        if (!currentState || !ownsHistoryState(currentState, location.href)) {
          throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
        }
        const stagedState = createHistoryState(
          scrollX,
          scrollY,
          false,
          historySession,
          stageDestination === "replace" ? currentState.entry : undefined,
        );
        if (stageDestination === "replace") writeHistory.replace(stagedState, destination.href);
        else {
          writeHistory.push(stagedState, destination.href);
          pushedDestination = true;
        }
        const selectedState = privateHistoryState(history.state);
        if (!selectedState || location.href !== destination.href) throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
        rememberHistoryState(selectedState, destination.href);
        selectedHistoryEntry = selectedState.entry;
      } catch {
        observeCancelledDeparture(
          () => displayedTruthUrl === truthUrl
            && (location.href === destination.href
              || (stageDestination === "push" && !pushedDestination && location.href === truthUrl)),
          recoverFragmentReload,
        );
        try {
          privateReloadFragmentDestination(location, destination, () => setTimeout(() => location.reload(), 0));
        } catch {
          recoverFragmentReload();
        }
        return;
      }
    }
    observeCancelledDeparture(
      () => displayedTruthUrl === truthUrl && location.href === destination.href,
      recoverFragmentReload,
    );
    try {
      privateReloadFragmentDestination(location, destination, () => setTimeout(() => location.reload(), 0));
    } catch {
      recoverFragmentReload();
    }
  };

  const recoverSelectedPush = (
    destination: URL,
    selectedPushCount: number,
    restoreFocus?: () => void,
    stageDestination = true,
    recoverCancelledMutation?: () => void,
    recoverAfterRollback = false,
  ): void => {
    restoreScrollRestoration();
    selectedPushRecovery = Object.freeze({
      destination,
      truthUrl: displayedTruthUrl,
      restoreFocus,
      stageDestination,
      recoverAfterRollback,
      recoverCancelledMutation,
    });
    history.go(-selectedPushCount);
  };

  const nativeActivationFinalizers = new WeakMap<Event, () => void>();
  const finalizeNativeActivation = (activation: Event): void => {
    const finalize = nativeActivationFinalizers.get(activation);
    if (!finalize) return;
    nativeActivationFinalizers.delete(activation);
    finalize();
  };

  const supersedePendingWorkForNativeActivation = (
    code: string,
    decision: string,
    observation?: Readonly<{
      event: Event;
      nativeDestination?: () => URL | undefined;
      afterNativeDestination?: () => URL | undefined;
      finalizeNow?: boolean;
      policyProtected?: () => boolean;
      canDepartCurrentDocument?: () => boolean;
    }>,
  ): boolean => {
    if (active?.kind === "mutation") return false;
    if (!traversing && !active) return false;
    const recoverCancelledMutation = active?.recoverCancelledMutation;
    if (active && recoverCancelledMutation && observation?.policyProtected?.()) {
      const relinquished = active;
      relinquished.cancellation.abort(new DOMException("Policy-protected activation retained browser ownership", "AbortError"));
      if (active === relinquished) active = undefined;
      if (traversing) {
        traversalSequence += 1;
        traversing = false;
        recoveringTraversal = undefined;
        repairDisplayedTruth(displayedTruthUrl, code, decision);
      }
      return true;
    }
    active?.cancellation.abort(new DOMException("Native activation superseded pending work", "AbortError"));
    if (traversing) {
      traversalSequence += 1;
      traversing = false;
      recoveringTraversal = undefined;
      repairDisplayedTruth(displayedTruthUrl, code, decision);
    }
    if (recoverCancelledMutation) {
      const truthUrl = displayedTruthUrl;
      const selectedUrl = location.href;
      let recovered = false;
      const recoverOnce = (): void => {
        if (recovered) return;
        recovered = true;
        recoverCancelledMutation();
      };
      observeCancelledDeparture(
        () => displayedTruthUrl === truthUrl && location.href === selectedUrl,
        recoverOnce,
      );
      if (observation) {
        let finalized = false;
        let reachedWindow = false;
        let preventedByFramework = false;
        const sameResourceFragment = (destination: URL): boolean => {
          const currentTruth = new URL(selectedUrl);
          return destination.origin === currentTruth.origin
            && destination.pathname === currentTruth.pathname
            && destination.search === currentTruth.search
            && destination.href.includes("#");
        };
        const recoverAfterNativeFragmentSelection = (): void => {
          if (finalized || reachedWindow || recovered || closed) return;
          if (observation.event.defaultPrevented) {
            finalized = true;
            recoverOnce();
            return;
          }
          if (observation.policyProtected?.()) {
            finalized = true;
            return;
          }
          const nativeDestination = observation.afterNativeDestination?.();
          if (!nativeDestination || !sameResourceFragment(nativeDestination)) return;
          const selectedDestination = new URL(location.href);
          if (selectedDestination.href !== nativeDestination.href) return;
          finalized = true;
          fallbackSameResourceFragmentRedirect(nativeDestination, recoverOnce, "none");
        };
        const finalize = (): void => {
          if (finalized || closed || recovered) return;
          finalized = true;
          globalThis.removeEventListener("hashchange", nativeFragmentChanged);
          if (observation.event.defaultPrevented) {
            recoverOnce();
            return;
          }
          if (observation.policyProtected?.()) return;
          const nativeDestination = observation.nativeDestination?.();
          if (!nativeDestination) {
            if (!observation.canDepartCurrentDocument?.()) recoverOnce();
            return;
          }
          preventedByFramework = true;
          observation.event.preventDefault();
          if (sameResourceFragment(nativeDestination)) {
            fallbackSameResourceFragmentRedirect(nativeDestination, recoverOnce, "push");
          } else {
            fallback(nativeDestination, false, false, undefined, recoverOnce);
          }
        };
        const finalizeActivation = (activation: Event): void => {
          if (activation !== observation.event) return;
          reachedWindow = true;
          finalize();
        };
        const nativeFragmentChanged = (): void => {
          setTimeout(recoverAfterNativeFragmentSelection, 0);
        };
        if (observation.finalizeNow) {
          finalizeActivation(observation.event);
          setTimeout(() => {
            if (!preventedByFramework && observation.event.defaultPrevented && !recovered) recoverOnce();
          }, 0);
          return true;
        }
        nativeActivationFinalizers.set(observation.event, () => finalizeActivation(observation.event));
        globalThis.addEventListener("hashchange", nativeFragmentChanged);
        setTimeout(() => {
          nativeActivationFinalizers.delete(observation.event);
          if (observation.event.defaultPrevented) {
            globalThis.removeEventListener("hashchange", nativeFragmentChanged);
            if (!recovered) recoverOnce();
            return;
          }
          if (reachedWindow || recovered || closed) return;
          setTimeout(() => {
            globalThis.removeEventListener("hashchange", nativeFragmentChanged);
            if (observation.event.defaultPrevented) {
              if (!recovered) recoverOnce();
              return;
            }
            if (reachedWindow || recovered || closed) return;
            const nativeDestination = observation.afterNativeDestination?.();
            recoverAfterNativeFragmentSelection();
            if (!finalized && ((!nativeDestination && !observation.canDepartCurrentDocument?.())
              || (nativeDestination && sameResourceFragment(nativeDestination)))) recoverOnce();
          }, 50);
        }, 0);
      }
    }
    return true;
  };

  const navigate = async (
    destination: URL,
    replace: boolean,
    initiator?: HTMLAnchorElement,
    selectedHistoryState?: PrivateHistoryState,
    preservationSafe: () => boolean = () => privateLinkPreservationSafe(initiator, { allowDocumentScroll: true }),
    recoverCancelledMutation?: () => void,
  ): Promise<void> => {
    if (active?.kind === "mutation") return;
    const inheritedMutationRecovery = active?.recoverCancelledMutation;
    const effectiveMutationRecovery = recoverCancelledMutation ?? inheritedMutationRecovery;
    active?.cancellation.abort(new DOMException("Navigation superseded", "AbortError"));
    if (closed || !currentMetadata || !preservationSafe()) {
      fallback(destination, replace, selectedHistoryState !== undefined, undefined, effectiveMutationRecovery);
      return;
    }
    sequence += 1;
    const operation: ActiveOperation = Object.freeze({
      kind: "navigation",
      id: `nav:${globalThis.crypto.randomUUID()}`,
      sequence,
      destination,
      currentTruthUrl: location.href,
      generation: currentMetadata.generation,
      documentEpoch: currentMetadata.epoch,
      cancellation: new AbortController(),
      recoverCancelledMutation: effectiveMutationRecovery,
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
          "x-fadeno-current-url": encodeURIComponent(operation.currentTruthUrl),
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
      if (!preservationSafe()) throw new TypeError("FADENO_UPDATE_PRESERVATION");
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
        consumeResultId(admission.resultId);
        if (effectiveMutationRecovery && sameResourceFragmentRedirect(redirect, operation.currentTruthUrl)) {
          fallbackSameResourceFragmentRedirect(redirect, effectiveMutationRecovery);
          return;
        }
        fallback(redirect, replace, false, undefined, effectiveMutationRecovery);
        return;
      }
      if (admission.outcome.kind === "recover") {
        fallback(new URL(operation.currentTruthUrl), true, false, undefined, effectiveMutationRecovery);
        return;
      }
      const next = nextDocument(admission.outcome, operation.generation);
      if (!next) throw new TypeError("FADENO_UPDATE_DOCUMENT_SHELL");
      if (!initiator && selectedHistoryState) {
        if (scrollX !== 0 || scrollY !== 0 || pendingElementScroll || liveElementScroll()) {
          markHistoryUnsafe(displayedHistoryEntry);
          if (displayedHistoryEntry) unsafeTraversalPersistence.requireRecovery(historySession, displayedHistoryEntry, displayedTruthUrl, "unsafe-scroll");
          throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
        }
      } else if (initiator && !flushCurrentScroll(true)) throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
      const operationFocusedNode = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
      historyPushesBeforeCommit = historyPushSequence;
      committing = true;
      try {
        applyDocument(
          next,
          operation.destination.href,
          replace,
          historySession,
          previousScrollRestoration,
          (state, url) => !closed
            && !closing
            && active === operation
            && !operation.cancellation.signal.aborted
            && location.href === url
            && !historyOwnershipOverflowed
            && !applicationOwnedHistoryEntries.has(applicationHistoryKey(state.session, state.entry, url)),
          writeHistory,
          operationFocusedNode,
        );
      } finally {
        committing = false;
      }
      destinationSelected = true;
      const committedState = privateHistoryState(history.state);
      if (!committedState) throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
      rememberHistoryState(committedState, location.href);
      displayedHistoryEntry = committedState.entry;
      selectedHistoryEntry = committedState.entry;
      displayedTruthUrl = location.href;
      consumeResultId(admission.resultId);
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
        if (selectedCommitFailure && selectedPushCount > 0) {
          recoverSelectedPush(
            destination,
            selectedPushCount,
            documentCommitFailure?.restoreFocus,
            !replace,
            effectiveMutationRecovery,
          );
        } else {
          fallback(
            destination,
            replace || selectedCommitFailure,
            selectedCommitFailure,
            documentCommitFailure?.restoreFocus,
            effectiveMutationRecovery,
          );
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

  const recoverCommittedMutationCurrentTruth = (
    currentTruthUrl: string,
    eligibility: PrivateFormEligibility,
    preservationSafe: () => boolean = () => privateFormPreservationSafe(eligibility, { allowDocumentScroll: true }),
  ): void => {
    const recoverAgain = (): void => recoverCommittedMutationCurrentTruth(currentTruthUrl, eligibility, preservationSafe);
    const selectedState = privateHistoryState(history.state);
    recordFormFlow({
      status: "refused",
      code: "FADENO_FORM_MUTATION_CURRENT_TRUTH",
      operation: "mutation",
      decisions: Object.freeze([
        "committed mutation departure was interrupted",
        "current server truth was requested through GET",
        "mutation was not resubmitted",
      ]),
      ownership: Object.freeze({
        browser: Object.freeze(["interrupted departure", "current-truth operation", "pending cleanup"]),
        server: Object.freeze(["current truth"]),
      }),
      skipped: Object.freeze(["mutation retry", "stale document retention"]),
      outcome: "current-truth-reload",
    });
    if (!selectedState || !ownsHistoryState(selectedState, location.href, true)) {
      fallback(new URL(currentTruthUrl), true, false, undefined, recoverAgain);
      return;
    }
    setTimeout(() => {
      if (closed || location.href !== currentTruthUrl) return;
      void navigate(
        new URL(currentTruthUrl),
        true,
        undefined,
        selectedState,
        preservationSafe,
        recoverAgain,
      );
    }, 0);
  };

  const submitFormOperation = async (
    eligibility: PrivateFormEligibility,
    request: ReturnType<typeof privateFormRequest>,
    sourceState: PrivateHistoryState,
  ): Promise<void> => {
    if (active?.kind === "mutation") return;
    const inheritedMutationRecovery = active?.recoverCancelledMutation;
    active?.cancellation.abort(new DOMException("Form submission superseded navigation", "AbortError"));
    sequence += 1;
    const operation: ActiveOperation = Object.freeze({
      kind: eligibility.kind,
      id: `${eligibility.kind === "mutation" ? "action" : "form"}:${globalThis.crypto.randomUUID()}`,
      sequence,
      destination: request.destination,
      currentTruthUrl: location.href,
      generation: currentMetadata?.generation ?? "",
      documentEpoch: currentMetadata?.epoch ?? "",
      cancellation: new AbortController(),
      recoverCancelledMutation: eligibility.kind === "navigation" ? inheritedMutationRecovery : undefined,
    });
    const priorBusy = eligibility.form.getAttribute("aria-busy");
    eligibility.form.setAttribute("aria-busy", "true");
    let ownsPending = true;
    const clearPending = (): void => {
      if (!ownsPending) return;
      ownsPending = false;
      if (priorBusy === null) eligibility.form.removeAttribute("aria-busy");
      else eligibility.form.setAttribute("aria-busy", priorBusy);
    };
    active = operation;
    activeFormEligibility = Object.freeze({ operation, eligibility });
    let requestCommitted = false;
    let destinationSelected = false;
    let historyPushesBeforeCommit = historyPushSequence;
    try {
      const fetchPromise = fetch(operation.destination.href, {
        method: operation.kind === "mutation" ? "POST" : "GET",
        ...(request.body === undefined ? {} : { body: request.body }),
        credentials: "same-origin",
        cache: "no-store",
        redirect: "manual",
        signal: operation.cancellation.signal,
        headers: {
          accept: mediaType,
          "x-fadeno-current-url": encodeURIComponent(operation.currentTruthUrl),
          "x-fadeno-document-epoch": operation.documentEpoch,
          "x-fadeno-operation-id": operation.id,
          "x-fadeno-operation-sequence": String(operation.sequence),
        },
      });
      requestCommitted = operation.kind === "mutation";
      const response = await fetchPromise;
      if (!response.ok || response.headers.get("content-type") !== mediaType) throw new TypeError("FADENO_UPDATE_TRANSPORT");
      const bytes = await boundedBytes(response, operation.cancellation.signal);
      if (!bytes) throw new TypeError("FADENO_UPDATE_LIMIT");
      const admission = admitPrivateUpdateBytes(bytes, {
        origin: location.origin,
        currentTruthUrl: operation.currentTruthUrl,
        transport: Object.freeze({ requestCache: "no-store", responseCacheControl: response.headers.get("cache-control") }),
        generation: operation.generation,
        documentEpoch: operation.documentEpoch,
        currentOperation: Object.freeze({
          id: operation.id,
          sequence: operation.sequence,
          kind: operation.kind,
          url: operation.destination.href,
        }),
        consumedResultIds: Object.freeze([...consumedResultIds]),
        requestCommitted,
      }, { signal: operation.cancellation.signal });
      if (active !== operation || operation.cancellation.signal.aborted
        || admission.decision.status !== "accepted" || !admission.outcome || !admission.resultId) {
        throw new TypeError(admission.decision.code);
      }
      if (!privateFormPreservationSafe(eligibility, { allowDocumentScroll: true })) {
        throw new TypeError("FADENO_UPDATE_PRESERVATION");
      }
      const currentHistoryState = privateHistoryState(history.state);
      if (location.href !== operation.currentTruthUrl
        || !currentHistoryState
        || !samePrivateHistoryState(currentHistoryState, sourceState)
        || !ownsHistoryState(currentHistoryState, operation.currentTruthUrl)) {
        throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
      }
      if (admission.outcome.kind === "redirect") {
        const redirect = new URL(admission.outcome.location, location.origin);
        if (operation.kind === "mutation") {
          consumeResultId(admission.resultId);
          const sameResourceFragment = sameResourceFragmentRedirect(redirect, operation.currentTruthUrl);
          const handoffPreservationSafe = privateFormHandoffPreservationCheck(eligibility);
          const recoverCancelledMutation = () => recoverCommittedMutationCurrentTruth(
            operation.currentTruthUrl,
            eligibility,
            handoffPreservationSafe,
          );
          clearPending();
          if (activeFormEligibility?.operation === operation) activeFormEligibility = undefined;
          if (active === operation) active = undefined;
          recordFormFlow({
            status: "applied",
            code: admission.decision.code,
            operation: operation.kind,
            decisions: Object.freeze([
              "server selected a same-origin redirect after one admitted mutation",
              "the mutation result was consumed before redirect ownership changed",
              sameResourceFragment
                ? "a same-resource fragment selected one native destination reload"
                : "a fresh cancellable GET operation acquired the redirect destination",
            ]),
            ownership: Object.freeze({
              browser: Object.freeze(sameResourceFragment
                ? ["submit event", "mutation operation", "pending cleanup", "native fragment reload"]
                : ["submit event", "mutation operation", "pending cleanup", "redirect GET operation"]),
              server: Object.freeze(["origin", "proof", "replay", "authorization", "action", "session", "revalidation", "redirect", "destination route"]),
            }),
            skipped: Object.freeze(["mutation retry", "POST redirect resubmission", "transported redirect execution", "general state reconciliation"]),
            outcome: sameResourceFragment ? "native-navigation" : "enhanced-redirect",
          });
          if (sameResourceFragment) {
            fallbackSameResourceFragmentRedirect(redirect, recoverCancelledMutation);
            return;
          }
          await navigate(
            redirect,
            false,
            undefined,
            sourceState,
            handoffPreservationSafe,
            recoverCancelledMutation,
          );
          return;
        }
        recordFormFlow({
          status: "applied",
          code: admission.decision.code,
          operation: operation.kind,
          decisions: Object.freeze([
            "server selected a same-origin redirect after one admitted form operation",
            "native destination navigation retained browser ownership",
          ]),
          ownership: Object.freeze({
            browser: Object.freeze(["submit event", "operation", "pending cleanup", "native destination"]),
            server: Object.freeze(["route", "redirect"]),
          }),
          skipped: Object.freeze(["mutation authority", "transported redirect execution", "document commit"]),
          outcome: "native-navigation",
        });
        clearPending();
        fallback(
          redirect,
          false,
          false,
          undefined,
          operation.recoverCancelledMutation,
        );
        return;
      }
      if (admission.outcome.kind === "recover") {
        recordFormFlow({
          status: "refused",
          code: admission.decision.code,
          operation: operation.kind,
          decisions: Object.freeze([
            "server selected independently trusted current truth",
            "submitted operation was not repeated",
          ]),
          ownership: Object.freeze({
            browser: Object.freeze(["submit event", "operation", "pending cleanup", "current-truth navigation"]),
            server: Object.freeze(["recovery decision", "current truth"]),
          }),
          skipped: Object.freeze(["mutation retry", "submitted-result document commit"]),
          outcome: "current-truth-reload",
        });
        clearPending();
        fallback(
          new URL(operation.currentTruthUrl),
          true,
          false,
          undefined,
          operation.kind === "mutation"
            ? () => recoverCommittedMutationCurrentTruth(operation.currentTruthUrl, eligibility)
            : operation.recoverCancelledMutation,
        );
        return;
      }
      const next = nextDocument(admission.outcome, operation.generation);
      if (!next) throw new TypeError("FADENO_UPDATE_DOCUMENT_SHELL");
      if (!flushCurrentScroll(true)) throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
      const operationFocusedNode = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
      historyPushesBeforeCommit = historyPushSequence;
      committing = true;
      try {
        applyDocument(
          next,
          operation.kind === "mutation" ? operation.currentTruthUrl : operation.destination.href,
          false,
          historySession,
          previousScrollRestoration,
          (state, url) => !closed
            && !closing
            && active === operation
            && !operation.cancellation.signal.aborted
            && location.href === url
            && !historyOwnershipOverflowed
            && !applicationOwnedHistoryEntries.has(applicationHistoryKey(state.session, state.entry, url)),
          writeHistory,
          operationFocusedNode,
        );
      } finally {
        committing = false;
      }
      destinationSelected = true;
      const committedState = privateHistoryState(history.state);
      if (!committedState) throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
      rememberHistoryState(committedState, location.href);
      displayedHistoryEntry = committedState.entry;
      selectedHistoryEntry = committedState.entry;
      displayedTruthUrl = location.href;
      consumeResultId(admission.resultId);
      currentMetadata = metadata(document);
      if (!currentMetadata) throw new TypeError("FADENO_UPDATE_DOCUMENT_METADATA");
      recordFormFlow({
        status: "applied",
        code: admission.decision.code,
        operation: operation.kind,
        decisions: Object.freeze([
          operation.kind === "mutation"
            ? "eligible protected POST acquired one mutation delivery operation"
            : "eligible GET form acquired navigation operation ownership",
          "platform successful controls were submitted once",
          "exact native server response was projected once",
          "current generation, epoch, operation, URL, cache, and result were admitted",
          "document, URL, history, focus, and pending state committed",
        ]),
        ownership: Object.freeze({
          browser: Object.freeze(["submit event", "successful controls", "operation", "pending state", "history", "focus"]),
          server: Object.freeze(operation.kind === "mutation"
            ? ["origin", "proof", "replay", "authorization", "action", "session", "revalidation", "rendered outcome"]
            : ["route", "resources", "rendered outcome"]),
        }),
        skipped: Object.freeze(["optimistic mutation", "mutation retry", "general state reconciliation", "transported script execution"]),
        outcome: "enhanced-document",
      });
    } catch (cause) {
      const cancelled = operation.cancellation.signal.aborted;
      const selectedCommitFailure = destinationSelected
        || (cause instanceof PrivateDocumentCommitFailure && cause.destinationSelected);
      recordFormFlow({
        status: cancelled ? "cancelled" : "refused",
        code: cancelled ? "FADENO_UPDATE_CANCELLED" : "FADENO_UPDATE_NATIVE_RECOVERY",
        operation: operation.kind,
        decisions: Object.freeze(operation.kind === "mutation"
          ? ["mutation delivery became uncertain", "trusted current truth selected", "mutation was not resubmitted"]
          : ["enhanced GET form could not commit", "native destination retained"]),
        ownership: Object.freeze({
          browser: Object.freeze(["submit event", "operation", "pending cleanup"]),
          server: Object.freeze(operation.kind === "mutation" ? ["mutation uncertainty", "current truth"] : ["rendered outcome"]),
        }),
        skipped: Object.freeze(["mutation retry", "stale document commit"]),
        outcome: operation.kind === "mutation" ? "current-truth-reload" : cancelled ? "none" : "native-navigation",
      });
      clearPending();
      if (active === operation && !closing) {
        if (operation.kind === "mutation" && requestCommitted) {
          if (mutationTraversalRecovery?.operation !== operation) {
            fallback(
              new URL(operation.currentTruthUrl),
              true,
              selectedCommitFailure,
              undefined,
              () => recoverCommittedMutationCurrentTruth(operation.currentTruthUrl, eligibility),
            );
          }
        } else if (!cancelled) {
          const selectedPushCount = historyPushSequence - historyPushesBeforeCommit;
          if (selectedCommitFailure && selectedPushCount > 0) recoverSelectedPush(
            operation.destination,
            selectedPushCount,
            undefined,
            true,
            operation.recoverCancelledMutation,
          );
          else fallback(
            operation.destination,
            selectedCommitFailure,
            selectedCommitFailure,
            undefined,
            operation.recoverCancelledMutation,
          );
        }
      }
    } finally {
      clearPending();
      if (activeFormEligibility?.operation === operation) activeFormEligibility = undefined;
      if (active === operation) active = undefined;
    }
  };

  const click = (event: MouseEvent): void => {
    if (closed || event.defaultPrevented || !event.isTrusted || event.button !== 0
      || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(target instanceof HTMLAnchorElement)) return;
    const sameContext = !target.hasAttribute("download")
      && privateTargetOwnsCurrentBrowsingContext(target.getAttribute("target"));
    const selectedUrl = new URL(location.href);
    const policyProtected = (): boolean => target.hasAttribute("referrerpolicy") || target.relList.contains("noreferrer");
    const nativeDocumentDestination = (): URL | undefined => {
      if (target.hasAttribute("download")
        || !privateTargetOwnsCurrentBrowsingContext(target.getAttribute("target"))) return undefined;
      try {
        const candidate = new URL(target.href, selectedUrl);
        return candidate.protocol === "http:" || candidate.protocol === "https:" ? candidate : undefined;
      } catch { return undefined; }
    };
    const nativeDestination = (): URL | undefined => {
      const candidate = nativeDocumentDestination();
      return candidate
        && candidate.origin === selectedUrl.origin
        && candidate.pathname === selectedUrl.pathname
        && candidate.search === selectedUrl.search
        && candidate.href.includes("#")
        ? candidate
        : undefined;
    };
    const nativeObservation = Object.freeze({
      event,
      nativeDestination,
      afterNativeDestination: nativeDestination,
      policyProtected,
      canDepartCurrentDocument: () => nativeDocumentDestination() !== undefined,
    });
    if (sameContext && active?.kind === "mutation") {
      event.preventDefault();
      recordFormFlow({
        status: "refused",
        code: "FADENO_FORM_MUTATION_PENDING",
        operation: "mutation",
        decisions: Object.freeze(["pending mutation retained document ownership", "new activation sent no request"]),
        ownership: Object.freeze({
          browser: Object.freeze(["pending mutation", "activation refusal"]),
          server: Object.freeze(["existing mutation only"]),
        }),
        skipped: Object.freeze(["new navigation request", "mutation retry"]),
        outcome: "none",
      });
      return;
    }
    if (sameContext && traversing && supersedePendingWorkForNativeActivation(
        "FADENO_UPDATE_NATIVE_CLICK_SUPERSESSION",
        "native same-context click superseded a traversal",
        nativeObservation,
      )) return;
    const destination = privateSafeLinkDestination(target);
    if (!destination || !currentMetadata || !privateLinkPreservationSafe(target, { allowDocumentScroll: true })) {
      if (sameContext) supersedePendingWorkForNativeActivation(
        "FADENO_UPDATE_NATIVE_CLICK_SUPERSESSION",
        "native same-context click superseded pending work",
        nativeObservation,
      );
      return;
    }
    const stateBeforeFlush = privateHistoryState(history.state);
    if (!stateBeforeFlush || !ownsHistoryState(stateBeforeFlush, location.href) || stateBeforeFlush.elementScroll
      || !flushCurrentScroll(true)) {
      if (sameContext) supersedePendingWorkForNativeActivation(
        "FADENO_UPDATE_NATIVE_CLICK_SUPERSESSION",
        "native same-context click superseded pending work",
        nativeObservation,
      );
      return;
    }
    const state = privateHistoryState(history.state);
    if (!state || !ownsHistoryState(state, location.href) || state.elementScroll) {
      if (sameContext) supersedePendingWorkForNativeActivation(
        "FADENO_UPDATE_NATIVE_CLICK_SUPERSESSION",
        "native same-context click superseded pending work",
        nativeObservation,
      );
      return;
    }
    event.preventDefault();
    void navigate(destination, false, target, state);
  };
  const submit = (event: SubmitEvent): void => {
    if (closed || !event.isTrusted || !(event.target instanceof HTMLFormElement)
      || (event.defaultPrevented && !active?.recoverCancelledMutation)) return;
    if (event.target.method.toLowerCase() === "dialog") return;
    const form = event.target;
    const ownsCurrentContext = (): boolean => {
      const submitterTarget = event.submitter instanceof HTMLElement ? event.submitter.getAttribute("formtarget") : null;
      return privateTargetOwnsCurrentBrowsingContext(submitterTarget ?? form.getAttribute("target"));
    };
    const sameContext = ownsCurrentContext();
    if (!sameContext && !active?.recoverCancelledMutation) return;
    if (active?.kind === "mutation") {
      event.preventDefault();
      recordFormFlow({
        status: "refused",
        code: "FADENO_FORM_MUTATION_PENDING",
        operation: "mutation",
        decisions: Object.freeze(["pending mutation retained form ownership", "duplicate submission sent no request"]),
        ownership: Object.freeze({
          browser: Object.freeze(["pending form", "duplicate refusal"]),
          server: Object.freeze(["existing mutation only"]),
        }),
        skipped: Object.freeze(["duplicate request", "mutation retry"]),
        outcome: "none",
      });
      return;
    }
    let finalizingAtWindow = false;
    const finalizeSubmission = (): void => {
      if (closed) return;
      if (!ownsCurrentContext()) {
        supersedePendingWorkForNativeActivation(
          "FADENO_UPDATE_NATIVE_FORM_SUPERSESSION",
          "browser-owned external-context form submission superseded pending navigation",
          Object.freeze({ event, finalizeNow: true }),
        );
        return;
      }
      if (event.defaultPrevented) {
        supersedePendingWorkForNativeActivation(
          "FADENO_UPDATE_NATIVE_FORM_SUPERSESSION",
          "cancelled same-context form submission superseded pending navigation",
          Object.freeze({ event, finalizeNow: true }),
        );
        return;
      }
      if (traversing) supersedePendingWorkForNativeActivation(
        "FADENO_UPDATE_NATIVE_FORM_SUPERSESSION",
        "same-context form submission superseded pending traversal",
      );
      const eligibility = privateFormEligibility(form, event.submitter);
      const retainNativeSubmission = (): void => {
        let afterNativeDestination: URL | undefined;
        const formData = (formDataEvent: FormDataEvent): void => {
          if (formDataEvent.target !== form) return;
          afterNativeDestination = privateNativeGetFormDestination(form, event.submitter, formDataEvent.formData);
        };
        if (active?.recoverCancelledMutation && !form.relList.contains("noreferrer")) {
          form.addEventListener("formdata", formData, { once: true });
          setTimeout(() => form.removeEventListener("formdata", formData), 0);
        }
        supersedePendingWorkForNativeActivation(
          "FADENO_UPDATE_NATIVE_FORM_SUPERSESSION",
          "same-context form submission superseded pending navigation",
          Object.freeze({
            event,
            nativeDestination: () => privateNativeGetFormDestination(form, event.submitter),
            afterNativeDestination: () => afterNativeDestination,
            ...(finalizingAtWindow ? { finalizeNow: true } : {}),
            policyProtected: () => form.relList.contains("noreferrer"),
          }),
        );
      };
      if (!eligibility || !currentMetadata || !privateFormPreservationSafe(eligibility, { allowDocumentScroll: true })) {
        retainNativeSubmission();
        return;
      }
      const stateBeforeFlush = privateHistoryState(history.state);
      if (!stateBeforeFlush || !ownsHistoryState(stateBeforeFlush, location.href) || stateBeforeFlush.elementScroll
        || !flushCurrentScroll(true)) {
        retainNativeSubmission();
        return;
      }
      const sourceState = privateHistoryState(history.state);
      if (!sourceState || !ownsHistoryState(sourceState, location.href) || sourceState.elementScroll) {
        retainNativeSubmission();
        return;
      }
      let request: ReturnType<typeof privateFormRequest>;
      try { request = privateFormRequest(eligibility); }
      catch {
        retainNativeSubmission();
        return;
      }
      event.preventDefault();
      void submitFormOperation(eligibility, request, sourceState);
    };
    if (active?.recoverCancelledMutation) {
      const finalizeAtWindow = (): void => {
        finalizingAtWindow = true;
        finalizeSubmission();
      };
      nativeActivationFinalizers.set(event, finalizeAtWindow);
      setTimeout(() => {
        if (nativeActivationFinalizers.get(event) !== finalizeAtWindow) return;
        nativeActivationFinalizers.delete(event);
        supersedePendingWorkForNativeActivation(
          "FADENO_UPDATE_NATIVE_FORM_SUPERSESSION",
          ownsCurrentContext()
            ? "browser-owned same-context form submission superseded pending navigation"
            : "browser-owned external-context form submission superseded pending navigation",
          Object.freeze({
            event,
            policyProtected: () => ownsCurrentContext() && form.relList.contains("noreferrer"),
          }),
        );
      }, 0);
      return;
    }
    finalizeSubmission();
  };
  const popstate = (): void => {
    if (mutationTraversalRecovery) {
      const recovery = mutationTraversalRecovery;
      mutationTraversalRecovery = undefined;
      recoverCommittedMutationCurrentTruth(recovery.currentTruthUrl, recovery.eligibility);
      return;
    }
    if (active?.kind === "mutation") {
      const mutationOperation = active;
      const submitted = activeFormEligibility?.operation === mutationOperation
        ? activeFormEligibility.eligibility
        : undefined;
      if (!submitted) {
        active.cancellation.abort(new DOMException("History traversal interrupted pending mutation", "AbortError"));
        restoreScrollRestoration();
        history.forward();
        return;
      }
      mutationTraversalRecovery = Object.freeze({
        operation: mutationOperation,
        currentTruthUrl: mutationOperation.currentTruthUrl,
        eligibility: submitted,
      });
      active.cancellation.abort(new DOMException("History traversal interrupted pending mutation", "AbortError"));
      restoreScrollRestoration();
      setTimeout(() => {
        if (mutationTraversalRecovery?.operation === mutationOperation) history.forward();
      }, 0);
      return;
    }
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
        if (recovery.recoverAfterRollback) {
          repairDisplayedTruth(
            recovery.truthUrl,
            "FADENO_FORM_FRAGMENT_RELOAD_CANCELLED",
            "cancelled pushed-fragment reload rolled back before current-truth recovery",
          );
          recovery.recoverCancelledMutation?.();
          recovery.restoreFocus?.();
          return;
        }
        try {
          if (recovery.stageDestination) {
            const stagedState = createHistoryState(scrollX, scrollY, false, historySession);
            const stagedPrivateState = privateHistoryState(stagedState);
            if (!stagedPrivateState) throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
            writeHistory.push(stagedState, recovery.destination.href);
            rememberHistoryState(stagedPrivateState, recovery.destination.href);
          }
          observeCancelledDeparture(
            () => location.href === recovery.destination.href,
            () => {
              if (recovery.recoverCancelledMutation) {
                repairDisplayedTruth(
                  recovery.truthUrl,
                  "FADENO_UPDATE_NATIVE_FALLBACK_CANCELLED",
                  "native post-selection mutation recovery was cancelled",
                );
                recovery.recoverCancelledMutation();
                recovery.restoreFocus?.();
                return;
              }
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
          fallback(
            recovery.destination,
            false,
            false,
            undefined,
            recovery.recoverCancelledMutation,
          );
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
    if (!state || repeatedSelection || !ownsHistoryState(state, location.href, true) || state.session !== historySession
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
    releaseHistoryMethods();
    globalThis.removeEventListener("click", finalizeNativeActivation);
    globalThis.removeEventListener("submit", finalizeNativeActivation);
    globalThis.removeEventListener("popstate", popstate);
    globalThis.removeEventListener("pagehide", pagehide);
    globalThis.removeEventListener("pageshow", pageshow);
    restoreScrollRestoration();
  };
  const pagehide = (event: PageTransitionEvent): void => {
    if (closing || !event.persisted) finishClose();
    else {
      releaseHistoryMethods();
      restoreScrollRestoration();
    }
  };
  const pageshow = (event: PageTransitionEvent): void => {
    if (!closed && event.persisted) {
      try {
        acquireHistoryMethods();
        if (!unsafeTraversalPersistence.refresh()) throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
        history.scrollRestoration = "manual";
        if (history.scrollRestoration !== "manual") throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
      }
      catch {
        historyWriteFailed = true;
        finishClose();
      }
    }
  };
  document.addEventListener("click", click);
  document.addEventListener("submit", submit);
  document.addEventListener("scroll", recordCurrentScroll, true);
  globalThis.addEventListener("click", finalizeNativeActivation);
  globalThis.addEventListener("submit", finalizeNativeActivation);
  globalThis.addEventListener("popstate", popstate);
  globalThis.addEventListener("pagehide", pagehide);
  globalThis.addEventListener("pageshow", pageshow);
  return Object.freeze({
    state: () => closed ? "closed" : closing ? "closing" : "active",
    close() {
      if (closed || closing) return;
      if (nativeDepartureRecovery) {
        closing = true;
        document.removeEventListener("click", click);
        document.removeEventListener("submit", submit);
        document.removeEventListener("scroll", recordCurrentScroll, true);
        restoreScrollRestoration();
        return;
      }
      const recoverCancelledMutation = active?.recoverCancelledMutation;
      if (!traversing && !committing && active?.kind !== "mutation" && !recoverCancelledMutation) {
        active?.cancellation.abort(new DOMException("Browser runtime closed", "AbortError"));
        finishClose();
        return;
      }
      closing = true;
      active?.cancellation.abort(new DOMException("Browser runtime closed", "AbortError"));
      document.removeEventListener("click", click);
      document.removeEventListener("submit", submit);
      document.removeEventListener("scroll", recordCurrentScroll, true);
      const recoverAfterCancelledClose = (): void => {
        if (!recoverCancelledMutation) return;
        try {
          document.addEventListener("click", click);
          document.addEventListener("submit", submit);
          document.addEventListener("scroll", recordCurrentScroll, true);
          history.scrollRestoration = "manual";
          if (history.scrollRestoration !== "manual") throw new TypeError("FADENO_UPDATE_HISTORY_STATE");
          closing = false;
          recoverCancelledMutation();
        } catch {
          finishClose();
          recoverCancelledMutation();
        }
      };
      const truthUrl = displayedTruthUrl;
      const selectedUrl = location.href;
      observeCancelledDeparture(
        () => closing && displayedTruthUrl === truthUrl && location.href === selectedUrl,
        () => {
          if (recoverCancelledMutation) {
            recoverAfterCancelledClose();
            return;
          }
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
        if (recoverCancelledMutation) {
          recoverAfterCancelledClose();
          return;
        }
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
