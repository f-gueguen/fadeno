const oversized = "x".repeat(65_537);

export function size(output: HTMLElement): void {
  output.textContent = String(oversized.length);
}
