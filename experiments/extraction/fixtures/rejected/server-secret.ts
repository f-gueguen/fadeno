import { secret } from "server-only:secrets";

export function reveal(output: HTMLElement): void {
  output.textContent = secret;
}
