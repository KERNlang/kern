import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  measureCanonicalizerRuntimeBottleneckM4116,
} from './runtime-bottleneck-m4-116-measure.mjs';

export function measureCanonicalizerRuntimeCostM4117(iterationBudget) {
  if (!Number.isSafeInteger(iterationBudget) || iterationBudget <= 0) {
    throw new TypeError('M4.117 iteration budget must be a positive safe integer');
  }
  return measureCanonicalizerRuntimeBottleneckM4116(iterationBudget);
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const budget = Number(process.argv[2]);
  if (Number.isSafeInteger(budget) && budget > 0) {
    process.stdout.write(
      `${JSON.stringify(measureCanonicalizerRuntimeCostM4117(budget), null, 2)}\n`,
    );
  }
}
