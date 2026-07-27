import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { measureCanonicalizerRuntimeCostM498 as measureLive } from './runtime-cost-m4-98-measure.mjs';
import {
  loadCanonicalizerRuntimeCostM498,
  measureCanonicalizerRuntimeCostM498,
  validateCanonicalizerRuntimeCostM498,
} from './runtime-cost-m4-98.mjs';

const summaryUrl = new URL('./runtime-cost-m4-98.json', import.meta.url);
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
    propertyHelpers: {
      propcountExecutions: measurement.summary.helperExecutions.propcount ?? 0,
      propidExecutions: measurement.summary.helperExecutions.propid ?? 0,
    },
    publicParityVerified: measurement.publicParityVerified,
    selectedFrameSuspensions: Object.fromEntries(
      Object.entries(measurement.summary.helperFrameSuspensions)
        .filter(([key]) => key.startsWith('expressionsources->')),
    ),
  };
}

test('M4.98 freezes exact property-row early-exit headroom', () => {
  const receipt = loadCanonicalizerRuntimeCostM498();
  assert.deepEqual(receipt, measureCanonicalizerRuntimeCostM498());
  assert.equal(receipt.format, 'kern.kir-canonicalizer.runtime-cost-reduction.5');
  assert.equal(receipt.baseline.m497ReceiptSha256, sha256(readFileSync(
    new URL('./runtime-cost-m4-97.json', import.meta.url),
  )));
  assert.deepEqual(receipt.optimization, {
    logicalLoopReduction: 6_705,
    propertyLoopUpperBoundBefore: 14_155,
    propertyOrderAuthenticated: true,
    runtimeEngineChanged: false,
    strategy: 'authenticate-nondecreasing-property-owners-and-exit-passed-owner',
  });
  assert.equal(receipt.result.belowFloor, 46_380);
  assert.equal(receipt.result.exactFloor, 46_381);
  assert.equal(receipt.result.floorReduction, 6_705);
  assert.equal(receipt.result.productionHeadroom, 19_155);
  assert.equal(receipt.result.promotionBudgetHeadroom, 2_771);
  assert.deepEqual(receipt.promotion, {
    disposition: 'promotion-budget-headroom-authenticated',
    nextMilestone: 'M4.99',
    profilePromotionApproved: false,
    promotionReady: true,
  });
});

test('M4.98 exact candidate fails below 46381 and succeeds at 46381', () => {
  const receipt = loadCanonicalizerRuntimeCostM498();
  const below = measureLive(receipt.result.belowFloor);
  const floor = measureLive(receipt.result.exactFloor, { verifyPublicParity: true });
  assert.deepEqual(compactMeasurement(below), receipt.observations[0]);
  assert.deepEqual(compactMeasurement(floor), receipt.observations[1]);
});

test('M4.98 rejects receipt mutation and decoration', () => {
  const receipt = measureCanonicalizerRuntimeCostM498();
  for (const mutate of [
    (copy) => { copy.result.exactFloor -= 1; },
    (copy) => { copy.optimization.logicalLoopReduction -= 1; },
    (copy) => { copy.optimization.propertyOrderAuthenticated = false; },
    (copy) => { copy.promotion.profilePromotionApproved = true; },
  ]) {
    const copy = structuredClone(receipt);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerRuntimeCostM498(copy),
      /coverage M4\.98 runtime-cost rejection/u,
    );
  }

  const decorated = structuredClone(receipt);
  Object.defineProperty(decorated, 'hidden', { value: true });
  assert.throws(
    () => validateCanonicalizerRuntimeCostM498(decorated),
    /coverage M4\.98 runtime-cost rejection/u,
  );

  const shared = structuredClone(receipt);
  shared.result = shared.optimization;
  assert.throws(
    () => validateCanonicalizerRuntimeCostM498(shared),
    /coverage M4\.98 runtime-cost rejection/u,
  );

  const accessorArray = structuredClone(receipt);
  const firstObservation = accessorArray.observations[0];
  let getterCalls = 0;
  Object.defineProperty(accessorArray.observations, '0', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return firstObservation;
    },
  });
  assert.throws(
    () => validateCanonicalizerRuntimeCostM498(accessorArray),
    /coverage M4\.98 runtime-cost rejection/u,
  );
  assert.equal(getterCalls, 0);
});

test('M4.98 receipt is canonical and loads in a fresh process', () => {
  const receipt = loadCanonicalizerRuntimeCostM498();
  assert.equal(readFileSync(summaryUrl, 'utf8'), `${JSON.stringify(receipt, null, 2)}\n`);
  const fresh = JSON.parse(execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import {loadCanonicalizerRuntimeCostM498 as load} from './scripts/kern-canonicalizer/runtime-cost-m4-98.mjs'; process.stdout.write(JSON.stringify(load()))",
    ],
    { cwd: new URL('../../', import.meta.url), encoding: 'utf8' },
  ));
  assert.deepEqual(fresh, receipt);
});

test('M4.98 measurement owner is side-effect free when imported with numeric argv', () => {
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import './scripts/kern-canonicalizer/runtime-cost-m4-98-measure.mjs'",
      'import-probe',
      '46381',
    ],
    { cwd: new URL('../../', import.meta.url), encoding: 'utf8' },
  );
  assert.equal(output, '');
});
