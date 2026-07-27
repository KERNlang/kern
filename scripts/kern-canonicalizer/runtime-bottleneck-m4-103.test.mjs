import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { measureCanonicalizerRuntimeBottleneckM4103 } from './runtime-bottleneck-m4-103-measure.mjs';
import {
  buildCanonicalizerRuntimeBottleneckM4103,
  loadCanonicalizerRuntimeBottleneckM4103,
  validateCanonicalizerRuntimeBottleneckM4103,
} from './runtime-bottleneck-m4-103.mjs';
const receiptUrl = new URL('./runtime-bottleneck-m4-103.json', import.meta.url);
const RECEIPT_DIGEST = 'a8f80c8d63cbaba2ff6d5d579d347ff9c489719e8f5170a95acadfbbfcd19488';

test('M4.103 publishes the exact validstatement runtime-bottleneck diagnosis', () => {
  assert.equal(createHash('sha256').update(readFileSync(receiptUrl)).digest('hex'), RECEIPT_DIGEST);
  const receipt = loadCanonicalizerRuntimeBottleneckM4103();
  assert.deepEqual(validateCanonicalizerRuntimeBottleneckM4103(receipt), receipt);
  assert.deepEqual(buildCanonicalizerRuntimeBottleneckM4103(), receipt);
  assert.equal(receipt.format, 'kern.kir-canonicalizer.runtime-bottleneck.2');
  assert.deepEqual(receipt.witness, {
    id: 'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#2:validstatement',
    parameterRows: 14,
    structuralRows: { nodes: 89, properties: 125, values: 2100 },
  });
  assert.deepEqual(receipt.observations.map((observation) => ({
    iterationBudget: observation.iterationBudget,
    outcome: observation.outcome,
    roundTrip: observation.roundTrip,
  })), [
    { iterationBudget: 65_536, outcome: 'failure', roundTrip: false },
    { iterationBudget: 72_195, outcome: 'success', roundTrip: true },
  ]);
  assert.deepEqual(receipt.diagnosis, {
    additionalBudget: 6_659,
    additionalCacheKeyCodeUnits: 28_276_387,
    additionalHelperExecutions: 261,
    additionalHelperFrameSuspensions: 228,
    additionalHelperPreparations: 1_084,
    additionalParentRestarts: 0,
    additionalRetainedForIterations: 6_659,
    additionalRolledBackIterations: 0,
    budgetAttribution: 'all-retained-for-iterations',
    emissionExecutionsAtProductionCeiling: 0,
    mechanism: 'committed-validation-and-emission-loop-work',
    nextMilestone: 'M4.104',
    optimizationTarget: 'statement-validation-and-emission-table-traversal',
    selectedHelperExecutionDeltas: {
      validstatementlist: 3,
      validstatement: 9,
      exprsource: 10,
      expressionsources: 0,
      emitstatementlist: 27,
      emitstatement: 73,
      stringat: 54,
      quotesource: 43,
      indentation: 3,
    },
  });
  assert.equal(receipt.promotion.profilePromotionApproved, false);
});

test('M4.103 live measurement rejects non-positive budgets', () => {
  assert.throws(
    () => measureCanonicalizerRuntimeBottleneckM4103(0),
    /positive safe integer/u,
  );
});

test('M4.103 observations remain immutable archival evidence after M4.104', () => {
  const receipt = loadCanonicalizerRuntimeBottleneckM4103();
  assert.deepEqual(receipt.observations.map(({ iterationBudget, outcome, roundTrip }) => ({
    iterationBudget,
    outcome,
    roundTrip,
  })), [
    { iterationBudget: 65_536, outcome: 'failure', roundTrip: false },
    { iterationBudget: 72_195, outcome: 'success', roundTrip: true },
  ]);
  assert.throws(
    () => measureCanonicalizerRuntimeBottleneckM4103(receipt.observations[1].iterationBudget),
    /must remain exact|Expected values to be strictly equal/u,
  );
});

test('M4.103 measurement owner is side-effect free with unrelated numeric argv', () => {
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "await import('./scripts/kern-canonicalizer/runtime-bottleneck-m4-103-measure.mjs'); process.stdout.write('quiet')",
      'scripts/check-kern-canonicalizer-coverage.mjs',
      '72195',
    ],
    { cwd: new URL('../../', import.meta.url), encoding: 'utf8' },
  );
  assert.equal(output, 'quiet');
});

test('M4.103 rejects receipt mutation, decoration, and shared references', () => {
  const receipt = loadCanonicalizerRuntimeBottleneckM4103();
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.runtime-bottleneck.3'; },
    (copy) => { copy.observations[0].loopIterations.rolledBack += 1; },
    (copy) => { copy.diagnosis.mechanism = 'parent-frame-restart'; },
    (copy) => { copy.promotion.profilePromotionApproved = true; },
  ]) {
    const copy = structuredClone(receipt);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerRuntimeBottleneckM4103(copy),
      /coverage M4\.103 runtime-bottleneck rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), receipt);
  assert.throws(
    () => validateCanonicalizerRuntimeBottleneckM4103(decorated),
    /coverage M4\.103 runtime-bottleneck rejection/u,
  );
  const shared = structuredClone(receipt);
  shared.future = shared.limits;
  assert.throws(
    () => validateCanonicalizerRuntimeBottleneckM4103(shared),
    /cycles or shared references/u,
  );
});

test('M4.103 preserves M4.102 bytes and loads canonically in a fresh process', () => {
  const m4102 = JSON.parse(readFileSync(
    new URL('./triple-row-headroom-m4-102.json', import.meta.url),
    'utf8',
  ));
  assert.equal(m4102.witnesses[0].exactFloor, 72_195);
  assert.equal(m4102.promotion.nextMilestone, 'M4.103');
  const receipt = loadCanonicalizerRuntimeBottleneckM4103();
  assert.equal(readFileSync(receiptUrl, 'utf8'), `${JSON.stringify(receipt, null, 2)}\n`);
  const fresh = JSON.parse(execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import {loadCanonicalizerRuntimeBottleneckM4103 as load} from './scripts/kern-canonicalizer/runtime-bottleneck-m4-103.mjs'; process.stdout.write(JSON.stringify(load()))",
    ],
    {
      cwd: new URL('../../', import.meta.url),
      encoding: 'utf8',
      env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
    },
  ));
  assert.deepEqual(fresh, receipt);
});
