import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatM4146CombinedPromotionStatus,
} from './coverage-status-m4-146.mjs';

test('M4.146 status records the exact combined promotion and queue', () => {
  const input = {
    kirLimits: { maxBytes: 367_368, maxDepth: 122, maxNodes: 7_136 },
    parameterMigration: {
      completeFunctions: 1,
      completeTools: 1,
      migratedParameterRows: 6,
      witnesses: [{
        id: 'examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources',
        parameterRows: 6,
        profileRows: { nodes: 205, properties: 332, values: 6_304 },
        tool: 'canonicalizer',
      }],
    },
    profileLimits: {
      maxNodeRows: 205,
      maxPropertyRows: 332,
      maxValueRows: 6_304,
    },
    runtimeByteLimits: {
      maxBytes: 2_938_944,
      maxStringBytes: 1_469_472,
    },
  };
  assert.equal(
    formatM4146CombinedPromotionStatus(input),
    'M4.146 promotes combined KIR 367368/122/7136 and profile 205/332/6304 with ' +
      'exact derived runtime bytes 1469472/2938944, publishing the exact ' +
      '1-function/6-row expressionsources parameter queue across 1 tool; M4.147 ' +
      'consumes it.',
  );
  for (const mutate of [
    (copy) => { copy.kirLimits.maxBytes -= 1; },
    (copy) => { copy.profileLimits.maxValueRows -= 1; },
    (copy) => { copy.runtimeByteLimits.maxBytes -= 1; },
    (copy) => { copy.parameterMigration.migratedParameterRows -= 1; },
    (copy) => { copy.parameterMigration.witnesses[0].id = 'substituted'; },
  ]) {
    const drifted = structuredClone(input);
    mutate(drifted);
    assert.throws(
      () => formatM4146CombinedPromotionStatus(drifted),
      /M4\.146 status requires/u,
    );
  }
});

