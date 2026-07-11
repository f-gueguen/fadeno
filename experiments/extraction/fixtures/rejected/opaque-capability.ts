const controller = new AbortController();

export function abort(): void {
  controller.abort();
}
