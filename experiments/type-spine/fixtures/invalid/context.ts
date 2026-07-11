import type { RequestContext } from "../../generated/candidate-types.ts";

declare const context: RequestContext;
void context.tenantId;
