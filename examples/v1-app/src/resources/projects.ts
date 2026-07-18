import {
  defineResource,
  resourceError,
  type ResourceReadContext,
} from "@fadeno/framework";

export type ProjectInput = Readonly<{
  projectId: number;
  region: string;
}>;

export const projectSummary = defineResource({
  read({ input, request }: ResourceReadContext<ProjectInput>) {
    const authorization = request.headers.get("authorization");
    const viewer = authorization === "Bearer example-tenant-alpha"
      ? "tenant-alpha"
      : authorization === "Bearer example-tenant-beta"
        ? "tenant-beta"
        : "public";
    return Object.freeze({ projectId: input.projectId, region: input.region, viewer });
  },
});

export const missingProject = defineResource({
  read() {
    throw resourceError({ code: "PROJECT_NOT_FOUND", status: 404 });
  },
});

let recoveryAttempt = 0;

export const recoveringProject = defineResource({
  read({ input }: ResourceReadContext<ProjectInput>) {
    recoveryAttempt += 1;
    if (recoveryAttempt === 1) {
      throw resourceError({ code: "PROJECT_TEMPORARILY_UNAVAILABLE", status: 503 });
    }
    return Object.freeze({ projectId: input.projectId });
  },
});
