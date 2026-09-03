import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  executeInternalRuntimeEnvelopeAsync,
  executeInternalRuntimeEnvelopeSync,
  limits,
  makeEnv,
  registerAllContracts,
} from './support.mjs';

registerAllContracts();

const SCHEDULER_TIMEOUT_MS = 25;
const ITERATIONS = 60_000;
const PRE_AMENDMENT_BUDGET = 1_048_576;

function countedLoop(count) {
  return [{ children: [], props: { from: '0', name: 'i', to: String(count) }, type: 'for' }];
}

function options(maxIterations) {
  return {
    enabled: true,
    limits: limits({ maxIterations }),
    scheduler: { timeoutMs: SCHEDULER_TIMEOUT_MS },
  };
}

test('L8: a synchronous counted loop runs past scheduler.timeoutMs without being terminated', () => {
  const started = Date.now();
  const envelope = executeInternalRuntimeEnvelopeSync(countedLoop(ITERATIONS), makeEnv(), options(33_554_432));
  const elapsed = Date.now() - started;
  assert.equal(envelope.outcome, 'success');
  assert.deepEqual(envelope.diagnostics, []);
  assert.ok(elapsed > SCHEDULER_TIMEOUT_MS, `elapsed ${elapsed}ms did not exceed the deadline`);
});

test('L8: the pre-amendment budget shows the same unbounded synchronous run', () => {
  const started = Date.now();
  const envelope = executeInternalRuntimeEnvelopeSync(countedLoop(ITERATIONS), makeEnv(), options(PRE_AMENDMENT_BUDGET));
  const elapsed = Date.now() - started;
  assert.equal(envelope.outcome, 'success');
  assert.ok(elapsed > SCHEDULER_TIMEOUT_MS, `elapsed ${elapsed}ms did not exceed the deadline`);
});

test('L8: the async path does not preempt a counted loop at the deadline either', async () => {
  const started = Date.now();
  const envelope = await executeInternalRuntimeEnvelopeAsync(countedLoop(ITERATIONS), makeEnv(), options(33_554_432));
  const elapsed = Date.now() - started;
  assert.equal(envelope.outcome, 'success');
  assert.deepEqual(envelope.diagnostics, []);
  assert.ok(elapsed > SCHEDULER_TIMEOUT_MS, `elapsed ${elapsed}ms did not exceed the deadline`);
});

test('L8: only the while frame carries a hard iteration ceiling of its own', () => {
  const nodes = [
    { props: { kind: 'let', name: 'i', value: '0' }, type: 'let' },
    {
      children: [{ props: { op: '+=', target: 'i', value: '1' }, type: 'assign' }],
      props: { cond: 'i < 200000' },
      type: 'while',
    },
  ];
  const envelope = executeInternalRuntimeEnvelopeSync(nodes, makeEnv(), options(33_554_432));
  assert.equal(envelope.outcome, 'failure');
  assert.deepEqual(
    envelope.diagnostics.map((diagnostic) => diagnostic.code),
    ['unsupported-runtime-input'],
  );
});
