import assert from 'node:assert/strict';
import test from 'node:test';

import { loadPublishedCanonicalizerDualRowHeadroomM455 } from './dual-row-headroom-m4-55.mjs';
import { loadCanonicalizerRuntimeCostM480 } from './runtime-cost-m4-80.mjs';

test('M4.55 preserves its exact published structural runtime evidence after M4.80', () => {
  const handoff = loadPublishedCanonicalizerDualRowHeadroomM455();
  const current = loadCanonicalizerRuntimeCostM480();
  assert.equal(handoff.digest, '10e36abdda5e7de48c65689f9d2a318a6095497bdd3cff81aa64e3ab4e6e535b');
  assert.equal(handoff.sourceCommit, '56a45251663840d2d8ab60a8c8ee84ae5b29975b');
  assert.equal(handoff.record.witnesses.length, 7);
  assert.equal(Math.max(...handoff.record.witnesses.map(({ exactFloor }) => exactFloor)), 26_356);
  assert.equal(handoff.record.witnesses.reduce((sum, { parameterRows }) => sum + parameterRows, 0), 102);
  assert.equal(handoff.record.witnesses.every(({ belowFloorOutcome }) => belowFloorOutcome === 'failure'), true);
  assert.equal(handoff.record.witnesses.every(({ floorOutcome, roundTrip }) =>
    floorOutcome === 'success' && roundTrip), true);
  assert.equal(current.result.exactFloor, 35_998);
});

test('M4.55 keeps module-envelope admission outside the structural claim', () => {
  assert.deepEqual(loadPublishedCanonicalizerDualRowHeadroomM455().record.moduleEnvelope, {
    disposition: 'not-claimed',
    maxDepth: 64,
  });
});
