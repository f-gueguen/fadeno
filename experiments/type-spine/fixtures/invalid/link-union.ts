import type { LinkInput, RouteId } from "../../generated/candidate-types.ts";

const link: LinkInput<RouteId> = {
  route: "home",
  parameters: { accountId: "account-1" },
};
void link;
