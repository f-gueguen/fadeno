import type { Page } from "@fadeno/framework";
import { DeveloperPanel } from "../../components/developer-panel.tsx";
import {
  createProject,
  deleteProject,
  demoEnvironment,
  projectCollection,
  signIn,
  updateProject,
} from "../../projects.ts";

const page: Page = async ({ read, session }) => {
  const environment = await read(demoEnvironment, null);
  const signedIn = session.get("viewer") === "owner";
  if (!signedIn) {
    return (
      <div class="lab-page">
        <header class="lab-heading">
          <p class="eyebrow">Protected action laboratory</p>
          <h1 id="projects-heading">Projects move through native forms.</h1>
          <p>Sign in, trigger a useful validation error, then create, rename, and delete a project. Every mutation returns a complete server-owned document.</p>
        </header>
        {environment.secure ? (
          <div class="workflow-grid">
            <section aria-labelledby="sign-in-heading" class="form-card">
              <p class="step-label">Step 1 · establish a protected session</p>
              <h2 id="sign-in-heading">Sign in as the example owner</h2>
              <p>Use passcode <code>example-owner</code>. A successful sign-in rotates the protected session before redirecting here.</p>
              <form action={signIn} class="form-stack">
                <label for="owner-passcode">Example owner passcode</label>
                <input id="owner-passcode" name={signIn.fields.passcode} type="password" required />
                <button type="submit">Sign in</button>
              </form>
            </section>
            <aside class="request-panel compact-thread" aria-labelledby="signed-out-thread">
              <p class="utility-label">Current response</p>
              <h2 id="signed-out-thread">Session: public</h2>
              <ol class="request-thread">
                <li><span class="thread-label">Route</span><strong>/projects</strong></li>
                <li><span class="thread-label">Authorization</span><strong>sign-in required</strong></li>
                <li class="thread-outcome"><span class="thread-label">Outcome</span><strong>safe form issued</strong></li>
              </ol>
            </aside>
          </div>
        ) : (
          <section class="environment-banner environment-readonly" role="status" aria-labelledby="read-only-heading">
            <p class="utility-label">Read-only development mode</p>
            <h2 id="read-only-heading">Mutation controls stay off on HTTP.</h2>
            <p>The public laboratory keeps mutation controls behind HTTPS. Run <code>pnpm demo</code> from the repository root for the complete workflow, or keep browsing the route and resource labs here.</p>
            <a class="button-link button-secondary" href="/resources">Continue to resource recovery</a>
          </section>
        )}
        <DeveloperPanel
          source="src/projects.ts"
          excerpt="signIn"
          explanation={[
            "The form is complete native HTML before enhancement starts.",
            "The server validates the exact origin, proof, fields, and session.",
            "A successful sign-in rotates the protected session.",
            "The redirect returns through a fresh page request.",
          ]}
        />
      </div>
    );
  }

  const projects = await read(projectCollection, null);
  return (
    <div class="lab-page">
      <header class="lab-heading">
        <p class="eyebrow">Protected action laboratory</p>
        <h1 id="projects-heading">Project workflow</h1>
        <p id="authenticated-viewer"><span class="status-dot" aria-hidden="true"></span> Signed in as the example owner. The session was rotated.</p>
      </header>

      <section class="form-card create-card" aria-labelledby="create-project-heading">
        <p class="step-label">Step 2 · validate and mutate</p>
        <h2 id="create-project-heading">Create a project</h2>
        <p>Try a blank title to see field-level correction. A successful action revalidates the collection before this page returns.</p>
        <form action={createProject} class="form-stack">
        <label for="new-project-title">Title</label>
        <input id="new-project-title" name={createProject.fields.title} type="text" required />
        <label for="new-project-attachment">Text attachment</label>
        <input id="new-project-attachment" name={createProject.fields.attachment} type="file" accept="text/plain" />
        <button type="submit">Create project</button>
        </form>
      </section>

      <section class="collection-section" aria-labelledby="project-list-heading">
        <div class="section-heading inline-heading">
          <div><p class="step-label">Step 3 · revalidated resource</p><h2 id="project-list-heading">Projects</h2></div>
          <span class="status-chip status-success">Fresh server read</span>
        </div>
        <ul id="project-list" class="project-list">
        {projects.map((project) => (
          <li class="project-card">
            <div class="project-summary">
              <span class="project-number">P{project.id}</span>
              <div><h3 class="project-title">{project.title}</h3>
            {project.attachment === null
              ? <p class="project-attachment">No attachment</p>
                  : <p class="project-attachment">{project.attachment.name} ({project.attachment.bytes} bytes)</p>}</div>
            </div>

            <form action={updateProject} class="inline-form">
              <input name={updateProject.fields.projectId} type="hidden" value={project.id} />
              <label for={`project-${project.id}-title`}>New title</label>
              <input id={`project-${project.id}-title`} name={updateProject.fields.title} type="text" value={project.title} required />
              <button type="submit">Update project</button>
            </form>

            <form action={deleteProject} class="delete-form">
              <input name={deleteProject.fields.projectId} type="hidden" value={project.id} />
              <label>
                <input name={deleteProject.fields.confirmed} type="checkbox" value="authored-value-is-normalized" />
                Confirm deletion
              </label>
              <button class="button-danger" type="submit">Delete project</button>
            </form>
          </li>
        ))}
        </ul>
      </section>
      <DeveloperPanel
        source="src/projects.ts"
        excerpt="createProject"
        explanation={[
          "The browser submits the same successful controls in native or eligible enhanced mode.",
          "The action validates and mutates once on the server.",
          "The project collection is completely revalidated.",
          "The redirected page atomically replaces stale project output.",
        ]}
      />
    </div>
  );
};

export default page;
