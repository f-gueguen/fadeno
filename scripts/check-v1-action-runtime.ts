import assert from "node:assert/strict";

import {
  actionError,
  defineAction,
  redirect,
  renderRoute,
  textField,
  type Handler,
  type Page,
} from "../packages/framework/src/index.ts";
import { jsx } from "../packages/framework/src/jsx-runtime.ts";
import { listenNodeHttp } from "../packages/framework/src/node.ts";

const canonicalOrigin = "https://app.example";
const applicationGeneration = "v1-action-runtime-test";
const routeId = "route:projects";
const key = Buffer.alloc(32, 7).toString("base64url");
const previousKeys = process.env["FADENO_SESSION_KEYS"];
process.env["FADENO_SESSION_KEYS"] = `active:${key}`;

let title = "Initial project";
const internalReports: Array<Readonly<{ incidentId: string; code: string; cause: unknown }>> = [];

const saveProject = defineAction({
  fields: { title: textField({ maximumBytes: 128 }) },
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
    return redirect("/projects");
  },
});

const page: Page = ({ session }) => jsx("html", {
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
        ],
      }),
    }),
  ],
});

const handler: Handler = (request) => renderRoute({
  request,
  routeId,
  generation: applicationGeneration,
  parameters: Object.freeze(Object.create(null) as Record<string, never>),
  page,
  layouts: [],
});

function cookie(response: Response): string {
  const value = response.headers.getSetCookie()[0];
  assert.ok(value);
  assert.match(value, /^__Host-fadeno-session=.*; Path=\/; Max-Age=[1-9][0-9]*; Secure; HttpOnly; SameSite=Lax$/u);
  return value.split(";", 1)[0]!;
}

function form(html: string): Readonly<{ action: string; proof: string; titleName: string }> {
  const action = /<form action="([^"]+)" enctype="application\/x-www-form-urlencoded" method="post">/u.exec(html)?.[1];
  const proof = /<input type="hidden" name="__fadeno_proof" value="([^"]+)">/u.exec(html)?.[1];
  const titleInput = /<input[^>]*id="project-title"[^>]*>/u.exec(html)?.[0];
  const titleName = titleInput ? / name="([^"]+)"/u.exec(titleInput)?.[1] : undefined;
  assert.ok(action);
  assert.ok(proof);
  assert.ok(titleName);
  assert.doesNotMatch(html, /name="title"/u);
  return Object.freeze({ action: action.replaceAll("&amp;", "&"), proof, titleName });
}

const server = await listenNodeHttp({
  handler,
  hostname: "127.0.0.1",
  port: 0,
  canonicalOrigin,
  applicationGeneration,
  failureObserver(report) { internalReports.push(report); },
});

try {
  const initial = await fetch(`${server.origin}/projects`);
  assert.equal(initial.status, 200);
  const initialCookie = cookie(initial);
  const initialForm = form(await initial.text());

  const acceptedBody = new URLSearchParams({
    __fadeno_proof: initialForm.proof,
    [initialForm.titleName]: "Saved project",
  }).toString();
  const accepted = await fetch(`${server.origin}${initialForm.action}`, {
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

  const replay = await fetch(`${server.origin}${initialForm.action}`, {
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
  const currentForm = form(await current.text());
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
    }),
  });
  assert.equal(invalid.status, 200);
  const invalidHtml = await invalid.text();
  assert.match(invalidHtml, /role="alert"/u);
  assert.match(invalidHtml, /The project was not saved\./u);
  assert.match(invalidHtml, /Enter a project title\./u);
  assert.match(invalidHtml, /aria-invalid="true"/u);
  assert.match(invalidHtml, /value=""/u);
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
} finally {
  await server.close();
  if (previousKeys === undefined) delete process.env["FADENO_SESSION_KEYS"];
  else process.env["FADENO_SESSION_KEYS"] = previousKeys;
}

console.log("V1 action runtime passed (native form, session, replay, recovery, redacted incident, origin)");
