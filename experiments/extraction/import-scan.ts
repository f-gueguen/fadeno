import { createScanner, SyntaxKind } from "typescript/unstable/ast";

export type ScannedImport = Readonly<{
  kind: "static" | "dynamic";
  specifier: string;
  range: Readonly<{ line: number; column: number; length: number }>;
}>;

type Token = Readonly<{ kind: SyntaxKind; value: string; start: number; end: number }>;

export function scanImports(source: string): ScannedImport[] {
  const scanner = createScanner(true, undefined, source);
  const tokens: Token[] = [];
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    tokens.push({
      kind,
      value: scanner.getTokenValue(),
      start: scanner.getTokenStart(),
      end: scanner.getTokenEnd(),
    });
  }

  const imports: ScannedImport[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.kind !== SyntaxKind.ImportKeyword) continue;
    const next = tokens[index + 1];
    if (!next || next.kind === SyntaxKind.DotToken) continue;
    let kind: ScannedImport["kind"] = "static";
    let specifier: Token | undefined = next;
    if (next.kind === SyntaxKind.OpenParenToken) {
      kind = "dynamic";
      specifier = tokens[index + 2];
    } else if (next.kind !== SyntaxKind.StringLiteral) {
      specifier = tokens.slice(index + 1).find((token) =>
        token.kind === SyntaxKind.StringLiteral ||
        token.kind === SyntaxKind.SemicolonToken
      );
    }
    if (!specifier || specifier.kind !== SyntaxKind.StringLiteral) continue;
    const before = source.slice(0, specifier.start);
    const lineStart = before.lastIndexOf("\n") + 1;
    imports.push({
      kind,
      specifier: specifier.value,
      range: {
        line: before.split("\n").length,
        column: specifier.start - lineStart + 1,
        length: specifier.end - specifier.start,
      },
    });
  }
  return imports;
}
