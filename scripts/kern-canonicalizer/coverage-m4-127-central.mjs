import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  loadCanonicalizerCombinedHeadroomM4127,
} from './combined-headroom-m4-127.mjs';
import {
  formatM4127CombinedHeadroomStatus,
} from './coverage-status-m4-127.mjs';

const RECEIPT_URL = new URL('./combined-headroom-m4-127.json', import.meta.url);
const RECEIPT_DIGEST =
  '604f2b9a59d2cd4b56b2a4263fcbb5129dd7bfb41c0601e7573b4a576515dcce';

export function assertM4127CombinedHeadroom() {
  const receipt = loadCanonicalizerCombinedHeadroomM4127();
  assert.equal(
    createHash('sha256').update(readFileSync(RECEIPT_URL)).digest('hex'),
    RECEIPT_DIGEST,
  );
  assert.equal(
    receipt.source.projectionAnalysisSha256,
    '25f1ba6ed40efdff909a6c95a11c385c12f9eba2b0025375ed4943f14393e369',
  );
  assert.equal(
    receipt.source.publishedInputCommit,
    '04e8f943ee070b4fc0b1d2ceb063adc53ecc5f06',
  );
  assert.equal(receipt.summary.witnessCount, 1);
  assert.equal(receipt.summary.totalParameterRows, 41);
  assert.equal(receipt.promotion.combinedPromotionApproved, false);
  return formatM4127CombinedHeadroomStatus(receipt);
}
