export function toggleMenu(button: HTMLButtonElement, menu: HTMLElement): void {
  menu.hidden = !menu.hidden;
  button.setAttribute("aria-expanded", String(!menu.hidden));
}
