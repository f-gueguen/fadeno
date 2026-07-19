import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  defineAction,
  redirect,
  renderRoute,
  textField,
  type Handler,
  type Page,
} from "../packages/framework/src/index.ts";
import { ActionServerRuntime } from "../packages/framework/src/internal/action-server.ts";
import {
  parsePrivateBuildDevArguments,
  parsePrivateEnvironmentFile,
} from "../packages/framework/src/internal/build-dev-decision.ts";
import { loadConfigFromSource } from "../packages/framework/src/internal/config.ts";
import { FadenoDiagnosticError } from "../packages/framework/src/internal/diagnostic.ts";
import { decodeNodeRequestTarget } from "../packages/framework/src/internal/node-http.ts";
import type { RouteManifest } from "../packages/framework/src/internal/routing/discovery.ts";
import { decodeRouteArtifactManifest } from "../packages/framework/src/internal/routing/generator.ts";
import { matchRoutePathname } from "../packages/framework/src/internal/routing/matcher.ts";
import {
  createDecisionSession,
  createDecisionSessionKeyring,
  openDecisionSession,
  signDecisionActionProof,
  verifyDecisionActionProof,
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
  "environment-file",
  stringCorpus(4, 256, ["A=one\nB='two'\n", "# empty\n", "A=${B}\n", "A=" + "x".repeat(4_094)]),
  (value) => {
    try {
      parsePrivateEnvironmentFile(value);
      return "accepted:environment";
    } catch (error) { return classifyError(error, /^FADENO_BUILD_ENV(?::[0-9]+)?$/u); }
  },
));

const commandRandom = new DeterministicRandom((A0_DECODER_FUZZ_SEED + 5) >>> 0);
const commandCases: FuzzCase<readonly string[]>[] = [
  ["build", "--project-root", "."],
  ["dev", "--project-root", ".", "--port", "4173"],
  [],
  ["build", "--project-root", "x".repeat(4_067)],
].map((value) => Object.freeze({ value: Object.freeze(value), bytes: encoder.encode(value.join("\0")).byteLength }));
for (let index = 0; index < 256; index += 1) {
  const value = Array.from({ length: commandRandom.integer(8) }, () => randomString(commandRandom));
  const bounded = value.map((part) => part.slice(0, 480));
  commandCases.push(Object.freeze({ value: Object.freeze(bounded), bytes: encoder.encode(bounded.join("\0")).byteLength }));
}
surfaces.push(await summarize(
  "command-arguments",
  commandCases,
  (value) => parsePrivateBuildDevArguments(value, exampleRoot) ? "accepted:command" : "refused:usage",
));

surfaces.push(await summarize(
  "route-artifact-manifest",
  stringCorpus(6, 256, [manifestBytes, "{}", "{", "x".repeat(4_096)]),
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
const cookieCases: FuzzCase<string | undefined>[] = [
  Object.freeze({ value: validSession.envelope, bytes: encoder.encode(validSession.envelope).byteLength }),
  Object.freeze({ value: undefined, bytes: 0 }),
  ...stringCorpus(7, 256, ["", "x".repeat(4_096)]),
];
surfaces.push(await summarize(
  "session-cookie",
  cookieCases,
  (value) => {
    const opened = openDecisionSession(keyring, value, now + 1);
    return opened.status === "invalid" || opened.status === "expired"
      ? `refused:${opened.status}`
      : `accepted:${opened.status}`;
  },
));

const validProof = signDecisionActionProof(keyring, "route:projects");
const proofRandom = new DeterministicRandom((A0_DECODER_FUZZ_SEED + 8) >>> 0);
const proofCases: FuzzCase<Readonly<{ keyId: string; message: string; signature: Uint8Array }>>[] = [
  Object.freeze({
    value: Object.freeze({ keyId: validProof.keyId, message: "route:projects", signature: validProof.signature }),
    bytes: encoder.encode(validProof.keyId + "route:projects").byteLength + validProof.signature.byteLength,
  }),
  Object.freeze({ value: Object.freeze({ keyId: "missing", message: "route:projects", signature: validProof.signature }), bytes: 53 }),
  Object.freeze({ value: Object.freeze({ keyId: validProof.keyId, message: "wrong", signature: validProof.signature }), bytes: 43 }),
  Object.freeze({ value: Object.freeze({ keyId: validProof.keyId, message: "x".repeat(4_058), signature: validProof.signature }), bytes: 4_096 }),
];
for (let index = 0; index < 256; index += 1) {
  const keyId = randomString(proofRandom).slice(0, 64);
  const message = randomString(proofRandom).slice(0, 512);
  const signature = proofRandom.bytes(proofRandom.integer(65));
  proofCases.push(Object.freeze({
    value: Object.freeze({ keyId, message, signature }),
    bytes: encoder.encode(keyId + message).byteLength + signature.byteLength,
  }));
}
surfaces.push(await summarize(
  "action-proof",
  proofCases,
  ({ keyId, message, signature }) => verifyDecisionActionProof(keyring, keyId, message, signature)
    ? "accepted:proof"
    : "refused:proof",
));

const fuzzAction = defineAction({
  fields: { title: textField({ maximumBytes: 128 }) },
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
const actionRuntime = new ActionServerRuntime({
  canonicalOrigin: "https://app.example",
  generation: "a0-decoder-fuzz",
  sessionKeys: `active:${Buffer.alloc(32, 19).toString("base64url")}`,
  now: Date.now,
});
const initial = await actionRuntime.serve(new Request("https://app.example/projects"), async (request) => await handler(request));
const initialHtml = await initial.text();
const action = /<form action="([^"]+)"/u.exec(initialHtml)?.[1]?.replaceAll("&amp;", "&");
const proof = /name="__fadeno_proof" value="([^"]+)"/u.exec(initialHtml)?.[1];
const fieldName = /<input name="([^"]+)" type="text">/u.exec(initialHtml)?.[1];
const cookie = initial.headers.getSetCookie()[0]?.split(";", 1)[0];
if (!action || !proof || !fieldName || !cookie) throw new Error("FADENO_A0_FUZZ_ACTION_SETUP");

type ActionBodyCase = Readonly<{ mediaType: string; body: string | Uint8Array }>;
function actionBodyCase(mediaType: string, body: string | Uint8Array): FuzzCase<ActionBodyCase> {
  const bytes = typeof body === "string" ? encoder.encode(body).byteLength : body.byteLength;
  return Object.freeze({ value: Object.freeze({ mediaType, body }), bytes });
}
const validBody = new URLSearchParams({ __fadeno_proof: proof, [fieldName]: "accepted" }).toString();
const actionBodyCases: FuzzCase<ActionBodyCase>[] = [
  actionBodyCase("application/x-www-form-urlencoded", validBody),
  actionBodyCase("application/x-www-form-urlencoded", `${fieldName}=${sentinel}`),
  actionBodyCase("application/x-www-form-urlencoded", `__fadeno_proof=${proof}&__fadeno_proof=${proof}&${fieldName}=${sentinel}`),
  actionBodyCase("application/json", `{"value":"${sentinel}"}`),
];
const bodyRandom = new DeterministicRandom((A0_DECODER_FUZZ_SEED + 9) >>> 0);
for (let index = 0; index < 128; index += 1) {
  const random = `${sentinel}:${randomString(bodyRandom)}`.slice(0, 1_024);
  const kind = bodyRandom.integer(4);
  if (kind === 0) actionBodyCases.push(actionBodyCase("application/x-www-form-urlencoded", random));
  else if (kind === 1) actionBodyCases.push(actionBodyCase(`multipart/form-data; boundary=fuzz-${index}`, random));
  else if (kind === 2) actionBodyCases.push(actionBodyCase("text/plain", random));
  else actionBodyCases.push(actionBodyCase("application/x-www-form-urlencoded", bodyRandom.bytes(bodyRandom.integer(1_025))));
}
surfaces.push(await summarize(
  "action-body",
  actionBodyCases,
  async ({ mediaType, body }) => {
    const response = await actionRuntime.serve(new Request(new URL(action, "https://app.example"), {
      method: "POST",
      headers: { origin: "https://app.example", cookie, "content-type": mediaType },
      body: typeof body === "string" ? body : body.slice().buffer as ArrayBuffer,
    }), async (request) => await handler(request));
    const responseBody = await response.text();
    if (responseBody.includes(sentinel)) return "unexpected:secret-leakage";
    if (response.status === 303) return "accepted:redirect";
    const code = /FADENO_[A-Z0-9_]+/u.exec(responseBody)?.[0];
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
