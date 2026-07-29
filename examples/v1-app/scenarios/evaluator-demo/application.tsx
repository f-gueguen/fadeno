import {
  notFound,
  renderRoute,
  type ErrorPage,
  type Handler,
  type Layout,
  type NotFoundPage,
  type Page,
} from "@fadeno/framework";
export { listenNodeHttp } from "@fadeno/framework/node";

import { Overview } from "../../src/components/overview.tsx";
import { projectSummary } from "../../src/resources/projects.ts";
import adminDashboard from "../../src/routes/admin/dashboard/page.tsx";
import adminLayout from "../../src/routes/admin/layout.tsx";
import adminNotFound from "../../src/routes/admin/not-found.tsx";
import errorPage from "../../src/routes/error.tsx";
import evidencePage from "../../src/routes/evidence/page.tsx";
import failurePage from "../../src/routes/failure/page.tsx";
import greetingPage from "../../src/routes/hello/[name]/page.tsx";
import rootLayout from "../../src/routes/layout.tsx";
import movedPage from "../../src/routes/moved/page.tsx";
import rootNotFound from "../../src/routes/not-found.tsx";
import projectsPage from "../../src/routes/projects/page.tsx";
import rawHandler from "../../src/routes/raw/handler.ts";
import resourceFailurePage from "../../src/routes/resource-failure/page.tsx";
import resourceRecoveryPage from "../../src/routes/resource-recovery/page.tsx";
import resourcesPage from "../../src/routes/resources/page.tsx";
import routingPage from "../../src/routes/routing/page.tsx";
import stylesHandler from "../../src/routes/styles/handler.ts";

export const applicationGeneration = "v2-evaluator-demo-v1";
export const browserModule = "/_fadeno/browser-entry.js";

const overviewPage: Page = async ({ read }) => {
  const [first, equivalent] = await Promise.all([
    read(projectSummary, { projectId: 7, region: "north" }),
    read(projectSummary, { region: "north", projectId: 7 }),
  ]);
  if (first !== equivalent) throw new Error("equivalent resource reads did not share one result");
  return <Overview evidence={first} greetingHref="/hello/Reader" />;
};

function render(
  request: Request,
  routeId: string,
  page: Page,
  options: Readonly<{
    layouts?: readonly Layout[];
    parameters?: Readonly<Record<string, string | readonly string[]>>;
    notFound?: NotFoundPage;
    error?: ErrorPage;
  }> = {},
): Promise<Response> {
  return renderRoute({
    request,
    routeId,
    generation: applicationGeneration,
    browserModule,
    parameters: options.parameters ?? Object.freeze({}),
    layouts: options.layouts ?? [rootLayout],
    page,
    ...(options.notFound ? { notFound: options.notFound } : {}),
    ...(options.error ? { error: options.error } : {}),
  });
}

export const handler: Handler = (request) => {
  const url = new URL(request.url);
  if (url.pathname === "/styles") return stylesHandler(request);
  if (url.pathname === "/raw") return rawHandler(request);
  if (url.pathname === "/") return render(request, "home", overviewPage, { error: errorPage });
  if (url.pathname === "/routing") return render(request, "routing", routingPage, { error: errorPage });
  if (url.pathname === "/resources") return render(request, "resources", resourcesPage, { error: errorPage });
  if (url.pathname === "/projects") return render(request, "projects", projectsPage, { error: errorPage });
  if (url.pathname === "/evidence") return render(request, "evidence", evidencePage, { error: errorPage });
  if (url.pathname === "/resource-failure") {
    return render(request, "resource-failure", resourceFailurePage, { error: errorPage });
  }
  if (url.pathname === "/resource-recovery") {
    return render(request, "resource-recovery", resourceRecoveryPage, { error: errorPage });
  }
  if (url.pathname === "/failure") return render(request, "failure", failurePage, { error: errorPage });
  if (url.pathname === "/moved") return render(request, "moved", movedPage, { error: errorPage });
  if (url.pathname === "/admin/dashboard") {
    return render(request, "admin-dashboard", adminDashboard, {
      layouts: [rootLayout, adminLayout],
      error: errorPage,
    });
  }
  if (url.pathname.startsWith("/admin/")) {
    return render(request, "admin-fallback", () => notFound(), {
      layouts: [rootLayout, adminLayout],
      notFound: adminNotFound,
      error: errorPage,
    });
  }
  const greeting = /^\/hello\/([^/]+)$/u.exec(url.pathname);
  if (greeting?.[1]) {
    let name: string;
    try {
      name = decodeURIComponent(greeting[1]);
    } catch {
      return render(request, "root-fallback", () => notFound(), { notFound: rootNotFound, error: errorPage });
    }
    return render(request, "hello-name", greetingPage, {
      parameters: Object.freeze({ name }),
      error: errorPage,
    });
  }
  return render(request, "root-fallback", () => notFound(), { notFound: rootNotFound, error: errorPage });
};
