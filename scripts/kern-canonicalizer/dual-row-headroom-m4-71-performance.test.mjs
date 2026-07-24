import assert from 'node:assert/strict';
import test from 'node:test';

import { loadPublishedCanonicalizerDualRowHeadroomM471 } from './dual-row-headroom-m4-71.mjs';
import { loadCanonicalizerRuntimeCostM480 } from './runtime-cost-m4-80.mjs';

test('M4.71 preserves its exact published validstatementlist runtime evidence after M4.80', () => {
  const handoff = loadPublishedCanonicalizerDualRowHeadroomM471();
  const current = loadCanonicalizerRuntimeCostM480();
  assert.equal(handoff.digest, '8be340082e3a5de479b015d4f0f4248486286290ed981cbf5715538069638c12');
  assert.equal(handoff.sourceCommit, '75a927c4faf36d4c18530ff30b4f877fdc411628');
  assert.deepEqual(handoff.record.witnesses.map(({ exactFloor }) => exactFloor), [36_193]);
  assert.equal(handoff.record.witnesses[0].belowFloorOutcome, 'failure');
  assert.equal(handoff.record.witnesses[0].floorOutcome, 'success');
  assert.equal(handoff.record.witnesses[0].roundTrip, true);
  assert.equal(current.result.exactFloor, 35_998);
});

test('M4.71 keeps module-envelope admission outside the structural claim', () => {
  assert.deepEqual(loadPublishedCanonicalizerDualRowHeadroomM471().record.moduleEnvelope, {
    disposition: 'not-claimed',
    maxDepth: 64,
  });
});
