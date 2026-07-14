import type { Page } from "fadeno-framework-internal";
import {
  createProject,
  deleteProject,
  projectCollection,
  signIn,
  updateProject,
} from "../../projects.ts";

const page: Page = async ({ read, session }) => {
  const signedIn = session.get("viewer") === "owner";
  if (!signedIn) {
    return (
      <section aria-labelledby="projects-heading">
        <h1 id="projects-heading">Project administration</h1>
        <p>Sign in before changing projects.</p>
        <form action={signIn}>
          <label for="owner-passcode">Example owner passcode</label>
          <input id="owner-passcode" name={signIn.fields.passcode} type="password" required />
          <button type="submit">Sign in</button>
        </form>
      </section>
    );
  }

  const projects = await read(projectCollection, null);
  return (
    <section aria-labelledby="projects-heading">
      <h1 id="projects-heading">Project administration</h1>
      <p id="authenticated-viewer">Signed in as the example owner.</p>

      <h2>Create a project</h2>
      <form action={createProject}>
        <label for="new-project-title">Title</label>
        <input id="new-project-title" name={createProject.fields.title} type="text" required />
        <label for="new-project-attachment">Text attachment</label>
        <input id="new-project-attachment" name={createProject.fields.attachment} type="file" accept="text/plain" />
        <button type="submit">Create project</button>
      </form>

      <h2>Projects</h2>
      <ul id="project-list">
        {projects.map((project) => (
          <li>
            <p class="project-title">{project.title}</p>
            {project.attachment === null
              ? <p class="project-attachment">No attachment</p>
              : <p class="project-attachment">{project.attachment.name} ({project.attachment.bytes} bytes)</p>}

            <form action={updateProject}>
              <input name={updateProject.fields.projectId} type="hidden" value={project.id} />
              <label for={`project-${project.id}-title`}>New title</label>
              <input id={`project-${project.id}-title`} name={updateProject.fields.title} type="text" value={project.title} required />
              <button type="submit">Update project</button>
            </form>

            <form action={deleteProject}>
              <input name={deleteProject.fields.projectId} type="hidden" value={project.id} />
              <label>
                <input name={deleteProject.fields.confirmed} type="checkbox" />
                Confirm deletion
              </label>
              <button type="submit">Delete project</button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default page;
