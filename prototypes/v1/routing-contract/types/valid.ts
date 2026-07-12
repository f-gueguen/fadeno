import {
  routeHref,
  type RouteHrefInput,
  type RouteId,
  type RouteParameters,
} from "./generated-routes.js";

const root = routeHref({ route: "/" });
const account = routeHref({ route: "/accounts/[accountId]", parameters: { accountId: "a/b" } });
const member = routeHref({
  route: "/teams/[teamId]/members/[memberId]",
  parameters: { teamId: "team", memberId: "member" },
});
const files = routeHref({ route: "/files/[...parts]", parameters: { parts: ["one", "two"] } });

const selected: RouteId = Math.random() > 0.5 ? "/" : "/accounts/[accountId]";
const correlated: RouteHrefInput<typeof selected> = selected === "/"
  ? { route: "/" }
  : { route: "/accounts/[accountId]", parameters: { accountId: "account" } };
const fromUnion = routeHref(correlated);
const parameters: RouteParameters<"/accounts/[accountId]"> = { accountId: "account" };

void [root, account, member, files, fromUnion, parameters];
