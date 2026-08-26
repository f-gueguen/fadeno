export const PRIVATE_RECONCILIATION_LIMITS = Object.freeze({
  maximumRecords: 4_096,
  maximumDepth: 16,
  maximumIdentityBytes: 128,
});

export type PrivateReconciliationRefusalCode =
  | "FADENO_RECONCILIATION_CONTENT"
  | "FADENO_RECONCILIATION_IDENTITY"
  | "FADENO_RECONCILIATION_LIMIT"
  | "FADENO_RECONCILIATION_OWNERSHIP"
  | "FADENO_RECONCILIATION_REPLACEMENT"
  | "FADENO_RECONCILIATION_SHAPE"
  | "FADENO_RECONCILIATION_SURFACE";

export class PrivateReconciliationRefusal extends TypeError {
  readonly code: PrivateReconciliationRefusalCode;

  constructor(code: PrivateReconciliationRefusalCode) {
    super(code);
    this.name = "PrivateReconciliationRefusal";
    this.code = code;
  }
}

export type PrivateReconciliationResult = Readonly<{
  rootIdentity: string;
  reusedIdentities: readonly string[];
  replacedIdentities: readonly string[];
}>;

export type PrivateReconciliationTransaction = Readonly<{
  preservesActiveElement: boolean;
  validate(): void;
  commit(): PrivateReconciliationResult;
  rollback(): void;
}>;

type Side = "current" | "incoming";

type CollectedSubtree = Readonly<{
  root: Element;
  elements: readonly Element[];
  identities: ReadonlyMap<string, Element>;
  identityByElement: ReadonlyMap<Element, string>;
  parents: ReadonlyMap<string, string | null>;
  children: ReadonlyMap<string, readonly string[]>;
}>;

type CollectedTree = CollectedSubtree & Readonly<{
  documentIdentities: ReadonlyMap<string, Element>;
}>;

type AttributeSnapshot = readonly Readonly<{
  element: Element;
  attributes: readonly (readonly [string, string])[];
}>[];

type ContentSnapshot = readonly Readonly<{
  element: Element;
  content: string;
}>[];

type LiveControlSnapshot = readonly (
  | Readonly<{
    kind: "input";
    element: HTMLInputElement;
    value: string | null;
    files: readonly File[] | null;
    checked: boolean;
    indeterminate: boolean;
    selection: ControlSelectionSnapshot | null;
  }>
  | Readonly<{
    kind: "select";
    element: HTMLSelectElement;
    selected: readonly boolean[];
    selectedIndex: number;
  }>
  | Readonly<{
    kind: "textarea";
    element: HTMLTextAreaElement;
    value: string;
    selection: ControlSelectionSnapshot | null;
  }>
)[];

type ControlSelectionSnapshot = Readonly<{
  direction: "backward" | "forward" | "none" | null;
  end: number;
  start: number;
}>;

type DocumentSelectionSnapshot = Readonly<{
  anchorNode: Node | null;
  anchorOffset: number;
  focusNode: Node | null;
  focusOffset: number;
  ranges: readonly Readonly<{
    endContainer: Node;
    endOffset: number;
    startContainer: Node;
    startOffset: number;
  }>[];
}>;

type LiveOwnerSnapshot = readonly (
  | Readonly<{
    kind: "details";
    element: HTMLDetailsElement;
    open: boolean;
  }>
  | Readonly<{
    kind: "dialog";
    element: HTMLDialogElement;
    modal: boolean;
    open: boolean;
  }>
  | Readonly<{
    kind: "popover";
    element: HTMLElement;
    open: boolean;
  }>
  | Readonly<{
    kind: "media";
    element: HTMLMediaElement;
    currentTime: number | null;
    paused: boolean;
    playbackRate: number;
  }>
)[];

type AttributePlan = Readonly<{
  element: Element;
  remove: readonly string[];
  set: readonly (readonly [string, string])[];
}>;

type TextPlan = Readonly<{
  element: Element;
  text: string;
}>;

type StructurePlan = Readonly<{
  parent: Element;
  desiredChildren: readonly Element[];
  originalChildren: readonly Element[];
}>;

type StructureSnapshot = Readonly<{
  parent: Element;
  originalChildren: readonly Element[];
}>;

const encoder = new TextEncoder();
const htmlNamespace = "http://www.w3.org/1999/xhtml";
const opaqueElementName = "fadeno-island";
const frameworkProofFieldName = "__fadeno_proof";
const frameworkProofIdentityPrefix = "\u0000fadeno-proof:";
const initialDisclosureState = new WeakMap<
  HTMLDetailsElement | HTMLDialogElement,
  boolean
>();
const supportedDescendantNames = new Set([
  "a",
  "audio",
  "button",
  "details",
  "dialog",
  "div",
  "fadeno-island",
  "form",
  "h1",
  "input",
  "label",
  "nav",
  "option",
  "output",
  "p",
  "section",
  "select",
  "span",
  "summary",
  "textarea",
]);
const supportedAttributeNames = new Set([
  "action",
  "aria-busy",
  "aria-label",
  "checked",
  "class",
  "contenteditable",
  "data-fadeno-navigation-focus",
  "disabled",
  "enctype",
  "for",
  "href",
  "id",
  "method",
  "name",
  "open",
  "popover",
  "preload",
  "role",
  "selected",
  "src",
  "tabindex",
  "target",
  "type",
  "value",
]);
const supportedInputTypes = new Set([
  "checkbox",
  "file",
  "hidden",
  "radio",
  "submit",
  "text",
]);

function refuse(code: PrivateReconciliationRefusalCode): never {
  throw new PrivateReconciliationRefusal(code);
}

function boundedIdentity(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.trim() === value
    && !value.includes("\u0000")
    && encoder.encode(value).byteLength <= PRIVATE_RECONCILIATION_LIMITS.maximumIdentityBytes;
}

function frameworkProofIdentity(element: Element, parentIdentity: string | null): string | undefined {
  if (parentIdentity === null
    || element.localName !== "input"
    || element.hasAttribute("id")
    || element.getAttribute("type")?.toLowerCase() !== "hidden"
    || element.getAttribute("name") !== frameworkProofFieldName
    || element.parentElement?.localName !== "form") return undefined;
  const identity = `${frameworkProofIdentityPrefix}${parentIdentity}`;
  if (encoder.encode(identity).byteLength
    > PRIVATE_RECONCILIATION_LIMITS.maximumIdentityBytes) {
    refuse("FADENO_RECONCILIATION_IDENTITY");
  }
  return identity;
}

function elementName(element: Element): string {
  return `${element.namespaceURI ?? ""}:${element.localName}`;
}

function validateUrlAttribute(element: Element, name: string, value: string): void {
  if (name !== "href" && name !== "action") return;
  try {
    const received = new URL(value, location.href);
    if (received.origin !== location.origin
      || received.username !== ""
      || received.password !== ""
      || (received.protocol !== "https:"
        && !(received.protocol === "http:"
          && new Set(["127.0.0.1", "localhost", "[::1]"]).has(received.hostname)))) {
      refuse("FADENO_RECONCILIATION_SURFACE");
    }
  } catch {
    refuse("FADENO_RECONCILIATION_SURFACE");
  }
  if (name === "action" && element.localName !== "form") {
    refuse("FADENO_RECONCILIATION_SURFACE");
  }
}

function validateAttributeOwner(
  element: Element,
  name: string,
  value: string,
): void {
  const localName = element.localName;
  const owned =
    name === "id"
    || name === "class"
    || name === "aria-label"
    || (name === "aria-busy" && localName === "form")
    || name === "role"
    || name === "tabindex"
    || name === "data-fadeno-navigation-focus"
    || (name === "href" && localName === "a")
    || (name === "target" && (localName === "a" || localName === "form"))
    || ((name === "action" || name === "method" || name === "enctype") && localName === "form")
    || (name === "for" && localName === "label")
    || (name === "disabled" && ["button", "input", "option", "select"].includes(localName))
    || (name === "value" && (localName === "input" || localName === "option"))
    || (name === "type" && (localName === "button" || localName === "input"))
    || (name === "name" && (localName === "input" || localName === "select"))
    || (name === "checked" && localName === "input")
    || (name === "selected" && localName === "option")
    || (name === "contenteditable" && (localName === "div" || localName === "span"))
    || (name === "open" && (localName === "details" || localName === "dialog"))
    || (name === "popover" && (localName === "div" || localName === "span"))
    || ((name === "src" || name === "preload") && localName === "audio");
  if (!owned) refuse("FADENO_RECONCILIATION_SURFACE");
  validateUrlAttribute(element, name, value);
}

function validateElementSurface(
  element: Element,
  side: Side,
  depth: number,
): void {
  if (depth > PRIVATE_RECONCILIATION_LIMITS.maximumDepth) {
    refuse("FADENO_RECONCILIATION_LIMIT");
  }
  if (element.namespaceURI !== htmlNamespace) {
    refuse("FADENO_RECONCILIATION_SURFACE");
  }
  if (depth === 1 ? element.localName !== "main" : !supportedDescendantNames.has(element.localName)) {
    refuse("FADENO_RECONCILIATION_SURFACE");
  }
  for (const name of element.getAttributeNames()) {
    if (!supportedAttributeNames.has(name)) {
      refuse("FADENO_RECONCILIATION_SURFACE");
    }
    validateAttributeOwner(element, name, element.getAttribute(name) ?? "");
  }
  if (element.localName === "input") {
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    if (!supportedInputTypes.has(type)
      || (type === "file" && element.hasAttribute("value"))
      || (element.hasAttribute("checked") && type !== "checkbox" && type !== "radio")) {
      refuse("FADENO_RECONCILIATION_SURFACE");
    }
  }
  if (element.localName === "button") {
    const type = (element.getAttribute("type") ?? "submit").toLowerCase();
    if (type !== "submit" && type !== "button") {
      refuse("FADENO_RECONCILIATION_SURFACE");
    }
  }
  if (element.localName === "form") {
    const method = (element.getAttribute("method") ?? "get").toLowerCase();
    const encoding = (element.getAttribute("enctype") ?? "application/x-www-form-urlencoded").toLowerCase();
    if ((method !== "get" && method !== "post")
      || (encoding !== "application/x-www-form-urlencoded"
        && encoding !== "multipart/form-data")) {
      refuse("FADENO_RECONCILIATION_SURFACE");
    }
  }
  if (element.hasAttribute("contenteditable")) {
    const value = element.getAttribute("contenteditable");
    if (value !== "" && value !== "true" && value !== "plaintext-only") {
      refuse("FADENO_RECONCILIATION_SURFACE");
    }
  }
  if (element.hasAttribute("popover")) {
    const value = element.getAttribute("popover");
    if (value !== "" && value !== "auto" && value !== "manual") {
      refuse("FADENO_RECONCILIATION_SURFACE");
    }
  }
  if (element.localName === "audio") {
    const source = element.getAttribute("src");
    const preload = element.getAttribute("preload");
    if (!source?.startsWith("data:audio/wav;base64,")
      || (preload !== null && !["auto", "metadata", "none"].includes(preload))) {
      refuse("FADENO_RECONCILIATION_SURFACE");
    }
  }
  if (side === "incoming"
    && element.localName === "a"
    && element.getAttribute("target") !== null
    && element.getAttribute("target") !== "_self") {
    refuse("FADENO_RECONCILIATION_SURFACE");
  }
}

function collectTree(root: Element, side: Side): CollectedSubtree {
  const elements: Element[] = [];
  const identities = new Map<string, Element>();
  const identityByElement = new Map<Element, string>();
  const parents = new Map<string, string | null>();
  const children = new Map<string, readonly string[]>();

  const visit = (element: Element, parentIdentity: string | null, depth: number): void => {
    if (elements.length >= PRIVATE_RECONCILIATION_LIMITS.maximumRecords) {
      refuse("FADENO_RECONCILIATION_LIMIT");
    }
    validateElementSurface(element, side, depth);
    const identity = boundedIdentity(element.id)
      ? element.id
      : frameworkProofIdentity(element, parentIdentity);
    if (!identity || identities.has(identity)) {
      refuse("FADENO_RECONCILIATION_IDENTITY");
    }
    identities.set(identity, element);
    identityByElement.set(element, identity);
    parents.set(identity, parentIdentity);
    elements.push(element);

    if (element.localName === opaqueElementName) {
      if (element.querySelector("[id]")) {
        refuse("FADENO_RECONCILIATION_OWNERSHIP");
      }
      children.set(identity, []);
      return;
    }

    const elementChildren = Array.from(element.children);
    const childNodes = Array.from(element.childNodes);
    if (elementChildren.length > 0) {
      if (childNodes.some((node) => node.nodeType !== Node.ELEMENT_NODE)) {
        refuse("FADENO_RECONCILIATION_SHAPE");
      }
    } else if (childNodes.some((node) => node.nodeType !== Node.TEXT_NODE)) {
      refuse("FADENO_RECONCILIATION_SHAPE");
    }
    const childIdentities: string[] = [];
    for (const child of elementChildren) {
      const childIdentity = boundedIdentity(child.id)
        ? child.id
        : frameworkProofIdentity(child, identity);
      if (!childIdentity) {
        refuse("FADENO_RECONCILIATION_IDENTITY");
      }
      childIdentities.push(childIdentity);
      visit(child, identity, depth + 1);
    }
    children.set(identity, Object.freeze(childIdentities));
  };

  visit(root, null, 1);
  return Object.freeze({
    root,
    elements: Object.freeze(elements),
    identities,
    identityByElement,
    parents,
    children,
  });
}

function collectDocument(document_: Document, side: Side): CollectedTree {
  const roots = [...document_.querySelectorAll("main[id]")];
  if (roots.length !== 1) {
    refuse("FADENO_RECONCILIATION_SHAPE");
  }
  const tree = collectTree(roots[0] ?? refuse("FADENO_RECONCILIATION_SHAPE"), side);
  const bodyElements = [...document_.body.children];
  if (bodyElements.length !== 1 || bodyElements[0] !== tree.root) {
    refuse("FADENO_RECONCILIATION_SHAPE");
  }
  const documentIdentities = new Map<string, Element>();
  const walker = document_.createTreeWalker(
    document_.documentElement,
    NodeFilter.SHOW_ELEMENT,
  );
  let element: Element | null = walker.currentNode as Element;
  while (element !== null) {
    if (element.hasAttribute("id")) {
      if (documentIdentities.size >= PRIVATE_RECONCILIATION_LIMITS.maximumRecords) {
        refuse("FADENO_RECONCILIATION_LIMIT");
      }
      if (!boundedIdentity(element.id) || documentIdentities.has(element.id)) {
        refuse("FADENO_RECONCILIATION_IDENTITY");
      }
      documentIdentities.set(element.id, element);
    }
    element = walker.nextNode() as Element | null;
  }
  for (const element of tree.elements) {
    const identity = tree.identityByElement.get(element)
      ?? refuse("FADENO_RECONCILIATION_OWNERSHIP");
    if (!identity.startsWith(frameworkProofIdentityPrefix)
      && documentIdentities.get(identity) !== element) {
      refuse("FADENO_RECONCILIATION_OWNERSHIP");
    }
  }
  return Object.freeze({ ...tree, documentIdentities });
}

function boundedLiveElements(tree: CollectedTree): readonly Element[] {
  const elements = [...tree.elements];
  for (const opaque of tree.elements) {
    if (opaque.localName !== opaqueElementName) continue;
    const walker = opaque.ownerDocument.createTreeWalker(
      opaque,
      NodeFilter.SHOW_ELEMENT,
    );
    let element = walker.nextNode() as Element | null;
    while (element !== null) {
      if (elements.length >= PRIVATE_RECONCILIATION_LIMITS.maximumRecords) {
        refuse("FADENO_RECONCILIATION_LIMIT");
      }
      elements.push(element);
      element = walker.nextNode() as Element | null;
    }
  }
  return Object.freeze(elements);
}

function preservesStateAttribute(element: Element, name: string): boolean {
  if (name === "open" && (element.localName === "details" || element.localName === "dialog")) {
    return true;
  }
  return element === element.ownerDocument.activeElement
    && (name === "data-fadeno-navigation-focus" || name === "tabindex");
}

function prepareAttributePlan(current: Element, incoming: Element): AttributePlan {
  const incomingNames = new Set(incoming.getAttributeNames());
  const remove = current.getAttributeNames().filter((name) =>
    name !== "id"
    && !preservesStateAttribute(current, name)
    && !incomingNames.has(name)
  );
  const set: Array<readonly [string, string]> = [];
  for (const name of incomingNames) {
    if (name === "id" || preservesStateAttribute(current, name)) continue;
    const value = incoming.getAttribute(name) ?? refuse("FADENO_RECONCILIATION_SURFACE");
    if (current.getAttribute(name) !== value) set.push(Object.freeze([name, value]));
  }
  return Object.freeze({
    element: current,
    remove: Object.freeze(remove),
    set: Object.freeze(set),
  });
}

function stateOwnedLeafContent(element: Element): boolean {
  return element.localName === "textarea"
    || element.hasAttribute("contenteditable")
    || element.localName === "audio";
}

function selectionIntersects(
  document_: Document,
  element: Element,
  requireNonCollapsed: boolean,
): boolean {
  const selection = document_.getSelection();
  if (!selection || (requireNonCollapsed && selection.isCollapsed)) return false;
  for (let index = 0; index < selection.rangeCount; index += 1) {
    try {
      if (selection.getRangeAt(index).intersectsNode(element)) return true;
    } catch { /* detached or unsupported range falls back to endpoint ownership */ }
  }
  return Boolean((selection.anchorNode && element.contains(selection.anchorNode))
    || (selection.focusNode && element.contains(selection.focusNode)));
}

function ownsOpenPopover(element: Element): boolean {
  try {
    return element.matches(":popover-open")
      || element.querySelector(":popover-open") !== null;
  } catch {
    return element.matches("[popover]")
      || element.querySelector("[popover]") !== null;
  }
}

function ownsBrowserState(document_: Document, element: Element): boolean {
  const active = document_.activeElement;
  if ((active && element.contains(active)) || selectionIntersects(document_, element, false)) {
    return true;
  }
  if (ownsOpenPopover(element)) return true;
  return element.matches(
    "input, textarea, select, details, dialog, audio, fadeno-island, [contenteditable]",
  ) || element.querySelector(
    "input, textarea, select, details, dialog, audio, fadeno-island, [contenteditable]",
  ) !== null;
}

type DirtyRadioGroups = ReadonlyMap<string, ReadonlySet<string | null>>;

function radioFormIdentity(
  tree: CollectedTree,
  radio: HTMLInputElement,
): string | null | undefined {
  return radio.form === null ? null : tree.identityByElement.get(radio.form);
}

function collectDirtyRadioGroups(tree: CollectedTree): DirtyRadioGroups {
  const groups = new Map<string, Set<string | null>>();
  for (const element of tree.elements) {
    if (!(element instanceof HTMLInputElement)
      || element.type !== "radio"
      || element.checked === element.defaultChecked) continue;
    const form = radioFormIdentity(tree, element);
    if (form === undefined) continue;
    const forms = groups.get(element.name) ?? new Set<string | null>();
    forms.add(form);
    groups.set(element.name, forms);
  }
  return groups;
}

function inDirtyRadioGroup(
  groups: DirtyRadioGroups,
  tree: CollectedTree,
  radio: HTMLInputElement,
): boolean {
  const form = radioFormIdentity(tree, radio);
  return form !== undefined && groups.get(radio.name)?.has(form) === true;
}

function sameRadioGroup(
  currentTree: CollectedTree,
  currentRadio: HTMLInputElement,
  incomingTree: CollectedTree,
  incomingRadio: HTMLInputElement,
): boolean {
  const currentForm = radioFormIdentity(currentTree, currentRadio);
  return currentRadio.name === incomingRadio.name
    && currentForm !== undefined
    && currentForm === radioFormIdentity(incomingTree, incomingRadio);
}

function dirtySelect(owner: HTMLSelectElement): boolean {
  return Array.from(owner.options).some(({ selected, defaultSelected }) =>
    selected !== defaultSelected
  );
}

function directlyMovedChildren(plan: StructurePlan): readonly Element[] {
  const desired = new Set(plan.desiredChildren);
  const sequence = Array.from(plan.parent.children).filter((child) => desired.has(child));
  const moved: Element[] = [];
  let cursor: Element | null = null;
  for (const child of [...plan.desiredChildren].reverse()) {
    const originalIndex = sequence.indexOf(child);
    const next = originalIndex < 0 ? null : sequence[originalIndex + 1] ?? null;
    if (originalIndex < 0 || next !== cursor) {
      if (originalIndex >= 0) {
        sequence.splice(originalIndex, 1);
        moved.push(child);
      }
      const cursorIndex = cursor === null ? sequence.length : sequence.indexOf(cursor);
      sequence.splice(cursorIndex, 0, child);
    }
    cursor = child;
  }
  return Object.freeze(moved);
}

function selectionCoversInsertion(
  document_: Document,
  plan: StructurePlan,
): boolean {
  if (!plan.parent.isConnected) return false;
  const selection = document_.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  const currentChildren = Array.from(plan.parent.children);
  const currentIndexes = new Map(
    currentChildren.map((child, index) => [child, index] as const),
  );
  const nextOffsets: Array<number | undefined> = [];
  let nextOffset: number | undefined;
  for (let index = plan.desiredChildren.length - 1; index >= 0; index -= 1) {
    const retainedIndex = currentIndexes.get(plan.desiredChildren[index]!);
    if (retainedIndex !== undefined) nextOffset = retainedIndex;
    nextOffsets[index] = nextOffset;
  }
  const ranges = Array.from(
    { length: selection.rangeCount },
    (_, index) => selection.getRangeAt(index),
  );
  const covered = (offset: number): boolean => ranges.some((range) => {
    try {
      return range.comparePoint(plan.parent, offset) === 0;
    } catch {
      refuse("FADENO_RECONCILIATION_OWNERSHIP");
    }
  });
  let previousOffset: number | undefined;
  for (let index = 0; index < plan.desiredChildren.length; index += 1) {
    const retainedIndex = currentIndexes.get(plan.desiredChildren[index]!);
    if (retainedIndex !== undefined) {
      previousOffset = retainedIndex + 1;
      continue;
    }
    const followingOffset = nextOffsets[index];
    if (followingOffset !== undefined && covered(followingOffset)) return true;
    if (previousOffset !== undefined && previousOffset !== followingOffset
      && covered(previousOffset)) return true;
    if (followingOffset === undefined && previousOffset === undefined
      && covered(currentChildren.length)) return true;
  }
  return false;
}

function controlSelection(
  element: HTMLInputElement | HTMLTextAreaElement,
): ControlSelectionSnapshot | null {
  try {
    const start = element.selectionStart;
    const end = element.selectionEnd;
    if (start === null || end === null) return null;
    return Object.freeze({
      direction: element.selectionDirection,
      end,
      start,
    });
  } catch {
    return null;
  }
}

function sameControlSelection(
  element: HTMLInputElement | HTMLTextAreaElement,
  expected: ControlSelectionSnapshot | null,
): boolean {
  const current = controlSelection(element);
  return current === null
    ? expected === null
    : expected !== null
      && current.start === expected.start
      && current.end === expected.end
      && current.direction === expected.direction;
}

function snapshotLiveControls(elements: readonly Element[]): LiveControlSnapshot {
  const snapshot: Array<LiveControlSnapshot[number]> = [];
  for (const element of elements) {
    if (element instanceof HTMLInputElement) {
      snapshot.push(Object.freeze({
        kind: "input",
        element,
        value: element.type === "file" ? null : element.value,
        files: element.type === "file"
          ? Object.freeze(Array.from(element.files ?? []))
          : null,
        checked: element.checked,
        indeterminate: element.indeterminate,
        selection: controlSelection(element),
      }));
    } else if (element instanceof HTMLSelectElement) {
      snapshot.push(Object.freeze({
        kind: "select",
        element,
        selected: Object.freeze(Array.from(element.options, ({ selected }) => selected)),
        selectedIndex: element.selectedIndex,
      }));
    } else if (element instanceof HTMLTextAreaElement) {
      snapshot.push(Object.freeze({
        kind: "textarea",
        element,
        value: element.value,
        selection: controlSelection(element),
      }));
    }
  }
  return Object.freeze(snapshot);
}

function sameFiles(element: HTMLInputElement, expected: readonly File[] | null): boolean {
  if (expected === null) return true;
  const current = Array.from(element.files ?? []);
  return current.length === expected.length
    && current.every((file, index) => file === expected[index]);
}

function restoreFiles(element: HTMLInputElement, expected: readonly File[]): void {
  if (sameFiles(element, expected)) return;
  const transfer = new DataTransfer();
  for (const file of expected) transfer.items.add(file);
  element.files = transfer.files;
}

function restoreLiveControls(snapshot: LiveControlSnapshot): void {
  if (sameLiveControls(snapshot)) return;
  for (const entry of snapshot) {
    if (entry.kind === "input" && entry.element.type === "radio") {
      entry.element.checked = false;
    }
  }
  for (const entry of snapshot) {
    if (entry.kind === "input") {
      if (entry.value !== null && entry.element.value !== entry.value) {
        entry.element.value = entry.value;
      }
      if (entry.files !== null) restoreFiles(entry.element, entry.files);
      if (entry.element.type !== "radio"
        && entry.element.checked !== entry.checked) {
        entry.element.checked = entry.checked;
      }
      if (entry.element.indeterminate !== entry.indeterminate) {
        entry.element.indeterminate = entry.indeterminate;
      }
      if (!sameControlSelection(entry.element, entry.selection)
        && entry.selection !== null) {
        entry.element.setSelectionRange(
          entry.selection.start,
          entry.selection.end,
          entry.selection.direction ?? undefined,
        );
      }
    } else if (entry.kind === "textarea") {
      if (entry.element.value !== entry.value) entry.element.value = entry.value;
      if (!sameControlSelection(entry.element, entry.selection)
        && entry.selection !== null) {
        entry.element.setSelectionRange(
          entry.selection.start,
          entry.selection.end,
          entry.selection.direction ?? undefined,
        );
      }
    } else {
      const sameOptions = entry.element.options.length === entry.selected.length
        && entry.selected.every((selected, index) =>
          entry.element.options.item(index)?.selected === selected
        );
      if (!sameOptions || entry.element.selectedIndex !== entry.selectedIndex) {
        for (const option of entry.element.options) option.selected = false;
        entry.selected.forEach((selected, index) => {
          const option = entry.element.options.item(index);
          if (option) option.selected = selected;
        });
        entry.element.selectedIndex = entry.selectedIndex;
      }
    }
  }
  for (const entry of snapshot) {
    if (entry.kind === "input" && entry.element.type === "radio" && entry.checked) {
      entry.element.checked = true;
    }
  }
}

function sameLiveControls(snapshot: LiveControlSnapshot): boolean {
  return snapshot.every((entry) => {
    if (entry.kind === "input") {
      return (entry.value === null || entry.element.value === entry.value)
        && sameFiles(entry.element, entry.files)
        && entry.element.checked === entry.checked
        && entry.element.indeterminate === entry.indeterminate
        && sameControlSelection(entry.element, entry.selection);
    }
    if (entry.kind === "textarea") {
      return entry.element.value === entry.value
        && sameControlSelection(entry.element, entry.selection);
    }
    return entry.element.options.length === entry.selected.length
      && entry.element.selectedIndex === entry.selectedIndex
      && entry.selected.every((selected, index) =>
        entry.element.options.item(index)?.selected === selected
      );
  });
}

function snapshotDocumentSelection(document_: Document): DocumentSelectionSnapshot {
  const selection = document_.getSelection();
  const ranges: Array<DocumentSelectionSnapshot["ranges"][number]> = [];
  if (selection) {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      const range = selection.getRangeAt(index);
      ranges.push(Object.freeze({
        endContainer: range.endContainer,
        endOffset: range.endOffset,
        startContainer: range.startContainer,
        startOffset: range.startOffset,
      }));
    }
  }
  return Object.freeze({
    anchorNode: selection?.anchorNode ?? null,
    anchorOffset: selection?.anchorOffset ?? 0,
    focusNode: selection?.focusNode ?? null,
    focusOffset: selection?.focusOffset ?? 0,
    ranges: Object.freeze(ranges),
  });
}

function sameDocumentSelection(
  document_: Document,
  expected: DocumentSelectionSnapshot,
): boolean {
  const current = document_.getSelection();
  if (!current) {
    return expected.anchorNode === null
      && expected.focusNode === null
      && expected.ranges.length === 0;
  }
  if (current.anchorNode !== expected.anchorNode
    || current.anchorOffset !== expected.anchorOffset
    || current.focusNode !== expected.focusNode
    || current.focusOffset !== expected.focusOffset
    || current.rangeCount !== expected.ranges.length) {
    return false;
  }
  return expected.ranges.every((range, index) => {
    const received = current.getRangeAt(index);
    return received.startContainer === range.startContainer
      && received.startOffset === range.startOffset
      && received.endContainer === range.endContainer
      && received.endOffset === range.endOffset;
  });
}

function restoreDocumentSelection(
  document_: Document,
  expected: DocumentSelectionSnapshot,
): void {
  if (sameDocumentSelection(document_, expected)) return;
  const selection = document_.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  if (expected.anchorNode?.isConnected
    && expected.focusNode?.isConnected
    && expected.ranges.length === 1) {
    selection.setBaseAndExtent(
      expected.anchorNode,
      expected.anchorOffset,
      expected.focusNode,
      expected.focusOffset,
    );
    return;
  }
  for (const expectedRange of expected.ranges) {
    if (!expectedRange.startContainer.isConnected
      || !expectedRange.endContainer.isConnected) continue;
    const range = document_.createRange();
    range.setStart(expectedRange.startContainer, expectedRange.startOffset);
    range.setEnd(expectedRange.endContainer, expectedRange.endOffset);
    selection.addRange(range);
  }
}

function popoverOpen(element: HTMLElement): boolean {
  try {
    return element.matches(":popover-open");
  } catch {
    return false;
  }
}

function dialogModal(element: HTMLDialogElement): boolean {
  try {
    return element.matches(":modal");
  } catch {
    return false;
  }
}

function snapshotLiveOwners(elements: readonly Element[]): LiveOwnerSnapshot {
  const snapshot: Array<LiveOwnerSnapshot[number]> = [];
  for (const element of elements) {
    if (element instanceof HTMLDetailsElement) {
      snapshot.push(Object.freeze({ kind: "details", element, open: element.open }));
    } else if (element instanceof HTMLDialogElement) {
      snapshot.push(Object.freeze({
        kind: "dialog",
        element,
        modal: dialogModal(element),
        open: element.open,
      }));
    } else if (element instanceof HTMLElement && element.hasAttribute("popover")) {
      snapshot.push(Object.freeze({
        kind: "popover",
        element,
        open: popoverOpen(element),
      }));
    } else if (element instanceof HTMLMediaElement) {
      snapshot.push(Object.freeze({
        kind: "media",
        element,
        currentTime: element.paused ? element.currentTime : null,
        paused: element.paused,
        playbackRate: element.playbackRate,
      }));
    }
  }
  return Object.freeze(snapshot);
}

function sameLiveOwners(snapshot: LiveOwnerSnapshot): boolean {
  return snapshot.every((entry) => {
    if (entry.kind === "details") return entry.element.open === entry.open;
    if (entry.kind === "dialog") {
      return entry.element.open === entry.open
        && dialogModal(entry.element) === entry.modal;
    }
    if (entry.kind === "popover") return popoverOpen(entry.element) === entry.open;
    return entry.element.paused === entry.paused
      && entry.element.playbackRate === entry.playbackRate
      && (entry.currentTime === null
        || entry.element.currentTime === entry.currentTime);
  });
}

function restoreLiveOwners(snapshot: LiveOwnerSnapshot): void {
  for (const entry of snapshot) {
    if (entry.kind === "details") {
      if (entry.element.open !== entry.open) entry.element.open = entry.open;
    } else if (entry.kind === "dialog") {
      const currentModal = dialogModal(entry.element);
      if (!entry.open) {
        if (entry.element.open) entry.element.close();
      } else if (!entry.element.open || currentModal !== entry.modal) {
        if (entry.element.open) entry.element.close();
        if (entry.modal) entry.element.showModal();
        else entry.element.show();
      }
    } else if (entry.kind === "popover") {
      const currentOpen = popoverOpen(entry.element);
      if (entry.open && !currentOpen) entry.element.showPopover();
      else if (!entry.open && currentOpen) entry.element.hidePopover();
    } else {
      if (entry.element.playbackRate !== entry.playbackRate) {
        entry.element.playbackRate = entry.playbackRate;
      }
      if (entry.paused) {
        if (!entry.element.paused) entry.element.pause();
        if (entry.currentTime !== null
          && entry.element.currentTime !== entry.currentTime) {
          entry.element.currentTime = entry.currentTime;
        }
      } else if (entry.element.paused) {
        void entry.element.play().catch(() => undefined);
      }
    }
  }
}

function attributes(element: Element): readonly (readonly [string, string])[] {
  return Object.freeze(element.getAttributeNames().map((name) =>
    Object.freeze([name, element.getAttribute(name) ?? ""] as const)
  ));
}

function sameAttributes(
  element: Element,
  expected: readonly (readonly [string, string])[],
): boolean {
  const received = element.getAttributeNames();
  return received.length === expected.length
    && expected.every(([name, value]) => element.getAttribute(name) === value);
}

function sameIdentitySequence(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  return left !== undefined
    && right !== undefined
    && left.length === right.length
    && left.every((identity, index) => identity === right[index]);
}

function assertPreparedCurrentTree(
  document_: Document,
  expected: CollectedTree,
  attributeSnapshot: AttributeSnapshot,
  contentSnapshot: ContentSnapshot,
): void {
  const received = collectDocument(document_, "current");
  if (received.root !== expected.root
    || received.elements.length !== expected.elements.length
    || received.documentIdentities.size !== expected.documentIdentities.size) {
    refuse("FADENO_RECONCILIATION_OWNERSHIP");
  }
  for (const [identity, element] of expected.documentIdentities) {
    if (received.documentIdentities.get(identity) !== element) {
      refuse("FADENO_RECONCILIATION_OWNERSHIP");
    }
  }
  for (const [identity, element] of expected.identities) {
    if (received.identities.get(identity) !== element
      || received.parents.get(identity) !== expected.parents.get(identity)
      || !sameIdentitySequence(
        received.children.get(identity),
        expected.children.get(identity),
      )) {
      refuse("FADENO_RECONCILIATION_OWNERSHIP");
    }
  }
  if (attributeSnapshot.some(({ element, attributes: expectedAttributes }) =>
    !sameAttributes(element, expectedAttributes)
  )) {
    refuse("FADENO_RECONCILIATION_OWNERSHIP");
  }
  if (contentSnapshot.some(({ element, content }) => element.innerHTML !== content)) {
    refuse("FADENO_RECONCILIATION_OWNERSHIP");
  }
}

function restoreAttributes(snapshot: AttributeSnapshot): void {
  for (const { element, attributes: expected } of snapshot) {
    const names = new Set(expected.map(([name]) => name));
    for (const name of element.getAttributeNames()) {
      if (!names.has(name)) element.removeAttribute(name);
    }
    for (const [name, value] of expected) {
      if (element.getAttribute(name) !== value) element.setAttribute(name, value);
    }
  }
}

function restoreStructure(plans: readonly StructureSnapshot[]): void {
  for (const { parent, originalChildren } of [...plans].reverse()) {
    const original = new Set(originalChildren);
    for (const child of Array.from(parent.children)) {
      if (!original.has(child)) child.remove();
    }
    let cursor: Element | null = null;
    for (const child of [...originalChildren].reverse()) {
      if (child.parentElement !== parent || child.nextElementSibling !== cursor) {
        parent.insertBefore(child, cursor);
      }
      cursor = child;
    }
  }
}

export function privateCurrentDocumentReconciliationSafe(
  document_: Document = document,
  requiredOwners: readonly Node[] = [],
): boolean {
  try {
    const tree = collectDocument(document_, "current");
    return requiredOwners.every((owner) => owner === tree.root || tree.root.contains(owner));
  } catch {
    return false;
  }
}

export function recordPrivateDisclosureState(
  document_: Document = document,
): void {
  for (const element of document_.querySelectorAll("details, dialog")) {
    if ((element instanceof HTMLDetailsElement
        || element instanceof HTMLDialogElement)
      && !initialDisclosureState.has(element)) {
      initialDisclosureState.set(element, element.open);
    }
  }
}

export function privateDisclosureStateOwners(
  document_: Document = document,
): readonly (HTMLDetailsElement | HTMLDialogElement)[] {
  recordPrivateDisclosureState(document_);
  return Object.freeze(
    Array.from(document_.querySelectorAll("details, dialog"))
      .filter((element): element is HTMLDetailsElement | HTMLDialogElement =>
        (element instanceof HTMLDetailsElement
          || element instanceof HTMLDialogElement)
        && (element.open
          || initialDisclosureState.get(element) !== element.open)
      ),
  );
}

export function preparePrivateDocumentReconciliation(
  currentDocument: Document,
  incomingDocument: Document,
  replacementIdentities: readonly string[] = [],
): PrivateReconciliationTransaction {
  if (!Array.isArray(replacementIdentities)
    || replacementIdentities.some((identity) => !boundedIdentity(identity))) {
    refuse("FADENO_RECONCILIATION_REPLACEMENT");
  }
  const replacementSet = new Set(replacementIdentities);
  if (replacementSet.size !== replacementIdentities.length) {
    refuse("FADENO_RECONCILIATION_REPLACEMENT");
  }

  const current = collectDocument(currentDocument, "current");
  const incoming = collectDocument(incomingDocument, "incoming");
  const dirtyRadioGroups = collectDirtyRadioGroups(current);
  if (current.root.id !== incoming.root.id || replacementSet.has(current.root.id)) {
    refuse("FADENO_RECONCILIATION_IDENTITY");
  }

  for (const incomingElement of incoming.elements) {
    const identity = incoming.identityByElement.get(incomingElement)
      ?? refuse("FADENO_RECONCILIATION_OWNERSHIP");
    const currentElement = current.identities.get(identity);
    if (!currentElement) {
      if (current.documentIdentities.has(identity)
        || incomingElement.localName === opaqueElementName) {
        refuse("FADENO_RECONCILIATION_OWNERSHIP");
      }
      if (incomingElement instanceof HTMLInputElement
        && incomingElement.type === "radio"
        && incomingElement.hasAttribute("checked")
        && inDirtyRadioGroup(dirtyRadioGroups, incoming, incomingElement)) {
        refuse("FADENO_RECONCILIATION_OWNERSHIP");
      }
      continue;
    }
    if (elementName(currentElement) !== elementName(incomingElement)
      || current.parents.get(identity) !== incoming.parents.get(identity)) {
      refuse("FADENO_RECONCILIATION_OWNERSHIP");
    }
    if (currentElement.localName === "input") {
      const currentType = (currentElement.getAttribute("type") ?? "text").toLowerCase();
      const incomingType = (incomingElement.getAttribute("type") ?? "text").toLowerCase();
      if (currentType !== incomingType) {
        refuse("FADENO_RECONCILIATION_OWNERSHIP");
      }
      if (currentElement instanceof HTMLInputElement
        && currentType === "radio"
        && inDirtyRadioGroup(dirtyRadioGroups, current, currentElement)
        && (currentElement.hasAttribute("checked")
          !== incomingElement.hasAttribute("checked")
          || currentElement.getAttribute("name") !== incomingElement.getAttribute("name"))) {
        refuse("FADENO_RECONCILIATION_OWNERSHIP");
      }
      if (currentElement instanceof HTMLInputElement
        && incomingElement instanceof HTMLInputElement
        && currentType === "radio"
        && (currentElement.checked || incomingElement.checked)
        && !sameRadioGroup(current, currentElement, incoming, incomingElement)
        && inDirtyRadioGroup(dirtyRadioGroups, incoming, incomingElement)) {
        refuse("FADENO_RECONCILIATION_OWNERSHIP");
      }
      if (currentElement instanceof HTMLInputElement
        && currentType === "checkbox"
        && currentElement.indeterminate
        && currentElement.hasAttribute("checked")
          !== incomingElement.hasAttribute("checked")) {
        refuse("FADENO_RECONCILIATION_OWNERSHIP");
      }
      if (currentElement instanceof HTMLInputElement
        && currentType === "text"
        && currentDocument.activeElement === currentElement
        && currentElement.getAttribute("value") !== incomingElement.getAttribute("value")) {
        refuse("FADENO_RECONCILIATION_OWNERSHIP");
      }
    }
    if (currentElement instanceof HTMLSelectElement
      && dirtySelect(currentElement)
      && currentElement.innerHTML !== incomingElement.innerHTML) {
      refuse("FADENO_RECONCILIATION_OWNERSHIP");
    }
    const activeElement = currentDocument.activeElement;
    if (currentElement.localName !== opaqueElementName
      && activeElement
      && currentElement.contains(activeElement)
      && (currentElement.hasAttribute("disabled")
          !== incomingElement.hasAttribute("disabled")
        || currentElement.getAttribute("class")
          !== incomingElement.getAttribute("class"))) {
      refuse("FADENO_RECONCILIATION_OWNERSHIP");
    }
    for (const stateOwnerAttribute of ["contenteditable", "popover"] as const) {
      if ((currentElement.hasAttribute(stateOwnerAttribute)
          || incomingElement.hasAttribute(stateOwnerAttribute))
        && currentElement.getAttribute(stateOwnerAttribute)
          !== incomingElement.getAttribute(stateOwnerAttribute)) {
        refuse("FADENO_RECONCILIATION_OWNERSHIP");
      }
    }
    if (currentElement.localName === "audio"
      && (currentElement.getAttribute("src") !== incomingElement.getAttribute("src")
        || currentElement.getAttribute("preload") !== incomingElement.getAttribute("preload"))) {
      refuse("FADENO_RECONCILIATION_CONTENT");
    }
    if (currentElement.localName === opaqueElementName
      ? currentElement.innerHTML !== incomingElement.innerHTML
        || !sameAttributes(currentElement, attributes(incomingElement))
      : stateOwnedLeafContent(currentElement)
        && currentElement.innerHTML !== incomingElement.innerHTML) {
      refuse("FADENO_RECONCILIATION_CONTENT");
    }
  }

  for (const currentElement of current.elements) {
    const identity = current.identityByElement.get(currentElement)
      ?? refuse("FADENO_RECONCILIATION_OWNERSHIP");
    if (!incoming.identities.has(identity)
      && ownsBrowserState(currentDocument, currentElement)) {
      refuse("FADENO_RECONCILIATION_OWNERSHIP");
    }
  }

  for (const identity of replacementSet) {
    const currentElement = current.identities.get(identity)
      ?? refuse("FADENO_RECONCILIATION_REPLACEMENT");
    const incomingElement = incoming.identities.get(identity)
      ?? refuse("FADENO_RECONCILIATION_REPLACEMENT");
    if (elementName(currentElement) !== elementName(incomingElement)
      || (current.children.get(identity)?.length ?? 0) !== 0
      || (incoming.children.get(identity)?.length ?? 0) !== 0
      || currentElement.localName === opaqueElementName) {
      refuse("FADENO_RECONCILIATION_REPLACEMENT");
    }
  }

  const desiredNodes = new Map<string, Element>();
  const reusedIdentities: string[] = [];
  const replacedIdentities: string[] = [];
  const attributePlans: AttributePlan[] = [];
  const textPlans: TextPlan[] = [];
  for (const incomingElement of incoming.elements) {
    const identity = incoming.identityByElement.get(incomingElement)
      ?? refuse("FADENO_RECONCILIATION_OWNERSHIP");
    const currentElement = current.identities.get(identity);
    if (currentElement && !replacementSet.has(identity)) {
      desiredNodes.set(identity, currentElement);
      reusedIdentities.push(identity);
      attributePlans.push(prepareAttributePlan(currentElement, incomingElement));
      if (incomingElement.localName !== opaqueElementName
        && (incoming.children.get(identity)?.length ?? 0) === 0
        && !stateOwnedLeafContent(incomingElement)
        && currentElement.textContent !== incomingElement.textContent) {
        if (selectionIntersects(currentDocument, currentElement, true)) {
          refuse("FADENO_RECONCILIATION_OWNERSHIP");
        }
        textPlans.push(Object.freeze({
          element: currentElement,
          text: incomingElement.textContent ?? "",
        }));
      }
      continue;
    }
    const replacement = incomingElement.cloneNode(false) as Element;
    desiredNodes.set(identity, replacement);
    if (replacementSet.has(identity)) replacedIdentities.push(identity);
    if (incomingElement.localName !== opaqueElementName
      && (incoming.children.get(identity)?.length ?? 0) === 0) {
      textPlans.push(Object.freeze({
        element: replacement,
        text: incomingElement.textContent ?? "",
      }));
    }
  }
  if (replacedIdentities.length !== replacementSet.size) {
    refuse("FADENO_RECONCILIATION_REPLACEMENT");
  }

  const structurePlans: StructurePlan[] = [];
  for (const incomingElement of incoming.elements) {
    if (incomingElement.localName === opaqueElementName) continue;
    const identity = incoming.identityByElement.get(incomingElement)
      ?? refuse("FADENO_RECONCILIATION_OWNERSHIP");
    const parent = desiredNodes.get(identity)
      ?? refuse("FADENO_RECONCILIATION_OWNERSHIP");
    const childIdentities = incoming.children.get(identity)
      ?? refuse("FADENO_RECONCILIATION_OWNERSHIP");
    const desiredChildren = childIdentities.map((identity) =>
      desiredNodes.get(identity) ?? refuse("FADENO_RECONCILIATION_OWNERSHIP")
    );
    structurePlans.push(Object.freeze({
      parent,
      desiredChildren: Object.freeze(desiredChildren),
      originalChildren: Object.freeze(Array.from(parent.children)),
    }));
  }
  for (const plan of structurePlans) {
    if (selectionCoversInsertion(currentDocument, plan)) {
      refuse("FADENO_RECONCILIATION_OWNERSHIP");
    }
    if (directlyMovedChildren(plan).some((element) =>
      ownsBrowserState(currentDocument, element)
    )) {
      refuse("FADENO_RECONCILIATION_OWNERSHIP");
    }
  }

  const attributeSnapshot: AttributeSnapshot = Object.freeze(
    current.elements.map((element) => Object.freeze({
      element,
      attributes: attributes(element),
    })),
  );
  const contentSnapshot: ContentSnapshot = Object.freeze(
    current.elements
      .filter((element) =>
        element.localName === opaqueElementName
        || (current.children.get(
          current.identityByElement.get(element)
            ?? refuse("FADENO_RECONCILIATION_OWNERSHIP"),
        )?.length ?? 0) === 0
      )
      .map((element) => Object.freeze({
        element,
        content: element.innerHTML,
      })),
  );
  const structureSnapshot: readonly StructureSnapshot[] = Object.freeze(
    current.elements
      .filter((parent) => parent.localName !== opaqueElementName)
      .map((parent) => Object.freeze({
        parent,
        originalChildren: Object.freeze(Array.from(parent.children)),
      })),
  );
  const liveElements = boundedLiveElements(current);
  if (liveElements.some((element) =>
    element.scrollTop !== 0 || element.scrollLeft !== 0
  )) {
    refuse("FADENO_RECONCILIATION_OWNERSHIP");
  }
  const liveControlSnapshot = snapshotLiveControls(liveElements);
  const liveOwnerSnapshot = snapshotLiveOwners(liveElements);
  const reconcilerOwnedElements = new Set(current.elements);
  const rollbackLiveControlSnapshot = Object.freeze(
    liveControlSnapshot.filter(({ element }) =>
      reconcilerOwnedElements.has(element)
    ),
  );
  const rollbackLiveOwnerSnapshot = Object.freeze(
    liveOwnerSnapshot.filter(({ element }) =>
      reconcilerOwnedElements.has(element)
    ),
  );
  const documentSelectionSnapshot = snapshotDocumentSelection(currentDocument);
  const textSnapshot = new Map<Element, string>();
  for (const plan of textPlans) {
    const identity = current.identityByElement.get(plan.element);
    if (identity && current.identities.get(identity) === plan.element) {
      textSnapshot.set(plan.element, plan.element.textContent ?? "");
    }
  }
  const active = currentDocument.activeElement;
  const activeIdentity = active instanceof Element
    ? current.identityByElement.get(active)
    : undefined;
  const activeOpaqueOwner = active instanceof Element
    ? current.elements.find((element) =>
      element.localName === opaqueElementName && element.contains(active)
    )
    : undefined;
  const activeOpaqueIdentity = activeOpaqueOwner
    ? current.identityByElement.get(activeOpaqueOwner)
    : undefined;
  const preservesActiveElement = active instanceof HTMLElement
    && ((activeIdentity !== undefined
        && current.identities.get(activeIdentity) === active
        && desiredNodes.get(activeIdentity) === active)
      || (activeOpaqueIdentity !== undefined
        && desiredNodes.get(activeOpaqueIdentity) === activeOpaqueOwner));

  let state: "prepared" | "applied" | "rolled-back" = "prepared";
  const rollback = (): void => {
    if (state === "rolled-back") return;
    try {
      restoreStructure(structureSnapshot);
      restoreAttributes(attributeSnapshot);
      for (const { element, content } of contentSnapshot) {
        if (element.localName !== opaqueElementName
          && element.innerHTML !== content) {
          element.innerHTML = content;
        }
      }
      for (const [element, text] of textSnapshot) {
        if (element.textContent !== text) element.textContent = text;
      }
      restoreLiveControls(rollbackLiveControlSnapshot);
      restoreLiveOwners(rollbackLiveOwnerSnapshot);
      restoreDocumentSelection(currentDocument, documentSelectionSnapshot);
    } finally {
      state = "rolled-back";
    }
  };
  const validate = (): void => {
    if (state !== "prepared"
      || currentDocument.activeElement !== active
      || liveElements.some((element) =>
        element.scrollTop !== 0 || element.scrollLeft !== 0
      )
      || !sameLiveControls(liveControlSnapshot)
      || !sameLiveOwners(liveOwnerSnapshot)
      || !sameDocumentSelection(currentDocument, documentSelectionSnapshot)) {
      refuse("FADENO_RECONCILIATION_OWNERSHIP");
    }
    assertPreparedCurrentTree(
      currentDocument,
      current,
      attributeSnapshot,
      contentSnapshot,
    );
  };
  const commit = (): PrivateReconciliationResult => {
    validate();
    state = "applied";
    try {
      for (const plan of attributePlans) {
        for (const name of plan.remove) plan.element.removeAttribute(name);
        for (const [name, value] of plan.set) plan.element.setAttribute(name, value);
      }
      for (const { parent, desiredChildren } of structurePlans) {
        const desired = new Set(desiredChildren);
        for (const child of Array.from(parent.children)) {
          if (!desired.has(child)) child.remove();
        }
        let cursor: Element | null = null;
        for (const child of [...desiredChildren].reverse()) {
          if (child.parentElement !== parent || child.nextElementSibling !== cursor) {
            parent.insertBefore(child, cursor);
          }
          cursor = child;
        }
      }
      for (const plan of textPlans) plan.element.textContent = plan.text;
      return Object.freeze({
        rootIdentity: current.root.id,
        reusedIdentities: Object.freeze(reusedIdentities),
        replacedIdentities: Object.freeze(replacedIdentities),
      });
    } catch (cause) {
      rollback();
      throw cause;
    }
  };

  return Object.freeze({
    preservesActiveElement,
    validate,
    commit,
    rollback,
  });
}
