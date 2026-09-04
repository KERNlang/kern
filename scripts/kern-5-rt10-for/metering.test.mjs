import assert from 'node:assert/strict';
import test from 'node:test';

import { METER_POSITIONS, TWINS, loopStepBudget } from './k0-support.mjs';

// The tribunal pinned the loop charge as `1_init + Sum(1_head + body) + 1_exit`, against `maxSteps`
// and nothing else: there is no iteration limit in `KernKirLimits`. That formula is `2 + n*(1 + B)`
// for `n` trips and a per-iteration body cost `B`, so every row below is a *difference* in which the
// `init` and `exit` terms cancel and only `B` and the head charge survive. `B` is measured from a
// straight-line twin in the same run, so no expectation here is a hardcoded post-slice absolute.
const HEAD_CHARGE = 1;

async function twinCost(name) {
  return (await loopStepBudget(TWINS[name](), {}, `rt10f-${name}`)).execution;
}

async function loopCost(name, args = {}) {
  return (await loopStepBudget(METER_POSITIONS[name](), args, `rt10f-${name}`)).execution;
}

async function bodyCost(withBody, without) {
  return (await twinCost(withBody)) - (await twinCost(without));
}

test('the straight-line twins reproduce the base costs the identities are derived from', async () => {
  assert.equal(await twinCost('twin-let-literal'), 4, 'a let of a literal plus a return is the 4-step floor');
  assert.equal(await bodyCost('twin-let-binary', 'twin-let-literal'), 2, 'a binary bound costs two steps more');
  assert.equal(await bodyCost('twin-assign-one', 'twin-let-literal'), 4, 'assign acc = acc + 1 costs four steps');
  assert.equal(await bodyCost('twin-assign-counter', 'twin-two-lets'), 4, 'assign acc = acc + i costs four steps');
  assert.equal(await bodyCost('twin-assign-helper', 'twin-two-lets'), 7, 'assign acc = acc + idp(i) costs seven');
});

// Two trips apart with one body shape. A missing head charge makes this 8; a doubled head charge
// makes it 12; a body charged twice per iteration makes it 18.
test('two extra trips cost exactly twice the head charge plus twice the body', async () => {
  const body = await bodyCost('twin-assign-one', 'twin-let-literal');
  assert.equal(
    (await loopCost('meter-trips-3')) - (await loopCost('meter-trips-1')),
    2 * (HEAD_CHARGE + body),
    'RT10F_METER_DRIFT: the per-trip charge is one head step plus the body',
  );
});

// One trip against none. An `init` or `exit` term that scaled with the trip count would break this
// row while leaving the previous one intact.
test('the first trip costs exactly one head charge plus one body over the empty range', async () => {
  const body = await bodyCost('twin-assign-one', 'twin-let-literal');
  assert.equal(
    (await loopCost('meter-trips-1')) - (await loopCost('meter-trips-0')),
    HEAD_CHARGE + body,
    'RT10F_METER_DRIFT: init and exit are charged once each, whatever the trip count',
  );
});

// Same trip count, different bound expression. The extra cost of the bound appears once, not three
// times, which is the metering half of the bounds-evaluated-once rule.
test('a more expensive bound costs its extra steps once, not once per trip', async () => {
  const bound = await bodyCost('twin-let-binary', 'twin-let-literal');
  assert.equal(
    (await loopCost('meter-binary-bound-3')) - (await loopCost('meter-literal-bound-3')),
    bound,
    'RT10F_BOUND_REREAD: three times the bound cost means the bound was re-evaluated per trip',
  );
});

// A helper call in the body, so the per-trip charge carries RT-4's per-call charge through the loop
// unchanged. A per-call surcharge inside a loop would break this row and no other.
test('a helper call in the body is charged at its ordinary rate on every trip', async () => {
  const body = await bodyCost('twin-assign-helper', 'twin-two-lets');
  assert.equal(
    (await loopCost('meter-helper-3')) - (await loopCost('meter-helper-1')),
    2 * (HEAD_CHARGE + body),
    'RT10F_METER_DRIFT: a loop must not surcharge or discount a call in its body',
  );
});

// Nesting is compositional: the inner loop is a body statement whose own charge is
// `2 + m*(1 + B)`, so widening the inner range by two costs the outer trip count times two per-trip
// charges. An inner `init`/`exit` hoisted out of the outer body breaks exactly this row.
test('a nested loop charges its own init and exit once per outer trip', async () => {
  const body = await bodyCost('twin-assign-one', 'twin-let-literal');
  const outerTrips = 3;
  assert.equal(
    (await loopCost('meter-nested-3x4')) - (await loopCost('meter-nested-3x2')),
    outerTrips * 2 * (HEAD_CHARGE + body),
    'RT10F_NEST_METER_DRIFT: the inner loop is re-entered once per outer trip',
  );
});

// The absolute totals are not pinned as constants — they are the numbers the builder must report so
// the next slice inherits values rather than formulas — but they must be internally consistent with
// the pinned charge, which is a strictly stronger statement than either difference alone.
test('the absolute loop totals satisfy the pinned charge for every scanned trip count', async () => {
  const body = await bodyCost('twin-assign-one', 'twin-let-literal');
  const zero = await loopCost('meter-trips-0');
  for (const [name, trips] of [
    ['meter-trips-0', 0],
    ['meter-trips-1', 1],
    ['meter-trips-3', 3],
  ]) {
    assert.equal(
      await loopCost(name),
      zero + trips * (HEAD_CHARGE + body),
      `${name}: the total must be the empty-range total plus one head charge and one body per trip`,
    );
  }
});

// A step that is present in the source and a step that is defaulted must charge identically,
// because the linker materializes the omitted step as a literal `1` rather than leaving the legs to
// branch on its absence. An implementation that charged an expression step only for a written step
// separates here and nowhere else.
test('an explicit step of one costs exactly what the defaulted step costs', async () => {
  assert.equal(
    await loopCost('meter-explicit-step-1'),
    await loopCost('meter-trips-3'),
    'RT10F_STEP_DEFAULT_DRIFT: the omitted step must be materialized, not special-cased per leg',
  );
});
