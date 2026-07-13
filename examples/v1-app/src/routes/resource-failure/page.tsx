import type { Page } from "fadeno-framework-internal";
import { missingProject } from "../../resources/projects.ts";

const page: Page = async ({ read }) => {
  await read(missingProject, { projectId: 404, region: "north" });
  return <p>This output is unreachable.</p>;
};

export default page;
