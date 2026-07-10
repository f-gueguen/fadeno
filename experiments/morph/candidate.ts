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
 * Private K0 evidence candidate. The function is intentionally self-contained
 * because Playwright serializes it into each browser process.
 */
export function applyPrivateMorphCandidate(input: PrivateMorphPatch): PrivateMorphResult {
  const refuse = (reason: string): never => {
    throw new Error(`FADENO_MORPH_CANDIDATE_REFUSED: ${reason}`);
  };
  const isIdentity = (value: unknown): value is string =>
    typeof value === "string" && value.trim().length > 0;
  const elementName = (element: Element): string =>
    `${element.namespaceURI ?? ""}:${element.localName}`;
  const htmlNamespace = "http://www.w3.org/1999/xhtml";
  const supportedDescendantNames = new Set([
    "audio",
    "button",
    "details",
    "dialog",
    "div",
    "fadeno-island",
    "input",
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
    "aria-label",
    "checked",
    "class",
    "contenteditable",
    "id",
    "name",
    "open",
    "popover",
    "preload",
    "role",
    "selected",
    "src",
    "tabindex",
    "type",
    "value",
  ]);
  const supportedInputTypes = new Set(["checkbox", "file", "radio", "text"]);
  const opaqueElementName = "fadeno-island";

  type Side = "current" | "incoming";
  type CollectedTree = Readonly<{
    elements: readonly Element[];
    identities: ReadonlyMap<string, Element>;
    parents: ReadonlyMap<string, string | null>;
    children: ReadonlyMap<string, readonly string[]>;
  }>;
  type AttributePlan = Readonly<{
    current: Element;
    remove: readonly string[];
    set: ReadonlyArray<readonly [string, string]>;
  }>;

  const validateAttributeOwner = (element: Element, name: string, side: Side): void => {
    const localName = element.localName;
    const owned =
      name === "id" ||
      name === "class" ||
      name === "aria-label" ||
      name === "role" ||
      name === "tabindex" ||
      (name === "value" && (localName === "input" || localName === "option")) ||
      (name === "type" && localName === "input") ||
      (name === "name" && (localName === "input" || localName === "select")) ||
      (name === "checked" && localName === "input") ||
      (name === "selected" && localName === "option") ||
      (name === "contenteditable" && (localName === "div" || localName === "span")) ||
      (name === "open" && (localName === "details" || localName === "dialog")) ||
      (name === "popover" && (localName === "div" || localName === "span")) ||
      ((name === "src" || name === "preload") && localName === "audio");
    if (!owned) refuse(`${side} attribute owner is unsupported: ${name}`);
  };

  const validateElementSurface = (
    element: Element,
    side: Side,
    position: "root" | "descendant",
  ): void => {
    if (element.namespaceURI !== htmlNamespace) {
      refuse(`${side} ${position} element namespace is unsupported`);
    }
    const supported = position === "root"
      ? element.localName === "main"
      : supportedDescendantNames.has(element.localName);
    if (!supported) {
      const legacyPosition = position === "descendant" ? "child" : position;
      refuse(`${side} ${legacyPosition} element kind is unsupported: ${element.localName}`);
    }
    for (const name of element.getAttributeNames()) {
      if (!supportedAttributeNames.has(name)) {
        refuse(`${side} attribute is unsupported: ${name}`);
      }
      validateAttributeOwner(element, name, side);
    }
    if (element.localName === "input") {
      const inputType = (element.getAttribute("type") ?? "text").toLowerCase();
      if (!supportedInputTypes.has(inputType)) {
        refuse(`${side} input type is unsupported: ${inputType}`);
      }
      if (inputType === "file" && element.hasAttribute("value")) {
        refuse(`${side} file input value attribute is unsupported`);
      }
      if (
        element.hasAttribute("checked") &&
        inputType !== "checkbox" &&
        inputType !== "radio"
      ) {
        refuse(`${side} checked attribute requires checkbox or radio`);
      }
    }
    if (element.hasAttribute("contenteditable")) {
      const editable = element.getAttribute("contenteditable");
      if (editable !== "" && editable !== "true" && editable !== "plaintext-only") {
        refuse(`${side} contenteditable value is unsupported`);
      }
    }
    if (element.hasAttribute("popover")) {
      const popover = element.getAttribute("popover");
      if (popover !== "" && popover !== "auto" && popover !== "manual") {
        refuse(`${side} popover value is unsupported`);
      }
    }
    if (element.localName === "audio") {
      const source = element.getAttribute("src");
      if (!source?.startsWith("data:audio/wav;base64,")) {
        refuse(`${side} media source must be a local WAV data URL`);
      }
      const preload = element.getAttribute("preload");
      if (preload !== null && !["auto", "metadata", "none"].includes(preload)) {
        refuse(`${side} media preload value is unsupported`);
      }
    }
  };

  const collectTree = (root: Element, side: Side): CollectedTree => {
    const elements: Element[] = [];
    const identities = new Map<string, Element>();
    const parents = new Map<string, string | null>();
    const children = new Map<string, readonly string[]>();

    const visit = (element: Element, parentIdentity: string | null): void => {
      validateElementSurface(element, side, parentIdentity === null ? "root" : "descendant");
      if (!isIdentity(element.id)) refuse(`${side} element identity is missing`);
      if (identities.has(element.id)) refuse(`${side} identity is duplicated: ${element.id}`);
      identities.set(element.id, element);
      parents.set(element.id, parentIdentity);
      elements.push(element);

      if (element.localName === opaqueElementName) {
        if (element.querySelector("[id]")) {
          refuse(`${side} opaque island descendants cannot expose identities`);
        }
        children.set(element.id, []);
        return;
      }

      const elementChildren = Array.from(element.children);
      const childNodes = Array.from(element.childNodes);
      if (elementChildren.length > 0) {
        if (childNodes.some((node) => node.nodeType !== Node.ELEMENT_NODE)) {
          refuse(`${side} keyed parent has unsupported child nodes`);
        }
      } else if (childNodes.some((node) => node.nodeType !== Node.TEXT_NODE)) {
        refuse(`${side} leaf has unsupported child nodes`);
      }
      const childIdentities: string[] = [];
      for (const child of elementChildren) {
        if (!isIdentity(child.id)) refuse(`${side} element identity is missing`);
        childIdentities.push(child.id);
        visit(child, element.id);
      }
      children.set(element.id, childIdentities);
    };

    visit(root, null);
    return { elements, identities, parents, children };
  };

  const preservesStateAttribute = (element: Element, name: string): boolean =>
    name === "open" && (element.localName === "details" || element.localName === "dialog");

  const prepareAttributePlan = (current: Element, incoming: Element): AttributePlan => {
    const incomingNames = new Set(incoming.getAttributeNames());
    const remove = current.getAttributeNames().filter(
      (name) =>
        name !== "id" &&
        !preservesStateAttribute(current, name) &&
        !incomingNames.has(name),
    );
    const set: Array<readonly [string, string]> = [];
    for (const name of incomingNames) {
      if (name === "id" || preservesStateAttribute(current, name)) continue;
      const value = incoming.getAttribute(name) ?? refuse(`incoming attribute disappeared: ${name}`);
      if (current.getAttribute(name) !== value) set.push([name, value]);
    }
    return { current, remove, set };
  };

  const stateOwnedLeafContent = (element: Element): boolean =>
    element.localName === "textarea" ||
    element.hasAttribute("contenteditable") ||
    element.localName === "audio";

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
  const incomingTopLevelShapeIsValid =
    template.content.childNodes.length === 1 &&
    template.content.firstChild === incomingTopLevelElements[0];
  if (incomingTopLevelElements.length !== 1 || !incomingTopLevelShapeIsValid) {
    refuse("replacement HTML must contain exactly one root element");
  }
  const incomingRoot = incomingTopLevelElements[0] ??
    refuse("replacement HTML must contain exactly one root element");
  if (incomingRoot.id !== input.rootIdentity) refuse("incoming root identity differs");

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

  const current = collectTree(currentRoot, "current");
  const incoming = collectTree(incomingRoot, "incoming");
  for (const currentElement of current.elements) {
    const documentMatches = documentIdentities.get(currentElement.id) ?? [];
    if (documentMatches.length !== 1 || documentMatches[0] !== currentElement) {
      refuse(`current document identity is missing or ambiguous: ${currentElement.id}`);
    }
  }

  for (const incomingElement of incoming.elements) {
    const identity = incomingElement.id;
    const currentElement = current.identities.get(identity);
    const documentMatches = documentIdentities.get(identity) ?? [];
    if (!currentElement) {
      if (documentMatches.length > 0) {
        refuse(`incoming identity conflicts with current document: ${identity}`);
      }
      if (incomingElement.localName === opaqueElementName) {
        refuse(`opaque island insertion is unsupported: ${identity}`);
      }
      continue;
    }
    if (elementName(currentElement) !== elementName(incomingElement)) {
      refuse(`element kind differs: ${identity}`);
    }
    if (current.parents.get(identity) !== incoming.parents.get(identity)) {
      refuse(`reused element parent differs: ${identity}`);
    }
    if (currentElement.localName === "input") {
      const currentType = (currentElement.getAttribute("type") ?? "text").toLowerCase();
      const incomingType = (incomingElement.getAttribute("type") ?? "text").toLowerCase();
      if (currentType !== incomingType) refuse(`input type differs: ${identity}`);
    }
    if (currentElement.localName === "audio") {
      if (
        currentElement.getAttribute("src") !== incomingElement.getAttribute("src") ||
        currentElement.getAttribute("preload") !== incomingElement.getAttribute("preload")
      ) {
        refuse(`reused media source differs: ${identity}`);
      }
    }
    if (currentElement.localName === opaqueElementName) {
      if (currentElement.innerHTML !== incomingElement.innerHTML) {
        refuse(`reused opaque island content differs: ${identity}`);
      }
    } else if (
      stateOwnedLeafContent(currentElement) &&
      currentElement.innerHTML !== incomingElement.innerHTML
    ) {
      refuse(`reused state-owned content differs: ${identity}`);
    }
  }

  for (const identity of replacementSet) {
    const currentElement = current.identities.get(identity) ??
      refuse(`declared replacement is not observed: ${identity}`);
    const incomingElement = incoming.identities.get(identity) ??
      refuse(`declared replacement is not observed: ${identity}`);
    if (elementName(currentElement) !== elementName(incomingElement)) {
      refuse(`element kind differs: ${identity}`);
    }
    if (
      (current.children.get(identity)?.length ?? 0) !== 0 ||
      (incoming.children.get(identity)?.length ?? 0) !== 0 ||
      currentElement.localName === opaqueElementName
    ) {
      refuse(`declared replacement must be a non-opaque leaf: ${identity}`);
    }
  }

  const desiredNodes = new Map<string, Element>();
  const reusedIdentities: string[] = [];
  const replacedIdentities: string[] = [];
  const attributePlans: AttributePlan[] = [];
  const textPlans: Array<Readonly<{ element: Element; text: string }>> = [];
  for (const incomingElement of incoming.elements) {
    const identity = incomingElement.id;
    const currentElement = current.identities.get(identity);
    if (currentElement && !replacementSet.has(identity)) {
      desiredNodes.set(identity, currentElement);
      reusedIdentities.push(identity);
      attributePlans.push(prepareAttributePlan(currentElement, incomingElement));
      if (
        incomingElement.localName !== opaqueElementName &&
        (incoming.children.get(identity)?.length ?? 0) === 0 &&
        !stateOwnedLeafContent(incomingElement) &&
        currentElement.textContent !== incomingElement.textContent
      ) {
        textPlans.push({ element: currentElement, text: incomingElement.textContent ?? "" });
      }
      continue;
    }
    const replacement = incomingElement.cloneNode(false) as Element;
    desiredNodes.set(identity, replacement);
    if (replacementSet.has(identity)) replacedIdentities.push(identity);
    if (
      incomingElement.localName !== opaqueElementName &&
      (incoming.children.get(identity)?.length ?? 0) === 0
    ) {
      textPlans.push({ element: replacement, text: incomingElement.textContent ?? "" });
    }
  }
  if (replacedIdentities.length !== replacementSet.size) {
    refuse("declared replacement is not observed");
  }

  const structurePlans: Array<Readonly<{
    parent: Element;
    reverseChildren: readonly Element[];
    remove: readonly Element[];
  }>> = [];
  for (const incomingElement of incoming.elements) {
    if (incomingElement.localName === opaqueElementName) continue;
    const parent = desiredNodes.get(incomingElement.id) ??
      refuse(`planned parent disappeared: ${incomingElement.id}`);
    const childIdentities = incoming.children.get(incomingElement.id) ??
      refuse(`planned children disappeared: ${incomingElement.id}`);
    const childElements = childIdentities.map((identity) =>
      desiredNodes.get(identity) ?? refuse(`planned child disappeared: ${identity}`)
    );
    const desiredChildren = new Set(childElements);
    const remove = Array.from(parent.children).filter((child) => !desiredChildren.has(child));
    structurePlans.push({
      parent,
      reverseChildren: [...childElements].reverse(),
      remove,
    });
  }

  // First DOM write occurs below. Every identity, surface, content, attribute,
  // replacement, parent, desired node, and child order has already been planned.
  for (const plan of attributePlans) {
    for (const name of plan.remove) plan.current.removeAttribute(name);
    for (const [name, value] of plan.set) plan.current.setAttribute(name, value);
  }
  for (const plan of structurePlans) {
    for (const child of plan.remove) child.remove();
    let cursor: Element | null = null;
    for (const child of plan.reverseChildren) {
      if (child.nextElementSibling !== cursor) plan.parent.insertBefore(child, cursor);
      cursor = child;
    }
  }
  for (const plan of textPlans) plan.element.textContent = plan.text;

  return { rootIdentity: input.rootIdentity, reusedIdentities, replacedIdentities };
}
