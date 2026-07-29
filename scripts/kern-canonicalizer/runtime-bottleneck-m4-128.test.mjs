import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildCanonicalizerRuntimeBottleneckM4128,
  loadCanonicalizerRuntimeBottleneckM4128,
  validateCanonicalizerRuntimeBottleneckM4128,
} from './runtime-bottleneck-m4-128.mjs';
import {
  measureCanonicalizerRuntimeBottleneckM4128,
} from './runtime-bottleneck-m4-128-measure.mjs';

const RECEIPT_URL = new URL('./runtime-bottleneck-m4-128.json', import.meta.url);
const RECEIPT_DIGEST =
  '55512e5cdb91aa43b46ea8ccc09edb3cfe1890920071c13bed10c2d9f81440ac';
const M4127_RECEIPT_URL =
  new URL('./combined-headroom-m4-127.json', import.meta.url);
const M4127_RECEIPT_DIGEST =
  '604f2b9a59d2cd4b56b2a4263fcbb5129dd7bfb41c0601e7573b4a576515dcce';

test('M4.128 publishes an exact four-boundary validate runtime diagnosis', () => {
  assert.equal(
    createHash('sha256').update(readFileSync(RECEIPT_URL)).digest('hex'),
    RECEIPT_DIGEST,
  );
  assert.equal(
    createHash('sha256').update(readFileSync(M4127_RECEIPT_URL)).digest('hex'),
    M4127_RECEIPT_DIGEST,
  );
  const receipt = loadCanonicalizerRuntimeBottleneckM4128();
  assert.deepEqual(validateCanonicalizerRuntimeBottleneckM4128(receipt), receipt);
  assert.deepEqual(buildCanonicalizerRuntimeBottleneckM4128(), receipt);
  assert.equal(receipt.format, 'kern.kir-canonicalizer.runtime-bottleneck.5');
  assert.deepEqual(
    receipt.observations.map(({
      iterationBudget,
      outcome,
      phase,
      roundTrip,
    }) => ({ iterationBudget, outcome, phase, roundTrip })),
    [
      {
        iterationBudget: 49_152,
        outcome: 'failure',
        phase: 'second-recordfield-scan',
        roundTrip: false,
      },
      {
        iterationBudget: 52_023,
        outcome: 'failure',
        phase: 'second-recordfield-scan',
        roundTrip: false,
      },
      {
        iterationBudget: 53_500,
        outcome: 'failure',
        phase: 'emission-in-progress',
        roundTrip: false,
      },
      {
        iterationBudget: 54_894,
        outcome: 'success',
        phase: 'complete',
        roundTrip: true,
      },
    ],
  );
});

test('M4.128 attributes the deficit to two full recordfield scans', () => {
  const receipt = loadCanonicalizerRuntimeBottleneckM4128();
  const [promotion, midpoint, upper, floor] = receipt.observations;
  assert.equal(promotion.selectedHelperExecutions.recordfield, 2);
  assert.equal(midpoint.selectedHelperExecutions.recordfield, 2);
  assert.deepEqual(
    midpoint.selectedHelperExecutions,
    promotion.selectedHelperExecutions,
  );
  assert.deepEqual(
    midpoint.selectedHelperPreparations,
    promotion.selectedHelperPreparations,
  );
  assert.deepEqual(midpoint.cache, promotion.cache);
  assert.equal(
    midpoint.loopIterations.retained - promotion.loopIterations.retained,
    2_871,
  );
  assert.equal(upper.selectedHelperExecutions.validstatement, 159);
  assert.equal(upper.selectedHelperExecutions.emitstatement, 40);
  assert.equal(floor.selectedHelperExecutions.emitstatement, 159);
  assert.equal(receipt.diagnosis.exactRecordfieldIterations, 2 * 4_493);
  assert.equal(receipt.diagnosis.recordfieldIterationsBeyondDeficit, 3_244);
  assert.equal(
    receipt.diagnosis.mechanism,
    'two-full-value-table-recordfield-scans-during-assignment-target-validation',
  );
  assert.equal(
    receipt.diagnosis.optimizationTarget,
    'fold-assignment-target-kind-authentication-into-existing-expression-projection',
  );
  assert.deepEqual(receipt.observer.recentPromotionTail, [
    'prepare:recordfield',
    'cache:recordfield:miss',
    'suspend:validstatement->recordfield',
    'cache:recordfield:miss',
    'execute:recordfield',
  ]);
  assert.equal(receipt.promotion.combinedPromotionApproved, false);
  assert.equal(receipt.promotion.nextMilestone, 'M4.129');
});

test('M4.128 live promotion observation preserves observer parity', () => {
  const measured = measureCanonicalizerRuntimeBottleneckM4128(49_152);
  assert.equal(measured.envelope.outcome, 'failure');
  assert.equal(measured.roundTrip, false);
  assert.equal(measured.observerParityVerified, true);
  assert.deepEqual(measured.summary.loopIterations, {
    attemptedByType: { for: 49_152 },
    retained: 49_152,
    rolledBack: 0,
  });
  assert.equal(measured.summary.helperExecutions.recordfield, 2);
  assert.equal(measured.summary.helperExecutions.emitstatement, undefined);
  assert.deepEqual(measured.summary.recentNonLoopEvents.slice(-5), [
    'prepare:recordfield',
    'cache:recordfield:miss',
    'suspend:validstatement->recordfield',
    'cache:recordfield:miss',
    'execute:recordfield',
  ]);
});

test('M4.128 rejects invalid budgets, receipt drift, decoration, sharing, and cycles', () => {
  assert.throws(
    () => measureCanonicalizerRuntimeBottleneckM4128(0),
    /M4\.128 runtime-bottleneck measurement rejection/u,
  );
  const actual = loadCanonicalizerRuntimeBottleneckM4128();
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.runtime-bottleneck.6'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.diagnosis.exactRecordfieldIterations -= 1; },
    (copy) => { copy.observations[0].selectedHelperExecutions.recordfield = 1; },
    (copy) => { copy.promotion.combinedPromotionApproved = true; },
  ]) {
    const copy = structuredClone(actual);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerRuntimeBottleneckM4128(copy),
      /coverage M4\.128 runtime-bottleneck rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), actual);
  assert.throws(
    () => validateCanonicalizerRuntimeBottleneckM4128(decorated),
    /coverage M4\.128 runtime-bottleneck rejection/u,
  );
  const shared = structuredClone(actual);
  shared.future = shared.limits;
  assert.throws(
    () => validateCanonicalizerRuntimeBottleneckM4128(shared),
    /cycles or shared references/u,
  );
  const cyclic = structuredClone(actual);
  cyclic.future = cyclic;
  assert.throws(
    () => validateCanonicalizerRuntimeBottleneckM4128(cyclic),
    /cycles or shared references/u,
  );
});

test('M4.128 loads canonically in a fresh process and imports quietly', () => {
  const receipt = loadCanonicalizerRuntimeBottleneckM4128();
  assert.equal(readFileSync(RECEIPT_URL, 'utf8'), `${JSON.stringify(receipt, null, 2)}\n`);
  const fresh = JSON.parse(execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import {loadCanonicalizerRuntimeBottleneckM4128 as load} from './scripts/kern-canonicalizer/runtime-bottleneck-m4-128.mjs'; process.stdout.write(JSON.stringify(load()))",
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
      "await import('./scripts/kern-canonicalizer/runtime-bottleneck-m4-128-measure.mjs'); process.stdout.write('quiet')",
      'scripts/check-kern-canonicalizer-coverage.mjs',
      '54894',
    ],
    { cwd: new URL('../../', import.meta.url), encoding: 'utf8' },
  );
  assert.equal(output, 'quiet');
});
