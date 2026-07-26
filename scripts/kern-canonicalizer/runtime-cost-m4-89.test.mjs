import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadCanonicalizerDualRowHeadroomM488 } from './dual-row-headroom-m4-88.mjs';
import {
  loadCanonicalizerRuntimeCostM489,
  measureCanonicalizerRuntimeCostM489,
  validateCanonicalizerRuntimeCostM489,
} from './runtime-cost-m4-89.mjs';

const summaryUrl = new URL('./runtime-cost-m4-89.json', import.meta.url);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

test('M4.89 freezes the exact expression-source runtime-cost reduction', () => {
  const baseline = loadCanonicalizerDualRowHeadroomM488();
  const receipt = loadCanonicalizerRuntimeCostM489();
  assert.deepEqual(receipt, measureCanonicalizerRuntimeCostM489());
  assert.equal(receipt.format, 'kern.kir-canonicalizer.runtime-cost-reduction.2');
  assert.deepEqual(receipt.limits.activeProfile, baseline.limits.activeProfile);
  assert.deepEqual(receipt.limits.candidateProfile, baseline.limits.candidateProfile);
  assert.equal(receipt.limits.productionMaxCollectionLength, 65_536);
  assert.equal(receipt.limits.promotionBudget, 49_152);
  assert.equal(receipt.limits.maxDepth, 64);
  assert.deepEqual(receipt.optimization, {
    baselineDistinctExpressionIds: 71,
    baselineExpressionScanIterations: 81_224,
    cachedTablePasses: 2,
    helper: 'examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources',
    owner: 'examples/kern-canonicalizer/canonicalizer.kern#2:exprsource',
    strategy: 'memoized-table-wide-expression-projection',
    valueRows: 572,
  });
  assert.equal(receipt.baseline.m488ReceiptSha256, sha256(readFileSync(
    new URL('./dual-row-headroom-m4-88.json', import.meta.url),
  )));
  assert.equal(receipt.baseline.maxExactFloor, 107_594);
  assert.equal(receipt.baseline.requiredFloorReduction, 58_442);
  assert.equal(receipt.result.maxExactFloor, Math.max(...receipt.witnesses.map(({ exactFloor }) => exactFloor)));
  assert.equal(receipt.result.floorReduction, 107_594 - receipt.result.maxExactFloor);
  assert.equal(receipt.result.promotionHeadroom, 49_152 - receipt.result.maxExactFloor);
  assert.ok(receipt.result.floorReduction >= 58_442);
  assert.ok(receipt.result.maxExactFloor <= 49_152);
  assert.deepEqual(receipt.promotion, {
    disposition: 'headroom-authenticated',
    nextMilestone: 'M4.90',
  });
  assert.equal(receipt.witnesses.length, 3);
  for (const witness of receipt.witnesses) {
    assert.equal(witness.belowFloorOutcome, 'failure');
    assert.equal(witness.floorOutcome, 'success');
    assert.equal(witness.roundTrip, true);
    assert.ok(witness.exactFloor <= 49_152);
  }
  assert.equal(
    sha256(readFileSync(summaryUrl)),
    sha256(Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`)),
  );
});

test('M4.89 rejects decorated data, cycles, shared references, and receipt drift', () => {
  const receipt = measureCanonicalizerRuntimeCostM489();
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.runtime-cost-reduction.3'; },
    (copy) => { copy.result.maxExactFloor += 1; },
    (copy) => { copy.optimization.cachedTablePasses = 3; },
    (copy) => { copy.promotion.nextMilestone = 'M4.91'; },
  ]) {
    const copy = structuredClone(receipt);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerRuntimeCostM489(copy),
      /coverage M4\.89 runtime-cost rejection/u,
    );
  }
  const decorated = structuredClone(receipt);
  decorated.extra = true;
  assert.throws(
    () => validateCanonicalizerRuntimeCostM489(decorated),
    /coverage M4\.89 runtime-cost rejection/u,
  );
  const cyclic = structuredClone(receipt);
  cyclic.result.self = cyclic;
  assert.throws(
    () => validateCanonicalizerRuntimeCostM489(cyclic),
    /coverage M4\.89 runtime-cost rejection/u,
  );
  const shared = structuredClone(receipt);
  shared.witnesses[1].profileRows = shared.witnesses[0].profileRows;
  assert.throws(
    () => validateCanonicalizerRuntimeCostM489(shared),
    /coverage M4\.89 runtime-cost rejection/u,
  );
});
