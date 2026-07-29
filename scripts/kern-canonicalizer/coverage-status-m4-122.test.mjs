import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatM4122KirDepthHeadroomStatus,
} from './coverage-status-m4-122.mjs';

test('coverage status records the M4.122 depth-77 headroom GO', () => {
  const receipt = {
    limits: { candidateKir: { maxDepth: 77 } },
    promotion: { kirDepthPromotionApproved: true },
    summary: {
      maxExactFloor: 1_007,
      minimumPromotionHeadroom: 48_145,
      witnessCount: 1,
    },
  };
  assert.equal(
    formatM4122KirDepthHeadroomStatus(receipt),
    'M4.122 authenticates maxDepth 77 across 1 witness at exact floor 1007 with ' +
      '48145 promotion headroom; M4.123 promotes structural KIR depth.',
  );
  assert.throws(
    () => formatM4122KirDepthHeadroomStatus({
      ...receipt,
      promotion: { kirDepthPromotionApproved: false },
    }),
    /M4\.122/u,
  );
  assert.throws(
    () => formatM4122KirDepthHeadroomStatus({
      ...receipt,
      summary: {
        ...receipt.summary,
        maxExactFloor: undefined,
      },
    }),
    /M4\.122/u,
  );
  assert.throws(
    () => formatM4122KirDepthHeadroomStatus({
      ...receipt,
      summary: {
        ...receipt.summary,
        minimumPromotionHeadroom: Number.NaN,
      },
    }),
    /M4\.122/u,
  );
});
