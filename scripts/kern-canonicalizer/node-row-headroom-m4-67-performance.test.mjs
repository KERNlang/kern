import assert from 'node:assert/strict';
import test from 'node:test';

import { loadPublishedCanonicalizerNodeRowHeadroomM467 } from './node-row-headroom-m4-67.mjs';
import { loadCanonicalizerRuntimeCostM480 } from './runtime-cost-m4-80.mjs';

test('M4.67 preserves its exact published isSurfaceKind runtime evidence after M4.80', () => {
  const handoff = loadPublishedCanonicalizerNodeRowHeadroomM467();
  const current = loadCanonicalizerRuntimeCostM480();
  assert.equal(handoff.digest, '61e2c3b388160035d5764efcc2037c408eca8fc30f12010430168dd2b3bf9bca');
  assert.equal(handoff.sourceCommit, '40b6961bbd41f3b60e346ef3246d6587c0c3a1f4');
  assert.deepEqual(handoff.record.witnesses.map(({ exactFloor }) => exactFloor), [17_552]);
  assert.equal(handoff.record.witnesses[0].belowFloorOutcome, 'failure');
  assert.equal(handoff.record.witnesses[0].floorOutcome, 'success');
  assert.equal(handoff.record.witnesses[0].roundTrip, true);
  assert.equal(current.result.exactFloor, 35_998);
});

test('M4.67 keeps module-envelope admission outside the structural claim', () => {
  assert.deepEqual(loadPublishedCanonicalizerNodeRowHeadroomM467().record.moduleEnvelope, {
    disposition: 'not-claimed',
    maxDepth: 64,
  });
});
