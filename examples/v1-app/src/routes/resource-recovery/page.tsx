import type { Page } from "@fadeno/framework";
import { DeveloperPanel } from "../../components/developer-panel.tsx";
import { recoveringProject } from "../../resources/projects.ts";

const page: Page = async ({ read, request }) => {
  const run = new URL(request.url).searchParams.get("run");
  const region = run && /^[a-z0-9-]{1,32}$/u.test(run) ? `recovery-${run}` : "north";
  const project = await read(recoveringProject, { projectId: 7, region });
  return (
    <section aria-labelledby="recovery-heading" class="result-page recovery-result">
      <p class="eyebrow">Recovery result · 200</p>
      <h1 id="recovery-heading">Resource recovered</h1>
      <p>Project {project.projectId} recovered on a new request.</p>
      <p>The earlier 503 and its request-owned result are absent.</p>
      <dl class="result-facts"><div><dt>Previous request</dt><dd>503</dd></div><div><dt>Current request</dt><dd>200</dd></div><div><dt>Stale failure</dt><dd>removed</dd></div></dl>
      <a class="button-link button-secondary" href="/resources">Back to resource lab</a>
      <DeveloperPanel
        source="src/routes/resource-recovery/page.tsx"
        code={'const project = await read(recoveringProject, {\n  projectId: 7,\n  region,\n});'}
        explanation={[
          "The first request returns one typed 503 outcome.",
          "Its request-owned resource value is discarded at response completion.",
          "The next request runs the resource again and succeeds.",
          "The complete successful document contains no stale failure.",
        ]}
      />
    </section>
  );
};

export default page;
