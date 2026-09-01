import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ENTRY,
  LIMITS,
  VOID_FALLTHROUGH,
  emittedArtifacts,
  entryOf,
  executeKernKir,
  linkVerifiedKernKirProgram,
  project,
  provider,
  runtimeRequest,
  text,
  threeLegBytes,
} from './k0-support.mjs';

const BUDGETS = Object.freeze(Array.from({ length: 60 }, (_unused, index) => index + 1));

async function stepFloor(source, args = {}) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'the metering fixture must project');
  const linkFloor = BUDGETS.find(
    (maxSteps) => linkVerifiedKernKirProgram(verified, ENTRY, { ...LIMITS, maxSteps }).outcome === 'success',
  );
  assert.ok(linkFloor !== undefined, 'no budget in the scanned range linked the metering fixture');
  const outcomes = [];
  for (const maxSteps of BUDGETS) {
    const envelope = await executeKernKir(
      verified,
      { ...runtimeRequest(`rt6-steps-${maxSteps}`, args), limits: { ...LIMITS, maxSteps } },
      provider([]),
    );
    outcomes.push(envelope.outcome === 'success');
  }
  const executionFloor = BUDGETS[outcomes.indexOf(true)];
  assert.ok(executionFloor !== undefined, 'no budget in the scanned range executed the metering fixture');
  assert.ok(
    outcomes.slice(outcomes.indexOf(true)).every(Boolean),
    'step consumption must be monotonic in the step budget',
  );
  return executionFloor - linkFloor;
}

test('the void completion itself consumes no execution step', async () => {
  const oneStatement = await stepFloor(entryOf([text('only')]));
  const twoStatements = await stepFloor(VOID_FALLTHROUGH);
  assert.equal(twoStatements - oneStatement, 2, 'each print costs one statement step and one expression step');
  const valueReturn = await stepFloor(entryOf([text('only'), 'return value="\\"done\\""'], { returns: 'string' }));
  assert.equal(
    valueReturn - oneStatement,
    2,
    'a value return costs one statement step plus one expression step, and the void tail costs neither',
  );
});

test('neither emitted target meters the void tail', async () => {
  const { javascript, python } = await emittedArtifacts(VOID_FALLTHROUGH);
  const javascriptTail = javascript.slice(javascript.lastIndexOf(`presence:'absent'`));
  const pythonTail = python.slice(python.lastIndexOf('{"presence": "absent"}'));
  assert.ok(!javascriptTail.includes('__meter.step()'), 'the emitted JS void tail must not charge a statement step');
  assert.ok(!pythonTail.includes('_meter.step()'), 'the emitted Python void tail must not charge a statement step');
});

test('the void tail checks cancellation both before and after measuring the envelope', async () => {
  const { javascript, python } = await emittedArtifacts(VOID_FALLTHROUGH);
  const push = javascript.lastIndexOf('__events.push');
  const javascriptTail = javascript.slice(push, javascript.indexOf('} finally {', push));
  const pythonTail = python.slice(python.lastIndexOf('_events.append'), python.lastIndexOf('\n    finally:'));
  assert.equal(
    (javascriptTail.match(/__checkAbort\(\)/gu) ?? []).length,
    2,
    'the JS void tail checks cancellation on both sides of the envelope measurement',
  );
  assert.equal(
    (pythonTail.match(/_check_abort\(\)/gu) ?? []).length,
    2,
    'the Python void tail checks cancellation on both sides of the envelope measurement',
  );
});

test('a void run that exceeds the event budget fails closed identically on all three legs', async () => {
  const body = Array.from({ length: LIMITS.maxEvents + 1 }, (_unused, index) => text(`e${index}`));
  const { legs } = await threeLegBytes(entryOf(body), runtimeRequest('rt6-events', {}));
  assert.equal(legs.direct.envelope.outcome, 'failure');
  assert.equal(legs.direct.envelope.diagnostics[0].code, 'runtime-limit-exceeded');
});

test('a void handler emits no await on either target, so no microtask boundary is crossed', async () => {
  const { javascript, python } = await emittedArtifacts(VOID_FALLTHROUGH);
  const start = javascript.indexOf('const __checkAbort=');
  const javascriptBody = javascript.slice(start, javascript.indexOf('} finally {', start));
  const pythonBody = python.slice(
    python.lastIndexOf('_watcher = None if _external is None'),
    python.lastIndexOf('\n    finally:'),
  );
  assert.ok(!/\bawait\b/u.test(javascriptBody), 'a capability-free void handler emits no await in JavaScript');
  assert.ok(!/\bawait\b/u.test(pythonBody), 'a capability-free void handler emits no await in Python');
});
