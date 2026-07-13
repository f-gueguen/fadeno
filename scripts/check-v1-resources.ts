import assert from "node:assert/strict";

import {
  defineResource,
  resourceError,
  type ResourceDeclaration,
  type ResourceInput,
} from "../packages/framework/src/index.ts";
import {
  revalidateResourceDependencies,
  ResourceRequestScope,
  type ResourceDependency,
} from "../packages/framework/src/internal/resource.ts";

function request(signal?: AbortSignal): Request {
  return new Request("https://example.test/projects", signal ? { signal } : undefined);
}

let generation = 0;
const reads = new Map<string, number>();
function count(name: string): void { reads.set(name, (reads.get(name) ?? 0) + 1); }

const tasks = defineResource({ read: ({ input }: { input: Readonly<{ projectId: number }> }) => {
  count("tasks");
  return generation === 0 ? [`task-${input.projectId}-a`, `task-${input.projectId}-b`] : [`task-${input.projectId}-b`, `task-${input.projectId}-a`];
} });
const permissions = defineResource({ read: () => {
  count("permissions");
  throw generation === 0
    ? resourceError({ code: "ACCESS_DENIED", status: 403 })
    : resourceError({ code: "ACCESS_EXPIRED", status: 401 });
} });
const stable = defineResource({ read: () => { count("stable"); return { state: "unchanged" }; } });
const activity = defineResource({ read: () => { count("activity"); return new Map([["generation", generation]]); } });
const flaky = defineResource({ read: () => {
  count("flaky");
  if (generation > 0) throw new Error("storage failed");
  return "available";
} });
const notActive = defineResource({ read: () => "not-active" });

const initial = new ResourceRequestScope(request());
assert.deepEqual(await initial.read(tasks, { projectId: 7 }), ["task-7-a", "task-7-b"]);
await assert.rejects(initial.read(permissions, null));
assert.deepEqual(await initial.read(stable, null), { state: "unchanged" });
assert.ok(await initial.read(activity, null) instanceof Map);
assert.equal(await initial.read(flaky, null), "available");
const baseline = initial.dependencies;
initial.close();
assert.equal(baseline.length, 5);
assert.deepEqual(baseline.map(({ observation }) => observation.status), [
  "value", "expected-error", "value", "value", "value",
]);

generation = 1;
const keeps = [tasks, permissions, stable, activity, flaky, notActive] as readonly ResourceDeclaration<ResourceInput, unknown>[];
const report = await revalidateResourceDependencies(request(), baseline, keeps);
assert.equal(report.baseline, "all-active-dependencies");
assert.equal(report.dependencies.length, baseline.length, "every active dependency is rerun despite keeps metadata");
assert.equal(report.comparisons.length, baseline.length);
assert.equal(report.complete, false, "an unexpected loader failure blocks a complete result");
assert.deepEqual(Object.fromEntries(report.keeps.map(({ decision, resource }) => [
  resource === tasks ? "tasks"
    : resource === permissions ? "permissions"
      : resource === stable ? "stable"
        : resource === activity ? "activity"
          : resource === flaky ? "flaky"
            : "not-active",
  decision,
])), {
  tasks: "unsafe",
  permissions: "unsafe",
  stable: "verified",
  activity: "unsafe",
  flaky: "unsafe",
  "not-active": "not-active",
});
assert.deepEqual(report.comparisons.map(({ decision, reason }) => ({ decision, reason })), [
  { decision: "changed", reason: "value-changed" },
  { decision: "changed", reason: "expected-error-changed" },
  { decision: "unchanged", reason: "equivalent-value" },
  { decision: "refused", reason: "unsupported-value" },
  { decision: "refused", reason: "incomplete-revalidation" },
]);
assert.deepEqual(Object.fromEntries(reads), { tasks: 2, permissions: 2, stable: 2, activity: 2, flaky: 2 });

const correctedKeeps = [stable] as readonly ResourceDeclaration<ResourceInput, unknown>[];
const corrected = await revalidateResourceDependencies(request(), baseline.slice(0, 4), correctedKeeps);
assert.equal(corrected.complete, true);
assert.deepEqual(corrected.keeps.map(({ decision }) => decision), ["verified"]);
assert.equal(corrected.dependencies.length, 4, "removing unsafe keeps does not remove correctness work");

await assert.rejects(
  revalidateResourceDependencies(request(), [{ ...baseline[0]! }] as readonly ResourceDependency[]),
  /FADENO_RESOURCE_REVALIDATION_INPUT/u,
);
await assert.rejects(
  revalidateResourceDependencies(request(), [baseline[0]!, baseline[0]!]),
  /FADENO_RESOURCE_REVALIDATION_INPUT/u,
);
await assert.rejects(
  revalidateResourceDependencies(request(), baseline, [stable, stable] as readonly ResourceDeclaration<ResourceInput, unknown>[]),
  /FADENO_RESOURCE_REVALIDATION_KEEPS/u,
);

let cancellationPhase: "baseline" | "blocked" = "baseline";
const cancellable = defineResource({ read: ({ signal }) => {
  if (cancellationPhase === "baseline") return "ready";
  return new Promise<string>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
  });
} });
const cancellationBaselineScope = new ResourceRequestScope(request());
assert.equal(await cancellationBaselineScope.read(cancellable, null), "ready");
const cancellationBaseline = cancellationBaselineScope.dependencies;
cancellationBaselineScope.close();
cancellationPhase = "blocked";
const controller = new AbortController();
const cancelled = revalidateResourceDependencies(request(controller.signal), cancellationBaseline);
queueMicrotask(() => controller.abort());
await assert.rejects(cancelled, (error: unknown) => error instanceof DOMException && error.name === "AbortError");

const flow = {
  operation: "correctness-first-resource-revalidation",
  ownership: "all-active-dependencies",
  executed: report.dependencies.length,
  causes: report.comparisons.map(({ reason }) => reason),
  keeps: report.keeps.map(({ decision }, index) => ({ resource: ["tasks", "permissions", "stable", "activity", "flaky", "not-active"][index], decision })),
  skippedWork: report.keeps.filter(({ decision }) => decision === "not-active").map(() => "inactive-resource-read"),
  observableOutcome: report.complete ? "complete" : "refused",
  correction: { before: keeps.length, after: correctedKeeps.length, correctnessReadsRemoved: 0 },
};
assert.deepEqual(flow.skippedWork, ["inactive-resource-read"]);
assert.equal(flow.observableOutcome, "refused");
assert.deepEqual(flow.correction, { before: 6, after: 1, correctnessReadsRemoved: 0 });

console.log("V1 resource runtime passed (complete revalidation, keeps refusal/correction, flow, cancellation)");
