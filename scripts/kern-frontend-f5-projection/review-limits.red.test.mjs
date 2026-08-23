import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import { __test, runProjection } from './worker.mjs';

const MODULE = [{ moduleId: 'limit.kern', source: 'fn name=limit export=true\n' }];
const LIMIT_NAMES = [
  'maxModules', 'maxInstructionScalars', 'maxWorkSteps', 'maxNodes', 'maxDepth',
  'maxCollectionLength', 'maxStringCodePoints',
];

function projected(limits) {
  return __test.runProjectionWithProfileLimits(MODULE, limits);
}

function minimumPassing(name) {
  let low = 1;
  let high = 1;
  while (projected({ [name]: high }).receipt.status !== 'projected') high *= 2;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (projected({ [name]: middle }).receipt.status === 'projected') high = middle;
    else low = middle + 1;
  }
  return low;
}

test('F5-R7 all seven profile limits distinguish exact from one-over atomically', () => {
  for (const name of LIMIT_NAMES) {
    const exact = minimumPassing(name);
    const accepted = projected({ [name]: exact });
    assert.equal(accepted.receipt.status, 'projected', `${name} exact`);
    assert.ok(accepted.bytes instanceof Uint8Array, `${name} exact bytes`);
    const rejected = projected({ [name]: exact - 1 });
    assert.equal(rejected.receipt.status, 'fatal', `${name} one-over status`);
    assert.equal(rejected.receipt.diagnostics[0].code, 'F5_LIMIT', `${name} one-over code`);
    assert.equal(rejected.bytes, null, `${name} one-over atomicity`);
  }
});

test('F5-R7 1x/2x/4x/8x growth stays inside the charged scaling envelope', () => {
  const timings = [];
  for (const factor of [1, 2, 4, 8]) {
    const modules = Array.from({ length: factor * 4 }, (_, index) => ({
      moduleId: `growth/${String(index).padStart(3, '0')}.kern`,
      source: `fn name=f${index} export=true\n`,
    }));
    const start = performance.now();
    const result = runProjection(modules);
    timings.push(performance.now() - start);
    assert.equal(result.receipt.status, 'projected', `${factor}x status`);
    assert.ok(result.receipt.workSteps > 0, `${factor}x charged work`);
  }
  for (let index = 1; index < timings.length; index += 1) {
    assert.ok(timings[index] < timings[index - 1] * 3.5 + 250,
      `growth ${index}: ${timings.join(', ')}`);
  }
});
