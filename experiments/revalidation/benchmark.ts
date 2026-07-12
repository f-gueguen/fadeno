import {
  REVALIDATION_RESOURCE_IDS,
  type RevalidationBaselines,
  type RevalidationInput,
  type RevalidationRead,
  type RevalidationResourceId,
  type RevalidationWorkload,
} from "./contract.ts";

type Auth = Readonly<{ principalId: string; tenantId: string; secretCanary: string }>;
type ValueResult = Readonly<{ status: "value"; cacheable: boolean; value: unknown }>;
type ErrorResult = Readonly<{ status: "expected-error"; cacheable: true; code: string }>;
export type ResourceResult = ValueResult | ErrorResult;
type Task = { id: number; completed: boolean; rank: number };
type State = { tasks: Task[]; revision: number };

export type PageObservation = Readonly<{
  results: Readonly<Record<RevalidationResourceId, ResourceResult>>;
  executions: Readonly<Record<RevalidationResourceId, number>>;
}>;
export type SelectiveObservation = Readonly<{
  results: Readonly<Partial<Record<RevalidationResourceId, ResourceResult>>>;
  executions: Readonly<Record<RevalidationResourceId, number>>;
}>;

function canonicalJson(value: unknown, ancestors = new Set<object>()): string | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : undefined;
  if (typeof value !== "object" || ancestors.has(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return undefined;

  ancestors.add(value);
  const entries = Array.isArray(value)
    ? value.map((child, index) => [String(index), child] as const)
    : Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const children = entries.map(([key, child]) => {
    const encoded = canonicalJson(child, ancestors);
    return encoded === undefined ? undefined : [key, encoded] as const;
  });
  ancestors.delete(value);
  if (children.some((child) => child === undefined)) return undefined;
  if (Array.isArray(value)) return `[${children.map((child) => child?.[1]).join(",")}]`;
  return `{${children.map((child) => `${JSON.stringify(child?.[0])}:${child?.[1]}`).join(",")}}`;
}

export function resourceIdentityKey(resource: RevalidationResourceId, input: RevalidationInput): string {
  const encoded = canonicalJson(input);
  if (encoded === undefined) throw new Error(`FADENO_REVALIDATION_UNSUPPORTED_INPUT:${resource}`);
  return `${resource}:${encoded}`;
}

export function compareResourceResults(before: ResourceResult, after: ResourceResult): "equal" | "changed" | "refused" {
  if (!before.cacheable || !after.cacheable) return "refused";
  if (before.status !== after.status) return "changed";
  if (before.status === "expected-error" && after.status === "expected-error") return before.code === after.code ? "equal" : "changed";
  if (before.status === "value" && after.status === "value") {
    const beforeValue = canonicalJson(before.value);
    const afterValue = canonicalJson(after.value);
    if (beforeValue === undefined || afterValue === undefined) return "refused";
    return beforeValue === afterValue ? "equal" : "changed";
  }
  return "changed";
}

export function observableTaskTarget(result: ResourceResult | undefined): boolean | undefined {
  if (!result || result.status !== "value" || !result.value || typeof result.value !== "object" || Array.isArray(result.value)) return undefined;
  const target = Reflect.get(result.value, "target");
  return typeof target === "boolean" ? target : undefined;
}

export function createState(rowCount: number): State {
  return {
    tasks: Array.from({ length: rowCount }, (_, id) => ({ id, completed: id % 11 === 0, rank: (id * 17) % rowCount })),
    revision: 0,
  };
}

function loadResource(id: RevalidationResourceId, state: State, auth: Auth, _input: RevalidationInput): ResourceResult {
  if (auth.principalId !== "principal-001" || auth.tenantId !== "tenant-001") return { status: "expected-error", cacheable: true, code: "not-authorized" };
  switch (id) {
    case "profile": return { status: "value", cacheable: true, value: { id: auth.principalId, tenant: auth.tenantId } };
    case "projects": return { status: "value", cacheable: true, value: state.tasks.slice(0, 32).sort((left, right) => left.rank - right.rank).map(({ id: taskId }) => taskId) };
    case "tasks": return { status: "value", cacheable: true, value: { completed: state.tasks.filter(({ completed }) => completed).length, target: state.tasks[4242]?.completed } };
    case "activity": return { status: "value", cacheable: false, value: { ids: state.tasks.slice(0, 8).map(({ id: taskId }) => taskId) } };
    case "notifications": return { status: "value", cacheable: true, value: { unread: 0 } };
    case "permissions": return { status: "value", cacheable: true, value: ["read", "complete-task"] };
  }
}

export class RequestScope {
  readonly #cache = new Map<string, ResourceResult>();
  readonly #executions = new Map<RevalidationResourceId, number>();
  readonly state: State;
  readonly auth: Auth;
  constructor(state: State, auth: Auth) {
    this.state = state;
    this.auth = auth;
  }

  read(id: RevalidationResourceId, input: RevalidationInput): ResourceResult {
    const identity = resourceIdentityKey(id, input);
    const cached = this.#cache.get(identity);
    if (cached) return cached;
    this.#executions.set(id, (this.#executions.get(id) ?? 0) + 1);
    const result = loadResource(id, this.state, this.auth, input);
    this.#cache.set(identity, result);
    return result;
  }

  executions(): Record<RevalidationResourceId, number> {
    return Object.fromEntries(REVALIDATION_RESOURCE_IDS.map((id) => [id, this.#executions.get(id) ?? 0])) as Record<RevalidationResourceId, number>;
  }
}

function renderReads(state: State, auth: Auth, reads: readonly RevalidationRead[]): SelectiveObservation {
  const scope = new RequestScope(state, auth);
  const results: Partial<Record<RevalidationResourceId, ResourceResult>> = {};
  for (const { resource, input } of reads) results[resource] = scope.read(resource, input);
  return { results, executions: scope.executions() };
}

export function renderPage(state: State, auth: Auth, workload: RevalidationWorkload): PageObservation {
  return renderReads(state, auth, workload.pageReads) as PageObservation;
}

export function completeTask(state: State, auth: Auth, rowId: number): Readonly<{ status: "success" | "expected-error"; code?: string }> {
  if (auth.principalId !== "principal-001" || auth.tenantId !== "tenant-001") return { status: "expected-error", code: "not-authorized" };
  const task = state.tasks[rowId];
  if (!task) return { status: "expected-error", code: "not-found" };
  task.completed = true;
  state.revision += 1;
  return { status: "success" };
}

export function revalidateDefault(state: State, auth: Auth, workload: RevalidationWorkload, baselines: RevalidationBaselines): PageObservation {
  const included = new Set(baselines.default.revalidates);
  return renderReads(state, auth, workload.pageReads.filter(({ resource }) => included.has(resource))) as PageObservation;
}

export function revalidateSelective(state: State, auth: Auth, workload: RevalidationWorkload, baselines: RevalidationBaselines): SelectiveObservation {
  const selected = new Set<RevalidationResourceId>(baselines.selective.revalidates);
  const reads = workload.pageReads.filter(({ resource }, index, all) =>
    selected.has(resource) && all.findIndex((candidate) => candidate.resource === resource) === index
  );
  return renderReads(state, auth, reads);
}

function firstRead(workload: RevalidationWorkload, resource: RevalidationResourceId): RevalidationRead {
  const read = workload.pageReads.find((candidate) => candidate.resource === resource);
  if (!read) throw new Error(`FADENO_REVALIDATION_MISSING_READ:${resource}`);
  return read;
}

export function buildUnsafeKeepsControls(
  workload: RevalidationWorkload,
): ReadonlyMap<RevalidationResourceId, readonly [ResourceResult, ResourceResult]> {
  const auth = workload.authentication;

  const taskState = createState(workload.dataset.rowCount);
  const taskRead = firstRead(workload, "tasks");
  const taskBefore = new RequestScope(taskState, auth).read(taskRead.resource, taskRead.input);
  completeTask(taskState, auth, workload.mutation.rowId);
  const taskAfter = new RequestScope(taskState, auth).read(taskRead.resource, taskRead.input);

  const permissionState = createState(workload.dataset.rowCount);
  const permissionRead = firstRead(workload, "permissions");
  const permissionBefore = new RequestScope(permissionState, auth).read(permissionRead.resource, permissionRead.input);
  const permissionAfter = new RequestScope(permissionState, { ...auth, principalId: "unauthorized" }).read(permissionRead.resource, permissionRead.input);

  const projectState = createState(workload.dataset.rowCount);
  const projectRead = firstRead(workload, "projects");
  const projectBefore = new RequestScope(projectState, auth).read(projectRead.resource, projectRead.input);
  for (let index = 0; index < 32; index += 1) {
    const task = projectState.tasks[index];
    if (task) task.rank = 31 - index;
  }
  const projectAfter = new RequestScope(projectState, auth).read(projectRead.resource, projectRead.input);

  const activityState = createState(workload.dataset.rowCount);
  const activityRead = firstRead(workload, "activity");
  const activityBefore = new RequestScope(activityState, auth).read(activityRead.resource, activityRead.input);
  const activityAfter = new RequestScope(activityState, auth).read(activityRead.resource, activityRead.input);

  return new Map([
    ["tasks", [taskBefore, taskAfter]],
    ["permissions", [permissionBefore, permissionAfter]],
    ["projects", [projectBefore, projectAfter]],
    ["activity", [activityBefore, activityAfter]],
  ]);
}
