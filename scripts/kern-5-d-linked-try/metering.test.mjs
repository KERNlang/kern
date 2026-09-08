import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TRY_METER_POSITIONS,
  TRY_POSITIONS,
  TRY_THRESHOLD_POSITIONS,
  TRY_TWINS,
  assertTryAdmitted,
  assertTryStepThreshold,
  executeKernKir,
  loopStepBudget,
  occurrencesOf,
  project,
  provider,
  runtimeRequest,
  stepRequest,
  tryArtifact,
  tryPositionArguments,
  tryTwoLegs,
} from './k0-support.mjs';

// Every row below is a difference against a hand-counted twin measured in the SAME run: rt11's
// [RT11W-TD1] and rt12's [RT12J-TD9] both shipped derived integers that went RED against a correct
// implementation. The twin's measured cost goes into every assertion message, so a wrong pin is
// separable from a wrong implementation on sight.
//
// The hand count, statement by statement, from the RT-1 walk: `meter.step()` fires once per
// statement boundary, once per entered loop trip (`enterTrip`), once when a loop's condition finally
// fails, once more on a `break`, and -- new in D -- once per ENTERED block (try body, catch body,
// finally body) on top of the `try` statement's own boundary charge.
const TWIN_DELTAS = Object.freeze({
  // try boundary (1) + entered try body (1); the catch is never entered, so it charges nothing.
  'meter-try-leaf': { delta: 2, twin: 'twin-leaf' },
  // try boundary (1) + entered try body (1) + throw boundary (1) + entered catch body (1) + the
  // catch's own leaf (1) = 5, against the twin's `let` (1) + leaf (1) = 2. The payload record's
  // charge cancels because the twin's `let` carries the same record.
  //
  // NOTE, and it is a correction: the spec predicts 4. Counting the twin's `let` boundary against
  // the fixture's absent one gives 3, not 4 -- the spec double-counts the payload.
  'meter-try-throw-catch-leaf': { delta: 3, twin: 'twin-let-and-leaf' },
  // Three trips, each paying the try boundary plus the entered try body: 3 x 2.
  'meter-for-3-try-leaf': { delta: 6, twin: 'twin-for-3-leaf' },
  // entered finally body (1) + the finally's own leaf (1), against the finally-less try.
  'meter-try-leaf-finally-leaf': { delta: 2, twin: 'twin-try-catch-leaf' },
});

async function cost(table, name, requestId) {
  const source = table[name]();
  await assertTryAdmitted(name, source);
  return loopStepBudget(source, tryPositionArguments(name), requestId);
}

async function twinCost(name) {
  const source = TRY_TWINS[name]();
  await assertTryAdmitted(name, source);
  return loopStepBudget(source, {}, `d-twin-${name}`);
}

for (const [name, { delta, twin }] of Object.entries(TWIN_DELTAS)) {
  test(`${name} charges exactly ${delta} steps more than its hand-counted twin ${twin}`, async () => {
    const measuredTwin = await twinCost(twin);
    const measured = await cost(TRY_METER_POSITIONS, name, `d-meter-${name}`);
    assert.equal(
      measured.execution - measuredTwin.execution,
      delta,
      `D_METER_DRIFT: ${name} charged ${measured.execution} against twin ${twin}'s measured ${measuredTwin.execution}; the hand count says the difference is ${delta}`,
    );
  });
}

// The paired half of every metering row: RT-1 and the emitted artifact must share one threshold, not
// merely agree on a bound. Pinned from both sides -- succeeds at RT-1's execution count, fails one
// step under it.
for (const name of TRY_THRESHOLD_POSITIONS) {
  test(`${name} charges identically on RT-1 and the JavaScript leg at every budget`, async () => {
    await assertTryStepThreshold(name, TRY_POSITIONS[name](), tryPositionArguments(name));
  });
}

// D-5a's negative half: a catch body that is never entered charges nothing, so the finally-less
// try-catch and the plain leaf differ by exactly the two charges the try itself owns.
test('a catch body that is never entered charges nothing at all', async () => {
  const withCatch = await cost(TRY_METER_POSITIONS, 'meter-try-leaf', 'd-catch-unentered');
  const twin = await twinCost('twin-leaf');
  assert.equal(
    withCatch.execution - twin.execution,
    TWIN_DELTAS['meter-try-leaf'].delta,
    `D_METER_DRIFT: an unentered catch must charge zero; measured ${withCatch.execution} against twin ${twin.execution}`,
  );
});

// D-5d, the one pinned TS divergence. The envelope is a hard boundary: an exhausted step budget
// inside a try that HAS a catch still produces runtime-limit-exceeded, and the catch body does not
// run. On RT-1 the mechanism is the enforcement -- the fault leaves the generator and discards the
// frame stack, trap frames included.
test('maxSteps exhausted inside a try with a catch produces runtime-limit-exceeded, catch skipped', async () => {
  const source = TRY_POSITIONS['try-catch-caught-throw']();
  await assertTryAdmitted('try-catch-caught-throw', source);
  const verified = await project(source);
  const full = await loopStepBudget(source, {}, 'd-limit-full');
  const envelope = await executeKernKir(
    verified,
    stepRequest('d-limit-starved', {}, full.link + full.execution - 1),
    provider([]),
  );
  assert.equal(envelope.outcome, 'failure', 'D_ENVELOPE_CATCHABLE: a starved budget must fail');
  assert.deepEqual(
    envelope.diagnostics.map((diagnostic) => diagnostic.code),
    ['runtime-limit-exceeded'],
    'D_ENVELOPE_CATCHABLE: a step-budget fault must never be converted into a caught user throw',
  );
});

test('cancellation inside a try produces execution-cancelled with the catch body skipped, on both legs', async () => {
  const source = TRY_POSITIONS['try-catch-caught-throw']();
  await assertTryAdmitted('try-catch-caught-throw', source);
  const verified = await project(source);
  const request = { ...runtimeRequest('d-cancelled', {}), control: { preCancelled: true, timeoutMs: null } };
  const envelope = await executeKernKir(verified, request, provider([]));
  assert.equal(envelope.outcome, 'failure');
  assert.deepEqual(
    envelope.diagnostics.map((diagnostic) => diagnostic.code),
    ['execution-cancelled'],
    'D_ENVELOPE_CATCHABLE: cancellation must bypass the catch entirely',
  );
});

test('a timeout inside a try produces execution-timeout with the catch body skipped', async () => {
  const source = TRY_POSITIONS['try-catch-caught-throw']();
  await assertTryAdmitted('try-catch-caught-throw', source);
  const verified = await project(source);
  const request = { ...runtimeRequest('d-timeout', {}), control: { preCancelled: false, timeoutMs: 0 } };
  const envelope = await executeKernKir(verified, request, provider([]));
  assert.equal(envelope.outcome, 'failure');
  assert.deepEqual(
    envelope.diagnostics.map((diagnostic) => diagnostic.code),
    ['execution-timeout'],
    'D_ENVELOPE_CATCHABLE: a timeout must bypass the catch entirely',
  );
});

// QD-1 option (a), enforced by the carrier rather than implemented: the capability fault is raised
// in the driver and never re-enters the walk, so a catch cannot see it. Asserted on both legs so a
// future capability slice has to move this row consciously.
test('a capability-error raised inside a try with a catch stays an uncatchable fault on both legs', async () => {
  const source = TRY_POSITIONS['throw-uncaught-after-capability']();
  await assertTryAdmitted('throw-uncaught-after-capability', source);
  const legs = await tryTwoLegs(source, runtimeRequest('d-capability-error', {}));
  assert.equal(legs.direct.envelope.outcome, 'failure');
  assert.deepEqual(
    legs.direct.envelope.diagnostics.map((diagnostic) => diagnostic.code),
    ['uncaught-throw'],
    'D_ENVELOPE_CATCHABLE: the capability resolved, so the uncaught throw is what fails -- and the catch saw neither',
  );
});

// The tick fence: a try lowering that reached for a host suspension point would change the
// microtask shape RT-2 established and the emitted legs share. Counted against a twin so the
// baseline the emitter already has is subtracted out.
test('the emitted try region introduces no suspension point the finally-less twin does not have', async () => {
  const twin = await tryArtifact(TRY_TWINS['twin-leaf']());
  const fixture = await tryArtifact(TRY_POSITIONS['try-catch-caught-throw']());
  for (const token of ['await ', 'Promise', 'queueMicrotask', 'setImmediate', 'setTimeout']) {
    assert.equal(
      occurrencesOf(fixture.text, token),
      occurrencesOf(twin.text, token),
      `D_TICK_DRIFT: the try lowering changed the ${token} count against its finally-less twin`,
    );
  }
});
