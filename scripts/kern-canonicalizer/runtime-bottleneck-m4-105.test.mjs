import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  measureCanonicalizerRuntimeBottleneckM4105,
} from './runtime-bottleneck-m4-105-measure.mjs';
import {
  buildCanonicalizerRuntimeBottleneckM4105,
  loadCanonicalizerRuntimeBottleneckM4105,
  validateCanonicalizerRuntimeBottleneckM4105,
} from './runtime-bottleneck-m4-105.mjs';

const receiptUrl = new URL('./runtime-bottleneck-m4-105.json', import.meta.url);
const RECEIPT_DIGEST = '06538ef420d2374ecf39f5b12d775189c73cfa11a66a3ef460cf795c273db7e0';

test('M4.105 publishes the exact residual statement runtime-bottleneck diagnosis', () => {
  assert.equal(createHash('sha256').update(readFileSync(receiptUrl)).digest('hex'), RECEIPT_DIGEST);
  const receipt = loadCanonicalizerRuntimeBottleneckM4105();
  assert.deepEqual(validateCanonicalizerRuntimeBottleneckM4105(receipt), receipt);
  assert.deepEqual(buildCanonicalizerRuntimeBottleneckM4105(), receipt);
  assert.equal(receipt.format, 'kern.kir-canonicalizer.runtime-bottleneck.3');
  assert.deepEqual(receipt.observations.map((observation) => ({
    iterationBudget: observation.iterationBudget,
    outcome: observation.outcome,
    roundTrip: observation.roundTrip,
  })), [
    { iterationBudget: 49_152, outcome: 'failure', roundTrip: false },
    { iterationBudget: 62_830, outcome: 'success', roundTrip: true },
  ]);
  assert.equal(receipt.diagnosis.additionalRetainedIterations, 13_678);
  assert.equal(receipt.diagnosis.additionalRolledBackIterations, 0);
  assert.equal(receipt.diagnosis.additionalParentRestarts, 0);
  assert.equal(receipt.diagnosis.emissionExecutionsAtPromotionBudget, 0);
  assert.equal(receipt.diagnosis.validstatementExecutionsAtPromotionBudget, 34);
  assert.equal(receipt.diagnosis.validstatementExecutionsAtExactFloor, 73);
  assert.equal(
    receipt.diagnosis.optimizationTarget,
    'consolidated-authenticated-statement-property-and-child-count-access',
  );
  assert.deepEqual(receipt.promotion, {
    disposition: 'residual-runtime-bottleneck-attributed-optimization-required',
    nextMilestone: 'M4.106',
    profilePromotionApproved: false,
    promotionReady: false,
  });
});

test('M4.105 boundary remains immutable archival evidence after M4.106', () => {
  const receipt = loadCanonicalizerRuntimeBottleneckM4105();
  for (const expected of receipt.observations) {
    assert.throws(
      () => measureCanonicalizerRuntimeBottleneckM4105(expected.iterationBudget),
      assert.AssertionError,
    );
  }
});

test('M4.105 proves the promotion failure occurs during validation before emission', () => {
  const receipt = loadCanonicalizerRuntimeBottleneckM4105();
  const promotion = receipt.observations[0];
  const floor = receipt.observations[1];
  assert.deepEqual(promotion.loopIterations, {
    attemptedByType: { for: 49_152 },
    retained: 49_152,
    rolledBack: 0,
  });
  assert.equal(promotion.parentRestartCount, 0);
  assert.equal(promotion.selectedHelperExecutions.emitstatementlist, 0);
  assert.equal(promotion.selectedHelperExecutions.emitstatement, 0);
  assert.ok(promotion.selectedHelperExecutions.validstatement > 0);
  assert.equal(
    floor.loopIterations.retained - promotion.loopIterations.retained,
    receipt.diagnosis.additionalRetainedIterations,
  );
  assert.equal(receipt.observer.helperLoopAttributionAvailable, false);
});

test('M4.105 rejects invalid budgets, receipt mutation, decoration, and shared references', () => {
  assert.throws(
    () => measureCanonicalizerRuntimeBottleneckM4105(0),
    /M4\.105 iteration budget must be a positive safe integer/u,
  );
  const receipt = loadCanonicalizerRuntimeBottleneckM4105();
  for (const mutate of [
    (copy) => { copy.diagnosis.additionalRetainedIterations -= 1; },
    (copy) => { copy.observations[0].selectedHelperExecutions.emitstatement = 1; },
    (copy) => { copy.observer.helperLoopAttributionAvailable = true; },
    (copy) => { copy.promotion.profilePromotionApproved = true; },
  ]) {
    const copy = structuredClone(receipt);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerRuntimeBottleneckM4105(copy),
      /coverage M4\.105 runtime-bottleneck rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), receipt);
  assert.throws(
    () => validateCanonicalizerRuntimeBottleneckM4105(decorated),
    /coverage M4\.105 runtime-bottleneck rejection/u,
  );
  const shared = structuredClone(receipt);
  shared.future = shared.limits;
  assert.throws(
    () => validateCanonicalizerRuntimeBottleneckM4105(shared),
    /cycles or shared references/u,
  );
});

test('M4.105 preserves M4.104 bytes and loads canonically in a fresh process', () => {
  assert.equal(
    createHash('sha256').update(readFileSync(
      new URL('./runtime-cost-m4-104.json', import.meta.url),
    )).digest('hex'),
    'eace33240c8425569685d76530e4b59ec5b07fa874572a93458ea5e17f84ec92',
  );
  const receipt = loadCanonicalizerRuntimeBottleneckM4105();
  assert.equal(readFileSync(receiptUrl, 'utf8'), `${JSON.stringify(receipt, null, 2)}\n`);
  const fresh = JSON.parse(execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import {loadCanonicalizerRuntimeBottleneckM4105 as load} from './scripts/kern-canonicalizer/runtime-bottleneck-m4-105.mjs'; process.stdout.write(JSON.stringify(load()))",
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
      "await import('./scripts/kern-canonicalizer/runtime-bottleneck-m4-105-measure.mjs'); process.stdout.write('quiet')",
      'scripts/check-kern-canonicalizer-coverage.mjs',
      '49152',
    ],
    { cwd: new URL('../../', import.meta.url), encoding: 'utf8' },
  );
  assert.equal(output, 'quiet');
});
