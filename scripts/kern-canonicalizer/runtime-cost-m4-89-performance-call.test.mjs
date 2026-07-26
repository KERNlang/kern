import test from 'node:test';

import { verifyCanonicalizerRuntimeCostWitnessM489 } from './runtime-cost-m4-89-performance-fixture.mjs';

test('M4.89 callRejectCode has its exact optimized runtime floor', () => {
  verifyCanonicalizerRuntimeCostWitnessM489(1);
});
