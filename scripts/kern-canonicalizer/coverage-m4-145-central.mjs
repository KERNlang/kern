import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  loadCanonicalizerCombinedHeadroomM4145,
} from './combined-headroom-m4-145.mjs';
import {
  formatM4145CombinedHeadroomStatus,
} from './coverage-status-m4-145.mjs';

const RECEIPT_URL = new URL('./combined-headroom-m4-145.json', import.meta.url);
const RECEIPT_DIGEST =
  'e61beda6a311742d0475fdcd52ab0147cffe74300c1ee339ea79acceb3f147ba';

export function assertM4145CombinedHeadroom() {
  const receipt = loadCanonicalizerCombinedHeadroomM4145();
  assert.equal(
    createHash('sha256').update(readFileSync(RECEIPT_URL)).digest('hex'),
    RECEIPT_DIGEST,
  );
  assert.equal(
    receipt.source.projectionAnalysisSha256,
    '0aa57f2721cd76c9fed61ab5aaf22deccb868277e3627587712c92c907a6b086',
  );
  assert.equal(
    receipt.source.publishedInputCommit,
    '7273d51ee0c61785251aaf13106f6b6556720990',
  );
  assert.equal(receipt.summary.witnessCount, 1);
  assert.equal(receipt.summary.totalParameterRows, 6);
  assert.equal(receipt.promotion.combinedPromotionApproved, true);
  assert.equal(receipt.promotion.promotionReady, true);
  return formatM4145CombinedHeadroomStatus(receipt);
}
