import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { loadCanonicalizerPropertyRowHeadroomM479 } from './property-row-headroom-m4-79.mjs';
import { loadCanonicalizerRuntimeCostM480 } from './runtime-cost-m4-80.mjs';

test('M4.79 preserves the exact published structural runtime NO-GO', () => {
  const receipt = loadCanonicalizerPropertyRowHeadroomM479();
  assert.equal(
    createHash('sha256').update(`${JSON.stringify(receipt, null, 2)}\n`).digest('hex'),
    'd8683f1440e8bb0f8496ab1845c83c7dabe73dbfd26114b78685d8c8e1cf830b',
  );
  assert.deepEqual(receipt.witnesses, [{
    belowFloorOutcome: 'failure',
    exactFloor: 56_238,
    floorOutcome: 'success',
    id: 'examples/capstone-checker-subset/checker-while.kern#16:checkWhileCore',
    parameterRows: 22,
    productionHeadroom: 9_298,
    profileRows: { nodes: 38, properties: 61, values: 460 },
    promotionBudgetDeficit: 7_086,
    roundTrip: true,
  }]);
  assert.equal(receipt.promotion.disposition, 'rejected-over-budget');
  assert.equal(receipt.promotion.nextMilestone, 'M4.80');
});

test('M4.80 consumes the exact M4.79 deficit without rewriting history', () => {
  const m479 = loadCanonicalizerPropertyRowHeadroomM479();
  const m480 = loadCanonicalizerRuntimeCostM480();
  assert.equal(m480.baseline.exactFloor, m479.witnesses[0].exactFloor);
  assert.equal(m480.baseline.promotionBudgetDeficit, m479.summary.promotionBudgetDeficit);
  assert.equal(m480.result.floorReduction, 20_240);
  assert.equal(m480.result.exactFloor, 35_998);
  assert.equal(m480.result.promotionHeadroom, 13_154);
});
