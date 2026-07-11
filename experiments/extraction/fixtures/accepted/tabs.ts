export function selectTab(tab: HTMLElement, panels: readonly HTMLElement[]): void {
  const selected = tab.getAttribute("aria-controls");
  for (const panel of panels) panel.hidden = panel.id !== selected;
}
