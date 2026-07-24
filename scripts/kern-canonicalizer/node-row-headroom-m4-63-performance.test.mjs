import assert from 'node:assert/strict';
import test from 'node:test';

import { loadPublishedCanonicalizerNodeRowHeadroomM463 } from './node-row-headroom-m4-63.mjs';
import { loadCanonicalizerRuntimeCostM480 } from './runtime-cost-m4-80.mjs';

test('M4.63 preserves its exact published structural runtime evidence after M4.80', () => {
  const handoff = loadPublishedCanonicalizerNodeRowHeadroomM463();
  const current = loadCanonicalizerRuntimeCostM480();
  assert.equal(handoff.digest, '110260eb3a2c9ed942e309d5b6e1331f2752bc486bfe99840c887e2a6ef7e7c3');
  assert.equal(handoff.sourceCommit, '6aba5e056c833e7dd2e613a21ac52e3f718d9673');
  assert.equal(handoff.record.witnesses.length, 4);
  assert.equal(Math.max(...handoff.record.witnesses.map(({ exactFloor }) => exactFloor)), 27_076);
  assert.equal(handoff.record.witnesses.reduce((sum, { parameterRows }) => sum + parameterRows, 0), 37);
  assert.equal(handoff.record.witnesses.every(({ belowFloorOutcome }) => belowFloorOutcome === 'failure'), true);
  assert.equal(handoff.record.witnesses.every(({ floorOutcome, roundTrip }) =>
    floorOutcome === 'success' && roundTrip), true);
  assert.equal(current.result.exactFloor, 35_998);
});

test('M4.63 keeps module-envelope admission outside the structural claim', () => {
  assert.deepEqual(loadPublishedCanonicalizerNodeRowHeadroomM463().record.moduleEnvelope, {
    disposition: 'not-claimed',
    maxDepth: 64,
  });
});
