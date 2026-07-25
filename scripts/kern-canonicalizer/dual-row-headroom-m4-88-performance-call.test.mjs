import test from 'node:test';

import { verifyCanonicalizerDualRowWitnessM488 } from './dual-row-headroom-m4-88-performance-fixture.mjs';

test('M4.88 callRejectCode has its exact structural runtime floor', () => {
  verifyCanonicalizerDualRowWitnessM488(1);
});
