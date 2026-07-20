import {
  actionError,
  defineAction,
  redirect,
  renderRoute,
  textField,
  type Handler,
  type RenderChild,
} from "@fadeno/framework";
import { jsx, jsxs } from "@fadeno/framework/jsx-runtime";

export const applicationGeneration = "v2-form-submission-example-v1";
export const browserModule = "/_fadeno/browser-entry.js";

let projects: string[] = [];
let searchRequests = 0;
let signInRuns = 0;
let redirectAwayRuns = 0;
let createRuns = 0;
let updateRuns = 0;
let deleteRuns = 0;
let forbiddenRuns = 0;
let projectPageRenders = 0;
let mutationDelayMilliseconds = 0;

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

function duplicateProjectTitle(): never {
  throw actionError({
    code: "PROJECT_TITLE_DUPLICATE",
    fieldErrors: { title: "Use a title that is not already in the project list." },
    formErrors: ["The project was not created because that title already exists."],
  });
}

export const signIn = defineAction({
  fields: { passcode: textField({ maximumBytes: 64 }) },
  authorize() { return true; },
  run({ input, session }) {
    signInRuns += 1;
    if (input.passcode !== "example-owner") {
      throw actionError({
        code: "SIGN_IN_REFUSED",
        fieldErrors: { passcode: "Use the example owner passcode." },
        formErrors: ["Sign-in was refused."],
      });
    }
    session.set("viewer", "owner");
    session.rotate();
    return redirect("/projects");
  },
});

export const redirectAway = defineAction({
  fields: { passcode: textField({ maximumBytes: 64 }) },
  authorize() { return true; },
  run({ input, session }) {
    redirectAwayRuns += 1;
    if (input.passcode !== "example-owner") {
      throw actionError({
        code: "REDIRECT_AWAY_REFUSED",
        fieldErrors: { passcode: "Use the example owner passcode." },
        formErrors: ["Redirect-away sign-in was refused."],
      });
    }
    session.set("viewer", "owner");
    session.rotate();
    return redirect("/");
  },
});

export const createProject = defineAction({
  fields: {
    title: textField({ maximumBytes: 128 }),
    intent: textField({ maximumBytes: 16 }),
  },
  authorize({ session }) { return session.get("viewer") === "owner"; },
  async run({ input, signal }) {
    createRuns += 1;
    const title = input.title.trim();
    if (title.length < 3) {
      throw actionError({
        code: "PROJECT_TITLE_SHORT",
        fieldErrors: { title: "Use at least three characters." },
        formErrors: ["The project was not created."],
      });
    }
    if (projects.includes(title)) duplicateProjectTitle();
    await wait(mutationDelayMilliseconds, signal);
    if (projects.includes(title)) duplicateProjectTitle();
    projects = [...projects, title];
  },
});

export const updateProject = defineAction({
  fields: {
    project: textField({ maximumBytes: 128 }),
    title: textField({ maximumBytes: 128 }),
    intent: textField({ maximumBytes: 16 }),
  },
  authorize({ session }) { return session.get("viewer") === "owner"; },
  run({ input }) {
    updateRuns += 1;
    const index = projects.indexOf(input.project);
    const title = input.title.trim();
    if (index === -1) {
      throw actionError({ code: "PROJECT_NOT_FOUND", formErrors: ["The project no longer exists."] });
    }
    if (title.length < 3) {
      throw actionError({
        code: "PROJECT_TITLE_SHORT",
        fieldErrors: { title: "Use at least three characters." },
        formErrors: ["The project was not updated."],
      });
    }
    if (projects.some((project, projectIndex) => projectIndex !== index && project === title)) {
      throw actionError({
        code: "PROJECT_TITLE_DUPLICATE",
        fieldErrors: { title: "Use a title that is not already in the project list." },
        formErrors: ["The project was not updated because that title already exists."],
      });
    }
    projects = projects.map((project, projectIndex) => projectIndex === index ? title : project);
    return redirect("/projects");
  },
});

export const deleteProject = defineAction({
  fields: {
    project: textField({ maximumBytes: 128 }),
    intent: textField({ maximumBytes: 16 }),
  },
  authorize({ session }) { return session.get("viewer") === "owner"; },
  run({ input }) {
    deleteRuns += 1;
    if (!projects.includes(input.project)) {
      throw actionError({ code: "PROJECT_NOT_FOUND", formErrors: ["The project no longer exists."] });
    }
    projects = projects.filter((project) => project !== input.project);
  },
});

export const forbiddenAction = defineAction({
  fields: { note: textField({ maximumBytes: 64 }) },
  authorize() { return false; },
  run() { forbiddenRuns += 1; },
});

export function resetApplicationState(): void {
  projects = [];
  searchRequests = 0;
  signInRuns = 0;
  redirectAwayRuns = 0;
  createRuns = 0;
  updateRuns = 0;
  deleteRuns = 0;
  forbiddenRuns = 0;
  projectPageRenders = 0;
  mutationDelayMilliseconds = 0;
}

export function setMutationDelay(milliseconds: number): void {
  mutationDelayMilliseconds = milliseconds;
}

export function readApplicationState(): Readonly<{
  projects: readonly string[];
  searchRequests: number;
  signInRuns: number;
  redirectAwayRuns: number;
  createRuns: number;
  updateRuns: number;
  deleteRuns: number;
  forbiddenRuns: number;
  projectPageRenders: number;
}> {
  return Object.freeze({
    projects: Object.freeze([...projects]),
    searchRequests,
    signInRuns,
    redirectAwayRuns,
    createRuns,
    updateRuns,
    deleteRuns,
    forbiddenRuns,
    projectPageRenders,
  });
}

function shell(title: string, heading: string, content: RenderChild): RenderChild {
  return jsxs("html", { lang: "en", children: [
    jsx("head", { children: jsx("title", { children: title }) }),
    jsx("body", { children: jsxs("main", { children: [
      jsx("h1", { children: heading }),
      jsx("nav", { "aria-label": "Example navigation", children: jsxs("p", { children: [
        jsx("a", { href: "/", children: "Search" }),
        " · ",
        jsx("a", { href: "/projects", children: "Projects" }),
      ] }) }),
      content,
    ] }) }),
  ] });
}

function home(): RenderChild {
  return shell("Form navigation", "GET form navigation", jsxs("form", {
    id: "search-form",
    action: "/search?discarded=1",
    method: "get",
    children: [
      jsx("label", { for: "query", children: "Query" }),
      jsx("input", { id: "query", name: "q", value: "thread" }),
      jsx("input", { name: "flag", type: "checkbox", checked: true }),
      jsx("input", { name: "tag", type: "hidden", value: "alpha" }),
      jsx("input", { name: "tag", type: "hidden", value: "beta" }),
      jsx("select", { name: "choice", children: jsx("option", { value: "exact", selected: true, children: "Exact" }) }),
      jsx("textarea", { name: "notes", children: "first\nsecond" }),
      jsx("input", { name: "ignored", value: "disabled", disabled: true }),
      jsx("button", { name: "submitter", value: "search", type: "submit", children: "Search" }),
    ],
  }));
}

function search(url: URL): RenderChild {
  searchRequests += 1;
  return shell("Search result", "Search result", jsxs("section", { children: [
    jsx("p", { id: "search-query", children: url.search }),
    jsx("p", { id: "search-method", children: "GET navigation only" }),
  ] }));
}

function projectsPage(signedIn: boolean): RenderChild {
  projectPageRenders += 1;
  if (!signedIn) {
    return shell("Protected forms", "Protected forms", jsxs("section", { children: [
      jsxs("form", { id: "sign-in-form", action: signIn, children: [
        jsx("label", { for: "passcode", children: "Passcode" }),
        jsx("input", { id: "passcode", name: signIn.fields.passcode, type: "password", required: true }),
        jsx("button", { type: "submit", children: "Sign in" }),
      ] }),
      jsxs("form", { id: "forbidden-form", action: forbiddenAction, children: [
        jsx("input", { name: forbiddenAction.fields.note, value: "secret-form-canary" }),
        jsx("button", { type: "submit", children: "Attempt forbidden action" }),
      ] }),
      jsxs("form", { id: "redirect-away-form", action: redirectAway, children: [
        jsx("label", { for: "redirect-away-passcode", children: "Redirect-away passcode" }),
        jsx("input", { id: "redirect-away-passcode", name: redirectAway.fields.passcode, type: "password", required: true }),
        jsx("button", { type: "submit", children: "Sign in and redirect away" }),
      ] }),
    ] }));
  }
  return shell("Project forms", "Project forms", jsxs("section", { children: [
    jsx("p", { id: "viewer", children: "Signed in owner" }),
    jsxs("form", { id: "create-form", action: createProject, children: [
      jsx("label", { for: "title", children: "Project title" }),
      jsx("input", { id: "title", name: createProject.fields.title, value: "ab" }),
      jsx("button", { name: createProject.fields.intent, value: "create", type: "submit", children: "Create project" }),
    ] }),
    jsx("ul", { id: "projects", children: projects.map((project) => jsx("li", { children:
      jsx("span", { class: "project-title", children: project }),
    })) }),
    jsxs("form", { id: "update-form", action: updateProject, children: [
        jsx("label", { for: "update-title", children: "Updated title" }),
        jsx("input", { id: "update-title", name: updateProject.fields.title, value: projects[0] ?? "" }),
        jsx("input", { name: updateProject.fields.intent, type: "hidden", value: "update" }),
        projects.map((project) => jsx("button", {
          name: updateProject.fields.project,
          value: project,
          type: "submit",
          children: `Update ${project}`,
        })),
    ] }),
    jsxs("form", { id: "delete-form", action: deleteProject, children: [
        jsx("input", { name: deleteProject.fields.intent, type: "hidden", value: "delete" }),
        projects.map((project) => jsx("button", {
          name: deleteProject.fields.project,
          value: project,
          type: "submit",
          children: `Delete ${project}`,
        })),
    ] }),
  ] }));
}

function render(request: Request, routeId: string, page: (session: Readonly<{ get(key: string): unknown }>) => RenderChild): Promise<Response> {
  return renderRoute({
    request,
    routeId,
    generation: applicationGeneration,
    browserModule,
    parameters: Object.freeze({}),
    layouts: [],
    page: ({ session }) => page(session),
  });
}

export const handler: Handler = (request) => {
  const url = new URL(request.url);
  if (url.pathname === "/") return render(request, "home", () => home());
  if (url.pathname === "/search") return render(request, "search", () => search(url));
  if (url.pathname === "/projects") {
    return render(request, "projects", (session) => projectsPage(session.get("viewer") === "owner"));
  }
  return new Response("not found", { status: 404 });
};
