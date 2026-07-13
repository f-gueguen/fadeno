import { createUnsafeHtml } from "./internal/unsafe-html.ts";
import { createBoundaryNode } from "./internal/render-node.ts";
import { createNotFoundOutcome, createRedirectOutcome, renderMatchedRoute } from "./internal/render-route.ts";
import { createResourceDeclaration, createResourceError } from "./internal/resource.ts";

export interface ResourceInputObject {
  readonly [key: string]: ResourceInput;
}

export type ResourceInput = null | boolean | number | string | readonly ResourceInput[] | ResourceInputObject;
export type ResourceStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503;

export interface ResourceReadContext<Input extends ResourceInput> {
  readonly input: Input;
  readonly request: Request;
  readonly signal: AbortSignal;
}

export type ResourceLoader<Input extends ResourceInput, Value> = (
  context: ResourceReadContext<Input>,
) => Value | Promise<Value>;

declare const resourceDeclarationBrand: unique symbol;
declare const resourceErrorBrand: unique symbol;

export interface ResourceDeclaration<Input extends ResourceInput, Value> {
  readonly [resourceDeclarationBrand]: Readonly<{ input: Input; value: Value }>;
}

export interface ResourceError extends Error {
  readonly [resourceErrorBrand]: true;
  readonly code: string;
  readonly status: ResourceStatus;
}

export function defineResource<Input extends ResourceInput, Value>(
  options: Readonly<{ read: ResourceLoader<Input, Value> }>,
): ResourceDeclaration<Input, Value> {
  return createResourceDeclaration(options);
}

export function resourceError(options: Readonly<{ code: string; status: ResourceStatus }>): ResourceError {
  return createResourceError(options);
}

export type Handler = (request: Request) => Response | Promise<Response>;

declare const renderNodeBrand: unique symbol;
declare const routeOutcomeBrand: unique symbol;

export interface RenderNode { readonly [renderNodeBrand]: true; }
export interface RouteOutcome { readonly [routeOutcomeBrand]: true; }
export interface RedirectOutcome extends RouteOutcome {}

export type RenderChild =
  | RenderNode
  | UnsafeHtml
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly RenderChild[];

export interface PageContext<Parameters extends Readonly<Record<string, string | readonly string[]>>> {
  readonly request: Request;
  readonly parameters: Parameters;
  readonly signal: AbortSignal;
  readonly read: <Input extends ResourceInput, Value>(resource: ResourceDeclaration<Input, Value>, input: Input) => Promise<Value>;
}

export type Page<Parameters extends Readonly<Record<string, string | readonly string[]>> = Readonly<Record<string, string | readonly string[]>>> = (
  context: PageContext<Parameters>,
) => RenderChild | RouteOutcome | Promise<RenderChild | RouteOutcome>;

export type NotFoundPage<Parameters extends Readonly<Record<string, string | readonly string[]>> = Readonly<Record<string, string | readonly string[]>>> = (
  context: PageContext<Parameters>,
) => RenderChild | Promise<RenderChild>;

export type ErrorPage<Parameters extends Readonly<Record<string, string | readonly string[]>> = Readonly<Record<string, string | readonly string[]>>> = (
  context: PageContext<Parameters> & Readonly<{
    incidentId: string;
    resourceError?: Readonly<Pick<ResourceError, "code" | "status">>;
  }>,
) => RenderChild | Promise<RenderChild>;

export type Layout<Parameters extends Readonly<Record<string, string | readonly string[]>> = Readonly<Record<string, string | readonly string[]>>> = (
  context: PageContext<Parameters> & Readonly<{ children: RenderChild }>,
) => RenderChild | Promise<RenderChild>;

export interface MatchedRouteRender {
  readonly request: Request;
  readonly parameters: Readonly<Record<string, string | readonly string[]>>;
  readonly page: Page;
  readonly layouts: readonly Layout[];
  readonly notFound?: NotFoundPage;
  readonly error?: ErrorPage;
}

export interface BoundaryProps {
  readonly children: RenderChild | ((signal: AbortSignal) => RenderChild | Promise<RenderChild>);
  readonly fallback: RenderChild;
  readonly timeoutMilliseconds?: number;
}

export function Boundary(properties: BoundaryProps): RenderNode {
  return createBoundaryNode(properties.children, properties.fallback, properties.timeoutMilliseconds);
}

export function notFound(): RouteOutcome {
  return createNotFoundOutcome();
}

export function redirect(location: string, status: 303 | 307 | 308 = 303): RedirectOutcome {
  return createRedirectOutcome(location, status);
}

export function renderRoute(input: MatchedRouteRender): Promise<Response> {
  return renderMatchedRoute(input);
}

declare const unsafeHtmlBrand: unique symbol;

export interface UnsafeHtml {
  readonly [unsafeHtmlBrand]: true;
}

export function unsafeHtml<const Reason extends string>(
  html: string,
  options: { readonly reason: Reason extends "" ? never : Reason },
): UnsafeHtml {
  return createUnsafeHtml(html, options.reason) as UnsafeHtml;
}

export interface RouteConfig {
  readonly root: string;
}

export interface FadenoConfig {
  readonly routes?: RouteConfig;
}

type NoExtra<Actual, Expected> = Actual & Record<Exclude<keyof Actual, keyof Expected>, never>;
type ExactConfig<Config extends FadenoConfig> = NoExtra<Config, FadenoConfig> &
  (Config extends { readonly routes: infer Routes extends RouteConfig }
    ? { readonly routes: NoExtra<Routes, RouteConfig> }
    : unknown);

export function defineConfig<const Config extends FadenoConfig>(config: ExactConfig<Config>): Config {
  return config;
}
