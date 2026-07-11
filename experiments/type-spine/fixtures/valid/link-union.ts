import type { LinkInput, RouteId } from "../../generated/candidate-types.ts";

declare const route: RouteId;
const link: LinkInput<RouteId> = route === "home"
  ? { route: "home", parameters: {} }
  : { route: "account", parameters: { accountId: "account-1" } };
void link;
