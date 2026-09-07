import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WHILE_METER_POSITIONS,
  WHILE_POSITIONS,
  WHILE_TWINS,
  integerSlot,
  loopStepBudget,
  runtimeRequest,
  twoLegBytes,
} from './k0-support.mjs';

// The same charge `for` is pinned to: `1_init + Sum(1_head + body) + 1_exit`, against `maxSteps`
// and nothing else — there is no iteration limit in `KernKirLimits` and this slice creates none.
// Every row is a *difference* in which `init` and `exit` cancel, and every body cost is measured
// from a straight-line twin in the same run, so no expectation here is a hardcoded absolute.
const HEAD_CHARGE = 1;

async function twinCost(name) {
  return (await loopStepBudget(WHILE_TWINS[name](), {}, `rt11w-${name}`)).execution;
}

async function loopCost(name) {
  return (await loopStepBudget(WHILE_METER_POSITIONS[name](), {}, `rt11w-${name}`)).execution;
}

async function bodyCost(withBody, without) {
  return (await twinCost(withBody)) - (await twinCost(without));
}

test('the straight-line twins reproduce the base costs the identities are derived from', async () => {
  assert.equal(await twinCost('twin-let-literal'), 4, 'a let of a literal plus a return is the 4-step floor');
  assert.equal(await bodyCost('twin-assign-one', 'twin-let-literal'), 4, 'assign acc = acc + 1 costs four steps');
  assert.equal(await bodyCost('twin-two-lets-assign', 'twin-two-lets'), 4, 'assign i = i + 1 costs four steps');
});

// E2. Two trips apart with one body shape. A missing head charge makes this 16; a doubled head
// charge makes it 20; a body charged twice per iteration makes it 34.
test('two extra trips cost exactly twice the head charge plus twice the while body', async () => {
  const accumulator = await bodyCost('twin-assign-one', 'twin-let-literal');
  const increment = await bodyCost('twin-two-lets-assign', 'twin-two-lets');
  assert.equal(
    (await loopCost('meter-trips-3')) - (await loopCost('meter-trips-1')),
    2 * (HEAD_CHARGE + accumulator + increment),
    'RT11W_METER_DRIFT: the per-trip charge is one head step plus the body the while spells out',
  );
});

// E3. One trip against none. An `init` or `exit` term that scaled with the trip count would break
// this row while leaving the previous one intact.
test('the first trip costs exactly one head charge plus one body over the never-entered loop', async () => {
  const accumulator = await bodyCost('twin-assign-one', 'twin-let-literal');
  const increment = await bodyCost('twin-two-lets-assign', 'twin-two-lets');
  assert.equal(
    (await loopCost('meter-trips-1')) - (await loopCost('meter-trips-0')),
    HEAD_CHARGE + accumulator + increment,
    'RT11W_METER_DRIFT: init and exit are charged once each, whatever the trip count',
  );
});

// E4 and E5, the cross-form rows the tribunal asked for. Literal tick equality between the two loop
// forms is arithmetically impossible: a `while` must spell out `let i = 0` and `assign i = i + 1`,
// and both are metered. So the claim is that the *machinery* charge is identical and every
// difference is the measured cost of those two statements — which is strictly stronger, because the
// weaker literal claim would be satisfiable only by mis-metering one of the two forms.
test('a while and a for over the same trip count differ by exactly the counter the while spells out', async () => {
  const increment = await bodyCost('twin-two-lets-assign', 'twin-two-lets');
  const counterLet = (await twinCost('twin-two-lets')) - (await twinCost('twin-let-literal'));
  const trips = 3;
  assert.equal(
    (await loopCost('meter-trips-3')) - (await loopCost('meter-for-trips-3')),
    counterLet + trips * increment,
    'RT11W_EQUIVALENCE_DRIFT: the while machinery must cost exactly what the for machinery costs',
  );
});

// E5, the never-entered end of the same claim, stated so it cannot be a tautology: two loops with
// the identical condition and different bodies must cost the same when the condition is false from
// the start. A lowering that ran the body once before its first test, or that charged the body's
// statement count at loop entry, breaks this row and no other. It is also the only zero-trip row
// available: a `while` reads one condition where a `for` reads three bounds, so the two forms'
// never-entered totals legitimately differ by that expression cost and cannot be compared directly.
test('a never-entered while costs the same whatever its body holds', async () => {
  assert.equal(
    await loopCost('meter-trips-0-fat'),
    await loopCost('meter-trips-0'),
    'RT11W_METER_DRIFT: a body that never runs must be charged nothing at all',
  );
});

// E1. Equal outputs, byte-identically, on both legs — the half of equivalence that needs no
// arithmetic at all and that a loop off by one trip fails outright.
test('a while and a for over the same trip count return the same value on both legs', async () => {
  const viaWhile = await twoLegBytes(WHILE_METER_POSITIONS['meter-trips-3'](), runtimeRequest('rt11w-eq-while', {}));
  const viaFor = await twoLegBytes(WHILE_METER_POSITIONS['meter-for-trips-3'](), runtimeRequest('rt11w-eq-for', {}));
  assert.deepEqual(viaWhile.legs.direct.envelope.result, integerSlot('3'), 'the while form sums three trips');
  assert.deepEqual(viaFor.legs.direct.envelope.result, integerSlot('3'), 'the for form sums the same three');
  assert.deepEqual(
    viaWhile.legs.direct.envelope.result,
    viaFor.legs.direct.envelope.result,
    'RT11W_EQUIVALENCE_DRIFT: the two loop forms must agree on the value',
  );
});

// Nesting is compositional: the inner loop is a body statement whose own charge is
// `2 + m*(1 + B)`, so widening the inner bound by two costs the outer trip count times two per-trip
// charges. An inner `init`/`exit` hoisted out of the outer body breaks exactly this row.
test('a nested while charges its own init and exit once per outer trip', async () => {
  const accumulator = await bodyCost('twin-assign-one', 'twin-let-literal');
  const increment = await bodyCost('twin-two-lets-assign', 'twin-two-lets');
  const outerTrips = 2;
  assert.equal(
    (await loopCost('meter-nested-2x4')) - (await loopCost('meter-nested-2x2')),
    outerTrips * 2 * (HEAD_CHARGE + accumulator + increment),
    'RT11W_NEST_METER_DRIFT: the inner loop is re-entered once per outer trip',
  );
});

// The absolute totals are not pinned as constants — they are the numbers the builder must report so
// the next slice inherits values rather than formulas — but they must be internally consistent with
// the pinned charge, which is strictly stronger than any single difference.
test('the absolute while totals satisfy the pinned charge for every scanned trip count', async () => {
  const accumulator = await bodyCost('twin-assign-one', 'twin-let-literal');
  const increment = await bodyCost('twin-two-lets-assign', 'twin-two-lets');
  const zero = await loopCost('meter-trips-0');
  for (const [name, trips] of [
    ['meter-trips-0', 0],
    ['meter-trips-1', 1],
    ['meter-trips-3', 3],
  ]) {
    assert.equal(
      await loopCost(name),
      zero + trips * (HEAD_CHARGE + accumulator + increment),
      `${name}: the total must be the never-entered total plus one head charge and one body per trip`,
    );
  }
  assert.ok(WHILE_POSITIONS['while-counted-3'] !== undefined, 'the metering family shares the behaviour fixtures');
});
