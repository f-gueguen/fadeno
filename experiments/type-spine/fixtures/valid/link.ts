import type { LinkInput } from "../../generated/candidate-types.ts";

const link: LinkInput<"account"> = {
  route: "account",
  parameters: { accountId: "account-1" },
};
void link;
