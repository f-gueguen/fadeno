import {
  actionError,
  defineAction,
  defineResource,
  renderRoute,
  textField,
  type Handler,
} from "@fadeno/framework";
import { jsx, jsxs } from "@fadeno/framework/jsx-runtime";

let projectTitle = "Alpha";
export const executionCounts = { pages: 0, resources: 0, actions: 0 };

const project = defineResource({
  read: () => {
    executionCounts.resources += 1;
    return Object.freeze({ title: projectTitle });
  },
});

const renameProject = defineAction({
  fields: { title: textField({ maximumBytes: 64 }) },
  authorize: ({ request }) => request.headers.get("authorization") === "Bearer owner",
  run: ({ input }) => {
    executionCounts.actions += 1;
    if (input.title === null || input.title.trim() === "") {
      throw actionError({
        code: "PROJECT_TITLE_REQUIRED",
        fieldErrors: { title: "Enter a project title." },
        formErrors: ["The project was not renamed."],
      });
    }
    projectTitle = input.title;
  },
});

export const handler: Handler = (request) => renderRoute({
  request,
  routeId: "route:projects:index",
  generation: "server-update-example-v1",
  parameters: Object.freeze({}),
  layouts: [],
  page: async (context) => {
    executionCounts.pages += 1;
    const current = await context.read(project, Object.freeze({ project: "alpha" }));
    return jsxs("html", { children: [
      jsx("head", { children: jsx("title", { children: "Project settings" }) }),
      jsx("body", { children: jsxs("main", { children: [
        jsx("h1", { children: current.title }),
        jsx("form", { action: renameProject, children: [
          jsx("label", { for: "project-title", children: "Project title" }),
          jsx("input", { id: "project-title", name: renameProject.fields.title }),
          jsx("button", { type: "submit", children: "Rename" }),
        ] }),
      ] }) }),
    ] });
  },
});
