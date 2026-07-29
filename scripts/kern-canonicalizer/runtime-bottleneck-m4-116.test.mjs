import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  measureCanonicalizerRuntimeBottleneckM4116,
} from './runtime-bottleneck-m4-116-measure.mjs';
import {
  buildCanonicalizerRuntimeBottleneckM4116,
  loadCanonicalizerRuntimeBottleneckM4116,
  validateCanonicalizerRuntimeBottleneckM4116,
} from './runtime-bottleneck-m4-116.mjs';

const RECEIPT_URL = new URL('./runtime-bottleneck-m4-116.json', import.meta.url);
const RECEIPT_DIGEST = '5342271907023c75b1c3b5acfd714860f6686d31a5a3bf60c37e7d8f73803056';
const M4115_RECEIPT_URL = new URL('./triple-row-headroom-m4-115.json', import.meta.url);
const M4115_RECEIPT_DIGEST =
  '0142e5d39fc94ec76e2cf793a62a922fa9087a12fb4cd83b9499cfc58f922b9d';
test('M4.116 publishes an exact three-boundary checkModule runtime diagnosis', () => {
  assert.equal(
    createHash('sha256').update(readFileSync(RECEIPT_URL)).digest('hex'),
    RECEIPT_DIGEST,
  );
  assert.equal(
    createHash('sha256').update(readFileSync(M4115_RECEIPT_URL)).digest('hex'),
    M4115_RECEIPT_DIGEST,
  );
  const receipt = loadCanonicalizerRuntimeBottleneckM4116();
  assert.deepEqual(validateCanonicalizerRuntimeBottleneckM4116(receipt), receipt);
  assert.deepEqual(buildCanonicalizerRuntimeBottleneckM4116(), receipt);
  assert.equal(receipt.format, 'kern.kir-canonicalizer.runtime-bottleneck.4');
  assert.deepEqual(
    receipt.observations.map(({ iterationBudget, outcome, roundTrip }) => ({
      iterationBudget,
      outcome,
      roundTrip,
    })),
    [
      { iterationBudget: 49_152, outcome: 'failure', roundTrip: false },
      { iterationBudget: 65_536, outcome: 'failure', roundTrip: false },
      { iterationBudget: 176_119, outcome: 'success', roundTrip: true },
    ],
  );
  assert.equal(receipt.promotion.profilePromotionApproved, false);
  assert.equal(receipt.promotion.nextMilestone, 'M4.117');
});

test('M4.116 attributes the dominant cost to repeated full typefields scans', () => {
  const receipt = loadCanonicalizerRuntimeBottleneckM4116();
  const [promotion, production, floor] = receipt.observations;
  assert.equal(promotion.selectedHelperExecutions.validstatementlist, 0);
  assert.equal(production.selectedHelperExecutions.validstatementlist, 0);
  assert.equal(promotion.selectedHelperExecutions.emitstatement, 0);
  assert.equal(production.selectedHelperExecutions.emitstatement, 0);
  assert.deepEqual(promotion.typefields, {
    executionsEntered: 18,
    minimumCompletedFullScans: 17,
  });
  assert.deepEqual(production.typefields, {
    executionsEntered: 24,
    minimumCompletedFullScans: 23,
  });
  assert.deepEqual(floor.typefields, {
    completedFullScans: 59,
    executionsEntered: 59,
  });
  assert.equal(59 * receipt.diagnosis.valueRowsPerTypefieldsExecution, 142_249);
  assert.equal(
    receipt.diagnosis.exactFloorTypefieldsShareBasisPoints,
    Math.round(142_249 * 10_000 / floor.iterationBudget),
  );
  assert.equal(
    receipt.diagnosis.mechanism,
    'repeated-full-value-table-scans-during-function-parameter-type-validation',
  );
  assert.equal(
    receipt.diagnosis.optimizationTarget,
    'single-pass-authenticated-function-type-field-index',
  );
  assert.deepEqual(receipt.diagnosis.promotionToProduction, {
    additionalCacheHits: 596,
    additionalCacheKeyCodeUnits: 6_069_919,
    additionalCacheMisses: 208,
    additionalForIterations: 16_384,
    additionalHelperExecutions: 104,
    additionalHelperFrameSuspensions: 44,
    additionalHelperPreparations: 700,
    additionalRetainedIterations: 16_384,
    additionalWhileIterations: 0,
    additionalCompletedTypefieldsIterations: 14_466,
    additionalCompletedTypefieldsScans: 6,
  });
  assert.equal(
    receipt.diagnosis.productionToFloor.minimumAdditionalCompletedTypefieldsIterations,
    84_385,
  );
});

test('M4.116 exact observations remain immutable archival evidence after M4.117', () => {
  const receipt = loadCanonicalizerRuntimeBottleneckM4116();
  assert.deepEqual(receipt.observations.map(({ outcome }) => outcome), [
    'failure',
    'failure',
    'success',
  ]);
  const successor = measureCanonicalizerRuntimeBottleneckM4116(
    receipt.observations[0].iterationBudget,
  );
  assert.equal(successor.envelope.outcome, 'success');
  assert.equal(successor.roundTrip, true);
  assert.equal(successor.observerParityVerified, true);
  assert.equal(successor.summary.helperExecutions.typefieldtablefacts, 1);
  assert.equal(successor.summary.loopIterations.retained, 38_693);
});

test('M4.116 rejects invalid budgets, receipt drift, decoration, sharing, and cycles', () => {
  assert.throws(
    () => measureCanonicalizerRuntimeBottleneckM4116(0),
    /M4\.116 iteration budget must be a positive safe integer/u,
  );
  const receipt = loadCanonicalizerRuntimeBottleneckM4116();
  for (const mutate of [
    (copy) => { copy.diagnosis.exactFloorTypefieldsIterations -= 1; },
    (copy) => { copy.observations[1].selectedHelperExecutions.validstatementlist = 1; },
    (copy) => { copy.observer.helperExecuteSemantics = 'completion'; },
    (copy) => { copy.promotion.profilePromotionApproved = true; },
  ]) {
    const copy = structuredClone(receipt);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerRuntimeBottleneckM4116(copy),
      /coverage M4\.116 runtime-bottleneck rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), receipt);
  assert.throws(
    () => validateCanonicalizerRuntimeBottleneckM4116(decorated),
    /coverage M4\.116 runtime-bottleneck rejection/u,
  );
  const shared = structuredClone(receipt);
  shared.future = shared.limits;
  assert.throws(
    () => validateCanonicalizerRuntimeBottleneckM4116(shared),
    /cycles or shared references/u,
  );
  const cyclic = structuredClone(receipt);
  cyclic.future = cyclic;
  assert.throws(
    () => validateCanonicalizerRuntimeBottleneckM4116(cyclic),
    /cycles or shared references/u,
  );
});

test('M4.116 loads canonically in a fresh process and measurement import is quiet', () => {
  const receipt = loadCanonicalizerRuntimeBottleneckM4116();
  assert.equal(readFileSync(RECEIPT_URL, 'utf8'), `${JSON.stringify(receipt, null, 2)}\n`);
  const fresh = JSON.parse(execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import {loadCanonicalizerRuntimeBottleneckM4116 as load} from './scripts/kern-canonicalizer/runtime-bottleneck-m4-116.mjs'; process.stdout.write(JSON.stringify(load()))",
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
      "await import('./scripts/kern-canonicalizer/runtime-bottleneck-m4-116-measure.mjs'); process.stdout.write('quiet')",
      'scripts/check-kern-canonicalizer-coverage.mjs',
      '176119',
    ],
    { cwd: new URL('../../', import.meta.url), encoding: 'utf8' },
  );
  assert.equal(output, 'quiet');
});
