import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { loadCanonicalizerPropertyRowHeadroomM479 } from './property-row-headroom-m4-79.mjs';
import { loadCanonicalizerRuntimeCostM480 } from './runtime-cost-m4-80.mjs';

const RECEIPT_URL = new URL('./runtime-cost-m4-80.json', import.meta.url);
const RECEIPT_DIGEST = '48465b28f951d5f74a1ea148d2c21a1f28d3dcb13c475ed5885d7c0512046b14';

export function assertCanonicalizerRuntimeCostM480() {
  assert.equal(
    createHash('sha256').update(readFileSync(RECEIPT_URL)).digest('hex'),
    RECEIPT_DIGEST,
    'M4.80 receipt bytes must remain exact',
  );
  const m479 = loadCanonicalizerPropertyRowHeadroomM479();
  assert.equal(
    createHash('sha256').update(`${JSON.stringify(m479, null, 2)}\n`).digest('hex'),
    'd8683f1440e8bb0f8496ab1845c83c7dabe73dbfd26114b78685d8c8e1cf830b',
  );
  const receipt = loadCanonicalizerRuntimeCostM480();
  assert.deepEqual(receipt.baseline, {
    exactFloor: 56_238,
    implementationBaseCommit: '990898fba53f88e71dce24e5e783d47b9c91b62c',
    m479ReceiptSha256: 'd8683f1440e8bb0f8496ab1845c83c7dabe73dbfd26114b78685d8c8e1cf830b',
    promotionBudgetDeficit: 7_086,
  });
  assert.deepEqual(receipt.limits, {
    activeProfile: { maxNodeRows: 38, maxPropertyRows: 53, maxValueRows: 461 },
    candidateProfile: { maxNodeRows: 38, maxPropertyRows: 61, maxValueRows: 461 },
    maxDepth: 64,
    productionMaxCollectionLength: 65_536,
    promotionBudget: 49_152,
  });
  assert.deepEqual(receipt.result, {
    belowFloorOutcome: 'failure',
    exactFloor: 35_998,
    floorOutcome: 'success',
    floorReduction: 20_240,
    productionHeadroom: 29_538,
    promotionHeadroom: 13_154,
    roundTrip: true,
  });
  assert.deepEqual(receipt.promotion, {
    disposition: 'headroom-authenticated',
    nextMilestone: 'M4.81',
  });
  assert.deepEqual(receipt.optimization, {
    exactValueTablePasses: 1,
    forbiddenWholeTableHelpers: ['recordfield', 'valuechildcount'],
    helper: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#16:typefields',
    owner: 'examples/kern-canonicalizer/canonicalizer.kern#0:typesource',
    strategy: 'merged-direct-child-field-scan',
  });
  assert.deepEqual(receipt.witness, {
    id: 'examples/capstone-checker-subset/checker-while.kern#16:checkWhileCore',
    parameterRows: 22,
    profileRows: { nodes: 38, properties: 61, values: 460 },
  });
  return receipt;
}
