import assert from 'node:assert/strict';
import test from 'node:test';

import {
  POSITIONS,
  assertEachAdmitted,
  assertStepThreshold,
  fixtureArguments,
  loopStepBudget,
} from './k0-support.mjs';

// A step search on a program that does not link reports "no budget in the scanned range", which
// names the symptom instead of the cause. The admission check runs first so an unadmitted kind fails
// this file with the linker's own refusal.
async function budget(name, args = 'one-element') {
  const source = POSITIONS[name]();
  await assertEachAdmitted(name, source);
  return loopStepBudget(source, fixtureArguments(source, args), `e-meter-${name}-${args}`);
}

// Differences, never absolute counts: a fixture whose body cost changes must not move a row that is
// about a structural charge.
test('a bare do costs exactly one step more than the same program without it', async () => {
  const withDo = await budget('do-bare');
  const twin = await budget('do-bare-twin');
  assert.equal(
    withDo.execution - twin.execution,
    1,
    'E_METER_BARE_DO: a bare do must charge one dispatch step, no more and no less',
  );
});

// The zero-trip constant. A zero-length each dispatches, evaluates its source identifier once and
// takes the terminal charge: 1 + 1 + 1. An implementation that skipped the terminal charge gives 2;
// one that charged a trip anyway gives 4.
test('a zero-trip each costs three steps over its loopless twin', async () => {
  const empty = await budget('each-plain', 'empty-list');
  const twin = await budget('each-plain-twin', 'empty-list');
  assert.equal(
    empty.execution - twin.execution,
    3,
    'E_METER_ZERO_TRIP: dispatch + source + terminal, the same constant a zero-trip for and while charge',
  );
});

// The slope. Three elements minus one element must be exactly twice the one-element minus zero
// difference: that is what makes the per-trip charge a constant rather than a fitted number.
test('the per-trip charge is a constant slope in the list length', async () => {
  const zero = await budget('each-plain', 'empty-list');
  const one = await budget('each-plain', 'one-element');
  const three = await budget('each-plain', 'three-elements');
  const perTrip = one.execution - zero.execution;
  assert.ok(perTrip > 0, 'E_METER_NO_TRIP_CHARGE: a trip must cost something');
  assert.equal(
    three.execution - zero.execution,
    perTrip * 3,
    'E_METER_SLOPE: three trips must cost exactly three times one trip',
  );
});

// Index materialization is free in steps (__intValue calls meter.check/meter.text, never
// meter.step), so the index variant differs from the plain variant only by the body it runs.
test('an index binding adds no step of its own', async () => {
  const plain = await budget('each-plain', 'three-elements');
  const indexed = await budget('each-index', 'three-elements');
  const plainOne = await budget('each-plain', 'one-element');
  const indexedOne = await budget('each-index', 'one-element');
  assert.equal(
    indexed.execution - plain.execution,
    (indexedOne.execution - plainOne.execution) * 3,
    'E_METER_INDEX: the index variant may differ only by its per-trip body cost, never by a materialization charge',
  );
});

// The legs must exhaust at the SAME step, not merely produce the same answer. Both bounds are
// asserted: success at RT-1's count and failure one below it.
for (const [name, args] of [
  ['do-bare', 'one-element'],
  ['do-sync-call', 'one-element'],
  ['each-plain', 'empty-list'],
  ['each-plain', 'three-elements'],
  ['each-index', 'three-elements'],
  ['each-break', 'three-elements'],
  ['each-continue', 'three-elements'],
  ['each-try-finally-in-body', 'three-elements'],
]) {
  test(`${name} at ${args} exhausts at the same step on both legs`, async () => {
    const source = POSITIONS[name]();
    await assertEachAdmitted(name, source);
    await assertStepThreshold(`${name}-${args}`, source, fixtureArguments(source, args));
  });
}

test('a sync do costs the same as the call it discards, plus one dispatch', async () => {
  const withDo = await budget('do-sync-call');
  const twin = await budget('do-sync-call-twin');
  const bare = await budget('do-bare');
  const bareTwin = await budget('do-bare-twin');
  assert.ok(
    withDo.execution - twin.execution > bare.execution - bareTwin.execution,
    'E_METER_DO_CALL: a do that calls must cost more than a bare do, or the call was not evaluated',
  );
});
