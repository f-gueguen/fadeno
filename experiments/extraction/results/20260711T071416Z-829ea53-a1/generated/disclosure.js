export function disclosure(details) {
    details.open = !details.open;
}
const disclosureBehavior = disclosure;
const extractedHandler = (details) => {
    disclosureBehavior(details);
};
const moduleState = globalThis;
moduleState.__fadenoExtractionModuleEvaluations =
    (moduleState.__fadenoExtractionModuleEvaluations ?? 0) + 1;
export const handlerIdentity = "94581e65b8432be2650e2aa73ed3c84f14891864c002571f7e957b9736c9b755";
export { extractedHandler as handler };
