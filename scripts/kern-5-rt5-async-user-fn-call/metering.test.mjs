import assert from 'node:assert/strict';
import test from 'node:test';

import { directStepBudget } from '../kern-5-rt4-user-fn-call/k0-support.mjs';
import {
  ASYNC_TEXT_HELPER,
  CAPABILITY_LINE,
  RELAY_HELPER,
  SYNC_TEXT_HELPER,
  TEXT_INPUT,
  entryFn,
  moduleSource,
  textArgs,
} from './k0-support.mjs';

const FIXTURES = Object.freeze({
  'inline-capability-control': moduleSource([entryFn([CAPABILITY_LINE, 'return value="reply"'], TEXT_INPUT, 'string')]),
  'one-async-call': moduleSource([ASYNC_TEXT_HELPER, entryFn(['return value="fetchIt(t)"'], TEXT_INPUT, 'string')]),
  'paired-async-call': moduleSource([
    ASYNC_TEXT_HELPER,
    entryFn(['let name=a value="fetchIt(t)"', 'return value="fetchIt(a)"'], TEXT_INPUT, 'string'),
  ]),
  'return-control': moduleSource([entryFn(['return value="t"'], TEXT_INPUT, 'string')]),
  'sync-call-control': moduleSource([SYNC_TEXT_HELPER, entryFn(['return value="echo(t)"'], TEXT_INPUT, 'string')]),
  'transitive-async-call': moduleSource([
    ASYNC_TEXT_HELPER,
    RELAY_HELPER,
    entryFn(['return value="relay(t)"'], TEXT_INPUT, 'string'),
  ]),
});

const EXECUTION_STEPS = Object.freeze({
  'inline-capability-control': 5,
  'one-async-call': 8,
  'paired-async-call': 15,
  'return-control': 3,
  'sync-call-control': 6,
  'transitive-async-call': 11,
});

async function steps() {
  const observed = {};
  for (const name of Object.keys(FIXTURES).sort()) {
    observed[name] = (await directStepBudget(FIXTURES[name], textArgs('m'), `rt5-meter-${name}`)).execution;
  }
  return observed;
}

test('the execution step budget of every metering fixture is pinned absolutely', async () => {
  assert.deepEqual(
    await steps(),
    EXECUTION_STEPS,
    'RT5_METER_DRIFT: an absolute step count moved, so the metering model changed',
  );
});

test('a synchronous call still costs exactly three steps, so RT-4 metering is untouched', () => {
  assert.equal(EXECUTION_STEPS['sync-call-control'] - EXECUTION_STEPS['return-control'], 3);
});

test('resume is zero-cost: a capability costs the same inside a callee as it does inline', () => {
  const inline = EXECUTION_STEPS['inline-capability-control'] - EXECUTION_STEPS['return-control'];
  const suspended = EXECUTION_STEPS['one-async-call'] - EXECUTION_STEPS['sync-call-control'];
  assert.equal(
    suspended,
    inline,
    'suspending and resuming a callee must not charge a step the inline capability does not charge',
  );
});

test('the paired call costs exactly twice the call, dispatch and body of one call', () => {
  const constant = EXECUTION_STEPS['return-control'] - 2;
  const single = EXECUTION_STEPS['one-async-call'] - constant;
  const paired = EXECUTION_STEPS['paired-async-call'] - constant;
  assert.equal(paired, 2 * single, 'RT5_RESUME_DOUBLE_METERED: a second dispatch costs exactly what the first cost');
});

test('a transitive hop costs one more call, argument and dispatch and nothing else', () => {
  assert.equal(EXECUTION_STEPS['transitive-async-call'] - EXECUTION_STEPS['one-async-call'], 3);
});
