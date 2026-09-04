import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASYNC_INT_HELPER,
  CAPABILITY,
  CAPABILITY_EVENT,
  between,
  countOccurrences,
  emittedArtifacts,
  integerSlot,
  program,
  runtimeRequest,
  threeLegBytes,
} from './k0-support.mjs';
import { abortingProvider, assertLegParity, threeLegAbort } from '../kern-5-rt5-async-user-fn-call/k0-support.mjs';

// RT10F-C3 claimed a capability call inside a `for` body is unprojectable because `for`'s
// `allowedChildren` excludes `capability`. That premise is correct in isolation but the conclusion
// is not: `if` IS an allowed child of `for`, and `if`'s own `allowedChildren` is `null`
// (unrestricted), so a capability nested one level under an `if` inside a `for` body projects,
// links and runs on all three legs. See spec.md's Corrections Log for the full chain.
const SECOND_CAPABILITY = 'capability namespace=fixture operation=second name=again';
const SECOND_CAPABILITY_EVENT = Object.freeze({ ...CAPABILITY_EVENT, operation: 'second' });

const CAPABILITY_UNDER_IF_EVERY_TRIP = () =>
  program([
    'let name=acc value="0"',
    'for name=i from="0" to="3"',
    '  if cond="true"',
    `    ${CAPABILITY}`,
    '  assign target="acc" value="acc + i"',
    'return value="acc"',
  ]);

const CAPABILITY_UNDER_IF_ONE_TRIP = () =>
  program([
    'let name=acc value="0"',
    'for name=i from="0" to="3"',
    '  if cond="i == 1"',
    `    ${CAPABILITY}`,
    '  assign target="acc" value="acc + i"',
    'return value="acc"',
  ]);

const ASYNC_LET_AND_CAPABILITY_UNDER_IF = () =>
  program(
    [
      'let name=acc value="0"',
      'for name=i from="0" to="3"',
      '  let name=x value="afi()"',
      '  if cond="true"',
      `    ${SECOND_CAPABILITY}`,
      '  assign target="acc" value="acc + x"',
      'return value="acc"',
    ],
    { helpers: [ASYNC_INT_HELPER] },
  );

const CAPABILITY_UNDER_IF_STRAIGHT_LINE = () =>
  program([
    'let name=acc value="0"',
    'if cond="true"',
    `  ${CAPABILITY}`,
    'assign target="acc" value="acc + 1"',
    'return value="acc"',
  ]);

async function statementRegion(source) {
  const artifacts = await emittedArtifacts(source);
  const javascriptSpecialized = between(
    artifacts.javascript,
    'const __runSpecialized=',
    'const execute=async(input,executionOptions)',
    'the emitted JavaScript specialized handler',
  );
  const pythonSpecialized = between(
    artifacts.python,
    'async def _run_specialized(',
    'async def execute(',
    'the emitted Python specialized handler',
  );
  return {
    javascript: between(javascriptSpecialized, '    try {', '    } finally {', 'the JavaScript statement region'),
    python: between(pythonSpecialized, '    try:', '    finally:', 'the Python statement region'),
  };
}

function awaitCensus(region) {
  return {
    javascript: countOccurrences(region.javascript, 'await '),
    python: countOccurrences(region.python, 'await '),
  };
}

function loopHead(region) {
  const javascriptMatch = /for\([^)]*\)\{/u.exec(region.javascript);
  assert.ok(javascriptMatch !== null, 'the JavaScript loop head must be a single-line for(...)');
  const pythonLine = region.python.split('\n').find((line) => line.trim().startsWith('while '));
  assert.ok(pythonLine !== undefined, 'the Python loop head must be a single while line');
  return { javascript: javascriptMatch[0], python: pythonLine };
}

test('a capability nested under an if inside a for body projects, links and runs on all three legs', async () => {
  const { legs } = await threeLegBytes(CAPABILITY_UNDER_IF_EVERY_TRIP(), runtimeRequest('rt10f-cap-every-trip', {}));
  assert.equal(legs.direct.envelope.outcome, 'success');
  assert.deepEqual(legs.direct.envelope.result, integerSlot('3'), '0 + 1 + 2, to exclusive');
  assert.deepEqual(
    [...legs.direct.envelope.events],
    [CAPABILITY_EVENT, CAPABILITY_EVENT, CAPABILITY_EVENT],
    'RT10F_CAP_LOOP_ORDER: one capability event per trip, in trip order, identical on every leg',
  );
  assert.equal(legs.direct.calls.length, 3);
  assert.equal(legs.javascript.calls.length, 3);
  assert.equal(legs.python.calls.length, 3);
});

test('a capability guarded by a condition true on only one trip fires exactly once', async () => {
  const { legs } = await threeLegBytes(CAPABILITY_UNDER_IF_ONE_TRIP(), runtimeRequest('rt10f-cap-one-trip', {}));
  assert.equal(legs.direct.envelope.outcome, 'success');
  assert.deepEqual(legs.direct.envelope.result, integerSlot('3'));
  assert.deepEqual(
    [...legs.direct.envelope.events],
    [CAPABILITY_EVENT],
    'RT10F_CAP_LOOP_GUARD: the untaken trips must not fire the capability',
  );
  assert.equal(legs.direct.calls.length, 1);
  assert.equal(legs.javascript.calls.length, 1);
  assert.equal(legs.python.calls.length, 1);
});

test('an async helper let and a capability under if interleave per trip, identically on every leg', async () => {
  const { legs } = await threeLegBytes(
    ASYNC_LET_AND_CAPABILITY_UNDER_IF(),
    runtimeRequest('rt10f-cap-interleave', {}),
  );
  assert.equal(legs.direct.envelope.outcome, 'success');
  assert.deepEqual(legs.direct.envelope.result, integerSlot('9'), 'three trips of afi() = 3 each');
  assert.deepEqual(
    [...legs.direct.envelope.events],
    [
      CAPABILITY_EVENT,
      SECOND_CAPABILITY_EVENT,
      CAPABILITY_EVENT,
      SECOND_CAPABILITY_EVENT,
      CAPABILITY_EVENT,
      SECOND_CAPABILITY_EVENT,
    ],
    'RT10F_CAP_LOOP_INTERLEAVE: the helper call and the direct capability must alternate per trip, never batch',
  );
  assert.equal(legs.direct.calls.length, 6);
  assert.equal(legs.javascript.calls.length, 6);
  assert.equal(legs.python.calls.length, 6);
});

test('a provider that aborts on the second capability call cancels mid-loop identically on every leg', async () => {
  const legs = await threeLegAbort(
    CAPABILITY_UNDER_IF_EVERY_TRIP(),
    runtimeRequest('rt10f-cap-cancel', {}),
    { abortAtInvocation: 2 },
  );
  const envelope = assertLegParity(legs, 'for-if-capability-cancel-mid-loop');
  assert.equal(envelope.outcome, 'failure');
  assert.deepEqual(
    [...envelope.diagnostics],
    [{ category: 'runtime', code: 'execution-cancelled', phase: 'execution' }],
    'RT10F_CANCEL_MID_LOOP: the standing envelope shape for a cancelled run',
  );
  assert.deepEqual(
    [...envelope.events],
    [CAPABILITY_EVENT],
    'RT10F_CANCEL_MID_LOOP: the first trip commits, the interrupted second trip does not',
  );
  assert.equal(legs.direct.calls.length, 2, 'the provider observed the call it aborted inside');
  assert.equal(legs.javascript.calls.length, 2);
  assert.equal(legs.python.calls.length, 2);
});

test('an uninterrupted run of the cancellation fixture succeeds identically on every leg', async () => {
  const legs = await threeLegAbort(CAPABILITY_UNDER_IF_EVERY_TRIP(), runtimeRequest('rt10f-cap-cancel-control', {}));
  const envelope = assertLegParity(legs, 'for-if-capability-cancel-control');
  assert.equal(envelope.outcome, 'success');
  assert.deepEqual(envelope.result, integerSlot('3'));
});

test('the await census inside the loop equals trips times per-trip awaits, and the loop head carries none', async () => {
  const { legs } = await threeLegBytes(
    ASYNC_LET_AND_CAPABILITY_UNDER_IF(),
    runtimeRequest('rt10f-cap-census', {}),
  );
  assert.equal(legs.direct.calls.length, 6, '3 trips * 2 per-trip awaits (the helper call and the direct capability)');
  assert.equal(legs.javascript.calls.length, 6);
  assert.equal(legs.python.calls.length, 6);

  const region = await statementRegion(ASYNC_LET_AND_CAPABILITY_UNDER_IF());
  const head = loopHead(region);
  assert.equal(head.javascript.includes('await'), false, 'RT10F_AWAIT_AT_HEAD: the JavaScript loop head must not await');
  assert.equal(head.python.includes('await'), false, 'RT10F_AWAIT_AT_HEAD: the Python loop head must not await');
});

test('a capability under if inside a for body adds no static await site over the same statement straight-line', async () => {
  const loop = awaitCensus(await statementRegion(CAPABILITY_UNDER_IF_EVERY_TRIP()));
  const straight = awaitCensus(await statementRegion(CAPABILITY_UNDER_IF_STRAIGHT_LINE()));
  assert.equal(
    loop.javascript,
    straight.javascript,
    'RT10F_AWAIT_DRIFT: the loop must not duplicate the await call site per trip in source',
  );
  assert.equal(loop.python, straight.python, 'RT10F_AWAIT_DRIFT: same for the Python leg');
});
