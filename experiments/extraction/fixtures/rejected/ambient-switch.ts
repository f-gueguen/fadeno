const environment = typeof window === "undefined" ? "server" : "browser";

export function show(output: HTMLElement): void {
  output.textContent = environment;
}
