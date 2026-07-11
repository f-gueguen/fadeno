export function start(output: HTMLElement): void {
  setInterval(() => {
    output.textContent = new Date().toISOString();
  }, 1_000);
}
