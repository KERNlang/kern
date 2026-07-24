import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { loadPublishedCanonicalizerResidualAnalysisM483 } from './coverage-residual-analysis-m4-83.mjs';
import { loadCanonicalizerValueRowHeadroomM484 } from './value-row-headroom-m4-84.mjs';

const RECEIPT_URL = new URL('./value-row-headroom-m4-84.json', import.meta.url);
const RECEIPT_DIGEST = '4b92ced7a43f4aa938a9fe303edcd5fb17b423a61d99b9a8c476ccdc653b8065';

export function assertCanonicalizerValueRowHeadroomM484() {
  assert.equal(
    createHash('sha256').update(readFileSync(RECEIPT_URL)).digest('hex'),
    RECEIPT_DIGEST,
    'M4.84 receipt bytes must remain exact',
  );
  const analysis = loadPublishedCanonicalizerResidualAnalysisM483();
  assert.equal(analysis.digest, '42815f7d4bd02daa625718deb8b8ae04590efb605dccc69ffc90b3a4bdcbf546');
  assert.equal(analysis.inputCommit, '89083ba126201067c918ea7e130382ca171f4097');
  assert.deepEqual(analysis.record.selectedNextAction, {
    changedLimits: ['maxValueRows'],
    completeFunctions: 1,
    completeTools: 1,
    limits: { maxNodeRows: 38, maxPropertyRows: 61, maxValueRows: 580 },
    totalDelta: 119,
    witnesses: ['examples/capstone-checker-subset/checker.kern#16:argProvenanced'],
  });

  const receipt = loadCanonicalizerValueRowHeadroomM484();
  assert.equal(receipt.format, 'kern.kir-canonicalizer.value-row-headroom.1');
  assert.deepEqual(receipt.limits, {
    candidateProfile: { maxNodeRows: 38, maxPropertyRows: 61, maxValueRows: 580 },
    productionMaxCollectionLength: 65_536,
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
  });
  assert.deepEqual(receipt.promotion, { disposition: 'approved', nextMilestone: 'M4.85' });
  assert.deepEqual(receipt.summary, {
    maxExactFloor: 38_773,
    minimumProductionHeadroom: 26_763,
    minimumPromotionHeadroom: 10_379,
    witnessCount: 1,
  });
  assert.deepEqual(receipt.witnesses, [{
    belowFloorOutcome: 'failure',
    exactFloor: 38_773,
    floorOutcome: 'success',
    id: 'examples/capstone-checker-subset/checker.kern#16:argProvenanced',
    parameterRows: 19,
    productionHeadroom: 26_763,
    profileRows: { nodes: 35, properties: 55, values: 580 },
    promotionHeadroom: 10_379,
    roundTrip: true,
  }]);
  assert.deepEqual(receipt.moduleEnvelope, { disposition: 'not-claimed', maxDepth: 64 });
  assert.deepEqual(receipt.source, {
    canonicalizerCompositeSha256: 'fe5087dfcb79898a4b5d46cd233a2bbbeea156417f18ac314e87330172e31b28',
    canonicalizerPolicySha256: '6506df16bb042ae3c5544fce3324c500e2401192983fc98ae492d2283ff21495',
    compositionSha256: '894cf14bc391d3109a20fb6abef8d1c98cab426e2ed6d238d414c8aee46cff3b',
    inputSourceSha256: [{
      path: 'examples/capstone-checker-subset/checker.kern',
      sha256: 'a703952e717a77015179987a4e5a6940b0b16846a9c122810e959a595eee5017',
    }],
    publishedCoverageImplementationDigest: 'e02d1e500c4ddfd668b11854bed8d69c04d0fc79d0adb9484f6d9838ab76c301',
    publishedCoverageSummarySha256: 'cb38681a9ad87434c85eef3295e5a7cef4957af2397f75186a9496fc82d9153d',
    publishedInputCommit: '6a5dea4687b54600778d62cf21855443567959e6',
    publishedPrerequisiteSummarySha256: '1236bd16b762ee0a115a31487f622a77662e609520e1a7e15fb48e784820c5d0',
    residualAnalysisInputCommit: '89083ba126201067c918ea7e130382ca171f4097',
    residualAnalysisSha256: '42815f7d4bd02daa625718deb8b8ae04590efb605dccc69ffc90b3a4bdcbf546',
    runtimeHandlerAbi: 'kern.runtime.handler.v1',
    structuralKirCodecSha256: '04ec8bde39fcd2313bd0de9e1092f38436fa8b8ea4b9b68401183863cd85a1ab',
  });
  return receipt;
}
