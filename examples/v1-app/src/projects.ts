import {
  actionError,
  checkboxField,
  defineAction,
  defineResource,
  fileField,
  integerField,
  redirect,
  textField,
} from "@fadeno/framework";

export type Project = Readonly<{
  id: number;
  title: string;
  attachment: Readonly<{ name: string; bytes: number }> | null;
}>;

let nextProjectId = 2;
const projects = new Map<number, Project>([
  [1, Object.freeze({ id: 1, title: "First project", attachment: null })],
]);

export const projectCollection = defineResource({
  read() {
    return Object.freeze([...projects.values()].sort((left, right) => left.id - right.id));
  },
});

function authenticated(viewer: unknown): boolean {
  return viewer === "owner";
}

export const signIn = defineAction({
  fields: { passcode: textField({ maximumBytes: 64 }) },
  authorize() { return true; },
  run({ input, session }) {
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

export const createProject = defineAction({
  fields: {
    title: textField({ maximumBytes: 128 }),
    attachment: fileField({ required: false, maximumBytes: 1_024, acceptedTypes: ["text/plain"] }),
  },
  keeps: [projectCollection],
  authorize({ session }) { return authenticated(session.get("viewer")); },
  run({ input }) {
    const title = input.title?.trim() ?? "";
    if (title.length === 0) {
      throw actionError({
        code: "PROJECT_TITLE_REQUIRED",
        fieldErrors: { title: "Enter a project title." },
        formErrors: ["The project was not created."],
      });
    }
    const attachment = input.attachment === null
      ? null
      : Object.freeze({
          name: input.attachment.originalName,
          bytes: input.attachment.bytes().byteLength,
        });
    const project = Object.freeze({ id: nextProjectId, title, attachment });
    projects.set(project.id, project);
    nextProjectId += 1;
    return redirect("/projects");
  },
});

export const updateProject = defineAction({
  fields: {
    projectId: integerField({ minimum: 1 }),
    title: textField({ maximumBytes: 128 }),
  },
  keeps: [projectCollection],
  authorize({ session }) { return authenticated(session.get("viewer")); },
  run({ input }) {
    const title = input.title?.trim() ?? "";
    if (title.length === 0) {
      throw actionError({
        code: "PROJECT_TITLE_REQUIRED",
        fieldErrors: { title: "Enter a project title." },
        formErrors: ["The project was not updated."],
      });
    }
    const existing = input.projectId === null ? undefined : projects.get(input.projectId);
    if (!existing) {
      throw actionError({ code: "PROJECT_NOT_FOUND", formErrors: ["The project no longer exists."] });
    }
    projects.set(existing.id, Object.freeze({ ...existing, title }));
    return redirect("/projects");
  },
});

export const deleteProject = defineAction({
  fields: {
    projectId: integerField({ minimum: 1 }),
    confirmed: checkboxField(),
  },
  keeps: [projectCollection],
  authorize({ session }) { return authenticated(session.get("viewer")); },
  run({ input }) {
    if (!input.confirmed) {
      throw actionError({
        code: "PROJECT_DELETE_CONFIRMATION_REQUIRED",
        fieldErrors: { confirmed: "Confirm deletion." },
        formErrors: ["The project was not deleted."],
      });
    }
    if (input.projectId === null || !projects.delete(input.projectId)) {
      throw actionError({ code: "PROJECT_NOT_FOUND", formErrors: ["The project no longer exists."] });
    }
    return redirect("/projects");
  },
});
