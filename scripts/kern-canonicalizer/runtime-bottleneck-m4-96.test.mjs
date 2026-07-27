import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  loadCanonicalizerRuntimeBottleneckM496,
  validateCanonicalizerRuntimeBottleneckM496,
} from './runtime-bottleneck-m4-96.mjs';

const summaryUrl = new URL('./runtime-bottleneck-m4-96.json', import.meta.url);

test('M4.96 publishes the exact bounded runtime-bottleneck diagnosis', () => {
  const receipt = loadCanonicalizerRuntimeBottleneckM496();
  assert.equal(receipt.format, 'kern.kir-canonicalizer.runtime-bottleneck.1');
  assert.deepEqual(receipt.witness, {
    id: 'examples/capstone-checker-subset/checker-while.kern#15:comparisonOperandsOk',
    parameterRows: 24,
    structuralRows: { nodes: 53, properties: 95, values: 832 },
  });
  assert.deepEqual(receipt.diagnosis, {
    additionalBudget: 500,
    additionalCacheKeyCodeUnits: 38_788_004,
    additionalExpressionsourcesExecutions: 91,
    additionalRetainedIterations: 500,
    additionalRolledBackIterations: 78_379,
    dominantHelper: 'expressionsources',
    mechanism: 'parent-frame-restart-after-nested-helper-cache-miss',
    nextMilestone: 'M4.97',
    selectedRestartBreakdown: {
      'expressionsources->stringat': 83,
      'expressionsources->validbinaryop': 2,
      'expressionsources->validexpressionidentifier': 6,
    },
  });
  assert.equal(receipt.promotion.profilePromotionApproved, false);
  assert.equal(receipt.observer.publicHandlerOptionExposed, false);
});

test('M4.96 preserves both bounded observations as immutable pre-optimization evidence', () => {
  const receipt = loadCanonicalizerRuntimeBottleneckM496();
  assert.deepEqual(receipt.observations.map(({ iterationBudget, outcome }) => ({
    iterationBudget,
    outcome,
  })), [
    { iterationBudget: 34_000, outcome: 'failure' },
    { iterationBudget: 34_500, outcome: 'failure' },
  ]);
  assert.equal(receipt.observations[1].expressionsources.executions, 92);
  assert.equal(receipt.observations[1].expressionsources.parentRestarts, 91);
  assert.equal(receipt.observations[1].loopIterations.rolledBack, 78_645);
});

test('M4.96 rejects receipt mutation and decoration', () => {
  const receipt = loadCanonicalizerRuntimeBottleneckM496();
  const mutations = [
    (copy) => { copy.format = 'kern.kir-canonicalizer.runtime-bottleneck.2'; },
    (copy) => { copy.observations[1].loopIterations.rolledBack -= 1; },
    (copy) => { copy.diagnosis.dominantHelper = 'tablesok'; },
    (copy) => { copy.promotion.profilePromotionApproved = true; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(receipt);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerRuntimeBottleneckM496(copy),
      /coverage M4\.96 runtime-bottleneck rejection/u,
    );
  }
  const decorated = structuredClone(receipt);
  Object.defineProperty(decorated, 'hidden', { value: true });
  assert.throws(
    () => validateCanonicalizerRuntimeBottleneckM496(decorated),
    /coverage M4\.96 runtime-bottleneck rejection/u,
  );
});

test('M4.96 receipt is canonical and loads in a fresh process', () => {
  const receipt = loadCanonicalizerRuntimeBottleneckM496();
  assert.equal(
    readFileSync(summaryUrl, 'utf8'),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  const fresh = JSON.parse(execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import {loadCanonicalizerRuntimeBottleneckM496 as load} from './scripts/kern-canonicalizer/runtime-bottleneck-m4-96.mjs'; process.stdout.write(JSON.stringify(load()))",
    ],
    { cwd: new URL('../../', import.meta.url), encoding: 'utf8' },
  ));
  assert.deepEqual(fresh, receipt);
});
