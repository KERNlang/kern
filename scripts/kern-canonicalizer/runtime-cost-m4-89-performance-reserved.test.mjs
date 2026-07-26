import test from 'node:test';

import { verifyCanonicalizerRuntimeCostWitnessM489 } from './runtime-cost-m4-89-performance-fixture.mjs';

test('M4.93 gives isreserved headroom below its historical M4.89 floor', () => {
  verifyCanonicalizerRuntimeCostWitnessM489(2);
});
