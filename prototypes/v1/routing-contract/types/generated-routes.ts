export interface RouteDefinitionMap {
  readonly "/": Record<never, never>;
  readonly "/accounts/[accountId]": { readonly accountId: string };
  readonly "/teams/[teamId]/members/[memberId]": {
    readonly teamId: string;
    readonly memberId: string;
  };
  readonly "/files/[...parts]": {
    readonly parts: readonly [string, ...string[]];
  };
}

export type RouteId = Extract<keyof RouteDefinitionMap, string>;
export type RouteParameters<Id extends RouteId> = RouteDefinitionMap[Id];
export type RouteHrefInput<Id extends RouteId = RouteId> = {
  readonly [Current in Id]: keyof RouteParameters<Current> extends never
    ? { readonly route: Current }
    : { readonly route: Current; readonly parameters: RouteParameters<Current> };
}[Id];

export declare function routeHref<const Id extends RouteId>(input: RouteHrefInput<Id>): string;
