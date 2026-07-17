import type { Page } from "fadeno-framework-internal";
import { routeHref } from "fadeno:routes";
import { projectSummary } from "../resources/projects.ts";

const greetingHref = routeHref({ route: "/hello/[name]", parameters: { name: "Reader" } });

const page: Page = async ({ read }) => {
  const [first, equivalent] = await Promise.all([
    read(projectSummary, { projectId: 7, region: "north" }),
    read(projectSummary, { region: "north", projectId: 7 }),
  ]);
  if (first !== equivalent) throw new Error("equivalent resource reads did not share one result");

  return (
    <section aria-labelledby="welcome-heading" class="hero-card">
      <h1 id="welcome-heading">First running Fadeno application</h1>
      <p>This document is routed, escaped, and streamed without client JavaScript.</p>
      <p>Project {first.projectId} is ready for {first.viewer}.</p>
      <p>Equivalent resource reads shared one request result.</p>
      <a href={greetingHref}>Open the parameterized greeting</a>
    </section>
  );
};

export default page;
