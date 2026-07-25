import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { loadPublishedCanonicalizerResidualAnalysisM487 } from './coverage-residual-analysis-m4-87.mjs';
import { loadCanonicalizerDualRowHeadroomM488 } from './dual-row-headroom-m4-88.mjs';

const RECEIPT_URL = new URL('./dual-row-headroom-m4-88.json', import.meta.url);
const RECEIPT_DIGEST = '285b42785be8f651d323444ddd3464381b337b74557bbd07e8c3f4bad02a89bb';

export function assertCanonicalizerDualRowHeadroomM488() {
  assert.equal(
    createHash('sha256').update(readFileSync(RECEIPT_URL)).digest('hex'),
    RECEIPT_DIGEST,
    'M4.88 receipt bytes must remain exact',
  );
  const analysis = loadPublishedCanonicalizerResidualAnalysisM487();
  assert.equal(analysis.digest, '9046716d876c336140b567a8a40a9b52750106b2ac5db66f38f7621e935c203a');
  assert.equal(analysis.inputCommit, '46337a6549390087ef095c18d0e178cf9ef28392');
  assert.deepEqual(analysis.record.selectedNextAction, {
    changedLimits: ['maxNodeRows', 'maxPropertyRows'],
    completeFunctions: 3,
    completeTools: 2,
    limits: { maxNodeRows: 74, maxPropertyRows: 77, maxValueRows: 580 },
    totalDelta: 52,
    witnesses: [
      'examples/capstone-checker-subset/checker.kern#18:indexRejectDetail',
      'examples/capstone-checker-subset/checker.kern#23:callRejectCode',
      'examples/selfhost-validator/validator.kern#2:isreserved',
    ],
  });

  const receipt = loadCanonicalizerDualRowHeadroomM488();
  assert.equal(receipt.format, 'kern.kir-canonicalizer.dual-row-headroom.4');
  assert.deepEqual(receipt.limits, {
    activeProfile: { maxNodeRows: 38, maxPropertyRows: 61, maxValueRows: 580 },
    candidateProfile: { maxNodeRows: 74, maxPropertyRows: 77, maxValueRows: 580 },
    diagnosticMaxCollectionLength: 107_594,
    productionMaxCollectionLength: 65_536,
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
  });
  assert.deepEqual(receipt.promotion, {
    disposition: 'rejected-over-production-ceiling',
    nextMilestone: 'M4.89',
    productionCeilingDeficit: 42_058,
    promotionBudgetDeficit: 58_442,
    requiredFloorReduction: 58_442,
  });
  assert.deepEqual(receipt.summary, {
    maxExactFloor: 107_594,
    productionCeilingDeficit: 42_058,
    promotionBudgetDeficit: 58_442,
    totalParameterRows: 40,
    witnessCount: 3,
  });
  assert.equal(receipt.witnesses[2].productionOutcome, 'failure');
  assert.deepEqual(receipt.measurement, {
    disposition: 'diagnostic-only',
    runtimePolicyChanged: false,
  });
  assert.deepEqual(receipt.moduleEnvelope, { disposition: 'not-claimed', maxDepth: 64 });
  return receipt;
}
