import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LIMITS,
  WHILE_METER_POSITIONS,
  WHILE_POSITIONS,
  WHILE_TWINS,
  assertTwoLegStepThreshold,
  integerSlot,
  loopStepBudget,
  runtimeRequest,
  twoLegBytes,
} from './k0-support.mjs';

// The charge, corrected. `for`'s pinned formula is `1_init + Sum(1_head + body) + 1_exit`, and its
// bounds fold into the constant because they are read once above the head. A `while` re-evaluates
// its condition on every attempt — `n` true probes and one false one — so its charge is
//
//     ticks(n) = A + n * P     with   P = 1_head + B + C   and   A = 1_init + 1_exit + C
//
// where `B` is the body cost and `C` the condition's per-evaluation cost. `2 + n*(1 + B)` is what
// this suite asserted before and it is wrong: it drops the `(n+1)*C` term, so it would have failed
// against a correct implementation. Every row below is a difference in which `A` or `C` cancels, or
// a cross-check that two independent paths to the same unknown agree.
const HEAD_CHARGE = 1;
const INIT_AND_EXIT = 2;

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
  assert.ok(
    (await bodyCost('twin-two-lets-cond-costly', 'twin-two-lets-cond-cheap')) > 0,
    'the costlier condition must actually cost more, or the per-attempt row proves nothing',
  );
});

// Linearity. No twin, no `C`, no `A`: the model says `ticks` is affine in the trip count, so the
// three-trip step must be exactly twice the one-trip step. A body charged twice, an `init` or `exit`
// that scales with the trip count, or a condition evaluated a number of times that is not `n+1` all
// break this row, and it is the only row that needs no measured atom at all.
test('the charge is affine in the trip count', async () => {
  const zero = await loopCost('meter-trips-0');
  const one = await loopCost('meter-trips-1');
  const three = await loopCost('meter-trips-3');
  assert.equal(
    three - one,
    2 * (one - zero),
    'RT11W_METER_DRIFT: ticks(3) - ticks(1) must be exactly twice ticks(1) - ticks(0)',
  );
});

// The two independent paths to `C`, which must agree. The per-trip increment gives
// `C = P - 1_head - B`; the never-entered total gives `C = A - 1_init - 1_exit`. They are measured
// from different paths through the loop, so an exit charge missing on one path, or a condition
// evaluated once instead of on every attempt, separates them.
test('the never-entered total and the per-trip increment imply the same condition cost', async () => {
  const accumulator = await bodyCost('twin-assign-one', 'twin-let-literal');
  const increment = await bodyCost('twin-two-lets-assign', 'twin-two-lets');
  const perTrip = (await loopCost('meter-trips-1')) - (await loopCost('meter-trips-0'));
  const fromIncrement = perTrip - HEAD_CHARGE - accumulator - increment;
  const fromNeverEntered = (await loopCost('meter-trips-0')) - (await twinCost('twin-two-lets')) - INIT_AND_EXIT;
  assert.equal(
    fromIncrement,
    fromNeverEntered,
    'RT11W_METER_DRIFT: the head charge is not one, or the exit charge differs between the two exit paths',
  );
  assert.ok(fromIncrement > 0, 'a condition that costs nothing per attempt would mean it was hoisted');
});

// The body term inside the per-trip charge, isolated without needing `C`: two families differing
// only in one body statement must differ in per-trip cost by exactly that statement's twin cost.
test('the per-trip charge carries the body at its ordinary rate', async () => {
  const thin = (await loopCost('meter-trips-1')) - (await loopCost('meter-trips-0'));
  const fat = (await loopCost('meter-fat-1')) - (await loopCost('meter-fat-0'));
  assert.equal(
    fat - thin,
    await bodyCost('twin-assign-one', 'twin-let-literal'),
    'RT11W_METER_DRIFT: a loop must not surcharge or discount a statement in its body',
  );
});

// The row that distinguishes a condition loop from a counted one, and the mirror of rt10-for's
// "a bound costs its extra steps once, not once per trip". A costlier condition costs its extra
// `n+1` times, because it is re-read on every attempt including the failed one. A lowering that
// hoisted the condition above the head would charge the extra exactly once and fail both halves.
test('a costlier condition is charged once per attempt, which is once more than the trip count', async () => {
  const extra = await bodyCost('twin-two-lets-cond-costly', 'twin-two-lets-cond-cheap');
  assert.equal(
    (await loopCost('meter-cond-costly-3')) - (await loopCost('meter-trips-3')),
    4 * extra,
    'RT11W_COND_HOIST: three trips means four condition evaluations',
  );
  assert.equal(
    (await loopCost('meter-cond-costly-0')) - (await loopCost('meter-trips-0')),
    extra,
    'RT11W_COND_HOIST: a never-entered loop still evaluates its condition exactly once',
  );
});

// A never-entered loop costs the same whatever its body holds. A lowering that ran the body once
// before its first test, or that charged the body's statement count at loop entry, breaks this row
// and no other.
test('a never-entered while costs the same whatever its body holds', async () => {
  assert.equal(
    await loopCost('meter-fat-0'),
    await loopCost('meter-trips-0'),
    'RT11W_METER_DRIFT: a body that never runs must be charged nothing at all',
  );
});

// Nesting is compositional: the inner loop is a body statement whose own charge is `A + m*P`, so
// widening the inner bound by two costs the outer trip count times two inner per-trip charges. An
// inner `init`/`exit` hoisted out of the outer body breaks exactly this row.
test('a nested while charges its own init, exit and final probe once per outer trip', async () => {
  const inner = (await loopCost('meter-trips-1')) - (await loopCost('meter-trips-0'));
  const outerTrips = 2;
  assert.equal(
    (await loopCost('meter-nested-2x4')) - (await loopCost('meter-nested-2x2')),
    outerTrips * 2 * inner,
    'RT11W_NEST_METER_DRIFT: the inner loop is re-entered once per outer trip',
  );
});

// The leg-identity gate. RT-1 and the emitted JavaScript must charge the same number of steps on
// every path through the loop, so the artifact's own step threshold must equal RT-1's execution
// count exactly — pinned from both sides. Four paths: never entered, one shot, three trips, and a
// wider body. A budget one step under the threshold exhausts inside whichever slot the count lands
// in, so a leg that charged any one slot differently separates at one of these four thresholds.
for (const name of ['meter-trips-0', 'meter-trips-1', 'meter-trips-3', 'meter-fat-1']) {
  test(`${name} charges identically on RT-1 and the JavaScript leg at every budget`, async () => {
    await assertTwoLegStepThreshold(name, WHILE_METER_POSITIONS[name]());
  });
}

// The unbounded loop is the exhaustion path no threshold can pin, because there is no budget at
// which it succeeds. Both legs must fail identically at every budget instead, which `twoLegBytes`
// asserts by comparing the two envelopes byte for byte.
test('an unbounded while exhausts identically on both legs at every budget', async () => {
  for (const maxSteps of [8, 32, 512]) {
    const request = { ...runtimeRequest(`rt11w-infinite-${maxSteps}`, {}), limits: { ...LIMITS, maxSteps } };
    const runs = await twoLegBytes(WHILE_POSITIONS['while-true-exhausts-steps'](), request);
    assert.equal(runs.legs.direct.envelope.outcome, 'failure', `maxSteps ${maxSteps}: RT-1 must exhaust`);
    assert.equal(
      runs.legs.direct.envelope.diagnostics[0]?.code,
      'runtime-limit-exceeded',
      `maxSteps ${maxSteps}: the step budget is what refuses`,
    );
  }
});

// Equal outputs, byte-identically, on both legs — the half of `for`/`while` equivalence that needs
// no arithmetic and that a loop off by one trip fails outright. Literal tick equality between the
// forms is not asserted and cannot be: a `while` spells out `let i = 0` and `assign i = i + 1`, and
// re-reads its condition `n+1` times where a `for` reads three bounds once. The machinery claim is
// carried by the affine, condition-cost and leg-threshold rows above instead.
test('a while and a for over the same trip count return the same value on both legs', async () => {
  const viaWhile = await twoLegBytes(WHILE_METER_POSITIONS['meter-trips-3'](), runtimeRequest('rt11w-eq-while', {}));
  const viaFor = await twoLegBytes(WHILE_METER_POSITIONS['meter-for-trips-3'](), runtimeRequest('rt11w-eq-for', {}));
  assert.deepEqual(viaWhile.legs.direct.envelope.result, integerSlot('3'), 'the while form sums three trips');
  assert.deepEqual(
    viaWhile.legs.direct.envelope.result,
    viaFor.legs.direct.envelope.result,
    'RT11W_EQUIVALENCE_DRIFT: the two loop forms must agree on the value',
  );
});
