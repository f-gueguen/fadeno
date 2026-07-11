import { step } from "/shared.js";
export const handlerBoundarySentinel = "fadeno-handler-only-sentinel";
export function increment(output) { output.value = String(Number(output.value) + step); }
