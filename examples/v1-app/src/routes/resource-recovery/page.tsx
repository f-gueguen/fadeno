import type { Page } from "@fadeno/framework";
import { recoveringProject } from "../../resources/projects.ts";

const page: Page = async ({ read }) => {
  const project = await read(recoveringProject, { projectId: 7, region: "north" });
  return (
    <section aria-labelledby="recovery-heading">
      <h1 id="recovery-heading">Resource recovered</h1>
      <p>Project {project.projectId} recovered on a new request.</p>
    </section>
  );
};

export default page;
