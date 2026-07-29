import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { measureCanonicalizerRuntimeCostM4117 } from './runtime-cost-m4-117-measure.mjs';
import {
  buildCanonicalizerRuntimeCostM4117,
  loadCanonicalizerRuntimeCostM4117,
  validateCanonicalizerRuntimeCostM4117,
} from './runtime-cost-m4-117.mjs';

const RECEIPT_DIGEST = '125529edf09c4523e778288052c3b66cf08c8099a4f0d18ef25038cb64b54778';
const receiptUrl = new URL('./runtime-cost-m4-117.json', import.meta.url);
const SELECTED_HELPERS = [
  'tablesok', 'valuefacts', 'childcount', 'childat', 'stringat', 'numberat',
  'propid', 'propcount', 'typesource', 'typefields', 'typefieldtablefacts',
  'validstatementlist', 'validstatement', 'exprsource', 'expressionsources',
  'emitstatementlist', 'emitstatement',
];

function count(record) {
  return Object.values(record).reduce((total, value) => total + value, 0);
}

function selected(record) {
  return Object.fromEntries(SELECTED_HELPERS.map((name) => [name, record[name] ?? 0]));
}

test('M4.117 freezes exact promotion-budget runtime headroom', () => {
  assert.equal(createHash('sha256').update(readFileSync(receiptUrl)).digest('hex'), RECEIPT_DIGEST);
  const receipt = loadCanonicalizerRuntimeCostM4117();
  assert.deepEqual(validateCanonicalizerRuntimeCostM4117(receipt), receipt);
  assert.deepEqual(buildCanonicalizerRuntimeCostM4117(), receipt);
  assert.equal(receipt.format, 'kern.kir-canonicalizer.runtime-cost-reduction.8');
  assert.deepEqual(receipt.result, {
    belowFloor: 38_692,
    belowFloorOutcome: 'failure',
    exactFloor: 38_693,
    floorOutcome: 'success',
    floorReduction: 137_426,
    productionHeadroom: 26_843,
    promotionBudgetHeadroom: 10_459,
    roundTrip: true,
  });
  assert.deepEqual(receipt.optimization, {
    exactFloorReduction: 137_426,
    inputValueTableScanIterations: 2_411,
    projectedFactSlotsPerParent: 3,
    projectionMaterializationIterations: 2_412,
    runtimeEngineChanged: false,
    typefieldTableProjectionExecutions: 1,
    typefieldsExecutions: 59,
    strategy: 'table-wide-authenticated-type-field-projection-with-fixed-parent-view',
  });
  assert.deepEqual(receipt.promotion, {
    disposition: 'promotion-budget-headroom-authenticated',
    nextMilestone: 'M4.118',
    profilePromotionApproved: false,
    promotionReady: true,
  });
});

test('M4.117 exact candidate fails below 38693 and succeeds at 38693', () => {
  const receipt = loadCanonicalizerRuntimeCostM4117();
  for (const expected of receipt.observations) {
    const actual = measureCanonicalizerRuntimeCostM4117(expected.iterationBudget);
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

test('M4.117 rejects invalid budgets, receipt mutation, decoration, sharing, and cycles', () => {
  assert.throws(
    () => measureCanonicalizerRuntimeCostM4117(0),
    /M4\.117 iteration budget must be a positive safe integer/u,
  );
  const receipt = loadCanonicalizerRuntimeCostM4117();
  for (const mutate of [
    (copy) => { copy.result.exactFloor -= 1; },
    (copy) => { copy.optimization.typefieldTableProjectionExecutions = 2; },
    (copy) => { copy.observations[1].selectedHelperExecutions.typefieldtablefacts = 2; },
    (copy) => { copy.promotion.profilePromotionApproved = true; },
  ]) {
    const copy = structuredClone(receipt);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerRuntimeCostM4117(copy),
      /coverage M4\.117 runtime-cost rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), receipt);
  assert.throws(
    () => validateCanonicalizerRuntimeCostM4117(decorated),
    /coverage M4\.117 runtime-cost rejection/u,
  );
  const shared = structuredClone(receipt);
  shared.future = shared.limits;
  assert.throws(() => validateCanonicalizerRuntimeCostM4117(shared), /cycles or shared/u);
  const cyclic = structuredClone(receipt);
  cyclic.future = cyclic;
  assert.throws(() => validateCanonicalizerRuntimeCostM4117(cyclic), /cycles or shared/u);
});

test('M4.117 receipt is canonical and measurement import is side-effect free', () => {
  const receipt = loadCanonicalizerRuntimeCostM4117();
  assert.equal(readFileSync(receiptUrl, 'utf8'), `${JSON.stringify(receipt, null, 2)}\n`);
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "await import('./scripts/kern-canonicalizer/runtime-cost-m4-117-measure.mjs'); process.stdout.write('quiet')",
      'scripts/check-kern-canonicalizer-coverage.mjs',
      '38693',
    ],
    { cwd: new URL('../../', import.meta.url), encoding: 'utf8' },
  );
  assert.equal(output, 'quiet');
});
