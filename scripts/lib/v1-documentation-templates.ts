import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

interface IncludeDirective {
  readonly path: string;
  readonly language: string;
}

const includePattern = /^<!-- fadeno:include (\{.*\}) -->$/gmu;

function directive(value: string): IncludeDirective {
  const parsed = JSON.parse(value) as unknown;
  if (
    typeof parsed !== "object"
    || parsed === null
    || Array.isArray(parsed)
    || typeof (parsed as Record<string, unknown>).path !== "string"
    || typeof (parsed as Record<string, unknown>).language !== "string"
  ) {
    throw new Error("invalid Fadeno documentation include directive");
  }
  const result = parsed as unknown as IncludeDirective;
  if (!/^[a-z0-9+-]+$/u.test(result.language)) throw new Error(`invalid documentation fence language: ${result.language}`);
  return result;
}

export function renderV1DocumentationTemplate(
  template: string,
  repositoryRoot: string,
  authorizedPaths: ReadonlySet<string>,
): string {
  let count = 0;
  const rendered = template.replace(includePattern, (_match, value: string) => {
    count += 1;
    const include = directive(value);
    if (!authorizedPaths.has(include.path)) throw new Error(`documentation include is not authorized: ${include.path}`);
    const target = resolve(repositoryRoot, include.path);
    if (!target.startsWith(`${repositoryRoot}${sep}`)) throw new Error(`documentation include escapes repository: ${include.path}`);
    const content = readFileSync(target, "utf8").replaceAll("\r\n", "\n").trimEnd();
    if (content.includes("```")) throw new Error(`documentation include contains a fence: ${include.path}`);
    return `\`\`\`${include.language}\n${content}\n\`\`\``;
  });
  if (count === 0) throw new Error("V1 documentation template has no authorized include");
  if (rendered.includes("<!-- fadeno:include")) throw new Error("V1 documentation template has a malformed include");
  return rendered.replaceAll("\r\n", "\n").trimEnd() + "\n";
}
