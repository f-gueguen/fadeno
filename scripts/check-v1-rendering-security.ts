import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  createCspNonce,
  encodeBoolean,
  encodeEnumerated,
  encodeText,
  encodeUrl,
  readCspNonce,
  redactStructured,
  renderingSecurityRegistry,
  type TextContext,
  type UrlSink,
} from "../packages/framework/dist/internal/rendering-security.js";

interface TextCase { readonly id: string; readonly context: TextContext; readonly input: string; readonly output: string }
interface UrlCase { readonly id: string; readonly sink: UrlSink; readonly input: string; readonly output: string }
interface UrlRefusal { readonly id: string; readonly sink: UrlSink; readonly input: string; readonly error: string }
interface Corpus {
  readonly schemaVersion: number;
  readonly policyVersion: number;
  readonly futureConsumer: string;
  readonly textCases: readonly TextCase[];
  readonly urlCases: readonly UrlCase[];
  readonly urlRefusals: readonly UrlRefusal[];
  readonly refusedContexts: readonly string[];
  readonly browserOutcomes: readonly { readonly phase: string }[];
}

const corpusPath = fileURLToPath(new URL("../packages/framework/contracts/rendering-security-v1.corpus.json", import.meta.url));
const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as Corpus;
assert.equal(corpus.schemaVersion, 1);
assert.equal(corpus.policyVersion, renderingSecurityRegistry.schemaVersion);
assert.equal(corpus.futureConsumer, "V1-09 renderer and browser conformance");
assert.equal(corpus.browserOutcomes.every((outcome) => outcome.phase === "V1-09"), true);
assert.deepEqual(corpus.refusedContexts, renderingSecurityRegistry.refusedContexts);

for (const fixture of corpus.textCases) {
  assert.equal(encodeText(fixture.input, fixture.context), fixture.output, fixture.id);
}
for (const fixture of corpus.urlCases) {
  assert.equal(encodeUrl(fixture.input, fixture.sink), fixture.output, fixture.id);
}
for (const fixture of corpus.urlRefusals) {
  assert.throws(() => encodeUrl(fixture.input, fixture.sink), { message: fixture.error }, fixture.id);
}

assert.equal(encodeBoolean("disabled", true), "disabled");
assert.equal(encodeBoolean("disabled", false), "");
assert.throws(() => encodeBoolean("disabled", "true" as unknown as boolean), { message: "FADENO_RENDER_BOOLEAN_VALUE" });
for (const [attribute, tokens] of Object.entries(renderingSecurityRegistry.enumeratedAttributes)) {
  for (const token of tokens) assert.equal(encodeEnumerated(token, tokens), token, `${attribute}:${token}`);
  assert.throws(() => encodeEnumerated("TRUE", tokens), { message: "FADENO_RENDER_ENUMERATED_VALUE" });
}

const deterministicNonce = createCspNonce((bytes) => bytes.forEach((_, index) => { bytes[index] = index; }));
assert.equal(readCspNonce(deterministicNonce), "AAECAwQFBgcICQoLDA0ODw");
assert.equal(Object.isFrozen(deterministicNonce), true);
assert.equal(Object.getPrototypeOf(deterministicNonce), null);
assert.equal(readCspNonce({ ...deterministicNonce }), undefined);
assert.equal(readCspNonce(structuredClone(deterministicNonce)), undefined);
const liveNonces = new Set(Array.from({ length: 64 }, () => readCspNonce(createCspNonce())));
assert.equal(liveNonces.size, 64);
assert.equal([...liveNonces].every((nonce) => /^[A-Za-z0-9_-]{22}$/u.test(nonce ?? "")), true);

let getterCalls = 0;
const circular: Record<string, unknown> = { safe: "visible", url: "https://example.test/path?secret=query#fragment" };
circular["authorization"] = "Bearer credential";
circular["cookie"] = "session=credential";
circular["body"] = "sensitive form value";
circular["configuredPrivate"] = "application secret";
circular["error"] = new Error("message credential", { cause: { credential: true } });
circular["self"] = circular;
Object.defineProperty(circular, "getter", { enumerable: true, get() { getterCalls += 1; throw new Error("getter ran"); } });
const projection = redactStructured(circular, { sensitiveFields: ["configuredPrivate"] }) as Record<string, unknown>;
assert.equal(projection["safe"], "visible");
assert.equal(projection["url"], "https://example.test/path");
assert.equal(projection["authorization"], "[REDACTED]");
assert.equal(projection["cookie"], "[REDACTED]");
assert.equal(projection["body"], "[REDACTED]");
assert.equal(projection["configuredPrivate"], "[REDACTED]");
assert.deepEqual(projection["error"], { type: "Error" });
assert.equal(projection["self"], "[CIRCULAR]");
assert.equal(projection["getter"], "[ACCESSOR OMITTED]");
assert.equal(getterCalls, 0);
assert.equal(JSON.stringify(projection).includes("credential"), false);

console.log("V1 rendering security passed (versioned sinks, exact encoders, URL floor, nonce capability, structured redaction)");
