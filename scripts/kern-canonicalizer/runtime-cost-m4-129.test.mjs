import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { measureCanonicalizerRuntimeCostM4129 } from './runtime-cost-m4-129-measure.mjs';
import {
  buildCanonicalizerRuntimeCostM4129,
  loadCanonicalizerRuntimeCostM4129,
  validateCanonicalizerRuntimeCostM4129,
} from './runtime-cost-m4-129.mjs';

const RECEIPT_DIGEST = 'e4bd57760198241cbe295ef6dcc7e35b1b7ddbb41026ca066d4016de0cfccd7c';
const receiptUrl = new URL('./runtime-cost-m4-129.json', import.meta.url);
const SELECTED_HELPERS = [
  'recordfield', 'typefields', 'typefieldtablefacts', 'validstatement',
  'exprsource', 'expressionsources', 'emitstatement', 'emitstatementlist',
];

function count(record) {
  return Object.values(record).reduce((total, value) => total + value, 0);
}

function selected(record) {
  return Object.fromEntries(SELECTED_HELPERS.map((name) => [name, record[name] ?? 0]));
}

test('M4.129 freezes exact assignment-target projection headroom', () => {
  assert.equal(createHash('sha256').update(readFileSync(receiptUrl)).digest('hex'), RECEIPT_DIGEST);
  const receipt = loadCanonicalizerRuntimeCostM4129();
  assert.deepEqual(validateCanonicalizerRuntimeCostM4129(receipt), receipt);
  assert.deepEqual(buildCanonicalizerRuntimeCostM4129(), receipt);
  assert.deepEqual(receipt.result, {
    belowFloor: 45_907,
    belowFloorOutcome: 'failure',
    exactFloor: 45_908,
    floorOutcome: 'success',
    floorReduction: 8_986,
    productionHeadroom: 19_628,
    promotionBudgetHeadroom: 3_244,
    roundTrip: true,
  });
  assert.deepEqual(receipt.optimization, {
    exactFloorReduction: 8_986,
    recordfieldExecutions: 0,
    removedRecordfieldIterations: 8_986,
    runtimeEngineChanged: false,
    strategy: 'reuse-authenticated-type-field-projection-for-assignment-target-kind',
    tableWideLoopAdded: false,
    typefieldTableProjectionExecutions: 1,
  });
  assert.deepEqual(receipt.promotion, {
    combinedPromotionApproved: false,
    disposition: 'promotion-budget-headroom-authenticated',
    nextMilestone: 'M4.130',
    promotionReady: true,
  });
});

test('M4.129 fails below 45908 and succeeds with exact roundtrip at 45908', () => {
  const receipt = loadCanonicalizerRuntimeCostM4129();
  for (const expected of receipt.observations) {
    const actual = measureCanonicalizerRuntimeCostM4129(expected.iterationBudget);
    assert.equal(actual.envelope.outcome, expected.outcome);
    assert.equal(actual.roundTrip, expected.roundTrip);
    assert.equal(actual.observerParityVerified, expected.observerParityVerified);
    assert.deepEqual(actual.summary.cache, expected.cache);
    assert.deepEqual(actual.summary.cacheKeyCodeUnits, expected.cacheKeyCodeUnits);
    assert.deepEqual(actual.summary.loopIterations, expected.loopIterations);
    assert.equal(count(actual.summary.helperExecutions), expected.helperExecutionCount);
    assert.equal(
      count(actual.summary.helperFrameSuspensions),
      expected.helperFrameSuspensionCount,
    );
    assert.equal(count(actual.summary.helperPreparations), expected.helperPreparationCount);
    assert.equal(count(actual.summary.parentRestarts), expected.parentRestartCount);
    assert.deepEqual(selected(actual.summary.helperExecutions), expected.selectedHelperExecutions);
    assert.deepEqual(
      selected(actual.summary.helperPreparations),
      expected.selectedHelperPreparations,
    );
  }
});

test('M4.129 rejects invalid budgets, receipt drift, decoration, sharing, and cycles', () => {
  assert.throws(
    () => measureCanonicalizerRuntimeCostM4129(0),
    /M4\.129 runtime-cost measurement rejection/u,
  );
  const receipt = loadCanonicalizerRuntimeCostM4129();
  for (const mutate of [
    (copy) => { copy.result.exactFloor -= 1; },
    (copy) => { copy.optimization.recordfieldExecutions = 1; },
    (copy) => { copy.observations[1].selectedHelperExecutions.typefieldtablefacts = 2; },
    (copy) => { copy.promotion.promotionReady = false; },
  ]) {
    const copy = structuredClone(receipt);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerRuntimeCostM4129(copy),
      /coverage M4\.129 runtime-cost rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), receipt);
  assert.throws(
    () => validateCanonicalizerRuntimeCostM4129(decorated),
    /coverage M4\.129 runtime-cost rejection/u,
  );
  const shared = structuredClone(receipt);
  shared.future = shared.limits;
  assert.throws(() => validateCanonicalizerRuntimeCostM4129(shared), /cycles or shared/u);
  const cyclic = structuredClone(receipt);
  cyclic.future = cyclic;
  assert.throws(() => validateCanonicalizerRuntimeCostM4129(cyclic), /cycles or shared/u);
});

test('M4.129 receipt is canonical and measurement import is side-effect free', () => {
  const receipt = loadCanonicalizerRuntimeCostM4129();
  assert.equal(readFileSync(receiptUrl, 'utf8'), `${JSON.stringify(receipt, null, 2)}\n`);
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "await import('./scripts/kern-canonicalizer/runtime-cost-m4-129-measure.mjs'); process.stdout.write('quiet')",
      'scripts/check-kern-canonicalizer-coverage.mjs',
      '45908',
    ],
    { cwd: new URL('../../', import.meta.url), encoding: 'utf8' },
  );
  assert.equal(output, 'quiet');
});
