export type PrivateMorphPatch = Readonly<{
  rootIdentity: string;
  replacementHtml: string;
  replacementIdentities: readonly string[];
}>;

export type PrivateMorphResult = Readonly<{
  rootIdentity: string;
  reusedIdentities: readonly string[];
  replacedIdentities: readonly string[];
}>;

/**
 * Disposable K0 evidence only. This is not a public patch format or identity contract.
 * Keep every helper nested so Playwright can serialize this function into each browser.
 */
export function applyPrivateMorphCandidate(input: PrivateMorphPatch): PrivateMorphResult {
  const refuse = (reason: string): never => {
    throw new Error(`FADENO_MORPH_CANDIDATE_REFUSED: ${reason}`);
  };
  const isIdentity = (value: unknown): value is string =>
    typeof value === "string" && value.trim().length > 0;
  const elementName = (element: Element): string =>
    `${element.namespaceURI ?? ""}:${element.localName}`;
  const supportedRootElementName = "http://www.w3.org/1999/xhtml:main";
  const supportedChildElementNames = new Set([
    "http://www.w3.org/1999/xhtml:input",
    "http://www.w3.org/1999/xhtml:output",
  ]);
  const supportedAttributeNames = new Set(["id", "class", "aria-label", "value"]);
  const rootChildNodesAreSupported = (root: Element): boolean =>
    Array.from(root.childNodes).every(
      (node) =>
        node.nodeType === Node.ELEMENT_NODE ||
        (node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() === ""),
    );
  const collectIdentities = (root: Element, side: "current" | "incoming") => {
    if (!rootChildNodesAreSupported(root)) refuse(`${side} root has unsupported child nodes`);
    const children = Array.from(root.children);
    if (children.some((child) => child.children.length > 0)) {
      refuse(`${side} root has unsupported nested elements`);
    }
    const elements = [root, ...children];
    const identities = new Map<string, Element>();
    for (const element of elements) {
      if (!isIdentity(element.id)) refuse(`${side} element identity is missing`);
      if (identities.has(element.id)) refuse(`${side} identity is duplicated: ${element.id}`);
      identities.set(element.id, element);
    }
    return { elements, identities };
  };
  const prepareAttributePlan = (current: Element, incoming: Element) => {
    const incomingNames = new Set(incoming.getAttributeNames());
    const remove = current.getAttributeNames().filter(
      (name) => name !== "id" && !incomingNames.has(name),
    );
    const set: Array<readonly [string, string]> = [];
    for (const name of incomingNames) {
      if (name === "id") continue;
      const value = incoming.getAttribute(name) ?? refuse(`incoming attribute disappeared: ${name}`);
      set.push([name, value]);
    }
    return { current, remove, set };
  };
  const validateElementSurface = (
    element: Element,
    side: "current" | "incoming",
    position: "root" | "child",
  ): void => {
    const name = elementName(element);
    const supported = position === "root"
      ? name === supportedRootElementName
      : supportedChildElementNames.has(name);
    if (!supported) {
      refuse(`${side} ${position} element kind is unsupported: ${element.localName}`);
    }
    const unsupportedAttribute = element.getAttributeNames().find(
      (name) => !supportedAttributeNames.has(name),
    );
    if (unsupportedAttribute) {
      refuse(`${side} attribute is unsupported: ${unsupportedAttribute}`);
    }
  };

  if (
    typeof input !== "object" ||
    input === null ||
    !isIdentity(input.rootIdentity) ||
    typeof input.replacementHtml !== "string" ||
    input.replacementHtml.trim().length === 0 ||
    !Array.isArray(input.replacementIdentities)
  ) {
    refuse("patch shape is invalid");
  }
  if (!input.replacementIdentities.every(isIdentity)) {
    refuse("replacement identity is missing");
  }
  const replacementSet = new Set(input.replacementIdentities);
  if (replacementSet.size !== input.replacementIdentities.length) {
    refuse("replacement identity is duplicated");
  }
  if (replacementSet.has(input.rootIdentity)) refuse("update root cannot be replaced");

  const template = document.createElement("template");
  template.innerHTML = input.replacementHtml;
  const incomingTopLevelElements = Array.from(template.content.children);
  const incomingTopLevelShapeIsValid = Array.from(template.content.childNodes).every(
    (node) =>
      node === incomingTopLevelElements[0] ||
      (node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() === ""),
  );
  if (incomingTopLevelElements.length !== 1 || !incomingTopLevelShapeIsValid) {
    refuse("replacement HTML must contain exactly one root element");
  }
  const incomingRoot = incomingTopLevelElements[0] ??
    refuse("replacement HTML must contain exactly one root element");
  if (incomingRoot.id !== input.rootIdentity) {
    refuse("incoming root identity differs");
  }

  const documentIdentities = new Map<string, Element[]>();
  for (const element of document.querySelectorAll("[id]")) {
    const matches = documentIdentities.get(element.id);
    if (matches) matches.push(element);
    else documentIdentities.set(element.id, [element]);
  }
  const currentRootMatches = documentIdentities.get(input.rootIdentity) ?? [];
  if (currentRootMatches.length !== 1) refuse("current root identity is missing or ambiguous");
  const currentRoot = currentRootMatches[0] ??
    refuse("current root identity is missing or ambiguous");

  const current = collectIdentities(currentRoot, "current");
  const incoming = collectIdentities(incomingRoot, "incoming");
  const currentOrder = current.elements.map((element) => element.id);
  const incomingOrder = incoming.elements.map((element) => element.id);
  if (JSON.stringify(currentOrder) !== JSON.stringify(incomingOrder)) {
    refuse("current and incoming identity order differs");
  }
  for (const identity of currentOrder) {
    const currentElement = current.identities.get(identity) ??
      refuse(`identity is not observed on both sides: ${identity}`);
    const incomingElement = incoming.identities.get(identity) ??
      refuse(`identity is not observed on both sides: ${identity}`);
    const documentMatches = documentIdentities.get(identity) ?? [];
    if (documentMatches.length !== 1 || documentMatches[0] !== currentElement) {
      refuse(`current document identity is missing or ambiguous: ${identity}`);
    }
    if (elementName(currentElement) !== elementName(incomingElement)) {
      refuse(`element kind differs: ${identity}`);
    }
    const position = identity === input.rootIdentity ? "root" : "child";
    validateElementSurface(currentElement, "current", position);
    validateElementSurface(incomingElement, "incoming", position);
    if (
      identity !== input.rootIdentity &&
      !replacementSet.has(identity) &&
      currentElement.innerHTML !== incomingElement.innerHTML
    ) {
      refuse(`reused element content differs: ${identity}`);
    }
  }
  for (const identity of replacementSet) {
    if (!current.identities.has(identity) || !incoming.identities.has(identity)) {
      refuse(`declared replacement is not observed: ${identity}`);
    }
  }

  const reusedIdentities: string[] = [input.rootIdentity];
  const replacedIdentities: string[] = [];
  const attributePlans = [prepareAttributePlan(currentRoot, incomingRoot)];
  const replacementPlans: Array<Readonly<{
    current: Element;
    replacement: Element;
  }>> = [];
  for (const identity of currentOrder.slice(1)) {
    const currentElement = current.identities.get(identity) ??
      refuse(`identity vanished before mutation: ${identity}`);
    const incomingElement = incoming.identities.get(identity) ??
      refuse(`identity vanished before mutation: ${identity}`);
    if (replacementSet.has(identity)) {
      replacementPlans.push({
        current: currentElement,
        replacement: incomingElement.cloneNode(true) as Element,
      });
      replacedIdentities.push(identity);
    } else {
      attributePlans.push(prepareAttributePlan(currentElement, incomingElement));
      reusedIdentities.push(identity);
    }
  }
  if (replacementPlans.length !== replacementSet.size) {
    refuse("declared replacement is not observed");
  }

  for (const plan of attributePlans) {
    for (const name of plan.remove) plan.current.removeAttribute(name);
    for (const [name, value] of plan.set) plan.current.setAttribute(name, value);
  }
  for (const plan of replacementPlans) {
    plan.current.replaceWith(plan.replacement);
  }
  return { rootIdentity: input.rootIdentity, reusedIdentities, replacedIdentities };
}
