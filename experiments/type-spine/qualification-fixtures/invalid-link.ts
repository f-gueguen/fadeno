import type { LinkInput } from "../generated/candidate-types.ts";

export const invalid: LinkInput<"r0001" | "r0002"> = {
  route: "r0002",
  parameters: { p00: 1, p01: true },
};
