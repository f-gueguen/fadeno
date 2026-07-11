export function increment(output: HTMLOutputElement, step: number): void {
  output.value = String(Number(output.value) + step);
}
