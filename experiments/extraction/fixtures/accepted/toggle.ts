export function toggle(control: HTMLButtonElement, panel: HTMLElement): void {
  const expanded = control.getAttribute("aria-expanded") === "true";
  control.setAttribute("aria-expanded", String(!expanded));
  panel.hidden = expanded;
}
