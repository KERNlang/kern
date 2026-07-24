import assert from 'node:assert/strict';
import test from 'node:test';

import { loadPublishedCanonicalizerPropertyRowHeadroomM451 } from './property-row-headroom-m4-51.mjs';
import { loadCanonicalizerRuntimeCostM480 } from './runtime-cost-m4-80.mjs';

test('M4.51 preserves its exact published classcyclefrom runtime evidence after M4.80', () => {
  const handoff = loadPublishedCanonicalizerPropertyRowHeadroomM451();
  const current = loadCanonicalizerRuntimeCostM480();
  assert.equal(handoff.digest, 'c36711a885495d41b879bdcc364122f380dfde1a720a0985cdafbd78e067dfbe');
  assert.equal(handoff.sourceCommit, '2e363bab008fd2f03ef21fdc1bcb0a2488bd0637');
  assert.deepEqual(handoff.record.witnesses.map(({ exactFloor }) => exactFloor), [11_951]);
  assert.equal(handoff.record.witnesses[0].belowFloorOutcome, 'failure');
  assert.equal(handoff.record.witnesses[0].floorOutcome, 'success');
  assert.equal(handoff.record.witnesses[0].roundTrip, true);
  assert.equal(current.result.exactFloor, 35_998);
});

test('M4.51 keeps module-envelope admission outside the structural claim', () => {
  assert.deepEqual(loadPublishedCanonicalizerPropertyRowHeadroomM451().record.moduleEnvelope, {
    disposition: 'not-claimed',
    maxDepth: 64,
  });
});
