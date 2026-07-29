import {
  defineResource,
  resourceError,
  type ResourceReadContext,
} from "@fadeno/framework";

export type ProjectInput = Readonly<{
  projectId: number;
  region: string;
}>;

let projectSummaryExecution = 0;

export const projectSummary = defineResource({
  read({ input, request }: ResourceReadContext<ProjectInput>) {
    projectSummaryExecution += 1;
    const authorization = request.headers.get("authorization");
    const viewer = authorization === "Bearer example-tenant-alpha"
      ? "tenant-alpha"
      : authorization === "Bearer example-tenant-beta"
        ? "tenant-beta"
        : "public";
    return Object.freeze({
      executionId: `resource-${projectSummaryExecution}`,
      projectId: input.projectId,
      region: input.region,
      viewer,
    });
  },
});

export const missingProject = defineResource({
  read() {
    throw resourceError({ code: "PROJECT_NOT_FOUND", status: 404 });
  },
});

const recoveryAttempts = new Map<string, number>();

export const recoveringProject = defineResource({
  read({ input }: ResourceReadContext<ProjectInput>) {
    const recoveryAttempt = (recoveryAttempts.get(input.region) ?? 0) + 1;
    recoveryAttempts.set(input.region, recoveryAttempt);
    if (recoveryAttempt === 1) {
      throw resourceError({ code: "PROJECT_TEMPORARILY_UNAVAILABLE", status: 503 });
    }
    recoveryAttempts.delete(input.region);
    return Object.freeze({ projectId: input.projectId });
  },
});
