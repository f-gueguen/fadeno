import type {
  ActionDeclaration,
  ActionFieldToken,
  SessionView,
} from "../index.ts";

export type ActionRenderFailure = Readonly<{
  action: ActionDeclaration<Record<string, unknown>>;
  fields: Readonly<Record<string, unknown>>;
  fieldErrors: Readonly<Record<string, string>>;
  formErrors: readonly string[];
  code: string;
}>;

export type ActionFormRendering = Readonly<{
  actionUrl: string;
  encoding: "application/x-www-form-urlencoded" | "multipart/form-data";
  proof: string;
  generatedNames: Readonly<Record<string, string>>;
  failure: ActionRenderFailure | null;
}>;

export interface ActionRequestContext {
  readonly session: SessionView;
  readonly applicationGeneration: string;
  renderForm(
    action: ActionDeclaration<Record<string, unknown>>,
    routeId: string,
    returnLocation: string,
  ): ActionFormRendering;
  fieldName(token: ActionFieldToken<unknown>): string;
}

const contexts = new WeakMap<Request, ActionRequestContext>();

export function bindActionRequestContext(request: Request, context: ActionRequestContext): () => void {
  if (contexts.has(request)) throw new TypeError("FADENO_ACTION_REQUEST_CONTEXT");
  contexts.set(request, context);
  return () => { contexts.delete(request); };
}

export function captureActionRequestContext(request: Request): ActionRequestContext | undefined {
  return contexts.get(request);
}

