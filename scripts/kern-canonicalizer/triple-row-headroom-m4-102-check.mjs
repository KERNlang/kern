import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { loadPublishedCanonicalizerResidualAnalysisM4101 } from './coverage-residual-analysis-m4-101.mjs';
import { loadCanonicalizerTripleRowHeadroomM4102 } from './triple-row-headroom-m4-102.mjs';

const RECEIPT_URL = new URL('./triple-row-headroom-m4-102.json', import.meta.url);
const RECEIPT_DIGEST = '8bed0a4709de4ba79dfffba68e4f9304bdf599e04d771520637bb935865b5e58';

export function assertCanonicalizerTripleRowHeadroomM4102() {
  assert.equal(
    createHash('sha256').update(readFileSync(RECEIPT_URL)).digest('hex'),
    RECEIPT_DIGEST,
    'M4.102 receipt bytes must remain exact',
  );
  const analysis = loadPublishedCanonicalizerResidualAnalysisM4101();
  assert.equal(
    analysis.digest,
    '9b389d0b2536cf2cd11d49bc47f1f234c46924c14c2ef160faf633069a3c94f0',
  );
  assert.equal(analysis.inputCommit, 'f95952200aec3a13ff71d42f63b7a7ed47010e48');
  assert.deepEqual(analysis.record.selectedNextAction, {
    changedLimits: ['maxNodeRows', 'maxPropertyRows', 'maxValueRows'],
    completeFunctions: 1,
    completeTools: 1,
    limits: { maxNodeRows: 89, maxPropertyRows: 125, maxValueRows: 2100 },
    totalDelta: 1313,
    witnesses: [
      'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#2:validstatement',
    ],
  });

  const receipt = loadCanonicalizerTripleRowHeadroomM4102();
  assert.deepEqual(receipt.limits, {
    activeProfile: { maxNodeRows: 74, maxPropertyRows: 95, maxValueRows: 832 },
    candidateProfile: { maxNodeRows: 89, maxPropertyRows: 125, maxValueRows: 2100 },
    diagnosticMaxCollectionLength: 72_195,
    productionMaxCollectionLength: 65_536,
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
  });
  assert.deepEqual(receipt.promotion, {
    disposition: 'rejected-over-production-ceiling',
    nextMilestone: 'M4.103',
    productionCeilingDeficit: 6_659,
    promotionBudgetDeficit: 23_043,
    profilePromotionApproved: false,
    requiredFloorReduction: 23_043,
  });
  assert.deepEqual(receipt.summary, {
    maxExactFloor: 72_195,
    productionCeilingDeficit: 6_659,
    promotionBudgetDeficit: 23_043,
    totalParameterRows: 14,
    witnessCount: 1,
  });
  assert.deepEqual(receipt.measurement, {
    disposition: 'diagnostic-only',
    runtimePolicyChanged: false,
  });
  assert.deepEqual(receipt.moduleEnvelope, { disposition: 'not-claimed', maxDepth: 64 });
  return receipt;
}
