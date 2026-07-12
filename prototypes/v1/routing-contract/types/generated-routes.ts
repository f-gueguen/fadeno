export const routeTypeModel = {
  "/": {},
  "/accounts/[accountId]": { accountId: "single" },
  "/docs/[...parts]": { parts: "rest" },
  "/docs/[slug]": { slug: "single" },
  "/docs/about": {},
  "/files/[...parts]": { parts: "rest" },
  "/teams/[teamId]/members/[memberId]": { teamId: "single", memberId: "single" },
} as const;

export type RouteDefinitionMap = typeof routeTypeModel;
export type RouteId = Extract<keyof RouteDefinitionMap, string>;
type ParameterValue<Kind> = Kind extends "rest" ? readonly [string, ...string[]] : string;
export type RouteParameters<Id extends RouteId> = Id extends RouteId
  ? keyof RouteDefinitionMap[Id] extends never
    ? never
    : { readonly [Key in keyof RouteDefinitionMap[Id]]: ParameterValue<RouteDefinitionMap[Id][Key]> }
  : never;
export type RouteHrefInput<Id extends RouteId = RouteId> = {
  readonly [Current in Id]: keyof RouteDefinitionMap[Current] extends never
    ? { readonly route: Current }
    : { readonly route: Current; readonly parameters: RouteParameters<Current> };
}[Id];

type NoExtra<Actual, Expected> = Actual & Record<Exclude<keyof Actual, keyof Expected>, never>;
type ExactRouteHrefInput<Input extends RouteHrefInput> = Input extends {
  readonly route: infer Id extends RouteId;
}
  ? keyof RouteDefinitionMap[Id] extends never
    ? NoExtra<Input, { readonly route: Id }>
    : Input extends { readonly parameters: infer Parameters extends RouteParameters<Id> }
      ? NoExtra<Input, { readonly route: Id; readonly parameters: Parameters }> & {
          readonly parameters: NoExtra<Parameters, RouteParameters<Id>>;
        }
      : never
  : never;

export interface RouteHrefFunction {
  <const Input extends RouteHrefInput>(input: ExactRouteHrefInput<Input>): string;
}

export declare const routeHref: RouteHrefFunction;
