const initial = Math.random();

export function show(output: HTMLElement): void {
  output.textContent = String(initial);
}
