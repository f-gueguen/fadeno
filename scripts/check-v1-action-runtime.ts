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
import { actionLimits } from "../packages/framework/src/internal/action-limits.ts";
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
    if (input.title === "unsafe redirect") {
      session.set("last-title", "must-be-discarded");
      return redirect("https://attacker.example/projects");
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

type MultipartOutcome = "accepted" | "FADENO_ACTION_BODY" | "FADENO_ACTION_BODY_LIMIT";

function referenceFind(source: Uint8Array, expected: Uint8Array, start = 0): number {
  for (let index = start; index <= source.byteLength - expected.byteLength; index += 1) {
    let equal = true;
    for (let offset = 0; offset < expected.byteLength; offset += 1) {
      if (source[index + offset] !== expected[offset]) { equal = false; break; }
    }
    if (equal) return index;
  }
  return -1;
}

async function referenceMultipartOutcome(boundary: string, body: Uint8Array): Promise<MultipartOutcome> {
  if (body.byteLength === 0) return "FADENO_ACTION_BODY";
  const marker = new TextEncoder().encode(`--${boundary}`);
  let delimiters = 0;
  for (let index = referenceFind(body, marker); index >= 0; index = referenceFind(body, marker, index + 1)) {
    if (index !== 0 && (index < 2 || body[index - 2] !== 0x0d || body[index - 1] !== 0x0a)) continue;
    if ((delimiters += 1) > actionLimits.maximumParts + 2) return "FADENO_ACTION_BODY_LIMIT";
  }
  let cursor = -1;
  for (let index = referenceFind(body, marker); index >= 0; index = referenceFind(body, marker, index + 1)) {
    if (index !== 0 && (index < 2 || body[index - 2] !== 0x0d || body[index - 1] !== 0x0a)) continue;
    const suffix = index + marker.byteLength;
    if ((body[suffix] === 0x0d && body[suffix + 1] === 0x0a) || (body[suffix] === 0x2d && body[suffix + 1] === 0x2d)) {
      cursor = index;
      break;
    }
  }
  if (cursor < 0) return "FADENO_ACTION_BODY";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const headerEndMarker = Uint8Array.of(0x0d, 0x0a, 0x0d, 0x0a);
  const delimiter = new TextEncoder().encode(`\r\n--${boundary}`);
  let parts = 0;
  for (;;) {
    cursor += marker.byteLength;
    if (body[cursor] === 0x2d && body[cursor + 1] === 0x2d) {
      cursor += 2;
      while (body[cursor] === 0x20 || body[cursor] === 0x09) cursor += 1;
      if (cursor === body.byteLength || (body[cursor] === 0x0d && body[cursor + 1] === 0x0a)) break;
      return "FADENO_ACTION_BODY";
    }
    if (body[cursor] !== 0x0d || body[cursor + 1] !== 0x0a) return "FADENO_ACTION_BODY";
    const headerStart = cursor + 2;
    const headerEnd = referenceFind(body, headerEndMarker, headerStart);
    if (headerEnd < 0) return "FADENO_ACTION_BODY";
    let headers: string;
    try { headers = decoder.decode(body.subarray(headerStart, headerEnd)); }
    catch { return "FADENO_ACTION_BODY"; }
    const disposition = headers.split("\r\n").find((line) => line.toLowerCase().startsWith("content-disposition:"));
    if (headers.split("\r\n").some((line) => line.indexOf(":") <= 0)) return "FADENO_ACTION_BODY";
    const valueStart = headerEnd + headerEndMarker.byteLength;
    const valueEnd = referenceFind(body, delimiter, valueStart);
    if (valueEnd < 0) return "FADENO_ACTION_BODY";
    if (!disposition || !/;\s*filename\*?=/iu.test(disposition)) {
      try { decoder.decode(body.subarray(valueStart, valueEnd)); }
      catch { return "FADENO_ACTION_BODY"; }
    }
    if ((parts += 1) > actionLimits.maximumParts + 1) return "FADENO_ACTION_BODY_LIMIT";
    cursor = valueEnd + 2;
  }
  try {
    await new Request(canonicalOrigin, {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body: Uint8Array.from(body).buffer,
    }).formData();
  } catch {
    return "FADENO_ACTION_BODY";
  }
  return "accepted";
}

function multipartBody(boundary: string, value: Uint8Array, file = false): Uint8Array {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="field"${file ? '; filename="value.bin"' : ""}\r\n\r\n`),
    value,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

async function checkMultipartDifferential(): Promise<void> {
  const runtime = new ActionServerRuntime({
    canonicalOrigin,
    generation: applicationGeneration,
    sessionKeys: `active:${key}`,
  });
  const initial = await runtime.serve(new Request(`${canonicalOrigin}/projects`), async (request) => await handler(request));
  const session = cookie(initial);
  const target = form(await initial.text()).action;
  const cases: Array<Readonly<{ label: string; boundary: string; body: Uint8Array }>> = [];
  const boundary = "fadeno-differential";
  const valid = multipartBody(boundary, Buffer.from("value"));
  cases.push(
    { label: "valid", boundary, body: valid },
    { label: "invalid text UTF-8", boundary, body: multipartBody(boundary, Uint8Array.of(0xff)) },
    { label: "file bytes may be non-UTF-8", boundary, body: multipartBody(boundary, Uint8Array.of(0xff), true) },
    { label: "truncated framing", boundary, body: valid.subarray(0, valid.byteLength - 3) },
    { label: "invalid suffixes before opening", boundary, body: Buffer.concat([
      Buffer.from(`--${boundary}x--${boundary}-\r\n--${boundary} \r\nnoise\r\n`),
      valid,
    ]) },
    { label: "overlapping candidates", boundary: "--", body: Buffer.concat([
      Buffer.from("-----\r\n"),
      multipartBody("--", Buffer.from("value")),
    ]) },
  );
  const excessive = Buffer.concat([
    ...Array.from({ length: actionLimits.maximumParts + 2 }, (_, index) =>
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="field-${index}"\r\n\r\nvalue\r\n`)),
    Buffer.from(`--${boundary}--\r\n`),
  ]);
  cases.push({ label: "part limit", boundary, body: excessive });
  let random = 0x9e3779b9;
  const next = (): number => {
    random = (Math.imul(random ^ (random >>> 16), 0x21f0aaad) + 0x735a2d97) >>> 0;
    return random;
  };
  for (let index = 0; index < 512; index += 1) {
    const randomBoundary = `fadeno-random-${index % 17}`;
    const value = Uint8Array.from({ length: next() % 257 }, () => next() & 0xff);
    let body = multipartBody(randomBoundary, value, index % 3 === 0);
    if (index % 4 === 1) body = body.subarray(0, next() % body.byteLength);
    else if (index % 4 === 2) body = Buffer.concat([Buffer.from(`x--${randomBoundary}x\r\n`), body]);
    else if (index % 4 === 3) body = Buffer.concat([body.subarray(0, body.byteLength - 4), Uint8Array.of(next() & 0xff)]);
    cases.push({ label: `random ${index}`, boundary: randomBoundary, body });
  }
  for (const fixture of cases) {
    const expected = await referenceMultipartOutcome(fixture.boundary, fixture.body);
    const response = await runtime.serve(new Request(new URL(target, canonicalOrigin), {
      method: "POST",
      headers: {
        authorization: "Bearer owner",
        cookie: session,
        "content-type": `multipart/form-data; boundary=${fixture.boundary}`,
        origin: canonicalOrigin,
      },
      body: Uint8Array.from(fixture.body).buffer,
    }), async (request) => await handler(request));
    const responseText = await response.text();
    const code = /FADENO_[A-Z0-9_]+/u.exec(responseText)?.[0];
    const actual: MultipartOutcome = code === "FADENO_ACTION_BODY" || code === "FADENO_ACTION_BODY_LIMIT" ? code : "accepted";
    assert.equal(actual, expected, `${fixture.label}: ${response.status} ${responseText}`);
  }
}

await checkMultipartDifferential();

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

  const longReturn = `/projects?filter=${"x".repeat(1_800)}`;
  const longReturnResponse = await fetch(`${server.origin}${longReturn}`, { headers: { cookie: initialCookie } });
  assert.equal(longReturnResponse.status, 200);
  const longReturnForm = form(await longReturnResponse.text());
  assert.equal(new URL(longReturnForm.action, server.origin).searchParams.get("return"), longReturn);

  const tamperedCookie = `${initialCookie.slice(0, -1)}${initialCookie.endsWith("A") ? "B" : "A"}`;
  const tamperedSession = await fetch(`${server.origin}/projects`, { headers: { cookie: tamperedCookie } });
  assert.equal(tamperedSession.status, 401);
  assert.match(await tamperedSession.text(), /FADENO_SESSION_INVALID/u);
  assert.deepEqual(tamperedSession.headers.getSetCookie(), [
    "__Host-fadeno-session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax",
  ]);

  const wrongMethod = await fetch(`${server.origin}${initialForm.action}`, { redirect: "manual" });
  assert.equal(wrongMethod.status, 400);
  assert.match(await wrongMethod.text(), /FADENO_ACTION_METHOD/u);
  assert.equal(wrongMethod.headers.getSetCookie().length, 0);

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

  const unsafeRedirectPage = await fetch(`${server.origin}/projects`, { headers: { cookie: authenticatedCookie } });
  const unsafeRedirectForm = form(await unsafeRedirectPage.text());
  const unsafeRedirect = await fetch(`${server.origin}${unsafeRedirectForm.action}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: authenticatedCookie,
      "content-type": "application/x-www-form-urlencoded",
      origin: canonicalOrigin,
    },
    body: new URLSearchParams({
      __fadeno_proof: unsafeRedirectForm.proof,
      [unsafeRedirectForm.titleName]: "unsafe redirect",
    }),
  });
  assert.equal(unsafeRedirect.status, 400);
  assert.match(await unsafeRedirect.text(), /FADENO_ACTION_REDIRECT/u);
  assert.equal(internalReports.length, 0);
  assert.equal(title, "Saved project");

  const current = await fetch(`${server.origin}/projects`, { headers: { cookie: authenticatedCookie } });
  assert.equal(current.status, 200);
  const currentHtml = await current.text();
  assert.match(currentHtml, /<p id="session-title">Saved project<\/p>/u);
  const currentForm = secondaryForm(currentHtml);
  assert.ok(currentForm.categoryName);
  assert.ok(currentForm.intentName);
  assert.ok(currentForm.passcodeName);
  const wrongFormUrl = new URL(currentForm.action, server.origin);
  wrongFormUrl.searchParams.set("form", "0");
  const wrongForm = await fetch(wrongFormUrl, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: authenticatedCookie,
      "content-type": "application/x-www-form-urlencoded",
      origin: canonicalOrigin,
    },
    body: new URLSearchParams({
      __fadeno_proof: currentForm.proof,
      [currentForm.titleName]: "Wrong form instance",
    }),
  });
  assert.equal(wrongForm.status, 400);
  assert.match(await wrongForm.text(), /FADENO_ACTION_PROOF/u);
  assert.equal(title, "Saved project");
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

  const multipartBoundary = "fadeno-prefix-heavy-boundary";
  const multipartBody = [
    `x--${multipartBoundary}x`.repeat(4_096),
    `\r\n--${multipartBoundary}\r\nContent-Disposition: form-data; name="__fadeno_proof"\r\n\r\n${refreshed.proof}\r\n`,
    `--${multipartBoundary}\r\nContent-Disposition: form-data; name="${refreshed.titleName}"\r\n\r\nMultipart project\r\n`,
    `--${multipartBoundary}--\r\n`,
  ].join("");
  const multipart = await fetch(`${server.origin}${refreshed.action}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: changedCookie,
      "content-type": `multipart/form-data; boundary=${multipartBoundary}`,
      origin: canonicalOrigin,
    },
    body: multipartBody,
  });
  assert.equal(multipart.status, 400);
  assert.match(await multipart.text(), /<p>FADENO_ACTION_BODY<\/p>/u);
  assert.equal(title, "Recovered project");

  const excessiveMultipartBoundary = "fadeno-excessive-parts";
  const excessiveMultipartBody = [
    ...Array.from({ length: actionLimits.maximumParts + 2 }, (_, index) =>
      `--${excessiveMultipartBoundary}\r\nContent-Disposition: form-data; name="extra-${index}"\r\n\r\n\r\n`),
    `--${excessiveMultipartBoundary}--\r\n`,
  ].join("");
  const excessiveMultipart = await fetch(`${server.origin}${refreshed.action}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: changedCookie,
      "content-type": `multipart/form-data; boundary=${excessiveMultipartBoundary}`,
      origin: canonicalOrigin,
    },
    body: excessiveMultipartBody,
  });
  assert.equal(excessiveMultipart.status, 413);
  assert.match(await excessiveMultipart.text(), /<p>FADENO_ACTION_BODY_LIMIT<\/p>/u);
  assert.equal(title, "Recovered project");
} finally {
  await server.close();
  if (previousKeys === undefined) delete process.env["FADENO_SESSION_KEYS"];
  else process.env["FADENO_SESSION_KEYS"] = previousKeys;
}

const drainRuntime = new ActionServerRuntime({
  canonicalOrigin,
  generation: applicationGeneration,
  sessionKeys: `active:${key}`,
});
const drainInitial = await drainRuntime.serve(
  new Request(`${canonicalOrigin}/projects`),
  async (request) => await handler(request),
);
const drainCookie = cookie(drainInitial);
const drainForm = form(await drainInitial.text());
const drainRequest = (selectedForm: ParsedForm, selectedCookie: string, value: string): Request =>
  new Request(`${canonicalOrigin}${selectedForm.action}`, {
    method: "POST",
    headers: {
      authorization: "Bearer owner",
      cookie: selectedCookie,
      "content-type": "application/x-www-form-urlencoded",
      origin: canonicalOrigin,
    },
    body: new URLSearchParams({
      __fadeno_proof: selectedForm.proof,
      [selectedForm.titleName]: value,
    }),
  });
let revalidationChunk = 0;
let revalidationCompleted = false;
const drained = await drainRuntime.serve(
  drainRequest(drainForm, drainCookie, "Drained project"),
  async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (revalidationChunk < 2) controller.enqueue(Uint8Array.of(revalidationChunk += 1));
      else { revalidationCompleted = true; controller.close(); }
    },
  })),
);
assert.equal(drained.status, 303);
assert.equal(revalidationCompleted, true);
const rotatedDrainCookie = cookie(drained);
const lateErrorPage = await drainRuntime.serve(
  new Request(`${canonicalOrigin}/projects`, { headers: { cookie: rotatedDrainCookie } }),
  async (request) => await handler(request),
);
const lateErrorForm = form(await lateErrorPage.text());
const lateStreamError = new Error("late revalidation stream failure");
let latePull = 0;
const lateStream = new ReadableStream<Uint8Array>({
  pull(controller) {
    if (latePull === 0) { latePull += 1; controller.enqueue(Uint8Array.of(1)); }
    else controller.error(lateStreamError);
  },
});
await assert.rejects(
  drainRuntime.serve(
    drainRequest(lateErrorForm, rotatedDrainCookie, "Late failure project"),
    async () => new Response(lateStream),
  ),
  (error) => error === lateStreamError,
);
lateStream.getReader().releaseLock();

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
