import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { measureCanonicalizerRuntimeCostM4104 as measureLive } from './runtime-cost-m4-104-measure.mjs';
import {
  buildCanonicalizerRuntimeCostM4104,
  loadCanonicalizerRuntimeCostM4104,
  validateCanonicalizerRuntimeCostM4104,
} from './runtime-cost-m4-104.mjs';

const receiptUrl = new URL('./runtime-cost-m4-104.json', import.meta.url);
const RECEIPT_DIGEST = 'eace33240c8425569685d76530e4b59ec5b07fa874572a93458ea5e17f84ec92';

function compactMeasurement(measurement) {
  const selected = [
    'childat',
    'childcount',
    'emitstatement',
    'emitstatementlist',
    'quotesource',
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

test('M4.104 freezes exact production runtime headroom', () => {
  assert.equal(createHash('sha256').update(readFileSync(receiptUrl)).digest('hex'), RECEIPT_DIGEST);
  const receipt = loadCanonicalizerRuntimeCostM4104();
  assert.deepEqual(validateCanonicalizerRuntimeCostM4104(receipt), receipt);
  assert.deepEqual(buildCanonicalizerRuntimeCostM4104(), receipt);
  assert.equal(receipt.format, 'kern.kir-canonicalizer.runtime-cost-reduction.6');
  assert.deepEqual(receipt.result, {
    belowFloor: 62_829,
    belowFloorOutcome: 'failure',
    exactFloor: 62_830,
    floorOutcome: 'success',
    floorReduction: 9_365,
    productionHeadroom: 2_706,
    promotionBudgetDeficit: 13_678,
    roundTrip: true,
  });
  assert.deepEqual(receipt.optimization, {
    exactFloorReduction: 9_365,
    parentBeforeChildAuthenticated: true,
    quoteEscapeLoopIterations: 104,
    runtimeEngineChanged: false,
    strategy:
      'sparse-validated-source-quoting-with-dense-backslash-fallback-and-parent-bounded-child-lookup',
  });
  assert.deepEqual(receipt.promotion, {
    disposition: 'production-headroom-authenticated-promotion-budget-no-go',
    nextMilestone: 'M4.105',
    profilePromotionApproved: false,
    promotionReady: false,
  });
});

test('M4.104 exact candidate fails below 62830 and succeeds at 62830', () => {
  const receipt = loadCanonicalizerRuntimeCostM4104();
  for (const expected of receipt.observations) {
    assert.deepEqual(compactMeasurement(measureLive(expected.iterationBudget)), expected);
  }
});

test('M4.104 rejects invalid budgets, receipt mutation, decoration, and shared references', () => {
  assert.throws(() => measureLive(0), /positive safe integer/u);
  const receipt = loadCanonicalizerRuntimeCostM4104();
  for (const mutate of [
    (copy) => { copy.result.exactFloor -= 1; },
    (copy) => { copy.optimization.parentBeforeChildAuthenticated = false; },
    (copy) => { copy.observations[1].loopIterations.attemptedByType.while -= 1; },
    (copy) => { copy.promotion.profilePromotionApproved = true; },
  ]) {
    const copy = structuredClone(receipt);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerRuntimeCostM4104(copy),
      /coverage M4\.104 runtime-cost rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), receipt);
  assert.throws(
    () => validateCanonicalizerRuntimeCostM4104(decorated),
    /coverage M4\.104 runtime-cost rejection/u,
  );
  const shared = structuredClone(receipt);
  shared.future = shared.limits;
  assert.throws(
    () => validateCanonicalizerRuntimeCostM4104(shared),
    /cycles or shared references/u,
  );
});

test('M4.104 receipt is canonical and loaders are side-effect free', () => {
  const receipt = loadCanonicalizerRuntimeCostM4104();
  assert.equal(readFileSync(receiptUrl, 'utf8'), `${JSON.stringify(receipt, null, 2)}\n`);
  const fresh = JSON.parse(execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import {loadCanonicalizerRuntimeCostM4104 as load} from './scripts/kern-canonicalizer/runtime-cost-m4-104.mjs'; process.stdout.write(JSON.stringify(load()))",
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
      "await import('./scripts/kern-canonicalizer/runtime-cost-m4-104-measure.mjs'); process.stdout.write('quiet')",
      'scripts/check-kern-canonicalizer-coverage.mjs',
      '62830',
    ],
    { cwd: new URL('../../', import.meta.url), encoding: 'utf8' },
  );
  assert.equal(output, 'quiet');
});
