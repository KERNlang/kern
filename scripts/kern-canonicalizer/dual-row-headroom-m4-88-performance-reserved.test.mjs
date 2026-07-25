import test from 'node:test';

import { verifyCanonicalizerDualRowWitnessM488 } from './dual-row-headroom-m4-88-performance-fixture.mjs';

test('M4.88 isreserved has its exact structural runtime floor and production-ceiling failure', () => {
  verifyCanonicalizerDualRowWitnessM488(2);
});
