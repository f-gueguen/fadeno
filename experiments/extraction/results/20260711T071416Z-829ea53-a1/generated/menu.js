export function toggleMenu(button, menu) {
    menu.hidden = !menu.hidden;
    button.setAttribute("aria-expanded", String(!menu.hidden));
}
const menuBehavior = toggleMenu;
const extractedHandler = (button, menu) => {
    menuBehavior(button, menu);
};
const moduleState = globalThis;
moduleState.__fadenoExtractionModuleEvaluations =
    (moduleState.__fadenoExtractionModuleEvaluations ?? 0) + 1;
export const handlerIdentity = "87028b1bcdbe3dd5ab3417f1a8e29a3c37a61bc1e6ff76132c2aaad76beee163";
export { extractedHandler as handler };
