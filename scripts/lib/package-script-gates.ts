export function collectPackageScriptGates(
  scripts: Readonly<Record<string, string>>,
  root = "check",
): ReadonlySet<string> {
  return new Set(countPackageScriptGateExecutions(scripts, root).keys());
}

export function countPackageScriptGateExecutions(
  scripts: Readonly<Record<string, string>>,
  root = "check",
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();

  function visit(name: string, active: ReadonlySet<string>): void {
    if (active.has(name)) throw new Error(`package script cycle: ${[...active, name].join(" -> ")}`);
    const next = new Set(active).add(name);
    for (const command of (scripts[name] ?? "").split("&&")) {
      const gate = /^pnpm ([^ ]+)$/u.exec(command.trim())?.[1];
      if (!gate) continue;
      counts.set(gate, (counts.get(gate) ?? 0) + 1);
      visit(gate, next);
    }
  }

  visit(root, new Set());
  return counts;
}
