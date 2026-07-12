import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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

const temporaryRoot = mkdtempSync(join(tmpdir(), "fadeno-unsafe-instances-"));
try {
  const consumer = join(temporaryRoot, "consumer");
  const nodeModules = join(consumer, "node_modules");
  mkdirSync(nodeModules, { recursive: true });
  const packageRoot = fileURLToPath(new URL("../packages/framework/", import.meta.url));
  cpSync(packageRoot, join(nodeModules, "fadeno-first"), { recursive: true });
  cpSync(packageRoot, join(nodeModules, "fadeno-second"), { recursive: true });
  writeFileSync(join(consumer, "entry.mjs"), [
    'import assert from "node:assert/strict";',
    'import { unsafeHtml as firstUnsafeHtml } from "fadeno-first";',
    'import { unsafeHtml as secondUnsafeHtml } from "fadeno-second";',
    'import { readUnsafeHtml as firstRead } from "./node_modules/fadeno-first/dist/internal/unsafe-html.js";',
    'import { readUnsafeHtml as secondRead } from "./node_modules/fadeno-second/dist/internal/unsafe-html.js";',
    'const token = firstUnsafeHtml("<p>first</p>", { reason: "First installed package review" });',
    'assert.equal(typeof secondUnsafeHtml, "function");',
    'assert.equal(firstRead(token)?.html, "<p>first</p>");',
    'assert.equal(secondRead(token), undefined);',
  ].join("\n"));
  const result = spawnSync(process.execPath, ["entry.mjs"], { cwd: consumer, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

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
