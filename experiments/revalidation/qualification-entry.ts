import { executeQualificationMeasurements } from "./qualification-runner.ts";

const measurements = await executeQualificationMeasurements();
process.stdout.write(`FADENO_H4_MEASUREMENTS=${JSON.stringify(measurements)}\n`);
