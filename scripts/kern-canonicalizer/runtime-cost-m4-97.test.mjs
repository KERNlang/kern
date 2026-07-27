import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { measureCanonicalizerRuntimeCostM497 as measureLive } from './runtime-cost-m4-97-measure.mjs';
import {
  loadCanonicalizerRuntimeCostM497,
  measureCanonicalizerRuntimeCostM497,
  validateCanonicalizerRuntimeCostM497,
} from './runtime-cost-m4-97.mjs';

const summaryUrl = new URL('./runtime-cost-m4-97.json', import.meta.url);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function compactMeasurement(measurement) {
  return {
    cache: structuredClone(measurement.summary.cache),
    cacheKeyCodeUnits: structuredClone(measurement.summary.cacheKeyCodeUnits),
    expressionsources: {
      executions: measurement.summary.helperExecutions.expressionsources ?? 0,
      preparations: measurement.summary.helperPreparations.expressionsources ?? 0,
    },
    frameSuspensions: Object.values(measurement.summary.helperFrameSuspensions)
      .reduce((total, count) => total + count, 0),
    iterationBudget: measurement.iterationBudget,
    loopIterations: {
      attempted: Object.values(measurement.summary.loopIterations.attempted)
        .reduce((total, count) => total + count, 0),
      retained: measurement.summary.loopIterations.retained,
      rolledBack: measurement.summary.loopIterations.rolledBack,
    },
    outcome: measurement.envelope.outcome,
    publicParityVerified: measurement.publicParityVerified,
    selectedFrameSuspensions: Object.fromEntries(
      Object.entries(measurement.summary.helperFrameSuspensions)
        .filter(([key]) => key.startsWith('expressionsources->')),
    ),
  };
}

test('M4.97 freezes the exact resumable helper-frame runtime reduction', () => {
  const receipt = loadCanonicalizerRuntimeCostM497();
  assert.deepEqual(receipt, measureCanonicalizerRuntimeCostM497());
  assert.equal(receipt.format, 'kern.kir-canonicalizer.runtime-cost-reduction.4');
  assert.equal(receipt.baseline.m496ReceiptSha256, sha256(readFileSync(
    new URL('./runtime-bottleneck-m4-96.json', import.meta.url),
  )));
  assert.equal(receipt.optimization.parentFrameRestarts, 0);
  assert.equal(receipt.optimization.atBudget34500.loopAttemptsRemoved, 78_645);
  assert.equal(receipt.optimization.atBudget34500.expressionsourcesExecutionReduction, 91);
  assert.equal(receipt.optimization.atBudget34500.cacheKeyCodeUnitsReduction, 40_175_005);
  assert.equal(receipt.result.belowFloor, 53_085);
  assert.equal(receipt.result.exactFloor, 53_086);
  assert.equal(receipt.result.productionHeadroom, 12_450);
  assert.equal(receipt.result.promotionBudgetDeficit, 3_934);
  assert.deepEqual(receipt.promotion, {
    disposition: 'production-headroom-authenticated-promotion-budget-no-go',
    nextMilestone: 'M4.98',
    profilePromotionApproved: false,
  });
});

test('M4.97 live floor reproduction is archival after the M4.98 source optimization', () => {
  const receipt = loadCanonicalizerRuntimeCostM497();
  const below = measureLive(receipt.result.belowFloor);
  const floor = measureLive(receipt.result.exactFloor, { verifyPublicParity: true });
  assert.equal(below.envelope.outcome, 'success');
  assert.equal(floor.envelope.outcome, 'success');
  const belowRetained = compactMeasurement(below).loopIterations.retained;
  const floorRetained = compactMeasurement(floor).loopIterations.retained;
  assert.ok(belowRetained < receipt.result.belowFloor);
  assert.equal(floorRetained, belowRetained);
  assert.equal(floor.publicParityVerified, true);
});

test('M4.97 rejects receipt mutation and decoration', () => {
  const receipt = measureCanonicalizerRuntimeCostM497();
  for (const mutate of [
    (copy) => { copy.result.exactFloor -= 1; },
    (copy) => { copy.optimization.parentFrameRestarts = 1; },
    (copy) => { copy.observations[1].frameSuspensions -= 1; },
    (copy) => { copy.promotion.profilePromotionApproved = true; },
  ]) {
    const copy = structuredClone(receipt);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerRuntimeCostM497(copy),
      /coverage M4\.97 runtime-cost rejection/u,
    );
  }
  const decorated = structuredClone(receipt);
  Object.defineProperty(decorated, 'hidden', { value: true });
  assert.throws(
    () => validateCanonicalizerRuntimeCostM497(decorated),
    /coverage M4\.97 runtime-cost rejection/u,
  );
});

test('M4.97 receipt is canonical and loads in a fresh process', () => {
  const receipt = loadCanonicalizerRuntimeCostM497();
  assert.equal(readFileSync(summaryUrl, 'utf8'), `${JSON.stringify(receipt, null, 2)}\n`);
  const fresh = JSON.parse(execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import {loadCanonicalizerRuntimeCostM497 as load} from './scripts/kern-canonicalizer/runtime-cost-m4-97.mjs'; process.stdout.write(JSON.stringify(load()))",
    ],
    { cwd: new URL('../../', import.meta.url), encoding: 'utf8' },
  ));
  assert.deepEqual(fresh, receipt);
});
