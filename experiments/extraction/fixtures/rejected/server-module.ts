import { database } from "server-only:database";

export function query(output: HTMLElement): void {
  output.textContent = String(database.query("select 1"));
}
