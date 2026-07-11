import type {
  ActionFields,
  LinkInput,
  RequestContext,
  RouteParameters,
} from "../generated/candidate-types.ts";

export const route: RouteParameters<"r0001"> = { p00: 1, p01: true };
export const link: LinkInput<"r0001" | "r0002"> = {
  route: "r0002",
  parameters: { p00: false, p01: "value", p02: 2 },
};
export const fields: ActionFields<"f000"> = { v00: 1 };
export const context: RequestContext = {
  c00: "value", c01: 1, c02: true,
  c03: "value", c04: 1, c05: true,
  c06: "value", c07: 1, c08: true,
};
