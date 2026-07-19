import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  defineAction,
  fileField,
  redirect,
  renderRoute,
  textField,
  type Handler,
  type Page,
} from "../packages/framework/src/index.ts";
import {
  ActionServerRuntime,
  decodeSessionCookieHeader,
} from "../packages/framework/src/internal/action-server.ts";
import {
  parsePrivateBuildDevArguments,
  parsePrivateEnvironmentFile,
} from "../packages/framework/src/internal/build-dev-decision.ts";
import {
  decodeConfigSourceBytes,
  loadConfigFromSource,
} from "../packages/framework/src/internal/config.ts";
import { FadenoDiagnosticError } from "../packages/framework/src/internal/diagnostic.ts";
import { decodeNodeRequestTarget } from "../packages/framework/src/internal/node-http.ts";
import { parseProjectCheckArguments } from "../packages/framework/src/internal/project-check.ts";
import { parseProjectCreateArguments } from "../packages/framework/src/internal/project-create.ts";
import { parseProjectDeployArguments } from "../packages/framework/src/internal/project-deploy.ts";
import type { RouteManifest } from "../packages/framework/src/internal/routing/discovery.ts";
import { decodeRouteArtifactManifest } from "../packages/framework/src/internal/routing/generator.ts";
import { matchRoutePathname } from "../packages/framework/src/internal/routing/matcher.ts";
import {
  createDecisionSession,
  createDecisionSessionKeyring,
  openDecisionSession,
} from "../packages/framework/src/internal/session-decision.ts";
import { jsx } from "../packages/framework/src/jsx-runtime.ts";
import {
  A0_DECODER_FUZZ_SEED,
  A0_DECODER_FUZZ_SURFACES,
  validateA0DecoderFuzzSummary,
  type A0DecoderFuzzSummary,
  type A0DecoderFuzzSurface,
} from "./lib/a0-decoder-fuzz.ts";

type FuzzCase<Value> = Readonly<{ value: Value; bytes: number }>;

const root = fileURLToPath(new URL("../", import.meta.url));
const exampleRoot = join(root, "examples/v1-app");
const encoder = new TextEncoder();
const sentinel = "FADENO_FUZZ_SECRET_8f17c936";

class DeterministicRandom {
  #state: number;

  constructor(seed: number) { this.#state = seed >>> 0; }

  next(): number {
    let value = this.#state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.#state = value >>> 0;
    return this.#state;
  }

  integer(maximumExclusive: number): number { return this.next() % maximumExclusive; }

  bytes(length: number): Uint8Array {
    const result = new Uint8Array(length);
    for (let index = 0; index < result.length; index += 1) result[index] = this.next() & 0xff;
    return result;
  }
}

const alphabet = Object.freeze([
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/%._-:=?&#;,'\"[]{}()!@+$*\\ \t\r\n",
  "\0",
  "é",
  "東",
  "🙂",
  "\ud800",
]);

function randomString(random: DeterministicRandom): string {
  const target = random.integer(513);
  let value = "";
  for (let index = 0; index < target; index += 1) value += alphabet[random.integer(alphabet.length)]!;
  return value;
}

function stringCase(value: string): FuzzCase<string> {
  return Object.freeze({ value, bytes: encoder.encode(value).byteLength });
}

function stringCorpus(seedOffset: number, randomCases: number, fixed: readonly string[]): readonly FuzzCase<string>[] {
  const random = new DeterministicRandom((A0_DECODER_FUZZ_SEED + seedOffset) >>> 0);
  return Object.freeze([
    ...fixed.map(stringCase),
    ...Array.from({ length: randomCases }, () => stringCase(randomString(random))),
  ]);
}

function bytesCase(value: Uint8Array): FuzzCase<Uint8Array> {
  return Object.freeze({ value: value.slice(), bytes: value.byteLength });
}

function bytesCorpus(
  seedOffset: number,
  randomCases: number,
  fixed: readonly Uint8Array[],
): readonly FuzzCase<Uint8Array>[] {
  const random = new DeterministicRandom((A0_DECODER_FUZZ_SEED + seedOffset) >>> 0);
  return Object.freeze([
    ...fixed.map(bytesCase),
    ...Array.from({ length: randomCases }, () => bytesCase(random.bytes(random.integer(513)))),
  ]);
}

function classifyError(error: unknown, pattern: RegExp): string {
  if (error instanceof FadenoDiagnosticError && pattern.test(error.id)) return `refused:${error.id}`;
  if (error instanceof Error && pattern.test(error.message)) return `refused:${error.message}`;
  return `unexpected:${error instanceof Error ? error.name : typeof error}`;
}

async function summarize<Value>(
  id: string,
  cases: readonly FuzzCase<Value>[],
  classify: (value: Value) => string | Promise<string>,
): Promise<A0DecoderFuzzSurface> {
  const classifications: string[] = [];
  let accepted = 0;
  let refused = 0;
  let unexpected = 0;
  let largestInputBytes = 0;
  for (const item of cases) {
    largestInputBytes = Math.max(largestInputBytes, item.bytes);
    let classification: string;
    try { classification = await classify(item.value); }
    catch (error) { classification = `unexpected:${error instanceof Error ? error.name : typeof error}`; }
    classifications.push(classification);
    if (classification.startsWith("accepted:")) accepted += 1;
    else if (classification.startsWith("refused:")) refused += 1;
    else unexpected += 1;
  }
  return Object.freeze({
    id,
    cases: cases.length,
    accepted,
    refused,
    unexpected,
    largestInputBytes,
    classificationSha256: createHash("sha256").update(classifications.join("\n")).digest("hex"),
  });
}

const manifestBytes = readFileSync(join(exampleRoot, ".fadeno/routes/manifest.json"), "utf8");
const manifest = JSON.parse(manifestBytes) as RouteManifest;
const configSource = readFileSync(join(exampleRoot, "fadeno.config.ts"), "utf8");

const surfaces: A0DecoderFuzzSurface[] = [];

surfaces.push(await summarize(
  "adapter-request-target",
  stringCorpus(1, 256, ["/", "/projects?filter=safe", "//attacker.invalid/", "x".repeat(4_096)]),
  (value) => {
    try {
      const decoded = decodeNodeRequestTarget(value, "http://127.0.0.1:4173");
      return `accepted:${decoded.pathname.length > 0 ? "url" : "empty"}`;
    } catch (error) { return classifyError(error, /^FADENO_ADAPTER_REQUEST_TARGET$/u); }
  },
));

surfaces.push(await summarize(
  "route-pathname",
  stringCorpus(2, 256, ["/", "/projects", "/hello/Fadeno", "/" + "x".repeat(4_095)]),
  (value) => matchRoutePathname(manifest, value) ? "accepted:match" : "refused:no-match",
));

surfaces.push(await summarize(
  "configuration-source",
  stringCorpus(3, 64, [
    configSource,
    "export default {};\n",
    "export default (() => ({}))();\n",
    "x".repeat(4_096),
  ]),
  (value) => {
    try {
      loadConfigFromSource(exampleRoot, value);
      return "accepted:configuration";
    } catch (error) { return classifyError(error, /^FADENO_CONFIG_[A-Z0-9_]+$/u); }
  },
));

surfaces.push(await summarize(
  "configuration-file-bytes",
  bytesCorpus(4, 64, [
    encoder.encode(configSource),
    encoder.encode("export default {};\n"),
    Uint8Array.of(0xff),
    new Uint8Array(4_096).fill(0xff),
  ]),
  (value) => {
    try {
      loadConfigFromSource(exampleRoot, decodeConfigSourceBytes(value));
      return "accepted:configuration";
    } catch (error) { return classifyError(error, /^FADENO_CONFIG_[A-Z0-9_]+$/u); }
  },
));

surfaces.push(await summarize(
  "environment-file",
  stringCorpus(5, 256, ["A=one\nB='two'\n", "# empty\n", "A=${B}\n", "A=" + "x".repeat(4_094)]),
  (value) => {
    try {
      parsePrivateEnvironmentFile(value);
      return "accepted:environment";
    } catch (error) { return classifyError(error, /^FADENO_BUILD_ENV(?::[0-9]+)?$/u); }
  },
));

function commandCase(value: readonly string[]): FuzzCase<readonly string[]> {
  return Object.freeze({
    value: Object.freeze([...value]),
    bytes: encoder.encode(value.join("\0")).byteLength,
  });
}

function commandCorpus(
  seedOffset: number,
  fixed: readonly (readonly string[])[],
): readonly FuzzCase<readonly string[]>[] {
  const random = new DeterministicRandom((A0_DECODER_FUZZ_SEED + seedOffset) >>> 0);
  return Object.freeze([
    ...fixed.map(commandCase),
    ...Array.from({ length: 64 }, () => commandCase(
      Array.from({ length: random.integer(8) }, () => randomString(random).slice(0, 480)),
    )),
  ]);
}

surfaces.push(await summarize(
  "build-dev-command-arguments",
  commandCorpus(6, [
    ["build", "--project-root", "."],
    ["dev", "--project-root", ".", "--port", "4173"],
    [],
    ["build", "--project-root", "x".repeat(4_060)],
  ]),
  (value) => {
    const parsed = parsePrivateBuildDevArguments(value, exampleRoot);
    return parsed ? `accepted:${parsed.command}` : "refused:usage";
  },
));

surfaces.push(await summarize(
  "check-command-arguments",
  commandCorpus(7, [
    ["check", "--project-root", "."],
    ["check", "--project-root", ".", "--explain"],
    [],
    ["check", "--project-root", "x".repeat(4_060)],
  ]),
  (value) => parseProjectCheckArguments(value, exampleRoot) ? "accepted:check" : "refused:usage",
));

surfaces.push(await summarize(
  "create-command-arguments",
  commandCorpus(8, [
    ["create", "--project-root", "alpha-app"],
    ["create", "--project-root", "alpha-app", "extra"],
    [],
    ["create", "--project-root", "x".repeat(4_060)],
  ]),
  (value) => parseProjectCreateArguments(value, exampleRoot) ? "accepted:create" : "refused:usage",
));

surfaces.push(await summarize(
  "deploy-command-arguments",
  commandCorpus(9, [
    ["deploy", "--project-root", ".", "--output", "../release"],
    ["deploy", "--project-root", "."],
    [],
    ["deploy", "--project-root", ".", "--output", "x".repeat(4_040)],
  ]),
  (value) => parseProjectDeployArguments(value, exampleRoot) ? "accepted:deploy" : "refused:usage",
));

surfaces.push(await summarize(
  "route-artifact-manifest",
  stringCorpus(10, 256, [manifestBytes, "{}", "{", "x".repeat(4_096)]),
  (value) => {
    try {
      decodeRouteArtifactManifest(value);
      return "accepted:manifest";
    } catch (error) { return classifyError(error, /^FADENO_GENERATION_OUTPUT_MANIFEST$/u); }
  },
));

const keyring = createDecisionSessionKeyring([Object.freeze({ id: "active", key: new Uint8Array(32).fill(17) })]);
const now = 1_700_000_000_000;
const validSession = createDecisionSession(keyring, Object.freeze({ viewer: "owner" }), now);
const sessionCookie = `__Host-fadeno-session=${validSession.envelope}`;
const cookieCases: FuzzCase<string | null>[] = [
  Object.freeze({ value: null, bytes: 0 }),
  ...stringCorpus(11, 254, [
    sessionCookie,
    `other=one; ${sessionCookie}`,
    `  other = one ;  ${sessionCookie}  `,
    `${sessionCookie}; ${sessionCookie}`,
    "x".repeat(16 * 1_024 + 1),
  ]),
];
surfaces.push(await summarize(
  "session-cookie",
  cookieCases,
  (header) => {
    try {
      const opened = openDecisionSession(keyring, decodeSessionCookieHeader(header), now + 1);
      return opened.status === "invalid" || opened.status === "expired"
        ? `refused:${opened.status}`
        : `accepted:${opened.status}`;
    } catch (error) {
      return classifyError(error, /^FADENO_SESSION_COOKIE$/u);
    }
  },
));

const fuzzAction = defineAction({
  fields: {
    title: textField({ maximumBytes: 128 }),
    attachment: fileField({ required: false, maximumBytes: 128, acceptedTypes: ["text/plain"] }),
  },
  authorize: () => true,
  run: () => redirect("/projects"),
});
const actionDocument = () => jsx("html", {
  lang: "en",
  children: jsx("body", {
    children: jsx("form", {
      action: fuzzAction,
      children: [
        jsx("input", { name: fuzzAction.fields.title, type: "text" }),
        jsx("input", { name: fuzzAction.fields.attachment, type: "file" }),
        jsx("button", { type: "submit", children: "Save" }),
      ],
    }),
  }),
});
const page: Page = actionDocument;
const handler: Handler = (request) => renderRoute({
  request,
  routeId: "route:fuzz",
  generation: "a0-decoder-fuzz",
  parameters: Object.freeze(Object.create(null) as Record<string, never>),
  page,
  layouts: [],
  notFound: actionDocument,
  error: actionDocument,
});

type ActionFixture = Readonly<{
  runtime: ActionServerRuntime;
  action: string;
  proof: string;
  fieldName: string;
  fileFieldName: string;
  cookie: string;
}>;

async function createActionFixture(): Promise<ActionFixture> {
  const runtime = new ActionServerRuntime({
    canonicalOrigin: "https://app.example",
    generation: "a0-decoder-fuzz",
    sessionKeys: `active:${Buffer.alloc(32, 19).toString("base64url")}`,
    now: Date.now,
  });
  const initial = await runtime.serve(
    new Request("https://app.example/projects"),
    async (request) => await handler(request),
  );
  const html = await initial.text();
  const action = /<form action="([^"]+)"/u.exec(html)?.[1]?.replaceAll("&amp;", "&");
  const proof = /name="__fadeno_proof" value="([^"]+)"/u.exec(html)?.[1];
  const fieldName = /<input name="([^"]+)" type="text">/u.exec(html)?.[1];
  const fileFieldName = /<input name="([^"]+)" type="file">/u.exec(html)?.[1];
  const cookie = initial.headers.getSetCookie()[0]?.split(";", 1)[0];
  if (!action || !proof || !fieldName || !fileFieldName || !cookie) {
    throw new Error("FADENO_A0_FUZZ_ACTION_SETUP");
  }
  return Object.freeze({ runtime, action, proof, fieldName, fileFieldName, cookie });
}

async function submitAction(
  fixture: ActionFixture,
  mediaType: string,
  body: string | Uint8Array,
): Promise<Readonly<{ status: number; body: string }>> {
  const response = await fixture.runtime.serve(new Request(new URL(fixture.action, "https://app.example"), {
    method: "POST",
    headers: { origin: "https://app.example", cookie: fixture.cookie, "content-type": mediaType },
    body: typeof body === "string" ? body : body.slice().buffer as ArrayBuffer,
  }), async (request) => await handler(request));
  return Object.freeze({ status: response.status, body: await response.text() });
}

const proofFixture = await createActionFixture();
surfaces.push(await summarize(
  "action-proof",
  stringCorpus(12, 254, [
    proofFixture.proof,
    "",
    "v1",
    "v1.active.0.invalid.invalid",
    ".".repeat(320),
    "x".repeat(4_096),
  ]),
  async (proof) => {
    const body = new URLSearchParams({
      __fadeno_proof: proof,
      [proofFixture.fieldName]: "accepted",
    }).toString();
    const response = await submitAction(proofFixture, "application/x-www-form-urlencoded", body);
    if (response.status === 303) return "accepted:proof";
    const code = /FADENO_[A-Z0-9_]+/u.exec(response.body)?.[0];
    if (!code || !code.startsWith("FADENO_ACTION_PROOF")) {
      return `unexpected:${code ?? `status-${response.status}`}`;
    }
    return `refused:${code}`;
  },
));

type ActionBodyCase = Readonly<{
  fixture: ActionFixture;
  mediaType: string;
  body: string | Uint8Array;
}>;
function actionBodyCase(
  fixture: ActionFixture,
  mediaType: string,
  body: string | Uint8Array,
): FuzzCase<ActionBodyCase> {
  const bytes = typeof body === "string" ? encoder.encode(body).byteLength : body.byteLength;
  return Object.freeze({ value: Object.freeze({ fixture, mediaType, body }), bytes });
}

function multipartBody(fixture: ActionFixture, boundary: string): string {
  return [
    `--${boundary}\r\nContent-Disposition: form-data; name="__fadeno_proof"\r\n\r\n${fixture.proof}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="${fixture.fieldName}"\r\n\r\naccepted\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="${fixture.fileFieldName}"; filename="accepted.txt"\r\nContent-Type: text/plain\r\n\r\naccepted-file\r\n`,
    `--${boundary}--\r\n`,
  ].join("");
}

const bodyFixture = await createActionFixture();
const multipartFixture = await createActionFixture();
const validBody = new URLSearchParams({
  __fadeno_proof: bodyFixture.proof,
  [bodyFixture.fieldName]: "accepted",
}).toString();
const multipartBoundary = "fadeno-a0-valid-boundary";
const actionBodyCases: FuzzCase<ActionBodyCase>[] = [
  actionBodyCase(bodyFixture, "application/x-www-form-urlencoded", validBody),
  actionBodyCase(
    multipartFixture,
    `multipart/form-data; boundary=${multipartBoundary}`,
    multipartBody(multipartFixture, multipartBoundary),
  ),
  actionBodyCase(bodyFixture, "application/x-www-form-urlencoded", `${bodyFixture.fieldName}=${sentinel}`),
  actionBodyCase(bodyFixture, "application/x-www-form-urlencoded", `__fadeno_proof=${bodyFixture.proof}&__fadeno_proof=${bodyFixture.proof}&${bodyFixture.fieldName}=${sentinel}`),
  actionBodyCase(bodyFixture, "application/json", `{"value":"${sentinel}"}`),
];
const bodyRandom = new DeterministicRandom((A0_DECODER_FUZZ_SEED + 13) >>> 0);
for (let index = 0; index < 127; index += 1) {
  const random = `${sentinel}:${randomString(bodyRandom)}`.slice(0, 1_024);
  const kind = bodyRandom.integer(4);
  if (kind === 0) actionBodyCases.push(actionBodyCase(bodyFixture, "application/x-www-form-urlencoded", random));
  else if (kind === 1) actionBodyCases.push(actionBodyCase(bodyFixture, `multipart/form-data; boundary=fuzz-${index}`, random));
  else if (kind === 2) actionBodyCases.push(actionBodyCase(bodyFixture, "text/plain", random));
  else actionBodyCases.push(actionBodyCase(bodyFixture, "application/x-www-form-urlencoded", bodyRandom.bytes(bodyRandom.integer(1_025))));
}
surfaces.push(await summarize(
  "action-body",
  actionBodyCases,
  async ({ fixture, mediaType, body }) => {
    const response = await submitAction(fixture, mediaType, body);
    if (response.body.includes(sentinel)) return "unexpected:secret-leakage";
    if (response.status === 303) return "accepted:redirect";
    const code = /FADENO_[A-Z0-9_]+/u.exec(response.body)?.[0];
    if (!code || code === "FADENO_ACTION_INTERNAL") return `unexpected:${code ?? `status-${response.status}`}`;
    return `refused:${code}`;
  },
));

if (surfaces.map(({ id }) => id).join("\0") !== A0_DECODER_FUZZ_SURFACES.map(({ id }) => id).join("\0")) {
  throw new Error("FADENO_A0_FUZZ_SURFACE_ORDER");
}
const summary: A0DecoderFuzzSummary = Object.freeze({
  schemaVersion: 1,
  milestone: "A0-09",
  seed: A0_DECODER_FUZZ_SEED,
  outcome: "qualified-bounded-fuzz",
  deterministicReplay: true,
  secretLeakageObserved: false,
  totalCases: surfaces.reduce((total, surface) => total + surface.cases, 0),
  surfaces: Object.freeze(surfaces),
});
const errors = validateA0DecoderFuzzSummary(summary);
if (errors.length > 0) throw new Error(errors.join("\n"));
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
