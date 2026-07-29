import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { loadPublishedCanonicalizerResidualAnalysisM4114 } from './coverage-residual-analysis-m4-114.mjs';
import { formatM4115TripleRowHeadroomStatus } from './coverage-status.mjs';
import { loadCanonicalizerTripleRowHeadroomM4115 } from './triple-row-headroom-m4-115.mjs';

const RECEIPT_URL = new URL('./triple-row-headroom-m4-115.json', import.meta.url);

export function assertM4115TripleRowHeadroomStatus() {
  assert.equal(
    createHash('sha256').update(readFileSync(RECEIPT_URL)).digest('hex'),
    '0142e5d39fc94ec76e2cf793a62a922fa9087a12fb4cd83b9499cfc58f922b9d',
  );
  const analysis = loadPublishedCanonicalizerResidualAnalysisM4114();
  assert.equal(
    analysis.digest,
    '23fd8f52fa70e2a72fb4b4b1b7ae4c477b369a5f46853691b86b7506a9717e0c',
  );
  assert.deepEqual(analysis.record.selectedNextAction, {
    changedLimits: ['maxNodeRows', 'maxPropertyRows', 'maxValueRows'],
    completeFunctions: 1,
    completeTools: 1,
    limits: { maxNodeRows: 122, maxPropertyRows: 193, maxValueRows: 2411 },
    totalDelta: 412,
    witnesses: [
      'examples/capstone-checker-subset/checker.kern#24:checkModule',
    ],
  });
  const receipt = loadCanonicalizerTripleRowHeadroomM4115();
  assert.equal(receipt.summary.maxExactFloor, 176_119);
  assert.equal(receipt.summary.productionCeilingDeficit, 110_583);
  assert.equal(receipt.summary.promotionBudgetDeficit, 126_967);
  assert.equal(receipt.promotion.profilePromotionApproved, false);
  return formatM4115TripleRowHeadroomStatus(receipt);
}
