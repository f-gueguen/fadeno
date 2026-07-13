import type {
  ErrorPage,
  Layout,
  MatchedRouteRender,
  NotFoundPage,
  PageContext,
  ResourceDeclaration,
  ResourceInput,
  ResourceStatus,
  RedirectOutcome,
  RenderChild,
  RouteOutcome,
} from "../index.ts";
import { createElementNode } from "./render-node.ts";
import { renderDocument } from "./renderer.ts";
import { captureRequestFailureObserver, reportFrameworkFailure } from "./failure-observer.ts";
import { readResourceError, ResourceRequestScope } from "./resource.ts";

type OutcomePayload = Readonly<{ kind: "not-found" }> | Readonly<{ kind: "redirect"; location: string; status: 303 | 307 | 308 }>;
const outcomes = new WeakMap<object, OutcomePayload>();

function outcome(payload: OutcomePayload): RouteOutcome {
  const value = Object.freeze(Object.create(null) as object);
  outcomes.set(value, Object.freeze(payload));
  return value as RouteOutcome;
}

export function createNotFoundOutcome(): RouteOutcome {
  return outcome({ kind: "not-found" });
}

export function createRedirectOutcome(location: string, status: 303 | 307 | 308): RedirectOutcome {
  if (typeof location !== "string" || location.length === 0 || location.includes("\0")) {
    throw new TypeError("FADENO_RENDER_REDIRECT_LOCATION");
  }
  return outcome({ kind: "redirect", location, status }) as RedirectOutcome;
}

function safeDocument(title: string, heading: string, detail: string): RenderChild {
  return createElementNode("html", Object.freeze({ lang: "en" }), [
    createElementNode("head", Object.freeze(Object.create(null)), createElementNode("title", Object.freeze(Object.create(null)), title)),
    createElementNode("body", Object.freeze(Object.create(null)), createElementNode("main", Object.freeze(Object.create(null)), [
      createElementNode("h1", Object.freeze(Object.create(null)), heading),
      createElementNode("p", Object.freeze(Object.create(null)), detail),
    ])),
  ]);
}

async function composeLayouts(
  layouts: readonly Layout<Record<string, string | readonly string[]>>[],
  context: PageContext<Record<string, string | readonly string[]>>,
  child: RenderChild,
): Promise<RenderChild> {
  let result = child;
  for (const layout of [...layouts].reverse()) result = await layout({ ...context, children: result });
  return result;
}

async function renderNotFound(
  page: NotFoundPage<Record<string, string | readonly string[]>> | undefined,
  context: PageContext<Record<string, string | readonly string[]>>,
  layouts: readonly Layout<Record<string, string | readonly string[]>>[],
  resources: ResourceRequestScope,
): Promise<Response> {
  const child = page ? await page(context) : safeDocument("Not found", "Not found", "The requested page does not exist.");
  return renderDocument(await composeLayouts(layouts, context, child), { request: context.request, status: 404, cleanup: () => resources.close() });
}

async function renderFailure(
  page: ErrorPage<Record<string, string | readonly string[]>> | undefined,
  context: PageContext<Record<string, string | readonly string[]>>,
  layouts: readonly Layout<Record<string, string | readonly string[]>>[],
  incidentId: string,
  resources: ResourceRequestScope,
  expected: Readonly<{ code: string; status: ResourceStatus }> | undefined,
): Promise<Response> {
  try {
    const child = page
      ? await page({ ...context, incidentId, ...(expected ? { resourceError: expected } : {}) })
      : expected
        ? safeDocument("Resource unavailable", "Resource unavailable", expected.code)
        : safeDocument("Unexpected failure", "Unexpected failure", `Incident ${incidentId}`);
    return renderDocument(await composeLayouts(layouts, context, child), {
      request: context.request,
      status: expected?.status ?? 500,
      cleanup: () => resources.close(),
    });
  } catch {
    const child = expected
      ? safeDocument("Resource unavailable", "Resource unavailable", expected.code)
      : safeDocument("Unexpected failure", "Unexpected failure", `Incident ${incidentId}`);
    return renderDocument(child, {
      request: context.request,
      status: expected?.status ?? 500,
      cleanup: () => resources.close(),
    });
  }
}

export async function renderMatchedRoute(input: MatchedRouteRender): Promise<Response> {
  const failureObserver = captureRequestFailureObserver(input.request);
  const resources = new ResourceRequestScope(input.request);
  const context: PageContext<Record<string, string | readonly string[]>> = Object.freeze({
    request: input.request,
    parameters: input.parameters,
    signal: input.request.signal,
    read: <Input extends ResourceInput, Value>(resource: ResourceDeclaration<Input, Value>, resourceInput: Input) =>
      resources.read(resource, resourceInput),
  });
  try {
    const pageResult = await input.page(context);
    const pageOutcome = typeof pageResult === "object" && pageResult !== null ? outcomes.get(pageResult) : undefined;
    if (pageOutcome?.kind === "not-found") return await renderNotFound(input.notFound, context, input.layouts, resources);
    if (pageOutcome?.kind === "redirect") {
      const target = new URL(pageOutcome.location, input.request.url);
      if (target.origin !== new URL(input.request.url).origin || target.username !== "" || target.password !== "") {
        throw new TypeError("FADENO_RENDER_REDIRECT_ORIGIN");
      }
      resources.close();
      return new Response(null, { status: pageOutcome.status, headers: { location: `${target.pathname}${target.search}${target.hash}` } });
    }
    return renderDocument(await composeLayouts(input.layouts, context, pageResult as RenderChild), {
      request: input.request,
      cleanup: () => resources.close(),
    });
  } catch (cause) {
    const incidentId = globalThis.crypto.randomUUID();
    const expected = readResourceError(cause);
    if (!expected) reportFrameworkFailure(failureObserver, input.request, incidentId, "pre-publication", "FADENO_RENDER_UNEXPECTED", cause);
    return renderFailure(input.error, context, input.layouts, incidentId, resources, expected);
  }
}
