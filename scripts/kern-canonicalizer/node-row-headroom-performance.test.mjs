import assert from 'node:assert/strict';
import test from 'node:test';

import { loadPublishedCanonicalizerNodeRowHeadroomM447 } from './node-row-headroom-m4-47.mjs';
import { loadCanonicalizerRuntimeCostM480 } from './runtime-cost-m4-80.mjs';

test('M4.47 preserves its exact published structural runtime evidence after M4.80', () => {
  const handoff = loadPublishedCanonicalizerNodeRowHeadroomM447();
  const current = loadCanonicalizerRuntimeCostM480();
  assert.equal(handoff.digest, '0da8ef5be1be0ea2ac12ef739bd6cc38070d60b7b3a775f45602857d40979af1');
  assert.equal(handoff.sourceCommit, '233e71a84fe7afdd7566e19a5545a885ffc36e8f');
  assert.equal(handoff.record.witnesses.length, 4);
  assert.equal(Math.max(...handoff.record.witnesses.map(({ exactFloor }) => exactFloor)), 15_236);
  assert.equal(handoff.record.witnesses.every(({ belowFloorOutcome }) => belowFloorOutcome === 'failure'), true);
  assert.equal(handoff.record.witnesses.every(({ floorOutcome, roundTrip }) =>
    floorOutcome === 'success' && roundTrip), true);
  assert.equal(current.result.exactFloor, 35_998);
});

test('M4.47 keeps module-envelope depth outside the structural headroom claim', () => {
  const { record } = loadPublishedCanonicalizerNodeRowHeadroomM447();
  assert.deepEqual(record.moduleEnvelope, {
    disposition: 'not-claimed',
    knownDepthBlocker: 'examples/selfhost-validator/validator.kern#3:isportable',
    maxDepth: 64,
    moduleCodecSha256: record.moduleEnvelope.moduleCodecSha256,
  });
});
