import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const packageName = "@fadeno/framework";
const root = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = join(root, "packages/framework");
const scenarioRoot = join(root, "examples/v1-app/scenarios/server-update");
const require = createRequire(import.meta.url);
const tsc = join(dirname(require.resolve("typescript/package.json")), "bin/tsc");

type Operation = Readonly<{
  origin: string;
  currentTruthUrl: string;
  applicationGeneration: string;
  documentEpoch: string;
  operation: Readonly<{ id: string; sequence: number; kind: "navigation" | "mutation"; url: string }>;
  resultId: string;
  scrollBoundary: Readonly<{ documentPrecedingLayout: "unaffected"; elementPrecedingLayout: "unaffected" }>;
  authorizationOwner: object;
}>;

type ProjectionRecord = Readonly<{
  operationId: string;
  resultId: string;
  status: "projected" | "refused";
  code: string;
  outcome: "document" | "expected-error" | "redirect" | "recover" | null;
  completeness: "complete" | "interrupted" | "refused";
  redaction: "applied";
  provenance: Readonly<{
    route: Readonly<{ id: string; generation: string; outcome: string }> | null;
    resources: readonly Readonly<{ operation: string; outcome: string; cache: string; ownership: string; dependencyRecorded: boolean; cause: string }>[];
    action: Readonly<{ code: string; status: string; revalidation: string; outcome: string }> | null;
  }>;
  causes: readonly string[];
  skipped: readonly string[];
}>;

type Projection =
  | Readonly<{ status: "projected"; bytes: Uint8Array; record: ProjectionRecord }>
  | Readonly<{ status: "refused"; code: string; record: ProjectionRecord }>;

type ServerUpdateModule = Readonly<{
  createPrivateServerUpdateOperation(input: Operation): Operation;
  bindPrivateServerUpdateOperation(request: Request, operation: Operation): () => void;
  projectPrivateServerUpdate(response: Response, operation: Operation): Promise<Projection>;
  serializePrivateServerUpdateRecord(record: ProjectionRecord): Uint8Array;
}>;

type ActionRuntime = Readonly<{
  serve(request: Request, invoke: (request: Request) => Response | Promise<Response>): Promise<Response>;
}>;

type ApplicationModule = Readonly<{
  handler(request: Request): Response | Promise<Response>;
  executionCounts: { pages: number; resources: number; actions: number };
}>;

function run(command: string, arguments_: readonly string[], cwd: string): string {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`FADENO_V2_SERVER_UPDATE_COMMAND:${command}:${result.status ?? result.signal}\n${result.stdout}\n${result.stderr}`);
  }
  return `${result.stdout}${result.stderr}`;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function form(html: string): Readonly<{ action: string; proof: string; titleName: string }> {
  const action = /<form[^>]* action="([^"]+)"/u.exec(html)?.[1]?.replaceAll("&amp;", "&");
  const proof = /<input type="hidden" name="__fadeno_proof" value="([^"]+)">/u.exec(html)?.[1];
  const title = /<input[^>]*id="project-title"[^>]*>/u.exec(html)?.[0];
  const titleName = title ? / name="([^"]+)"/u.exec(title)?.[1] : undefined;
  assert.ok(action);
  assert.ok(proof);
  assert.ok(titleName);
  return Object.freeze({ action, proof, titleName });
}

function cookie(response: Response): string {
  const value = response.headers.getSetCookie()[0]?.split(";", 1)[0];
  assert.ok(value);
  return value;
}

const adr = readFileSync(join(root, "docs/adr/0048-server-owned-update-outcome-projection.md"), "utf8").replace(/\s+/gu, " ");
for (const fragment of [
  "consumes exactly one native `Response`",
  "cannot call the route, page, layout, resource, action, or authorization function again",
  "opaque authorization owner",
  "Construction-time evidence",
  "separate private redacted projection record",
  "introduces no new public export",
]) assert.equal(adr.includes(fragment), true, `ADR 0048 is missing ${fragment}`);

const threatModel = readFileSync(join(root, "docs/security/browser-update-threat-model.md"), "utf8").replace(/\s+/gu, " ");
for (const fragment of [
  "One user or representation projects another response",
  "Projection recreates application policy",
  "Provenance is reconstructed after cleanup",
  "Server evidence leaks protected data",
  "Failure repeats a mutation",
]) assert.equal(threatModel.includes(fragment), true, `browser threat model is missing ${fragment}`);

const packageDocument = readJson(join(packageRoot, "package.json")) as { exports: Record<string, unknown> };
assert.deepEqual(Object.keys(packageDocument.exports).sort(), [".", "./browser", "./jsx-runtime", "./node"]);
assert.equal(
  readFileSync(join(root, ".changeset/server-update-projection.md"), "utf8"),
  '---\n"@fadeno/framework": minor\n---\n\nProject native route, resource, and action outcomes into the bounded private\nbrowser update envelope without repeating application execution.\n',
);
const scope = readFileSync(join(root, "docs/product/scope.md"), "utf8");
const traceability = readFileSync(join(root, "docs/traceability.md"), "utf8");
for (const feature of ["WEB-01", "WEB-02", "DATA-01", "DATA-02", "ENH-01", "PATCH-01", "SEC-01"]) {
  assert.equal(scope.includes(`shared by WEB-01, WEB-02, DATA-01, DATA-02, ENH-01, PATCH-01, and\nSEC-01`), true, `${feature} scope is missing ADR 0048`);
  assert.equal(traceability.includes("`pnpm check:v2-server-update` is their shared packed proof"), true, `${feature} traceability is missing V2-03 evidence`);
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "fadeno-v2-server-update-"));
try {
  run("pnpm", ["--filter", packageName, "build"], root);
  const tarballs = join(temporaryRoot, "tarballs");
  mkdirSync(tarballs);
  run("pnpm", ["pack", "--pack-destination", tarballs], packageRoot);
  const tarballName = readdirSync(tarballs).find((name) => name.endsWith(".tgz"));
  if (!tarballName) throw new Error("FADENO_V2_SERVER_UPDATE_TARBALL");

  const consumer = join(temporaryRoot, "consumer");
  mkdirSync(join(consumer, "src"), { recursive: true });
  writeJson(join(consumer, "package.json"), {
    name: "fadeno-v2-server-update-consumer",
    version: "0.0.0",
    private: true,
    type: "module",
    dependencies: { [packageName]: `file:${join(tarballs, tarballName)}` },
  });
  writeJson(join(consumer, "tsconfig.json"), {
    compilerOptions: {
      lib: ["ES2022", "DOM"],
      module: "NodeNext",
      moduleResolution: "NodeNext",
      outDir: "dist",
      rootDir: "src",
      strict: true,
      types: [],
      verbatimModuleSyntax: true,
    },
    include: ["src/**/*.ts"],
  });
  cpSync(join(scenarioRoot, "application.ts"), join(consumer, "src/application.ts"));
  run("pnpm", ["install", "--offline", "--ignore-scripts"], consumer);
  run(process.execPath, [tsc, "-p", "tsconfig.json"], consumer);

  const installed = join(consumer, "node_modules", packageName);
  const application = await import(pathToFileURL(join(consumer, "dist/application.js")).href) as ApplicationModule;
  const serverUpdate = await import(pathToFileURL(join(installed, "dist/internal/server-update.js")).href) as ServerUpdateModule;
  const actionServer = await import(pathToFileURL(join(installed, "dist/internal/action-server.js")).href) as Readonly<{
    ActionServerRuntime: new(options: Readonly<{ canonicalOrigin: string; generation: string; sessionKeys: string }>) => ActionRuntime;
  }>;
  const runtime = new actionServer.ActionServerRuntime({
    canonicalOrigin: "https://example.test",
    generation: "server-update-example-v1",
    sessionKeys: `active:${Buffer.alloc(32, 19).toString("base64url")}`,
  });
  const owner = Object.freeze({});
  let sequence = 0;
  const operation = (id: string, kind: "navigation" | "mutation", authorizationOwner: object = owner): Operation => {
    sequence += 1;
    return serverUpdate.createPrivateServerUpdateOperation({
      origin: "https://example.test",
      currentTruthUrl: "/projects",
      applicationGeneration: "server-update-example-v1",
      documentEpoch: "document-1",
      operation: Object.freeze({ id, sequence, kind, url: "/projects" }),
      resultId: `result-${id}`,
      scrollBoundary: Object.freeze({ documentPrecedingLayout: "unaffected", elementPrecedingLayout: "unaffected" }),
      authorizationOwner,
    });
  };

  const navigation = operation("navigation-success", "navigation");
  const navigationRequest = new Request("https://example.test/projects");
  const releaseNavigation = serverUpdate.bindPrivateServerUpdateOperation(navigationRequest, navigation);
  const navigationResponse = await runtime.serve(navigationRequest, application.handler);
  releaseNavigation();
  const navigationCopy = navigationResponse.clone();
  const navigationHtml = await navigationCopy.text();
  const sessionCookie = cookie(navigationCopy);
  const navigationProjection = await serverUpdate.projectPrivateServerUpdate(navigationResponse, navigation);
  assert.equal(navigationProjection.status, "projected");
  if (navigationProjection.status !== "projected") throw new Error("FADENO_V2_SERVER_UPDATE_NAVIGATION");
  const navigationEnvelope = JSON.parse(new TextDecoder().decode(navigationProjection.bytes)) as Readonly<{
    outcome: Readonly<{ kind: string; url: string; title: string; root: Readonly<{ identity: string; html: string }> }>;
  }>;
  assert.equal(navigationEnvelope.outcome.root.html, navigationHtml);
  const success = Object.freeze({
    schema: "fadeno.example.server-update-success",
    version: 1,
    nativeStatus: navigationCopy.status,
    projectedOutcome: navigationEnvelope.outcome.kind,
    url: navigationEnvelope.outcome.url,
    title: navigationEnvelope.outcome.title,
    rootIdentity: navigationEnvelope.outcome.root.identity,
    nativeAndProjectedHtmlEqual: navigationEnvelope.outcome.root.html === navigationHtml,
    executions: Object.freeze({ ...application.executionCounts }),
  });
  assert.deepEqual(success, readJson(join(scenarioRoot, "expected/success.json")));
  const staleProjection = await serverUpdate.projectPrivateServerUpdate(navigationResponse, navigation);
  assert.equal(staleProjection.status, "refused");
  if (staleProjection.status !== "refused") throw new Error("FADENO_V2_SERVER_UPDATE_STALE");

  const submittedForm = form(navigationHtml);
  const beforeFailure = { ...application.executionCounts };
  const expectedFailureOperation = operation("action-expected-failure", "mutation");
  const expectedFailureRequest = new Request(new URL(submittedForm.action, expectedFailureOperation.origin), {
    method: "POST",
    headers: {
      authorization: "Bearer owner",
      cookie: sessionCookie,
      "content-type": "application/x-www-form-urlencoded",
      origin: expectedFailureOperation.origin,
    },
    body: new URLSearchParams({ __fadeno_proof: submittedForm.proof, [submittedForm.titleName]: "" }),
  });
  const releaseFailure = serverUpdate.bindPrivateServerUpdateOperation(expectedFailureRequest, expectedFailureOperation);
  const expectedFailureResponse = await runtime.serve(expectedFailureRequest, application.handler);
  releaseFailure();
  const expectedFailureCopy = expectedFailureResponse.clone();
  const expectedFailureHtml = await expectedFailureCopy.text();
  const expectedFailureProjection = await serverUpdate.projectPrivateServerUpdate(expectedFailureResponse, expectedFailureOperation);
  assert.equal(expectedFailureProjection.status, "projected");
  if (expectedFailureProjection.status !== "projected") throw new Error("FADENO_V2_SERVER_UPDATE_EXPECTED_FAILURE");
  const afterProjection = { ...application.executionCounts };
  const expectedFailure = Object.freeze({
    schema: "fadeno.example.server-update-expected-failure",
    version: 1,
    nativeStatus: expectedFailureCopy.status,
    humanMessagePresent: expectedFailureHtml.includes("The project was not renamed.")
      && expectedFailureHtml.includes("Enter a project title."),
    projectedOutcome: expectedFailureProjection.record.outcome,
    code: expectedFailureProjection.record.provenance.action?.code,
    actionStatus: expectedFailureProjection.record.provenance.action?.status,
    executionDelta: Object.freeze({
      pages: afterProjection.pages - beforeFailure.pages,
      resources: afterProjection.resources - beforeFailure.resources,
      actions: afterProjection.actions - beforeFailure.actions,
    }),
  });
  assert.deepEqual(expectedFailure, readJson(join(scenarioRoot, "expected/expected-failure.json")));

  const refusalForm = form(expectedFailureHtml);
  const secret = "must-not-enter-projection-record";
  const refusalOperation = operation("action-authorization-refusal", "mutation");
  const refusalRequest = new Request(new URL(refusalForm.action, refusalOperation.origin), {
    method: "POST",
    headers: {
      cookie: sessionCookie,
      "content-type": "application/x-www-form-urlencoded",
      origin: refusalOperation.origin,
    },
    body: new URLSearchParams({ __fadeno_proof: refusalForm.proof, [refusalForm.titleName]: secret }),
  });
  const releaseRefusal = serverUpdate.bindPrivateServerUpdateOperation(refusalRequest, refusalOperation);
  const refusalResponse = await runtime.serve(refusalRequest, application.handler);
  releaseRefusal();
  const refusalCopy = refusalResponse.clone();
  const refusal = await serverUpdate.projectPrivateServerUpdate(refusalResponse, refusalOperation);
  assert.equal(refusal.status, "refused");
  if (refusal.status !== "refused") throw new Error("FADENO_V2_SERVER_UPDATE_REFUSAL");
  const refusalText = JSON.stringify(refusal.record);
  const refusalOutput = Object.freeze({
    schema: "fadeno.example.server-update-refusal",
    version: 1,
    nativeStatus: refusalCopy.status,
    code: refusal.code,
    envelopePublished: false,
    redaction: refusal.record.redaction,
    submittedValuePresent: refusalText.includes(secret),
    proofPresent: refusalText.includes(refusalForm.proof),
    sessionPresent: refusalText.includes(sessionCookie),
  });
  assert.deepEqual(refusalOutput, readJson(join(scenarioRoot, "expected/refusal.json")));
  const humanRefusal = `${refusal.code}: update projection refused; the native response remains authoritative.\n`;
  assert.equal(humanRefusal, readFileSync(join(scenarioRoot, "expected/refusal-human.txt"), "utf8"));

  const flow = Object.freeze({
    schema: "fadeno.example.server-update-flow",
    version: 1,
    causes: navigationProjection.record.causes,
    ownership: Object.freeze([
      "exact request-bound operation authority",
      "generated route and application generation",
      "request-owned resource evidence",
    ]),
    skipped: navigationProjection.record.skipped,
    outcome: "one native document projected without rerunning application code",
  });
  assert.deepEqual(flow, readJson(join(scenarioRoot, "expected/flow.json")));

  const rollbackOperation = operation("rollback-owner", "navigation");
  const rollbackRequest = new Request("https://example.test/projects");
  const releaseRollback = serverUpdate.bindPrivateServerUpdateOperation(rollbackRequest, rollbackOperation);
  const rollbackResponse = await runtime.serve(rollbackRequest, application.handler);
  releaseRollback();
  const wrongOwner = operation("rollback-other-owner", "navigation", Object.freeze({}));
  const rollbackRefusal = await serverUpdate.projectPrivateServerUpdate(rollbackResponse, wrongOwner);
  assert.equal(rollbackRefusal.status, "refused");
  assert.match(await rollbackResponse.text(), /<h1>Alpha<\/h1>/u);

  const recoveredOperation = operation("navigation-recovered", "navigation");
  const recoveredRequest = new Request("https://example.test/projects");
  const releaseRecovered = serverUpdate.bindPrivateServerUpdateOperation(recoveredRequest, recoveredOperation);
  const recoveredResponse = await runtime.serve(recoveredRequest, application.handler);
  releaseRecovered();
  const recovered = await serverUpdate.projectPrivateServerUpdate(recoveredResponse, recoveredOperation);
  assert.equal(recovered.status, "projected");
  if (recovered.status !== "projected") throw new Error("FADENO_V2_SERVER_UPDATE_RECOVERY");
  const recoveredRecord = new TextDecoder().decode(serverUpdate.serializePrivateServerUpdateRecord(recovered.record));
  const recovery = Object.freeze({
    schema: "fadeno.example.server-update-recovery",
    version: 1,
    staleProjectionCode: staleProjection.code,
    rollbackCode: rollbackRefusal.code,
    nativeResponseRemainedUsable: true,
    currentOutcome: recovered.record.outcome,
    staleActionEvidencePresent: recovered.record.provenance.action !== null,
    staleFailureCodePresent: recoveredRecord.includes("PROJECT_TITLE_REQUIRED"),
    staleResultPresent: recoveredRecord.includes(expectedFailureOperation.resultId),
  });
  assert.deepEqual(recovery, readJson(join(scenarioRoot, "expected/recovery.json")));
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("V2 server update packed example passed (success, failure, flow, refusal, recovery, one-pass execution)");
