import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { formatM4116RuntimeBottleneckStatus } from './coverage-status.mjs';
import { loadCanonicalizerRuntimeBottleneckM4116 } from './runtime-bottleneck-m4-116.mjs';

const RECEIPT_URL = new URL('./runtime-bottleneck-m4-116.json', import.meta.url);

export function assertM4116RuntimeBottleneckStatus() {
  assert.equal(
    createHash('sha256').update(readFileSync(RECEIPT_URL)).digest('hex'),
    '5342271907023c75b1c3b5acfd714860f6686d31a5a3bf60c37e7d8f73803056',
  );
  const receipt = loadCanonicalizerRuntimeBottleneckM4116();
  assert.equal(receipt.limits.exactFloor, 176_119);
  assert.equal(receipt.diagnosis.exactFloorTypefieldsIterations, 142_249);
  assert.equal(receipt.diagnosis.valueRowsPerTypefieldsExecution, 2_411);
  assert.equal(receipt.observations[2].typefields.completedFullScans, 59);
  assert.equal(receipt.diagnosis.productionFailureBeforeStatementValidation, true);
  assert.equal(receipt.diagnosis.promotionFailureBeforeStatementValidation, true);
  assert.equal(receipt.promotion.profilePromotionApproved, false);
  assert.equal(receipt.promotion.nextMilestone, 'M4.117');
  return formatM4116RuntimeBottleneckStatus(receipt);
}
