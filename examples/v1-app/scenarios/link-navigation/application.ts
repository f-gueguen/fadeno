import { redirect, renderRoute, type Handler, type RenderChild } from "@fadeno/framework";
import { jsx, jsxs } from "@fadeno/framework/jsx-runtime";

export const applicationGeneration = "v2-link-navigation-example-v1";
export const browserModule = "/_fadeno/browser-entry.js";

const links = (): RenderChild => jsxs("nav", { "aria-label": "Example navigation", children: [
  jsx("a", { id: "home-link", href: "/", children: "Home" }),
  " ",
  jsx("a", { id: "next-link", href: "/next", children: "Next" }),
  " ",
  jsx("a", { id: "slow-link", href: "/slow", children: "Slow" }),
  " ",
  jsx("a", { id: "redirect-link", href: "/redirect", children: "Redirect" }),
  " ",
  jsx("a", { id: "recovery-link", href: "/unprojectable", children: "Recovery" }),
  " ",
  jsx("a", { id: "target-link", href: "/target", target: "_blank", children: "New tab" }),
  " ",
  jsx("a", { id: "download-link", href: "/download", download: "example.txt", children: "Download" }),
  " ",
  jsx("a", { id: "fragment-link", href: "#details", children: "Details" }),
  " ",
  jsxs("form", { id: "native-form", action: "/next", method: "get", children: [
    jsx("input", { name: "source", type: "hidden", value: "native-form" }),
    jsx("button", { type: "submit", children: "Submit natively" }),
  ] }),
] });

const longContent = (): RenderChild => jsxs("section", { id: "history-content", children: [
  ...Array.from({ length: 80 }, (_, index) => jsx("p", { children: `History qualification row ${index + 1}.` })),
  jsx("a", { id: "bottom-next-link", href: "/next", children: "Next from a scrolled document" }),
] });

function document(title: string, heading: string, content: RenderChild = null): RenderChild {
  return jsxs("html", { lang: "en", children: [
    jsx("head", { children: jsx("title", { children: title }) }),
    jsx("body", { children: jsxs("main", { children: [
      jsx("h1", { children: heading }),
      links(),
      content,
      jsx("p", { id: "details", children: "The native fragment target remains available." }),
    ] }) }),
  ] });
}

function render(request: Request, routeId: string, title: string, heading: string, content?: RenderChild): Promise<Response> {
  return renderRoute({
    request,
    routeId,
    generation: applicationGeneration,
    browserModule,
    parameters: Object.freeze({}),
    layouts: [],
    page: () => document(title, heading, content),
  });
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

export const handler: Handler = async (request) => {
  const url = new URL(request.url);
  if (url.pathname === "/") return render(request, "home", "Fadeno navigation", "Home", longContent());
  if (url.pathname === "/next") return render(request, "next", "Next project", "Next");
  if (url.pathname === "/owner") {
    return render(request, "owner", "Owned project", "Owner", jsx("p", { id: "owner", children: request.headers.get("cookie") ?? "anonymous" }));
  }
  if (url.pathname === "/slow") {
    await wait(500, request.signal);
    return render(request, "slow", "Slow project", "Slow");
  }
  if (url.pathname === "/redirect") {
    return renderRoute({
      request,
      routeId: "redirect",
      generation: applicationGeneration,
      browserModule,
      parameters: Object.freeze({}),
      layouts: [],
      page: () => redirect("/next", 303),
    });
  }
  if (url.pathname === "/unprojectable") {
    return new Response("<!doctype html><html><head><title>Native recovery</title></head><body><h1>Native recovery</h1></body></html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  if (url.pathname === "/target") return render(request, "target", "New browsing context", "New browsing context");
  if (url.pathname === "/download") return new Response("downloaded example", { headers: { "content-type": "text/plain" } });
  return new Response("not found", { status: 404 });
};
