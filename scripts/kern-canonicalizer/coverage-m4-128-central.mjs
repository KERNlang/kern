import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  formatM4128RuntimeBottleneckStatus,
} from './coverage-status-m4-128.mjs';
import {
  loadCanonicalizerRuntimeBottleneckM4128,
} from './runtime-bottleneck-m4-128.mjs';

const RECEIPT_URL = new URL('./runtime-bottleneck-m4-128.json', import.meta.url);
const RECEIPT_DIGEST =
  '55512e5cdb91aa43b46ea8ccc09edb3cfe1890920071c13bed10c2d9f81440ac';

export function assertM4128RuntimeBottleneck() {
  const receipt = loadCanonicalizerRuntimeBottleneckM4128();
  assert.equal(
    createHash('sha256').update(readFileSync(RECEIPT_URL)).digest('hex'),
    RECEIPT_DIGEST,
  );
  assert.equal(
    receipt.source.m4127ReceiptSha256,
    '604f2b9a59d2cd4b56b2a4263fcbb5129dd7bfb41c0601e7573b4a576515dcce',
  );
  assert.equal(
    receipt.source.publishedInputCommit,
    'e874d1adf4371ebc76e87fbf564e6fa516305aff',
  );
  assert.equal(receipt.witness.parameterRows, 41);
  assert.equal(receipt.promotion.requiredFloorReduction, 5_742);
  return formatM4128RuntimeBottleneckStatus(receipt);
}
