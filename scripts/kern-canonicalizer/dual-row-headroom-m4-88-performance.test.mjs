import test from 'node:test';

import {
  verifyCanonicalizerDualRowPolicyM488,
  verifyCanonicalizerDualRowWitnessM488,
} from './dual-row-headroom-m4-88-performance-fixture.mjs';

test('M4.88 preserves the historical indexRejectDetail floor after M4.89', () => {
  verifyCanonicalizerDualRowWitnessM488(0);
});

test('M4.88 keeps diagnostic admission and module-envelope admission outside policy', () => {
  verifyCanonicalizerDualRowPolicyM488();
});
