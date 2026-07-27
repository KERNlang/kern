import { measureCanonicalizerRuntimeBottleneckM496 } from './runtime-bottleneck-m4-96-measure.mjs';

export function measureCanonicalizerRuntimeCostM497(
  iterationBudget,
  options = {},
) {
  return measureCanonicalizerRuntimeBottleneckM496(iterationBudget, options);
}

const budget = Number(process.argv[2]);
if (Number.isSafeInteger(budget) && budget > 0) {
  process.stdout.write(`${JSON.stringify(measureCanonicalizerRuntimeCostM497(budget), null, 2)}\n`);
}
