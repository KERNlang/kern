import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { measureCanonicalizerRuntimeCostM4106 as measureLive } from './runtime-cost-m4-106-measure.mjs';
import {
  buildCanonicalizerRuntimeCostM4106,
  loadCanonicalizerRuntimeCostM4106,
  validateCanonicalizerRuntimeCostM4106,
} from './runtime-cost-m4-106.mjs';

const receiptUrl = new URL('./runtime-cost-m4-106.json', import.meta.url);
const RECEIPT_DIGEST = '827525373e1716137b53e322c913ec7dcb4f8ea0cd12dc1d8d77605c692a886a';

function compactMeasurement(measurement) {
  const selected = [
    'childat',
    'childcount',
    'emitstatement',
    'emitstatementlist',
    'numberat',
    'propcount',
    'propid',
    'statementfacts',
    'statementtablefacts',
    'validstatement',
    'validstatementlist',
  ];
  return {
    cache: structuredClone(measurement.summary.cache),
    cacheKeyCodeUnits: structuredClone(measurement.summary.cacheKeyCodeUnits),
    iterationBudget: measurement.iterationBudget,
    loopIterations: structuredClone(measurement.summary.loopIterations),
    observerParityVerified: measurement.observerParityVerified,
    outcome: measurement.envelope.outcome,
    parentRestartCount: Object.values(measurement.summary.parentRestarts)
      .reduce((total, count) => total + count, 0),
    roundTrip: measurement.roundTrip,
    selectedHelperExecutions: Object.fromEntries(selected.map((name) => [
      name,
      measurement.summary.helperExecutions[name] ?? 0,
    ])),
  };
}

test('M4.106 freezes promotion-budget runtime headroom', () => {
  assert.equal(createHash('sha256').update(readFileSync(receiptUrl)).digest('hex'), RECEIPT_DIGEST);
  const receipt = loadCanonicalizerRuntimeCostM4106();
  assert.deepEqual(validateCanonicalizerRuntimeCostM4106(receipt), receipt);
  assert.deepEqual(buildCanonicalizerRuntimeCostM4106(), receipt);
  assert.equal(receipt.format, 'kern.kir-canonicalizer.runtime-cost-reduction.7');
  assert.deepEqual(receipt.result, {
    belowFloor: 39_015,
    belowFloorOutcome: 'failure',
    exactFloor: 39_016,
    floorOutcome: 'success',
    floorReduction: 23_814,
    productionHeadroom: 26_520,
    promotionBudgetHeadroom: 10_136,
    roundTrip: true,
  });
  assert.deepEqual(receipt.optimization, {
    exactFloorReduction: 23_814,
    helperFunctionsAdded: 2,
    projectedFactSlotsPerNode: 8,
    runtimeEngineChanged: false,
    statementTableProjectionExecutions: 1,
    strategy: 'table-wide-authenticated-statement-fact-projection-with-fixed-node-view',
  });
  assert.deepEqual(receipt.promotion, {
    disposition: 'promotion-budget-headroom-authenticated',
    nextMilestone: 'M4.107',
    profilePromotionApproved: false,
    promotionReady: true,
  });
  assert.deepEqual(receipt.witness.structuralRows, {
    nodes: 89,
    properties: 125,
    values: 1_873,
  });
});

test('M4.106 exact candidate fails below 39016 and succeeds at 39016', () => {
  const receipt = loadCanonicalizerRuntimeCostM4106();
  for (const expected of receipt.observations) {
    assert.deepEqual(compactMeasurement(measureLive(expected.iterationBudget)), expected);
  }
});

test('M4.106 rejects invalid budgets, receipt mutation, decoration, and shared references', () => {
  assert.throws(() => measureLive(0), /positive safe integer/u);
  const receipt = loadCanonicalizerRuntimeCostM4106();
  for (const mutate of [
    (copy) => { copy.result.exactFloor -= 1; },
    (copy) => { copy.optimization.statementTableProjectionExecutions = 2; },
    (copy) => { copy.observations[1].loopIterations.attemptedByType.while -= 1; },
    (copy) => { copy.promotion.profilePromotionApproved = true; },
  ]) {
    const copy = structuredClone(receipt);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerRuntimeCostM4106(copy),
      /coverage M4\.106 runtime-cost rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), receipt);
  assert.throws(
    () => validateCanonicalizerRuntimeCostM4106(decorated),
    /coverage M4\.106 runtime-cost rejection/u,
  );
  const shared = structuredClone(receipt);
  shared.future = shared.limits;
  assert.throws(
    () => validateCanonicalizerRuntimeCostM4106(shared),
    /cycles or shared references/u,
  );
});

test('M4.106 receipt is canonical and loaders are side-effect free', () => {
  const receipt = loadCanonicalizerRuntimeCostM4106();
  assert.equal(readFileSync(receiptUrl, 'utf8'), `${JSON.stringify(receipt, null, 2)}\n`);
  const fresh = JSON.parse(execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import {loadCanonicalizerRuntimeCostM4106 as load} from './scripts/kern-canonicalizer/runtime-cost-m4-106.mjs'; process.stdout.write(JSON.stringify(load()))",
    ],
    {
      cwd: new URL('../../', import.meta.url),
      encoding: 'utf8',
      env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
    },
  ));
  assert.deepEqual(fresh, receipt);
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "await import('./scripts/kern-canonicalizer/runtime-cost-m4-106-measure.mjs'); process.stdout.write('quiet')",
      'scripts/check-kern-canonicalizer-coverage.mjs',
      '39016',
    ],
    { cwd: new URL('../../', import.meta.url), encoding: 'utf8' },
  );
  assert.equal(output, 'quiet');
});
