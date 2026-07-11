const capture = { "steps": [1, 2, -1, 3] };
export function increment(output, step) {
    output.value = String(Number(output.value) + step);
}
const counterBehavior = increment;
const extractedHandler = (output, ordinal) => {
    const step = capture.steps[(ordinal - 1) % capture.steps.length] ?? 0;
    counterBehavior(output, step);
};
const moduleState = globalThis;
moduleState.__fadenoExtractionModuleEvaluations =
    (moduleState.__fadenoExtractionModuleEvaluations ?? 0) + 1;
export const handlerIdentity = "99014513f0385340901228709d539c505a1cf2e839e1f7b6deff2021a3941613";
export { extractedHandler as handler };
