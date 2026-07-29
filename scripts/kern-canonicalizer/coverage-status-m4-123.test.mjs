import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatM4123KirDepthPromotionStatus,
} from './coverage-status-m4-123.mjs';

const handoff = {
  kirLimits: { maxBytes: 262_144, maxDepth: 77, maxNodes: 4_096 },
  parameterMigration: {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 5,
  },
};

test('coverage status records the M4.123 structural KIR depth promotion', () => {
  assert.equal(
    formatM4123KirDepthPromotionStatus(handoff),
    'M4.123 promotes structural KIR maxDepth to 77 and publishes the exact ' +
      '1-function/5-row parameter queue across 1 tool; M4.124 consumes it.',
  );
  for (const mutate of [
    (copy) => { copy.kirLimits.maxDepth = 76; },
    (copy) => { copy.parameterMigration.completeFunctions = 0; },
    (copy) => { copy.parameterMigration.completeTools = 2; },
    (copy) => { copy.parameterMigration.migratedParameterRows = 4; },
  ]) {
    const copy = structuredClone(handoff);
    mutate(copy);
    assert.throws(
      () => formatM4123KirDepthPromotionStatus(copy),
      /M4\.123/u,
    );
  }
});
