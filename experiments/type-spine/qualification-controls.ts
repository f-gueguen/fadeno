import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { TypeSpineInput } from "./contract.ts";
import { generateTypeSpine } from "./generator.ts";

const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const typescriptRoot = dirname(require.resolve("typescript/package.json"));
const tsc = join(typescriptRoot, "bin/tsc");
const compilerArguments = [
  "--noEmit", "--strict", "--target", "ES2022", "--module", "ESNext",
  "--moduleResolution", "Bundler", "--allowImportingTsExtensions",
  "--skipLibCheck", "false", "--incremental", "false", "--pretty", "false",
] as const;

const diagnosticContract = {
  "invalid-route.ts": { code: 2322, line: 3, anchor: "p00" },
  "invalid-link.ts": { code: 2322, line: 3, anchor: "invalid" },
  "invalid-form.ts": { code: 2353, line: 3, anchor: "unknown" },
  "invalid-context.ts": { code: 2339, line: 4, anchor: "missing" },
} as const;

function runTsc(files: readonly string[]): { status: number; output: string } {
  const child = spawnSync(process.execPath, [tsc, ...compilerArguments, ...files], { encoding: "utf8" });
  if (child.error) throw child.error;
  return { status: child.status ?? 1, output: `${child.stdout}${child.stderr}` };
}

async function verifyLanguageServer(source: string, candidate: string): Promise<void> {
  const child = spawn(process.execPath, [tsc, "--lsp", "--stdio"], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const send = (message: Record<string, unknown>) => {
    const body = JSON.stringify(message);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
  const waitFor = (needle: string) => new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`FADENO_TYPE_SPINE_LANGUAGE_SERVER_TIMEOUT:${stdout}:${stderr}`)), 10_000);
    const poll = setInterval(() => {
      if (stdout.includes(needle)) {
        clearTimeout(deadline);
        clearInterval(poll);
        resolve();
      }
    }, 20);
  });
  const sourceUri = pathToFileURL(source).href;
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { processId: null, rootUri: pathToFileURL(dirname(dirname(source))).href, capabilities: {} } });
  await waitFor('"id":1');
  send({ jsonrpc: "2.0", method: "initialized", params: {} });
  await waitFor('"id":"ts1"');
  send({ jsonrpc: "2.0", id: "ts1", result: null });
  send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: sourceUri, languageId: "typescript", version: 1, text: readFileSync(source, "utf8") } } });
  send({ jsonrpc: "2.0", id: 2, method: "textDocument/hover", params: { textDocument: { uri: sourceUri }, position: { line: 4, character: 4 } } });
  send({ jsonrpc: "2.0", id: 3, method: "textDocument/definition", params: { textDocument: { uri: sourceUri }, position: { line: 4, character: 4 } } });
  await waitFor('"id":3');
  child.kill();
  if (!stdout.includes('"id":2') || !stdout.includes("RouteParameters") || !stdout.includes(pathToFileURL(candidate).href)) {
    throw new Error(`FADENO_TYPE_SPINE_LANGUAGE_SERVER_RESPONSE:${stdout}:${stderr}`);
  }
}

export async function verifyQualificationControls(input: TypeSpineInput): Promise<void> {
  const workspace = mkdtempSync(join(realpathSync(tmpdir()), "fadeno-type-spine-qualification-"));
  try {
    generateTypeSpine(input, workspace);
    cpSync(join(root, "qualification-fixtures"), join(workspace, "qualification-fixtures"), { recursive: true });
    const valid = join(workspace, "qualification-fixtures/valid.ts");
    const validRun = runTsc([valid]);
    if (validRun.status !== 0 || validRun.output !== "") throw new Error(`FADENO_TYPE_SPINE_VALID:${validRun.output}`);
    for (const [name, expected] of Object.entries(diagnosticContract)) {
      const source = join(workspace, "qualification-fixtures", name);
      const line = readFileSync(source, "utf8").split("\n")[expected.line - 1] ?? "";
      const column = line.indexOf(expected.anchor) + 1;
      const run = runTsc([source]);
      const diagnostics = run.output.trim().split("\n").filter((item) => /: error TS\d+:/u.test(item));
      if (run.status === 0 || column === 0 || diagnostics.length !== 1 || !diagnostics[0]?.includes(`(${expected.line},${column}): error TS${expected.code}:`)) {
        throw new Error(`FADENO_TYPE_SPINE_DIAGNOSTIC_${name}:${run.output}`);
      }
    }
    const candidate = join(workspace, "generated/candidate-types.ts");
    await verifyLanguageServer(valid, candidate);
    const digest = createHash("sha256").update(readFileSync(candidate)).digest("hex");
    console.log(`type-spine stock-tool controls passed (tsc + TypeScript 7 LSP, ${digest})`);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}
