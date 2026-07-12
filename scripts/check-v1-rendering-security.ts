import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020Module from "ajv/dist/2020.js";

import {
  createCspNonce,
  classifySink,
  encodeAttribute,
  encodeBoolean,
  encodeEnumerated,
  encodeText,
  encodeUrl,
  readCspNonce,
  projectDiagnosticSource,
  renderingSecurityRegistry,
  type TextContext,
  type UrlSink,
} from "../packages/framework/dist/internal/rendering-security.js";
import { unsafeHtml } from "../packages/framework/dist/index.js";
import { readUnsafeHtml } from "../packages/framework/dist/internal/unsafe-html.js";

interface TextCase { readonly id: string; readonly context: TextContext; readonly input: string; readonly output: string }
interface AttributeCase { readonly id: string; readonly element: string; readonly attribute: string; readonly input: string; readonly output: string }
interface UrlCase { readonly id: string; readonly sink: UrlSink; readonly input: string; readonly output: string }
interface UrlRefusal { readonly id: string; readonly sink: UrlSink; readonly input: string; readonly error: string }
interface SinkCase { readonly id: string; readonly element: string; readonly attribute: string | null; readonly kind: string }
interface SinkRefusal { readonly id: string; readonly element: string; readonly attribute: string | null; readonly error: string }
interface Corpus {
  readonly schemaVersion: number;
  readonly policyVersion: number;
  readonly futureConsumer: string;
  readonly textCases: readonly TextCase[];
  readonly attributeCases: readonly AttributeCase[];
  readonly sinkCases: readonly SinkCase[];
  readonly sinkRefusals: readonly SinkRefusal[];
  readonly urlKindSamples: Readonly<Record<string, string>>;
  readonly urlMatrix: Readonly<Record<UrlSink, readonly string[]>>;
  readonly urlCases: readonly UrlCase[];
  readonly urlRefusals: readonly UrlRefusal[];
  readonly refusedContexts: readonly string[];
  readonly unsafeCapabilityOutcomes: readonly string[];
  readonly nonceCases: readonly Record<string, unknown>[];
  readonly redactionCases: readonly {
    readonly id: string;
    readonly source: Record<string, unknown>;
    readonly sensitiveFields: readonly string[];
    readonly sensitiveValues: readonly string[];
    readonly output: Record<string, unknown>;
  }[];
  readonly browserOutcomes: readonly { readonly phase: string }[];
}

const corpusPath = fileURLToPath(new URL("../packages/framework/contracts/rendering-security-v1.corpus.json", import.meta.url));
const schemaPath = fileURLToPath(new URL("../packages/framework/contracts/rendering-security-v1.schema.json", import.meta.url));
const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as Corpus;
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;
const validateCorpus = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
if (!validateCorpus(corpus)) throw new Error(`FADENO_RENDERING_CORPUS_SCHEMA:${JSON.stringify(validateCorpus.errors)}`);
assert.equal(corpus.schemaVersion, 1);
assert.equal(corpus.policyVersion, renderingSecurityRegistry.schemaVersion);
assert.equal(corpus.futureConsumer, "V1-09 renderer and browser conformance");
assert.equal(corpus.browserOutcomes.every((outcome) => outcome.phase === "V1-09"), true);
assert.deepEqual(corpus.refusedContexts, renderingSecurityRegistry.refusedContexts);
assert.deepEqual(renderingSecurityRegistry.acceptedSinkClasses, [
  "html-text", "attribute-double-quoted", "rcdata", "url-attribute", "boolean-attribute",
  "enumerated-attribute", "authenticated-raw-html",
]);
assert.deepEqual(corpus.unsafeCapabilityOutcomes, [
  "ordinary-string-refused-by-type",
  "same-package-token-accepted",
  "copy-clone-proxy-json-and-other-package-refused",
  "raw-html-never-receives-csp-nonce",
]);

for (const fixture of corpus.textCases) {
  assert.equal(encodeText(fixture.input, fixture.context), fixture.output, fixture.id);
}
for (const fixture of corpus.attributeCases) {
  assert.equal(encodeAttribute(fixture.element, fixture.attribute, fixture.input), fixture.output, fixture.id);
}
assert.throws(() => encodeAttribute("div", "onclick", "value"), { message: "FADENO_RENDER_EVENT_ATTRIBUTE" });
assert.throws(() => encodeAttribute("a", "href", "/path"), { message: "FADENO_RENDER_ATTRIBUTE_SINK" });
assert.throws(() => encodeText("value", "unknown" as TextContext), { message: "FADENO_RENDER_TEXT_CONTEXT" });
for (const fixture of corpus.sinkCases) {
  assert.equal(classifySink(fixture.element, fixture.attribute ?? undefined), fixture.kind, fixture.id);
}
assert.deepEqual(corpus.sinkRefusals.map((fixture) => fixture.id), corpus.refusedContexts);
for (const fixture of corpus.sinkRefusals) {
  assert.throws(() => classifySink(fixture.element, fixture.attribute ?? undefined), { message: fixture.error }, fixture.id);
}
for (const fixture of corpus.urlCases) {
  assert.equal(encodeUrl(fixture.input, fixture.sink), fixture.output, fixture.id);
}
for (const fixture of corpus.urlRefusals) {
  assert.throws(() => encodeUrl(fixture.input, fixture.sink), { message: fixture.error }, fixture.id);
}
assert.deepEqual(corpus.urlMatrix, renderingSecurityRegistry.urlSinks);
for (const [sink, acceptedKinds] of Object.entries(corpus.urlMatrix) as [UrlSink, readonly string[]][]) {
  const [element, attribute] = sink.split(".") as [string, string];
  assert.equal(classifySink(element, attribute), "url-attribute", sink);
  for (const [kind, sample] of Object.entries(corpus.urlKindSamples)) {
    if (acceptedKinds.includes(kind)) assert.doesNotThrow(() => encodeUrl(sample, sink), `${sink}:${kind}`);
    else assert.throws(() => encodeUrl(sample, sink), { message: "FADENO_RENDER_URL_SCHEME" }, `${sink}:${kind}`);
  }
}

for (const sink of renderingSecurityRegistry.booleanAttributes) {
  const [elementPattern, attribute] = sink.split(".") as [string, string];
  const element = elementPattern === "*" ? "div" : elementPattern;
  assert.equal(encodeBoolean(element, attribute, true), attribute, sink);
  assert.equal(encodeBoolean(element, attribute, false), "", sink);
}
assert.throws(() => encodeBoolean("input", "name", true), { message: "FADENO_RENDER_BOOLEAN_SINK" });
assert.throws(() => encodeBoolean("input", "disabled", "true" as unknown as boolean), { message: "FADENO_RENDER_BOOLEAN_VALUE" });
for (const [sink, tokens] of Object.entries(renderingSecurityRegistry.enumeratedAttributes)) {
  const [elementPattern, attribute] = sink.split(".") as [string, string];
  const element = elementPattern === "*" ? "div" : elementPattern;
  for (const token of tokens) assert.equal(encodeEnumerated(element, attribute, token), token, `${sink}:${token}`);
  assert.throws(() => encodeEnumerated(element, attribute, "TRUE"), { message: "FADENO_RENDER_ENUMERATED_VALUE" });
}
assert.throws(() => encodeEnumerated("input", "name", "value"), { message: "FADENO_RENDER_ENUMERATED_SINK" });

const nonceFixture = corpus.nonceCases.find((fixture) => fixture["id"] === "default-primitive");
assert(nonceFixture);
assert.equal(nonceFixture["minimumEntropyBits"], 128);
const deterministicNonce = createCspNonce();
assert.equal(Object.isFrozen(deterministicNonce), true);
assert.equal(Object.getPrototypeOf(deterministicNonce), null);
assert.equal(readCspNonce({ ...deterministicNonce }), undefined);
assert.equal(readCspNonce(structuredClone(deterministicNonce)), undefined);
const rawToken = unsafeHtml("<strong>reviewed</strong>", { reason: "Static fixture markup review" });
assert.equal(readCspNonce(rawToken), undefined);
assert.equal(readUnsafeHtml(deterministicNonce), undefined);
const sampleCount = nonceFixture["distinctSamples"] as number;
const outputLength = nonceFixture["outputLength"] as number;
const liveNonces = new Set(Array.from({ length: sampleCount }, () => readCspNonce(createCspNonce())));
assert.equal(liveNonces.size, sampleCount);
assert.equal([...liveNonces].every((nonce) => new RegExp(`^[A-Za-z0-9_-]{${outputLength}}$`, "u").test(nonce ?? "")), true);

for (const fixture of corpus.redactionCases) {
  assert.equal(
    JSON.stringify(projectDiagnosticSource(fixture.source, {
      sensitiveFields: fixture.sensitiveFields,
      sensitiveValues: fixture.sensitiveValues,
    })),
    JSON.stringify(fixture.output),
    fixture.id,
  );
}

let getterCalls = 0;
const details: Record<string, unknown> = { safe: "visible", requestUrl: "https://example.test/path?secret=query" };
details["authorization"] = "Bearer credential";
details["configuredPrivate"] = "application secret";
details["error"] = new Error("message credential", { cause: { credential: true } });
details["self"] = details;
Object.defineProperty(details, "getter", { enumerable: true, get() { getterCalls += 1; throw new Error("getter ran"); } });
const source: Record<string, unknown> = { method: "POST", request: { url: "https://example.test/path?secret=query", headers: { cookie: "credential" }, body: "credential" }, details, error: new Error("credential") };
Object.defineProperty(source, "ignoredGetter", { enumerable: true, get() { getterCalls += 1; return "credential"; } });
const projection = projectDiagnosticSource(source, { sensitiveFields: ["configuredPrivate"] }) as Record<string, unknown>;
const projectedDetails = projection["details"] as Record<string, unknown>;
assert.deepEqual(projection["request"], { url: "https://example.test/path" });
assert.deepEqual(projection["error"], { type: "Error" });
assert.equal(projectedDetails["safe"], "visible");
assert.equal(projectedDetails["requestUrl"], "https://example.test/path");
assert.equal(projectedDetails["authorization"], "[REDACTED]");
assert.equal(projectedDetails["configuredPrivate"], "[REDACTED]");
assert.deepEqual(projectedDetails["error"], { type: "Error" });
assert.equal(projectedDetails["self"], "[CIRCULAR]");
assert.equal(projectedDetails["getter"], "[ACCESSOR OMITTED]");
assert.equal(getterCalls, 0);
assert.equal(JSON.stringify(projection).includes("credential"), false);

console.log("V1 rendering security passed (versioned sinks, exact encoders, URL floor, nonce capability, structured redaction)");
