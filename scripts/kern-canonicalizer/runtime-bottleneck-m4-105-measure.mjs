import {
  measureCanonicalizerRuntimeCostM4104,
} from './runtime-cost-m4-104-measure.mjs';

export function measureCanonicalizerRuntimeBottleneckM4105(iterationBudget) {
  if (!Number.isSafeInteger(iterationBudget) || iterationBudget <= 0) {
    throw new TypeError('M4.105 iteration budget must be a positive safe integer');
  }
  return measureCanonicalizerRuntimeCostM4104(iterationBudget);
}
