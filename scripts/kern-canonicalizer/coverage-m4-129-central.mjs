import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  formatM4129RuntimeCostStatus,
} from './coverage-status-m4-129.mjs';
import {
  loadCanonicalizerRuntimeCostM4129,
} from './runtime-cost-m4-129.mjs';

const RECEIPT_URL = new URL('./runtime-cost-m4-129.json', import.meta.url);
const RECEIPT_DIGEST =
  'e4bd57760198241cbe295ef6dcc7e35b1b7ddbb41026ca066d4016de0cfccd7c';

export function assertM4129RuntimeCost() {
  const receipt = loadCanonicalizerRuntimeCostM4129();
  assert.equal(
    createHash('sha256').update(readFileSync(RECEIPT_URL)).digest('hex'),
    RECEIPT_DIGEST,
  );
  assert.equal(
    receipt.baseline.m4128ReceiptSha256,
    '55512e5cdb91aa43b46ea8ccc09edb3cfe1890920071c13bed10c2d9f81440ac',
  );
  assert.equal(receipt.witness.parameterRows, 41);
  assert.equal(receipt.result.floorReduction, 8_986);
  return formatM4129RuntimeCostStatus(receipt);
}
