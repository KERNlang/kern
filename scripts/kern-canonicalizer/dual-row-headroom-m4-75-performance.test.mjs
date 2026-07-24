import assert from 'node:assert/strict';
import test from 'node:test';

import { loadPublishedCanonicalizerDualRowHeadroomM475 } from './dual-row-headroom-m4-75.mjs';
import { loadCanonicalizerRuntimeCostM480 } from './runtime-cost-m4-80.mjs';

test('M4.75 preserves the exact published typesource structural floor', () => {
  const handoff = loadPublishedCanonicalizerDualRowHeadroomM475();
  assert.equal(handoff.digest, 'c70022af6c90620c9ade8c03cff85eba41c53966f515b5523bd774985cb877f6');
  assert.equal(handoff.sourceCommit, '177212fc4cc1ba0c15f04e1092657b4d335067e9');
  assert.deepEqual(handoff.record.witnesses, [{
    belowFloorOutcome: 'failure',
    exactFloor: 46_255,
    floorOutcome: 'success',
    id: 'examples/kern-canonicalizer/canonicalizer.kern#0:typesource',
    parameterRows: 6,
    productionHeadroom: 19_281,
    profileRows: { nodes: 38, properties: 51, values: 461 },
    promotionHeadroom: 2_897,
    roundTrip: true,
  }]);
});

test('M4.80 keeps M4.75 historical evidence separate from current optimization', () => {
  const m480 = loadCanonicalizerRuntimeCostM480();
  assert.equal(m480.optimization.owner, 'examples/kern-canonicalizer/canonicalizer.kern#0:typesource');
  assert.deepEqual(m480.limits.activeProfile, {
    maxNodeRows: 38,
    maxPropertyRows: 53,
    maxValueRows: 461,
  });
  assert.equal(m480.promotion.nextMilestone, 'M4.81');
});
