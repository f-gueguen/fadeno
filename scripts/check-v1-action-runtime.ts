import assert from "node:assert/strict";

import {
  actionError,
  defineAction,
  notFound,
  redirect,
  renderRoute,
  resourceError,
  textField,
  type Handler,
  type Page,
  type RenderChild,
  type SessionView,
} from "../packages/framework/src/index.ts";
import { ActionServerRuntime } from "../packages/framework/src/internal/action-server.ts";
import { decisionSessionLimits } from "../packages/framework/src/internal/session-decision.ts";
import { jsx } from "../packages/framework/src/jsx-runtime.ts";
import { listenNodeHttp } from "../packages/framework/src/node.ts";

const canonicalOrigin = "https://app.example";
const applicationGeneration = "v1-action-runtime-test";
const routeId = "route:projects";
const key = Buffer.alloc(32, 7).toString("base64url");
const previousKeys = process.env["FADENO_SESSION_KEYS"];
process.env["FADENO_SESSION_KEYS"] = `active:${key}`;

let title = "Initial project";
let advanceCompletionClock: (() => void) | undefined;
const internalReports: Array<Readonly<{ incidentId: string; code: string; cause: unknown }>> = [];

const saveProject = defineAction({
  fields: {
    title: textField({ maximumBytes: 128 }),
    category: textField({ required: false, maximumBytes: 32 }),
    intent: textField({ required: false, maximumBytes: 32 }),
    passcode: textField({ required: false, maximumBytes: 64 }),
  },
  authorize({ request, session }) {
    return request.headers.get("authorization") === "Bearer owner" || session.has("viewer");
  },
  run({ input, session }) {
    if (input.title === "explode") throw new Error("private action failure detail");
    if (input.title === "changed failure") {
      session.set("last-title", "changed-before-recovery");
      session.rotate();
      throw actionError({
        code: "PROJECT_CHANGED_FAILURE",
        changed: true,
        formErrors: ["The project changed but needs another submission."],
      });
    }
    if (input.title === null || input.title.trim() === "") {
      throw actionError({
        code: "PROJECT_TITLE_REQUIRED",
        fieldErrors: { title: "Enter a project title." },
        formErrors: ["The project was not saved."],
      });
    }
    title = input.title;
    session.set("viewer", "owner");
    session.set("last-title", input.title);
    session.rotate();
    if (input.title === "expire completion") advanceCompletionClock?.();
    return redirect("/projects");
  },
});

const pageDocument = (session: SessionView): RenderChild => jsx("html", {
  lang: "en",
  children: [
    jsx("head", { children: jsx("title", { children: "Projects" }) }),
    jsx("body", {
      children: jsx("main", {
        children: [
          jsx("h1", { children: "Projects" }),
          jsx("p", { id: "stored-title", children: title }),
          jsx("p", { id: "session-title", children: String(session.get("last-title") ?? "none") }),
          jsx("form", {
            action: saveProject,
            children: [
              jsx("label", { for: "project-title", children: "Title" }),
              jsx("input", { id: "project-title", name: saveProject.fields.title, type: "text", required: true }),
              jsx("button", { type: "submit", children: "Save" }),
            ],
          }),
          jsx("form", {
            id: "secondary-form",
            action: saveProject,
            children: [
              jsx("label", { for: "secondary-title", children: "Secondary title" }),
              jsx("input", { id: "secondary-title", name: saveProject.fields.title, type: "text", required: true }),
              jsx("label", { for: "secondary-category", children: "Category" }),
              jsx("select", {
                id: "secondary-category",
                name: saveProject.fields.category,
                children: [
                  jsx("option", { value: "alpha", children: "Alpha" }),
                  jsx("option", { value: "beta", children: "Beta" }),
                ],
              }),
              jsx("label", { for: "secondary-passcode", children: "Passcode" }),
              jsx("input", { id: "secondary-passcode", name: saveProject.fields.passcode, type: "password" }),
              jsx("button", { name: saveProject.fields.intent, value: "save", type: "submit", children: "Secondary save" }),
            ],
          }),
        ],
      }),
    }),
  ],
});
const page: Page = ({ session }) => pageDocument(session);

const handler: Handler = (request) => {
  const pathname = new URL(request.url).pathname;
  return renderRoute({
    request,
    routeId,
    generation: applicationGeneration,
    parameters: Object.freeze(Object.create(null) as Record<string, never>),
    page: pathname === "/action-not-found"
      ? () => notFound()
      : pathname === "/action-error"
        ? () => { throw resourceError({ code: "PROJECT_READ_FAILED", status: 503 }); }
        : page,
    layouts: [],
    notFound: ({ session }) => pageDocument(session),
    error: ({ session }) => pageDocument(session),
  });
};

function cookie(response: Response): string {
  const value = response.headers.getSetCookie()[0];
  assert.ok(value);
  assert.match(value, /^__Host-fadeno-session=.*; Path=\/; Max-Age=[1-9][0-9]*; Secure; HttpOnly; SameSite=Lax$/u);
  return value.split(";", 1)[0]!;
}

type ParsedForm = Readonly<{
  action: string;
  proof: string;
  titleName: string;
  categoryName?: string;
  intentName?: string;
  passcodeName?: string;
}>;

function formFor(html: string, titleId: string): ParsedForm {
  const titlePosition = html.indexOf(`id="${titleId}"`);
  assert.notEqual(titlePosition, -1);
  const formStart = html.lastIndexOf("<form", titlePosition);
  const formEnd = html.indexOf("</form>", titlePosition);
  assert.notEqual(formStart, -1);
  assert.notEqual(formEnd, -1);
  const source = html.slice(formStart, formEnd + "</form>".length);
  const action = /<form[^>]* action="([^"]+)"/u.exec(source)?.[1] ?? /<form action="([^"]+)"/u.exec(source)?.[1];
  const proof = /<input type="hidden" name="__fadeno_proof" value="([^"]+)">/u.exec(source)?.[1];
  const titleInput = new RegExp(`<input[^>]*id="${titleId}"[^>]*>`, "u").exec(source)?.[0];
  const titleName = titleInput ? / name="([^"]+)"/u.exec(titleInput)?.[1] : undefined;
  const fieldName = (id: string): string | undefined => {
    const element = new RegExp(`<(?:input|select)[^>]*id="${id}"[^>]*>`, "u").exec(source)?.[0];
    return element ? / name="([^"]+)"/u.exec(element)?.[1] : undefined;
  };
  const button = /<button[^>]*>Secondary save<\/button>/u.exec(source)?.[0];
  assert.ok(action);
  assert.ok(proof);
  assert.ok(titleName);
  assert.doesNotMatch(source, /name="(?:title|category|intent|passcode)"/u);
  const secondary = titleId === "secondary-title"
    ? {
        categoryName: fieldName("secondary-category"),
        intentName: button ? / name="([^"]+)"/u.exec(button)?.[1] : undefined,
        passcodeName: fieldName("secondary-passcode"),
      }
    : null;
  if (secondary) {
    assert.ok(secondary.categoryName);
    assert.ok(secondary.intentName);
    assert.ok(secondary.passcodeName);
  }
  return Object.freeze({
    action: action.replaceAll("&amp;", "&"),
    proof,
    titleName,
    ...(secondary ? {
      categoryName: secondary.categoryName!,
      intentName: secondary.intentName!,
      passcodeName: secondary.passcodeName!,
    } : {}),
  });
}

function form(html: string): ParsedForm { return formFor(html, "project-title"); }
function secondaryForm(html: string): ParsedForm { return formFor(html, "secondary-title"); }

const server = await listenNodeHttp({
  handler,
  hostname: "127.0.0.1",
  port: 0,
  canonicalOrigin,
  applicationGeneration,
  failureObserver(report) { internalReports.push(report); },
});

try {
  const notFoundResponse = await fetch(`${server.origin}/action-not-found`);
  assert.equal(notFoundResponse.status, 404);
  form(await notFoundResponse.text());
  const errorResponse = await fetch(`${server.origin}/action-error`);
  assert.equal(errorResponse.status, 503);
  form(await errorResponse.text());

  const initial = await fetch(`${server.origin}/projects`);
  assert.equal(initial.status, 200);
  const initialCookie = cookie(initial);
  const initialForm = form(await initial.text());

  const excessiveParts = new URLSearchParams({ __fadeno_proof: initialForm.proof });
  for (let index = 0; index < 129; index += 1) excessiveParts.append(`extra-${index}`, "");
  const excessive = await fetch(`${server.origin}${initialForm.action}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      authorization: "Bearer owner",
      cookie: initialCookie,
      "content-type": "application/x-www-form-urlencoded",
      origin: canonicalOrigin,
    },
    body: excessiveParts.toString(),
  });
  assert.equal(excessive.status, 413);
  assert.match(await excessive.text(), /FADENO_ACTION_BODY_LIMIT/u);
  assert.equal(title, "Initial project");

  const deniedBody = new URLSearchParams({
    __fadeno_proof: initialForm.proof,
    [initialForm.titleName]: "Denied project",
  }).toString();
  const denied = await fetch(`${server.origin}${initialForm.action}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: initialCookie,
      "content-type": "application/x-www-form-urlencoded",
      origin: canonicalOrigin,
    },
    body: deniedBody,
  });
  assert.equal(denied.status, 403);
  assert.match(await denied.text(), /FADENO_ACTION_UNAUTHORIZED/u);
  assert.equal(title, "Initial project");
  const deniedReplay = await fetch(`${server.origin}${initialForm.action}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      authorization: "Bearer owner",
      cookie: initialCookie,
      "content-type": "application/x-www-form-urlencoded",
      origin: canonicalOrigin,
    },
    body: deniedBody,
  });
  assert.equal(deniedReplay.status, 409);

  const acceptedFormResponse = await fetch(`${server.origin}/projects`, { headers: { cookie: initialCookie } });
  const acceptedForm = form(await acceptedFormResponse.text());

  const authoredName = await fetch(`${server.origin}${acceptedForm.action}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      authorization: "Bearer owner",
      cookie: initialCookie,
      "content-type": "application/x-www-form-urlencoded",
      origin: canonicalOrigin,
    },
    body: new URLSearchParams({
      __fadeno_proof: acceptedForm.proof,
      title: "Authored wire name",
    }),
  });
  assert.equal(authoredName.status, 400);
  assert.match(await authoredName.text(), /FADENO_ACTION_UNEXPECTED_FIELD/u);
  assert.equal(title, "Initial project");

  const acceptedBody = new URLSearchParams({
    __fadeno_proof: acceptedForm.proof,
    [acceptedForm.titleName]: "Saved project",
  }).toString();
  const accepted = await fetch(`${server.origin}${acceptedForm.action}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      authorization: "Bearer owner",
      cookie: initialCookie,
      "content-type": "application/x-www-form-urlencoded",
      origin: canonicalOrigin,
    },
    body: acceptedBody,
  });
  assert.equal(accepted.status, 303);
  assert.equal(accepted.headers.get("location"), "/projects");
  const authenticatedCookie = cookie(accepted);
  assert.notEqual(authenticatedCookie, initialCookie);

  const replay = await fetch(`${server.origin}${acceptedForm.action}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      authorization: "Bearer owner",
      cookie: initialCookie,
      "content-type": "application/x-www-form-urlencoded",
      origin: canonicalOrigin,
    },
    body: acceptedBody,
  });
  assert.equal(replay.status, 409);
  assert.match(await replay.text(), /FADENO_ACTION_REPLAY/u);

  const current = await fetch(`${server.origin}/projects`, { headers: { cookie: authenticatedCookie } });
  assert.equal(current.status, 200);
  const currentHtml = await current.text();
  const currentForm = secondaryForm(currentHtml);
  assert.ok(currentForm.categoryName);
  assert.ok(currentForm.intentName);
  assert.ok(currentForm.passcodeName);
  const invalid = await fetch(`${server.origin}${currentForm.action}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: authenticatedCookie,
      "content-type": "application/x-www-form-urlencoded",
      origin: canonicalOrigin,
    },
    body: new URLSearchParams({
      __fadeno_proof: currentForm.proof,
      [currentForm.titleName]: "",
      [currentForm.categoryName]: "beta",
      [currentForm.intentName]: "save",
      [currentForm.passcodeName]: "unsafe-secret-value",
    }),
  });
  assert.equal(invalid.status, 200);
  const invalidHtml = await invalid.text();
  assert.match(invalidHtml, /role="alert"/u);
  assert.match(invalidHtml, /The project was not saved\./u);
  assert.match(invalidHtml, /Enter a project title\./u);
  assert.match(invalidHtml, /aria-invalid="true"/u);
  assert.match(invalidHtml, /value=""/u);
  assert.doesNotMatch(invalidHtml, /unsafe-secret-value/u);
  assert.match(invalidHtml, /<option selected value="beta">Beta<\/option>/u);
  const primaryTitle = /<input[^>]*id="project-title"[^>]*>/u.exec(invalidHtml)?.[0];
  const secondaryTitle = /<input[^>]*id="secondary-title"[^>]*>/u.exec(invalidHtml)?.[0];
  assert.ok(primaryTitle);
  assert.ok(secondaryTitle);
  assert.doesNotMatch(primaryTitle, /aria-invalid/u);
  assert.match(secondaryTitle, /aria-invalid="true"/u);
  assert.equal(invalidHtml.match(/Enter a project title\./gu)?.length, 1);
  assert.equal(title, "Saved project");

  const changedForm = form(invalidHtml);
  const changed = await fetch(`${server.origin}${changedForm.action}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: authenticatedCookie,
      "content-type": "application/x-www-form-urlencoded",
      origin: canonicalOrigin,
    },
    body: new URLSearchParams({
      __fadeno_proof: changedForm.proof,
      [changedForm.titleName]: "changed failure",
    }),
  });
  assert.equal(changed.status, 200);
  const changedCookie = cookie(changed);
  assert.notEqual(changedCookie, authenticatedCookie);
  const changedHtml = await changed.text();
  assert.match(changedHtml, /The project changed but needs another submission\./u);
  const recoveredForm = form(changedHtml);
  const recovered = await fetch(`${server.origin}${recoveredForm.action}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: changedCookie,
      "content-type": "application/x-www-form-urlencoded",
      origin: canonicalOrigin,
    },
    body: new URLSearchParams({
      __fadeno_proof: recoveredForm.proof,
      [recoveredForm.titleName]: "Recovered project",
    }),
  });
  assert.equal(recovered.status, 303);
  assert.equal(title, "Recovered project");

  const internalResponse = await fetch(`${server.origin}/projects`, { headers: { cookie: changedCookie } });
  const internalForm = form(await internalResponse.text());
  const internal = await fetch(`${server.origin}${internalForm.action}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: changedCookie,
      "content-type": "application/x-www-form-urlencoded",
      origin: canonicalOrigin,
    },
    body: new URLSearchParams({
      __fadeno_proof: internalForm.proof,
      [internalForm.titleName]: "explode",
    }),
  });
  assert.equal(internal.status, 500);
  const internalHtml = await internal.text();
  assert.doesNotMatch(internalHtml, /private action failure detail/u);
  const incidentId = /Incident ([a-f0-9-]+)/u.exec(internalHtml)?.[1];
  assert.ok(incidentId);
  assert.equal(internalReports.length, 1);
  assert.equal(internalReports[0]?.incidentId, incidentId);
  assert.equal(internalReports[0]?.code, "FADENO_ACTION_INTERNAL");
  assert.equal((internalReports[0]?.cause as Error).message, "private action failure detail");
  assert.equal(title, "Recovered project");

  const refreshedResponse = await fetch(`${server.origin}/projects`, { headers: { cookie: changedCookie } });
  const refreshed = form(await refreshedResponse.text());
  const crossOrigin = await fetch(`${server.origin}${refreshed.action}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: changedCookie,
      "content-type": "application/x-www-form-urlencoded",
      origin: "https://attacker.example",
    },
    body: new URLSearchParams({
      __fadeno_proof: refreshed.proof,
      [refreshed.titleName]: "Hostile project",
    }),
  });
  assert.equal(crossOrigin.status, 400);
  assert.match(await crossOrigin.text(), /FADENO_ACTION_ORIGIN/u);
  assert.equal(title, "Recovered project");

  const cookieLessCrossOrigin = await fetch(`${server.origin}${refreshed.action}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "https://attacker.example",
    },
    body: new URLSearchParams({
      __fadeno_proof: refreshed.proof,
      [refreshed.titleName]: "Hostile project without cookie",
    }),
  });
  assert.equal(cookieLessCrossOrigin.status, 400);
  assert.equal(cookieLessCrossOrigin.headers.getSetCookie().length, 0);
} finally {
  await server.close();
  if (previousKeys === undefined) delete process.env["FADENO_SESSION_KEYS"];
  else process.env["FADENO_SESSION_KEYS"] = previousKeys;
}

let clock = Date.now();
const expiringRuntime = new ActionServerRuntime({
  canonicalOrigin,
  generation: applicationGeneration,
  sessionKeys: `active:${key}`,
  now: () => clock,
});
const expiringInitial = await expiringRuntime.serve(
  new Request(`${canonicalOrigin}/projects`),
  async (request) => await handler(request),
);
const expiringCookie = cookie(expiringInitial);
const expiringForm = form(await expiringInitial.text());
advanceCompletionClock = () => { clock += decisionSessionLimits.sessionLifetimeMilliseconds; };
const expiryReports: Array<Readonly<{ incidentId: string; code: string; cause: unknown }>> = [];
const expiredCompletion = await expiringRuntime.serve(
  new Request(`${canonicalOrigin}${expiringForm.action}`, {
    method: "POST",
    headers: {
      authorization: "Bearer owner",
      cookie: expiringCookie,
      "content-type": "application/x-www-form-urlencoded",
      origin: canonicalOrigin,
    },
    body: new URLSearchParams({
      __fadeno_proof: expiringForm.proof,
      [expiringForm.titleName]: "expire completion",
    }),
  }),
  async (request) => await handler(request),
  (report) => { expiryReports.push(report); },
);
advanceCompletionClock = undefined;
assert.equal(expiredCompletion.status, 500);
assert.match(await expiredCompletion.text(), /Incident [a-f0-9-]+/u);
assert.equal(expiryReports.length, 1);
assert.equal(expiryReports[0]?.code, "FADENO_ACTION_INTERNAL");
assert.match(String((expiryReports[0]?.cause as Error).message), /FADENO_SESSION_EXPIRED/u);
cookie(expiredCompletion);

console.log("V1 action runtime passed (native form, scoped recovery, session expiry, replay, redaction, origin)");
