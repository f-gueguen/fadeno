const cyclic: { self?: unknown } = {};
cyclic.self = cyclic;

export function inspect(output: HTMLElement): void {
  output.textContent = JSON.stringify(cyclic);
}
