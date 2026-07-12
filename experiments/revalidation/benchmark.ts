import type { RevalidationResourceId, RevalidationWorkload } from "./contract.ts";

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

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left < right ? -1 : 1).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

export function compareResourceResults(before: ResourceResult, after: ResourceResult): "equal" | "changed" | "refused" {
  if (!before.cacheable || !after.cacheable) return "refused";
  if (before.status !== after.status) return "changed";
  if (before.status === "expected-error" && after.status === "expected-error") return before.code === after.code ? "equal" : "changed";
  if (before.status === "value" && after.status === "value") return canonical(before.value) === canonical(after.value) ? "equal" : "changed";
  return "changed";
}

export function createState(rowCount: number): State {
  return {
    tasks: Array.from({ length: rowCount }, (_, id) => ({ id, completed: id % 11 === 0, rank: (id * 17) % rowCount })),
    revision: 0,
  };
}

function loadResource(id: RevalidationResourceId, state: State, auth: Auth): ResourceResult {
  if (auth.principalId !== "principal-001" || auth.tenantId !== "tenant-001") return { status: "expected-error", cacheable: true, code: "not-authorized" };
  switch (id) {
    case "profile": return { status: "value", cacheable: true, value: { id: auth.principalId, tenant: auth.tenantId } };
    case "projects": return { status: "value", cacheable: true, value: state.tasks.slice(0, 32).sort((left, right) => left.rank - right.rank).map(({ id }) => id) };
    case "tasks": return { status: "value", cacheable: true, value: { revision: state.revision, completed: state.tasks.filter(({ completed }) => completed).length, target: state.tasks[4242]?.completed } };
    case "activity": return { status: "value", cacheable: false, value: { ids: state.tasks.slice(0, 8).map(({ id }) => id) } };
    case "notifications": return { status: "value", cacheable: true, value: { unread: 0 } };
    case "permissions": return { status: "value", cacheable: true, value: ["read", "complete-task"] };
  }
}

export class RequestScope {
  readonly #cache = new Map<RevalidationResourceId, ResourceResult>();
  readonly #executions = new Map<RevalidationResourceId, number>();
  readonly state: State;
  readonly auth: Auth;
  constructor(state: State, auth: Auth) {
    this.state = state;
    this.auth = auth;
  }

  read(id: RevalidationResourceId): ResourceResult {
    const cached = this.#cache.get(id);
    if (cached) return cached;
    this.#executions.set(id, (this.#executions.get(id) ?? 0) + 1);
    const result = loadResource(id, this.state, this.auth);
    this.#cache.set(id, result);
    return result;
  }

  executions(): Record<RevalidationResourceId, number> {
    return Object.fromEntries(["activity", "notifications", "permissions", "profile", "projects", "tasks"].map((id) => [id, this.#executions.get(id as RevalidationResourceId) ?? 0])) as Record<RevalidationResourceId, number>;
  }
}

export function renderPage(state: State, auth: Auth, workload: RevalidationWorkload): PageObservation {
  const scope = new RequestScope(state, auth);
  const results = {} as Record<RevalidationResourceId, ResourceResult>;
  for (const id of workload.pageReads) results[id] = scope.read(id);
  return { results, executions: scope.executions() };
}

export function completeTask(state: State, auth: Auth, rowId: number): Readonly<{ status: "success" | "expected-error"; code?: string }> {
  if (auth.principalId !== "principal-001" || auth.tenantId !== "tenant-001") return { status: "expected-error", code: "not-authorized" };
  const task = state.tasks[rowId];
  if (!task) return { status: "expected-error", code: "not-found" };
  task.completed = true;
  state.revision += 1;
  return { status: "success" };
}

export function revalidateDefault(state: State, auth: Auth, workload: RevalidationWorkload): PageObservation {
  return renderPage(state, auth, workload);
}

export function revalidateSelective(state: State, auth: Auth): PageObservation {
  const scope = new RequestScope(state, auth);
  const tasks = scope.read("tasks");
  return {
    results: { tasks } as Record<RevalidationResourceId, ResourceResult>,
    executions: scope.executions(),
  };
}
