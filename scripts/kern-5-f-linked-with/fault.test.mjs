import assert from 'node:assert/strict';
import test from 'node:test';

import {
  POSITIONS,
  assertWithAdmitted,
  diagnosticCodes,
  envelopeBytes,
  eventTexts,
  executeKernKir,
  fixtureArguments,
  legRunner,
  project,
  provider,
  runtimeRequest,
} from './k0-support.mjs';

const LIMIT = 'runtime-limit-exceeded';

// The id is a parameter, not the fixture name: a `with` and its twin are compared byte for byte, and
// the envelope carries its own requestId, so the pair has to be driven under one id.
async function runnerFor(name, requestId = `f-fault-${name}`) {
  const source = POSITIONS[name]();
  await assertWithAdmitted(name, source);
  return legRunner(source, fixtureArguments(source, 'one-element'), requestId);
}

// The completion budget minus one does not starve the cleanup: the last step buys the `return`
// AFTER the block, by which time the cleanup has already committed. The starvation point has to be
// measured -- the smallest budget at which the cleanup marker appears -- and then stepped back from.
async function cleanupBudget(runner, label) {
  let low = 1;
  let high = runner.rt1.execution;
  assert.ok(
    eventTexts(await runner.direct(high)).includes('cleanup'),
    `F_FAULT_PROBE: ${label} never commits its cleanup marker inside the completion budget`,
  );
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (eventTexts(await runner.direct(mid)).includes('cleanup')) high = mid;
    else low = mid + 1;
  }
  assert.ok(low > 1, `F_FAULT_PROBE: ${label} must reach its cleanup strictly after the first step`);
  return low;
}

function assertBothLegs(legs, { codes, label, texts }) {
  for (const [leg, envelope] of Object.entries(legs)) {
    assert.deepEqual(diagnosticCodes(envelope), codes, `${label}: ${leg} must report exactly ${codes.join(', ')}`);
    assert.deepEqual(eventTexts(envelope), texts, `${label}: ${leg} must have emitted exactly ${JSON.stringify(texts)}`);
  }
}

// F-7a. The trap is pushed only after the acquire settles, so a fault while evaluating `V` leaves no
// binding and no cleanup. A lowering that opened the guard first would run the cleanup here.
test('a budget that expires inside the acquire runs no cleanup on either leg', async () => {
  const runner = await runnerFor('with-fallthrough');
  const legs = await runner.absolute(1);
  assertBothLegs(legs, { codes: [LIMIT], label: 'F_CLEANUP_ON_ACQUIRE_FAULT', texts: [] });
});

// F-7b. D-5d verbatim: an envelope fault inside the body bypasses the cleanup as well as any catch.
// The budget is measured, not guessed -- the smallest budget at which the body's own event appears.
test('a budget that expires inside the body runs no cleanup on either leg', async () => {
  const runner = await runnerFor('with-fallthrough');
  let entered;
  for (let steps = 1; steps <= runner.rt1.execution; steps += 1) {
    const legs = await runner.absolute(steps);
    if (eventTexts(legs.direct).includes('body')) {
      entered = { legs, steps };
      break;
    }
  }
  assert.ok(entered !== undefined, 'F_FAULT_PROBE: no budget under the completion count entered the body');
  assert.ok(
    entered.steps < runner.rt1.execution,
    'F_FAULT_PROBE: the body must be entered strictly before the program completes',
  );
  assertBothLegs(entered.legs, { codes: [LIMIT], label: 'F_CLEANUP_ON_BODY_FAULT', texts: ['body'] });
  const before = await runner.absolute(entered.steps - 1);
  assertBothLegs(before, { codes: [LIMIT], label: 'F_CLEANUP_ON_BODY_FAULT', texts: [] });
});

// F-7c, on every exit path. At the last budget that cannot pay for the cleanup, the fault wins over
// whatever completion was pending: no cleanup event escapes, no value is delivered and no
// uncaught-throw result is reported. The twin is driven to the same point under the same id, so the
// row guards the expansion equality as well as the fault rule.
const EXITS = Object.freeze([
  ['fallthrough', ['body']],
  ['return', ['body']],
  ['caught-throw', []],
  ['uncaught-throw', []],
]);

for (const [shape, texts] of EXITS) {
  test(`the ${shape} exit loses its cleanup and its completion one step under the cleanup, on both legs`, async () => {
    const runner = await runnerFor(`with-${shape}`, `f-fault-${shape}`);
    const boundary = await cleanupBudget(runner, `with-${shape}`);
    const committed = await runner.absolute(boundary);
    for (const [leg, envelope] of Object.entries(committed)) {
      assert.ok(
        eventTexts(envelope).includes('cleanup'),
        `F_CLEANUP_LOST: ${leg} must commit the cleanup event at the measured budget ${boundary}`,
      );
    }
    const starved = await runner.absolute(boundary - 1);
    assertBothLegs(starved, { codes: [LIMIT], label: `F_CLEANUP_ON_${shape}`, texts });
    for (const [leg, envelope] of Object.entries(starved)) {
      assert.equal(envelope.outcome, 'failure', `F_FAULT_PRECEDENCE: ${leg} must not report a completion`);
      assert.deepEqual(
        envelope.result,
        { presence: 'absent' },
        `F_FAULT_PRECEDENCE: ${leg} must discard the pending value when the cleanup cannot be paid for`,
      );
    }
    const twin = await runnerFor(`twin-${shape}`, `f-fault-${shape}`);
    const twinStarved = await twin.absolute(boundary - 1);
    for (const leg of ['direct', 'emitted']) {
      assert.deepEqual(
        Buffer.from(envelopeBytes(twinStarved[leg])),
        Buffer.from(envelopeBytes(starved[leg])),
        `F_TWIN_DIVERGENCE: the ${shape} twin starves differently from the with on the ${leg} leg`,
      );
    }
  });
}

// The uncaught throw is the one exit whose completion is itself a diagnostic. A leg that ranked the
// pending throw above the fault would report uncaught-throw at the starved budget.
test('a fault inside the cleanup wins over a propagating uncaught throw', async () => {
  const runner = await runnerFor('with-uncaught-throw');
  const enough = await runner.at(0);
  for (const [leg, envelope] of Object.entries(enough)) {
    assert.deepEqual(diagnosticCodes(envelope), ['uncaught-throw'], `F_FAULT_PRECEDENCE: ${leg} at the full budget`);
  }
  const boundary = await cleanupBudget(runner, 'with-uncaught-throw');
  const starved = await runner.absolute(boundary - 1);
  for (const [leg, envelope] of Object.entries(starved)) {
    assert.deepEqual(
      diagnosticCodes(envelope),
      [LIMIT],
      `F_FAULT_PRECEDENCE: ${leg} must report the fault, not the throw it was carrying`,
    );
  }
});

// Cancellation and timeout are the other two envelope faults D pinned; the cleanup must be skipped
// for the same reason and the two legs must agree on the code.
test('cancellation and timeout bypass the cleanup entirely', async () => {
  const source = POSITIONS['with-fallthrough']();
  await assertWithAdmitted('with-fallthrough', source);
  const verified = await project(source);
  const args = fixtureArguments(source, 'one-element');
  for (const [control, code] of [
    [{ preCancelled: true, timeoutMs: null }, 'execution-cancelled'],
    [{ preCancelled: false, timeoutMs: 1 }, 'execution-timeout'],
  ]) {
    const envelope = await executeKernKir(
      verified,
      { ...runtimeRequest('f-fault-abort', args), control },
      provider([]),
    );
    assert.deepEqual(diagnosticCodes(envelope), [code], `F_CLEANUP_ON_ABORT: ${code} must bypass the cleanup`);
    assert.equal(
      eventTexts(envelope).includes('cleanup'),
      false,
      `F_CLEANUP_ON_ABORT: ${code} must not let the cleanup event escape`,
    );
  }
});
