import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatM4129RuntimeCostStatus,
} from './coverage-status-m4-129.mjs';

test('M4.129 status records exact promotion-budget headroom', () => {
  const receipt = {
    observations: [{ outcome: 'failure' }, { outcome: 'success' }],
    optimization: {
      recordfieldExecutions: 0,
      typefieldTableProjectionExecutions: 1,
    },
    promotion: {
      nextMilestone: 'M4.130',
      promotionReady: true,
    },
    result: {
      exactFloor: 45_908,
      promotionBudgetHeadroom: 3_244,
    },
  };
  assert.equal(
    formatM4129RuntimeCostStatus(receipt),
    'M4.129 removes both assignment-target recordfield scans by reusing the authenticated ' +
      'type-field projection, reducing the exact floor to 45908 with 3244 promotion-budget ' +
      'headroom; M4.130 authenticates the combined KIR/profile promotion.',
  );
  const drifted = structuredClone(receipt);
  drifted.optimization.recordfieldExecutions = 1;
  assert.throws(
    () => formatM4129RuntimeCostStatus(drifted),
    /M4\.129 status requires/u,
  );
});
