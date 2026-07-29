import {
  defineAction,
  renderRoute,
  textField,
  unsafeHtml,
  type Handler,
  type RenderChild,
} from "@fadeno/framework";
import { jsx, jsxs } from "@fadeno/framework/jsx-runtime";

import { reconciliationScenario } from "./scenario-data.js";

export const applicationGeneration = "v2-structural-reconciliation-example-v1";
export const browserModule = "/_fadeno/browser-entry.js";
export const scenarioStyle = "html,body{margin:0}.peer{display:block;height:20px}.document-spacer{display:block;height:2400px}.scroll-box{display:block;width:240px;height:80px;overflow:auto}.scroll-content{display:block;height:600px}";
const actionOutcomes = new Set<string>();

export function resetApplicationState(): void {
  actionOutcomes.clear();
}

export const advanceScenario = defineAction({
  fields: {
    caseId: textField({ maximumBytes: 128 }),
    mode: textField({ maximumBytes: 16 }),
    submittedState: textField({ maximumBytes: 128 }),
  },
  authorize() { return true; },
  run({ input }) {
    if (input.mode !== "action") {
      throw new TypeError("FADENO_RECONCILIATION_EXAMPLE_ACTION_MODE");
    }
    actionOutcomes.add(input.caseId);
  },
});

function document(request: Request): RenderChild {
  const url = new URL(request.url);
  const caseId = url.searchParams.get("case") ?? "dirty-text-insert";
  const mode = url.searchParams.get("mode") ?? "navigation";
  const phase = url.searchParams.get("phase") === "incoming"
    || (mode === "action" && actionOutcomes.has(caseId))
    ? "incoming"
    : "current";
  const scenario = reconciliationScenario(caseId);
  if (!scenario || (mode !== "navigation" && mode !== "action")) {
    throw new TypeError("FADENO_RECONCILIATION_EXAMPLE_INPUT");
  }
  const destination = `/case?case=${encodeURIComponent(caseId)}&mode=${mode}&phase=incoming`;
  const scenarioMarkup = phase === "incoming"
    ? scenario.incomingChildren
    : scenario.currentChildren;
  const drivenScenarioMarkup = scenario.state === "dialog-modal"
    ? scenarioMarkup.replace(
        '<dialog id="modal-dialog">Modal content</dialog>',
        `<dialog id="modal-dialog"><span id="modal-content">Modal content</span><a id="modal-reconciliation-link" href="${destination.replaceAll("&", "&amp;")}">Apply navigation update</a></dialog>`,
      )
    : scenarioMarkup;
  return jsxs("html", { lang: "en", children: [
    jsx("head", { children: [
      jsxs("title", { children: ["Reconciliation · ", caseId] }),
      jsx("link", { rel: "stylesheet", href: "/_fadeno/reconciliation.css" }),
    ] }),
    jsx("body", { children: jsxs("main", {
      id: "root",
      class: phase === "incoming" ? "after" : "before",
      children: [
      unsafeHtml(drivenScenarioMarkup, {
        reason: "locked structural-reconciliation fixture with a top-layer test driver",
      }),
      jsx("a", {
        id: "reconciliation-link",
        href: destination,
        children: "Apply navigation update",
      }),
      jsxs("form", { id: "reconciliation-form", action: advanceScenario, children: [
        jsx("input", {
          id: "reconciliation-case",
          name: advanceScenario.fields.caseId,
          type: "hidden",
          value: caseId,
        }),
        jsx("input", {
          id: "reconciliation-mode",
          name: advanceScenario.fields.mode,
          type: "hidden",
          value: "action",
        }),
        jsx("input", {
          id: "reconciliation-submitted-state",
          name: advanceScenario.fields.submittedState,
          value: "server-default",
        }),
        jsx("button", {
          id: "reconciliation-submit",
          type: "submit",
          children: "Apply action update",
        }),
      ] }),
      ],
    }) }),
  ] });
}

export const handler: Handler = (request) => {
  const url = new URL(request.url);
  if (url.pathname === "/_fadeno/reconciliation.css") {
    return new Response(scenarioStyle, {
      headers: { "cache-control": "no-store", "content-type": "text/css; charset=utf-8" },
    });
  }
  if (url.pathname !== "/case") return new Response("not found", { status: 404 });
  return renderRoute({
    request,
    routeId: "structural-reconciliation",
    generation: applicationGeneration,
    browserModule,
    parameters: Object.freeze({}),
    layouts: [],
    page: () => document(request),
  });
};
