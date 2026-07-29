import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatM4130CombinedPromotionStatus,
} from './coverage-status-m4-130.mjs';

test('M4.130 status records the exact combined promotion and queue', () => {
  const input = {
    kirLimits: { maxBytes: 273_051, maxDepth: 98, maxNodes: 5_313 },
    parameterMigration: {
      completeFunctions: 1,
      completeTools: 1,
      migratedParameterRows: 41,
    },
    profileLimits: {
      maxNodeRows: 202,
      maxPropertyRows: 308,
      maxValueRows: 4_493,
    },
    runtimeByteLimits: {
      maxBytes: 2_184_408,
      maxStringBytes: 1_092_204,
    },
  };
  assert.equal(
    formatM4130CombinedPromotionStatus(input),
    'M4.130 promotes combined KIR 273051/98/5313 and profile 202/308/4493 with exact ' +
      'derived runtime bytes 1092204/2184408, publishing the exact 1-function/41-row ' +
      'parameter queue across 1 tool; ' +
      'M4.131 consumes it.',
  );
  const drifted = structuredClone(input);
  drifted.parameterMigration.migratedParameterRows = 40;
  assert.throws(
    () => formatM4130CombinedPromotionStatus(drifted),
    /M4\.130 status requires/u,
  );
});
