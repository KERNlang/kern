import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runSuccessfulLineReplay,
  successfulLineReplayManifest,
} from './replay.mjs';

test('M4.153-M4.170 replay manifest is complete and exclusions are explicit', () => {
  const manifest = successfulLineReplayManifest();
  const total = Object.values(manifest.totals).reduce((sum, stage) => sum + stage.total, 0);
  assert.equal(total, 343);
  assert.equal(manifest.sourceExcluded.length, 44);
  assert.equal(manifest.boundaryExcluded.length, 12);
  assert.equal(manifest.expectedPredecessorExcluded.length, 33);
  assert.equal(manifest.cases.length, 273);
  assert.deepEqual(Object.keys(manifest.totals), Array.from({ length: 18 }, (_, index) => `M4.${153 + index}`));
});

test('every admitted predecessor fixture is silent through M4.171', async () => {
  const receipt = await runSuccessfulLineReplay();
  assert.equal(receipt.totalRefs, 343);
  assert.equal(receipt.admittedRefs, 254);
  assert.equal(receipt.excludedRefs, 89);
  assert.equal(receipt.predecessorExcluded.length, 33);
  assert.equal(receipt.boundaryExcluded.length, 12);
  assert.equal(receipt.sourceExcluded.length, 44);
  assert.equal(receipt.uniqueCases, 273);
  assert.ok(receipt.workers > 0);
  console.log(`successful-line predecessor replay: ${JSON.stringify({
    admittedRefs: receipt.admittedRefs,
    boundaryExcluded: receipt.boundaryExcluded.length,
    excludedRefs: receipt.excludedRefs,
    predecessorExcluded: receipt.predecessorExcluded.length,
    sourceExcluded: receipt.sourceExcluded.length,
    totalRefs: receipt.totalRefs,
    uniqueCases: receipt.uniqueCases,
    workers: receipt.workers,
  })}`);
});
