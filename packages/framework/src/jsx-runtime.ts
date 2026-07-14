import type { ActionDeclaration, ActionFieldToken, RenderChild, RenderNode } from "./index.js";
import { classifySink } from "./internal/rendering-security.ts";
import { createAsyncNode, createElementNode, createFragmentNode } from "./internal/render-node.ts";

export type Component<Properties extends object = Record<string, unknown>> = (
  properties: Properties,
) => RenderChild | Promise<RenderChild>;

export const Fragment: unique symbol = Symbol.for("fadeno.jsx.fragment") as never;

const voidElements = new Set(["area", "br", "col", "hr", "img", "input", "link", "meta", "source", "wbr"]);

function plainProperties(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function intrinsic(element: string, input: unknown): RenderNode {
  classifySink(element);
  if (!plainProperties(input)) throw new TypeError("FADENO_RENDER_PROPERTIES");
  const properties = Object.create(null) as Record<string, unknown>;
  let children: RenderChild = undefined;
  for (const key of Object.keys(input).sort()) {
    const value = input[key];
    if (key === "children") {
      children = value as RenderChild;
      continue;
    }
    classifySink(element, key);
    properties[key] = value;
  }
  if (voidElements.has(element) && children !== undefined && children !== null && children !== false) {
    throw new TypeError("FADENO_RENDER_VOID_CHILDREN");
  }
  return createElementNode(element, Object.freeze(properties), children);
}

export function jsx(
  type: string | Component | typeof Fragment,
  properties: Record<string, unknown> | null,
): RenderChild {
  const input = properties ?? Object.create(null) as Record<string, unknown>;
  if (type === Fragment) return createFragmentNode(input["children"] as RenderChild);
  if (typeof type === "function") {
    const result = type(input);
    return result instanceof Promise ? createAsyncNode(result) : result;
  }
  if (typeof type === "string") return intrinsic(type, input);
  throw new TypeError("FADENO_RENDER_JSX_TYPE");
}

export const jsxs = jsx;

type OrdinaryValue = string | number;
type GlobalAttributes = Readonly<{
  id?: OrdinaryValue;
  class?: OrdinaryValue;
  title?: OrdinaryValue;
  lang?: OrdinaryValue;
  dir?: OrdinaryValue;
  role?: OrdinaryValue;
  tabindex?: OrdinaryValue;
  hidden?: boolean;
  inert?: boolean;
}>;
type WithChildren = GlobalAttributes & Readonly<{ children?: RenderChild }>;
type Void = GlobalAttributes & Readonly<{ children?: never }>;
type Link = WithChildren & Readonly<{ href?: string; download?: OrdinaryValue; hreflang?: OrdinaryValue; target?: OrdinaryValue; type?: OrdinaryValue }>;
type Form = WithChildren & Readonly<{ action?: string | ActionDeclaration<Record<string, unknown>>; autocomplete?: OrdinaryValue; enctype?: OrdinaryValue; method?: OrdinaryValue; name?: OrdinaryValue; target?: OrdinaryValue; novalidate?: boolean }>;
type FieldName = OrdinaryValue | ActionFieldToken<unknown>;
type Input = Void & Readonly<{ name?: FieldName; type?: OrdinaryValue; value?: OrdinaryValue; accept?: OrdinaryValue; placeholder?: OrdinaryValue; required?: boolean; disabled?: boolean; readonly?: boolean; checked?: boolean; autofocus?: boolean }>;

export namespace JSX {
  export type Element = RenderChild;
  export interface ElementChildrenAttribute { children: unknown; }
  export interface IntrinsicElements {
    html: WithChildren; head: WithChildren; body: WithChildren; title: WithChildren;
    main: WithChildren; header: WithChildren; footer: WithChildren; nav: WithChildren;
    section: WithChildren; article: WithChildren; aside: WithChildren; div: WithChildren;
    span: WithChildren; p: WithChildren; h1: WithChildren; h2: WithChildren; h3: WithChildren;
    h4: WithChildren; h5: WithChildren; h6: WithChildren; ul: WithChildren; ol: WithChildren;
    li: WithChildren; dl: WithChildren; dt: WithChildren; dd: WithChildren; figure: WithChildren;
    figcaption: WithChildren; blockquote: WithChildren; pre: WithChildren; code: WithChildren;
    em: WithChildren; strong: WithChildren; small: WithChildren; s: WithChildren; mark: WithChildren;
    abbr: WithChildren; cite: WithChildren; q: WithChildren; time: WithChildren; address: WithChildren;
    b: WithChildren; i: WithChildren; u: WithChildren; kbd: WithChildren; samp: WithChildren;
    var: WithChildren; sub: WithChildren; sup: WithChildren; a: Link;
    form: Form; label: WithChildren & Readonly<{ for?: OrdinaryValue }>;
    button: WithChildren & Readonly<{ type?: OrdinaryValue; name?: FieldName; value?: OrdinaryValue; disabled?: boolean }>;
    select: WithChildren & Readonly<{ name?: FieldName; required?: boolean; disabled?: boolean; multiple?: boolean }>;
    option: WithChildren & Readonly<{ value?: OrdinaryValue; selected?: boolean; disabled?: boolean }>;
    textarea: WithChildren & Readonly<{ name?: FieldName; placeholder?: OrdinaryValue; required?: boolean; disabled?: boolean; readonly?: boolean }>;
    details: WithChildren & Readonly<{ open?: boolean }>; summary: WithChildren;
    table: WithChildren; caption: WithChildren; colgroup: WithChildren; thead: WithChildren;
    tbody: WithChildren; tfoot: WithChildren; tr: WithChildren; th: WithChildren; td: WithChildren;
    fieldset: WithChildren & Readonly<{ disabled?: boolean }>; legend: WithChildren;
    output: WithChildren; progress: WithChildren; meter: WithChildren; dialog: WithChildren;
    picture: WithChildren; audio: WithChildren; video: WithChildren;
    area: Void & Readonly<{ href?: string; alt?: OrdinaryValue }>;
    br: Void; col: Void; hr: Void; img: Void & Readonly<{ src?: string; alt?: OrdinaryValue; width?: OrdinaryValue; height?: OrdinaryValue }>;
    input: Input; link: Void & Readonly<{ href?: string; rel?: OrdinaryValue; type?: OrdinaryValue }>;
    meta: Void & Readonly<{ charset?: OrdinaryValue; name?: OrdinaryValue; content?: OrdinaryValue }>;
    source: Void & Readonly<{ src?: string; type?: OrdinaryValue }>; wbr: Void;
  }
}
