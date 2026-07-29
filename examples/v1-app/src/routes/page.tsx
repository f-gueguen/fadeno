import type { Page } from "@fadeno/framework";
import { routeHref } from "fadeno:routes";
import { Overview } from "../components/overview.tsx";
import { projectSummary } from "../resources/projects.ts";

// fadeno-demo-source:start overview
const greetingHref = routeHref({ route: "/hello/[name]", parameters: { name: "Reader" } });

const page: Page = async ({ read }) => {
  const [first, equivalent] = await Promise.all([
    read(projectSummary, { projectId: 7, region: "north" }),
    read(projectSummary, { region: "north", projectId: 7 }),
  ]);
  if (first !== equivalent) throw new Error("equivalent resource reads did not share one result");

  return <Overview evidence={first} greetingHref={greetingHref} />;
};
// fadeno-demo-source:end overview

export default page;
