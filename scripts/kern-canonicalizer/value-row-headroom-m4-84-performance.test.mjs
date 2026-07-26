import assert from 'node:assert/strict';
import test from 'node:test';

import { loadCanonicalizerRuntimeCostM489 } from './runtime-cost-m4-89.mjs';
import { loadCanonicalizerValueRowHeadroomM484 } from './value-row-headroom-m4-84.mjs';

test('M4.84 preserves its historical argProvenanced floor after M4.89', () => {
  const historical = loadCanonicalizerValueRowHeadroomM484();
  const current = loadCanonicalizerRuntimeCostM489();
  const witness = historical.witnesses[0];
  assert.equal(witness.exactFloor, 38_773);
  assert.equal(witness.belowFloorOutcome, 'failure');
  assert.equal(witness.floorOutcome, 'success');
  assert.equal(witness.roundTrip, true);
  assert.equal(historical.source.canonicalizerCompositeSha256, current.source.m488PublishedCompositeSha256);
  assert.notEqual(historical.source.canonicalizerCompositeSha256, current.source.canonicalizerCompositeSha256);
  assert.equal(historical.limits.productionMaxCollectionLength, current.limits.productionMaxCollectionLength);
  assert.equal(historical.limits.promotionBudget, current.limits.promotionBudget);
});

test('M4.84 keeps module-envelope admission outside the structural claim', () => {
  const historical = loadCanonicalizerValueRowHeadroomM484();
  assert.deepEqual(historical.moduleEnvelope, { disposition: 'not-claimed', maxDepth: 64 });
  assert.equal(historical.witnesses.reduce((total, { parameterRows }) => total + parameterRows, 0), 19);
  assert.equal(historical.promotion.disposition, 'approved');
  assert.equal(historical.promotion.nextMilestone, 'M4.85');
});
