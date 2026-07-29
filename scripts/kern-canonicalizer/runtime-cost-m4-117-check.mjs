import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { formatM4117RuntimeCostStatus } from './coverage-status.mjs';
import { loadCanonicalizerRuntimeCostM4117 } from './runtime-cost-m4-117.mjs';

const RECEIPT_URL = new URL('./runtime-cost-m4-117.json', import.meta.url);

export function assertM4117RuntimeCostStatus() {
  assert.equal(
    createHash('sha256').update(readFileSync(RECEIPT_URL)).digest('hex'),
    '125529edf09c4523e778288052c3b66cf08c8099a4f0d18ef25038cb64b54778',
  );
  const receipt = loadCanonicalizerRuntimeCostM4117();
  assert.equal(receipt.result.exactFloor, 38_693);
  assert.equal(receipt.result.floorReduction, 137_426);
  assert.equal(receipt.result.promotionBudgetHeadroom, 10_459);
  assert.equal(receipt.optimization.typefieldTableProjectionExecutions, 1);
  assert.equal(receipt.promotion.profilePromotionApproved, false);
  assert.equal(receipt.promotion.nextMilestone, 'M4.118');
  return formatM4117RuntimeCostStatus(receipt);
}
