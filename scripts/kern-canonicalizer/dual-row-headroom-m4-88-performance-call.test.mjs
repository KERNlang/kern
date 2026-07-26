import test from 'node:test';

import { verifyCanonicalizerDualRowWitnessM488 } from './dual-row-headroom-m4-88-performance-fixture.mjs';

test('M4.88 preserves the historical callRejectCode floor after M4.89', () => {
  verifyCanonicalizerDualRowWitnessM488(1);
});
