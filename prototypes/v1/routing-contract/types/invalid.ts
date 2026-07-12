import { routeHref, type RouteHrefInput } from "./generated-routes.js";

// @ts-expect-error arbitrary strings are not routes
routeHref({ route: "/missing" });
declare const broadRoute: string;
// @ts-expect-error broad strings are not accepted as route identities
routeHref({ route: broadRoute });
// @ts-expect-error dynamic parameters are required
routeHref({ route: "/accounts/[accountId]" });
// @ts-expect-error a static route has no parameters member
routeHref({ route: "/", parameters: {} });
// @ts-expect-error parameter names remain correlated to the route
routeHref({ route: "/accounts/[accountId]", parameters: { memberId: "wrong" } });
// @ts-expect-error excess parameters are refused
routeHref({ route: "/accounts/[accountId]", parameters: { accountId: "ok", extra: "no" } });
const indirectExcess = { route: "/accounts/[accountId]", parameters: { accountId: "ok", extra: "no" } } as const;
// @ts-expect-error excess parameters remain refused through variables
routeHref(indirectExcess);
// @ts-expect-error rest routes require a non-empty tuple
routeHref({ route: "/files/[...parts]", parameters: { parts: [] } });

const uncorrelated: RouteHrefInput = Math.random() > 0.5
  ? { route: "/" }
  // @ts-expect-error the other route's parameters cannot be paired with this discriminator
  : { route: "/accounts/[accountId]", parameters: { memberId: "wrong" } };
void uncorrelated;
