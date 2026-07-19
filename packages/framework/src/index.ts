import { createUnsafeHtml } from "./internal/unsafe-html.ts";
import { createBoundaryNode } from "./internal/render-node.ts";
import { createNotFoundOutcome, createRedirectOutcome, renderMatchedRoute } from "./internal/render-route.ts";
import { createResourceDeclaration, createResourceError } from "./internal/resource.ts";
import {
  createActionDeclaration,
  createActionError,
  createCheckboxField,
  createFileField,
  createIntegerField,
  createTextField,
} from "./internal/action.ts";

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

declare const actionFieldBrand: unique symbol;
declare const actionFieldTokenBrand: unique symbol;
declare const actionDeclarationBrand: unique symbol;
declare const actionErrorBrand: unique symbol;
declare const actionRedirectOutcomeBrand: unique symbol;

export interface ActionUpload {
  readonly originalName: string;
  readonly contentType: string;
  readonly size: number;
  bytes(): Uint8Array;
}

export interface ActionField<Value> { readonly [actionFieldBrand]: Value }
export interface ActionFieldToken<Value> { readonly [actionFieldTokenBrand]: Value }
export type ActionInput<Fields extends Readonly<Record<string, ActionField<unknown>>>> = Readonly<{
  [Name in keyof Fields]: Fields[Name] extends ActionField<infer Value> ? Value : never;
}>;

export interface SessionValueObject { readonly [key: string]: SessionValue }
export type SessionValue = null | boolean | number | string | readonly SessionValue[] | SessionValueObject;

export interface SessionView {
  get(key: string): SessionValue | undefined;
  has(key: string): boolean;
}

export interface Session extends SessionView {
  set(key: string, value: SessionValue): void;
  delete(key: string): void;
  clear(): void;
  rotate(): void;
}

export interface ActionAuthorizationContext<Input extends Readonly<Record<string, unknown>>> {
  readonly request: Request;
  readonly session: SessionView;
  readonly input: Input;
  readonly signal: AbortSignal;
}

export interface ActionRunContext<Input extends Readonly<Record<string, unknown>>> {
  readonly request: Request;
  readonly session: Session;
  readonly input: Input;
  readonly signal: AbortSignal;
}

export interface ActionOptions<Fields extends Readonly<Record<string, ActionField<unknown>>>> {
  readonly fields: Fields;
  readonly authorize: (context: ActionAuthorizationContext<ActionInput<Fields>>) => boolean | Promise<boolean>;
  readonly run: (context: ActionRunContext<ActionInput<Fields>>) => void | ActionRedirectOutcome | Promise<void | ActionRedirectOutcome>;
  readonly keeps?: readonly ResourceDeclaration<ResourceInput, unknown>[];
}

export interface ActionDeclaration<Input extends Readonly<Record<string, unknown>>> {
  readonly [actionDeclarationBrand]: Input;
  readonly fields: Readonly<{ [Name in keyof Input]: ActionFieldToken<Input[Name]> }>;
}

export interface ActionError extends Error { readonly [actionErrorBrand]: true }

export function textField<const Required extends boolean = true>(
  options: Readonly<{ required?: Required; maximumBytes?: number }> = {},
): ActionField<Required extends false ? string | null : string> {
  return createTextField(options) as ActionField<Required extends false ? string | null : string>;
}

export function integerField<const Required extends boolean = true>(
  options: Readonly<{ required?: Required; minimum?: number; maximum?: number }> = {},
): ActionField<Required extends false ? number | null : number> {
  return createIntegerField(options) as ActionField<Required extends false ? number | null : number>;
}

export function checkboxField(): ActionField<boolean> { return createCheckboxField(); }

export function fileField<const Required extends boolean = true>(options: Readonly<{
  required?: Required;
  maximumBytes?: number;
  acceptedTypes?: readonly string[];
}> = {}): ActionField<Required extends false ? ActionUpload | null : ActionUpload> {
  return createFileField(options) as ActionField<Required extends false ? ActionUpload | null : ActionUpload>;
}

export function defineAction<const Fields extends Readonly<Record<string, ActionField<unknown>>>>(
  options: ActionOptions<Fields>,
): ActionDeclaration<ActionInput<Fields>> {
  return createActionDeclaration(options);
}

export function actionError(input: Readonly<{
  code: string;
  changed?: boolean;
  fieldErrors?: Readonly<Record<string, string>>;
  formErrors?: readonly string[];
}>): ActionError {
  return createActionError(input);
}

export type Handler = (request: Request) => Response | Promise<Response>;

declare const renderNodeBrand: unique symbol;
declare const routeOutcomeBrand: unique symbol;

export interface RenderNode { readonly [renderNodeBrand]: true; }
export interface RouteOutcome { readonly [routeOutcomeBrand]: true; }
export interface RedirectOutcome extends RouteOutcome {}
export interface ActionRedirectOutcome extends RedirectOutcome { readonly [actionRedirectOutcomeBrand]: true }

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
  readonly session: SessionView;
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
  /** Generated route identity used by the action runtime. Application code does not author this value. */
  readonly routeId?: string;
  /** Generated application identity used by the action runtime. Application code does not author this value. */
  readonly generation?: string;
  /** Generated same-origin browser entry used by the enhancement runtime. Application code does not author this value. */
  readonly browserModule?: string;
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

export function redirect(location: string, status?: 303): ActionRedirectOutcome;
export function redirect(location: string, status: 307 | 308): RedirectOutcome;
export function redirect(location: string, status: 303 | 307 | 308 = 303): RedirectOutcome {
  return createRedirectOutcome(location, status) as RedirectOutcome;
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
