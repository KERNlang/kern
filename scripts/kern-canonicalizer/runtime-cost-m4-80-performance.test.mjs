import assert from 'node:assert/strict';
import test from 'node:test';

import { loadCanonicalizerRuntimeCostM480 } from './runtime-cost-m4-80.mjs';
import { loadCanonicalizerRuntimeCostM489 } from './runtime-cost-m4-89.mjs';

test('M4.80 preserves its historical checkWhileCore floor after M4.89', () => {
  const historical = loadCanonicalizerRuntimeCostM480();
  const current = loadCanonicalizerRuntimeCostM489();
  assert.equal(historical.result.exactFloor, 35_998);
  assert.equal(historical.result.belowFloorOutcome, 'failure');
  assert.equal(historical.result.floorOutcome, 'success');
  assert.equal(historical.result.roundTrip, true);
  assert.equal(historical.source.canonicalizerCompositeSha256, current.source.m488PublishedCompositeSha256);
  assert.notEqual(historical.source.canonicalizerCompositeSha256, current.source.canonicalizerCompositeSha256);
  assert.equal(historical.limits.productionMaxCollectionLength, current.limits.productionMaxCollectionLength);
  assert.equal(historical.limits.promotionBudget, current.limits.promotionBudget);
});

test('M4.85 preserves M4.80 policy headroom after later authenticated promotions', () => {
  const historical = loadCanonicalizerRuntimeCostM480();
  const current = loadCanonicalizerRuntimeCostM489();
  assert.deepEqual(historical.limits.activeProfile, {
    maxNodeRows: 38,
    maxPropertyRows: 53,
    maxValueRows: 461,
  });
  assert.deepEqual(historical.limits.candidateProfile, {
    maxNodeRows: 38,
    maxPropertyRows: 61,
    maxValueRows: 461,
  });
  assert.deepEqual(current.limits.activeProfile, {
    maxNodeRows: 38,
    maxPropertyRows: 61,
    maxValueRows: 580,
  });
  assert.equal(historical.promotion.disposition, 'headroom-authenticated');
  assert.equal(historical.promotion.nextMilestone, 'M4.81');
  assert.equal(historical.limits.maxDepth, 64);
});
