export function toggle(control, panel) {
    const expanded = control.getAttribute("aria-expanded") === "true";
    control.setAttribute("aria-expanded", String(!expanded));
    panel.hidden = expanded;
}
const toggleBehavior = toggle;
const extractedHandler = (control, panel) => {
    toggleBehavior(control, panel);
};
const moduleState = globalThis;
moduleState.__fadenoExtractionModuleEvaluations =
    (moduleState.__fadenoExtractionModuleEvaluations ?? 0) + 1;
export const handlerIdentity = "cf5872fa652b195df6c4e2e43cae8b8609fd4512ef058c11f1cefd75dc32bedb";
export { extractedHandler as handler };
