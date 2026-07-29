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
  commit(): PrivateReconciliationResult;
  rollback(): void;
}>;

type Side = "current" | "incoming";

type CollectedTree = Readonly<{
  root: Element;
  elements: readonly Element[];
  identities: ReadonlyMap<string, Element>;
  identityByElement: ReadonlyMap<Element, string>;
  parents: ReadonlyMap<string, string | null>;
  children: ReadonlyMap<string, readonly string[]>;
}>;

type AttributeSnapshot = readonly Readonly<{
  element: Element;
  attributes: readonly (readonly [string, string])[];
}>[];

type LiveControlSnapshot = readonly (
  | Readonly<{
    kind: "input";
    element: HTMLInputElement;
    value: string | null;
    checked: boolean;
    indeterminate: boolean;
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

const encoder = new TextEncoder();
const htmlNamespace = "http://www.w3.org/1999/xhtml";
const opaqueElementName = "fadeno-island";
const frameworkProofFieldName = "__fadeno_proof";
const frameworkProofIdentityPrefix = "\u0000fadeno-proof:";
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
  return `${frameworkProofIdentityPrefix}${parentIdentity}`;
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

function collectTree(root: Element, side: Side): CollectedTree {
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
  if (side === "current") {
    const documentIdentities = new Map<string, Element>();
    for (const element of document_.querySelectorAll("[id]")) {
      if (!boundedIdentity(element.id) || documentIdentities.has(element.id)) {
        refuse("FADENO_RECONCILIATION_IDENTITY");
      }
      documentIdentities.set(element.id, element);
    }
    for (const element of tree.elements) {
      const identity = tree.identityByElement.get(element)
        ?? refuse("FADENO_RECONCILIATION_OWNERSHIP");
      if (!identity.startsWith(frameworkProofIdentityPrefix)
        && documentIdentities.get(identity) !== element) {
        refuse("FADENO_RECONCILIATION_OWNERSHIP");
      }
    }
  }
  return tree;
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
  return Boolean(
    (selection.anchorNode && element.contains(selection.anchorNode))
    || (selection.focusNode && element.contains(selection.focusNode)),
  );
}

function ownsBrowserState(document_: Document, element: Element): boolean {
  const active = document_.activeElement;
  if ((active && element.contains(active)) || selectionIntersects(document_, element, false)) {
    return true;
  }
  return element.matches(
    "input, textarea, select, details, dialog, audio, fadeno-island, [contenteditable]",
  ) || element.querySelector(
    "input, textarea, select, details, dialog, audio, fadeno-island, [contenteditable]",
  ) !== null;
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

function snapshotLiveControls(tree: CollectedTree): LiveControlSnapshot {
  const snapshot: Array<LiveControlSnapshot[number]> = [];
  for (const element of tree.elements) {
    if (element instanceof HTMLInputElement) {
      snapshot.push(Object.freeze({
        kind: "input",
        element,
        value: element.type === "file" ? null : element.value,
        checked: element.checked,
        indeterminate: element.indeterminate,
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
      }));
    }
  }
  return Object.freeze(snapshot);
}

function restoreLiveControls(snapshot: LiveControlSnapshot): void {
  for (const entry of snapshot) {
    if (entry.kind === "input" && entry.element.type === "radio") {
      entry.element.checked = false;
    }
  }
  for (const entry of snapshot) {
    if (entry.kind === "input") {
      if (entry.value !== null) entry.element.value = entry.value;
      if (entry.element.type !== "radio") entry.element.checked = entry.checked;
      entry.element.indeterminate = entry.indeterminate;
    } else if (entry.kind === "textarea") {
      entry.element.value = entry.value;
    } else {
      for (const option of entry.element.options) option.selected = false;
      entry.selected.forEach((selected, index) => {
        const option = entry.element.options.item(index);
        if (option) option.selected = selected;
      });
      entry.element.selectedIndex = entry.selectedIndex;
    }
  }
  for (const entry of snapshot) {
    if (entry.kind === "input" && entry.element.type === "radio" && entry.checked) {
      entry.element.checked = true;
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
): void {
  const received = collectDocument(document_, "current");
  if (received.root !== expected.root
    || received.elements.length !== expected.elements.length) {
    refuse("FADENO_RECONCILIATION_OWNERSHIP");
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
}

function restoreAttributes(snapshot: AttributeSnapshot): void {
  for (const { element, attributes: expected } of snapshot) {
    const names = new Set(expected.map(([name]) => name));
    for (const name of element.getAttributeNames()) {
      if (!names.has(name)) element.removeAttribute(name);
    }
    for (const [name, value] of expected) element.setAttribute(name, value);
  }
}

function restoreStructure(plans: readonly StructurePlan[]): void {
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
  if (current.root.id !== incoming.root.id || replacementSet.has(current.root.id)) {
    refuse("FADENO_RECONCILIATION_IDENTITY");
  }

  const documentIdentities = new Set(
    [...currentDocument.querySelectorAll("[id]")].map((element) => element.id),
  );
  for (const incomingElement of incoming.elements) {
    const identity = incoming.identityByElement.get(incomingElement)
      ?? refuse("FADENO_RECONCILIATION_OWNERSHIP");
    const currentElement = current.identities.get(identity);
    if (!currentElement) {
      if (documentIdentities.has(identity) || incomingElement.localName === opaqueElementName) {
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
      : stateOwnedLeafContent(currentElement)
        && currentElement.innerHTML !== incomingElement.innerHTML) {
      refuse("FADENO_RECONCILIATION_CONTENT");
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
  const liveControlSnapshot = snapshotLiveControls(current);
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
    if (state === "rolled-back" || state === "prepared") return;
    try {
      restoreStructure(structurePlans);
      restoreAttributes(attributeSnapshot);
      for (const [element, text] of textSnapshot) element.textContent = text;
      restoreLiveControls(liveControlSnapshot);
    } finally {
      state = "rolled-back";
    }
  };
  const commit = (): PrivateReconciliationResult => {
    if (state !== "prepared") {
      refuse("FADENO_RECONCILIATION_OWNERSHIP");
    }
    state = "applied";
    try {
      assertPreparedCurrentTree(currentDocument, current, attributeSnapshot);
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
    commit,
    rollback,
  });
}
