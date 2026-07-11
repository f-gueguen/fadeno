import type { RequestContext } from "../../generated/candidate-types.ts";

const context: RequestContext = { actorId: "actor-1", csrfToken: "token" };
void context.actorId;
