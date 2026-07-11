import type { RequestContext } from "../generated/candidate-types.ts";

declare const context: RequestContext;
export const invalid = context.missing;
