export function selectTab(tab, panels) {
    const selected = tab.getAttribute("aria-controls");
    for (const panel of panels)
        panel.hidden = panel.id !== selected;
}
const tabsBehavior = selectTab;
const extractedHandler = (tab, panels) => {
    tabsBehavior(tab, panels);
};
const moduleState = globalThis;
moduleState.__fadenoExtractionModuleEvaluations =
    (moduleState.__fadenoExtractionModuleEvaluations ?? 0) + 1;
export const handlerIdentity = "6a310e79af506c6a67b13aa63c1306309b8bf8215d855a9cc4c8d673ff1592df";
export { extractedHandler as handler };
