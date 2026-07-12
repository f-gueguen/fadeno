import assert from "node:assert/strict";

import { unsafeHtml } from "../packages/framework/dist/index.js";
import { readUnsafeHtml } from "../packages/framework/dist/internal/unsafe-html.js";

const reason = "Reviewed static article markup";
const token = unsafeHtml("<article>trusted</article>", { reason });
assert.deepEqual(readUnsafeHtml(token), { html: "<article>trusted</article>", reason });
assert.equal(Object.isFrozen(token), true);
assert.equal(Object.getPrototypeOf(token), null);
assert.deepEqual(Reflect.ownKeys(token), []);
assert.equal(JSON.stringify(token), "{}");
assert.equal(readUnsafeHtml(JSON.parse(JSON.stringify(token))), undefined);
assert.equal(readUnsafeHtml(structuredClone(token)), undefined);
assert.equal(readUnsafeHtml({ ...token }), undefined);
assert.equal(readUnsafeHtml(Object.assign(Object.create(null), token)), undefined);
assert.equal(readUnsafeHtml(new Proxy(token, {})), undefined);
assert.equal(readUnsafeHtml("<article>trusted</article>"), undefined);

const moduleUrl = new URL("../packages/framework/dist/internal/unsafe-html.js", import.meta.url);
const first = await import(`${moduleUrl.href}?instance=first`);
const second = await import(`${moduleUrl.href}?instance=second`);
const otherToken = first.createUnsafeHtml("<p>first</p>", "First package instance review");
assert.equal(first.readUnsafeHtml(otherToken)?.html, "<p>first</p>");
assert.equal(second.readUnsafeHtml(otherToken), undefined);
assert.equal(readUnsafeHtml(otherToken), undefined);

for (const invalidReason of ["", "   ", "control\ncharacter", "x".repeat(241)]) {
  assert.throws(() => unsafeHtml("<p>content</p>", { reason: invalidReason }), {
    name: "TypeError",
    message: "FADENO_UNSAFE_HTML_REASON",
  });
}

assert.throws(
  () => unsafeHtml("<p>content</p>", { reason: 1 as unknown as string }),
  { name: "TypeError", message: "FADENO_UNSAFE_HTML_ARGUMENT" },
);

console.log("V1 unsafe HTML capability passed (opaque type, explicit reason, same-instance runtime authority)");
