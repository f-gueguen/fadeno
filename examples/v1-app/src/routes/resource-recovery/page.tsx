import type { Page } from "@fadeno/framework";
import { recoveringProject } from "../../resources/projects.ts";

const page: Page = async ({ read }) => {
  const project = await read(recoveringProject, { projectId: 7, region: "north" });
  return (
    <section aria-labelledby="recovery-heading" class="result-page recovery-result">
      <p class="eyebrow">Recovery result · 200</p>
      <h1 id="recovery-heading">Resource recovered</h1>
      <p>Project {project.projectId} recovered on a new request.</p>
      <p>The earlier 503 and its request-owned result are absent.</p>
      <dl class="result-facts"><div><dt>Previous request</dt><dd>503</dd></div><div><dt>Current request</dt><dd>200</dd></div><div><dt>Stale failure</dt><dd>removed</dd></div></dl>
      <a class="button-link button-secondary" href="/resources">Back to resource lab</a>
    </section>
  );
};

export default page;
