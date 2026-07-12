import type { RenderChild, RenderNode } from "../index.ts";

export type RenderNodePayload =
  | Readonly<{ kind: "element"; element: string; properties: Readonly<Record<string, unknown>>; children: RenderChild }>
  | Readonly<{ kind: "fragment"; children: RenderChild }>
  | Readonly<{ kind: "async"; value: Promise<RenderChild> }>
  | Readonly<{
      kind: "boundary";
      children: RenderChild | ((signal: AbortSignal) => RenderChild | Promise<RenderChild>);
      fallback: RenderChild;
      timeoutMilliseconds?: number;
    }>
  | Readonly<{ kind: "framework-executable"; source: string }>;

const payloads = new WeakMap<object, RenderNodePayload>();

function node(payload: RenderNodePayload): RenderNode {
  const value = Object.freeze(Object.create(null) as object);
  payloads.set(value, Object.freeze(payload));
  return value as RenderNode;
}

export function createElementNode(
  element: string,
  properties: Readonly<Record<string, unknown>>,
  children: RenderChild,
): RenderNode {
  return node({ kind: "element", element, properties, children });
}

export function createFragmentNode(children: RenderChild): RenderNode {
  return node({ kind: "fragment", children });
}

export function createAsyncNode(value: Promise<RenderChild>): RenderNode {
  return node({ kind: "async", value });
}

export function createBoundaryNode(
  children: RenderChild | ((signal: AbortSignal) => RenderChild | Promise<RenderChild>),
  fallback: RenderChild,
  timeoutMilliseconds?: number,
): RenderNode {
  return node({
    kind: "boundary",
    children,
    fallback,
    ...(timeoutMilliseconds === undefined ? {} : { timeoutMilliseconds }),
  });
}

export function createFrameworkExecutableNode(source: string): RenderNode {
  if (typeof source !== "string" || source.length === 0 || source.includes("</script")) {
    throw new TypeError("FADENO_RENDER_FRAMEWORK_EXECUTABLE");
  }
  return node({ kind: "framework-executable", source });
}

export function readRenderNode(value: unknown): RenderNodePayload | undefined {
  return typeof value === "object" && value !== null ? payloads.get(value) : undefined;
}
