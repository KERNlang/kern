import assert from 'node:assert/strict';
import test from 'node:test';

import {
  JUMP_METER_POSITIONS,
  JUMP_POSITIONS,
  JUMP_THRESHOLD_POSITIONS,
  JUMP_TWINS,
  LIMITS,
  assertJumpStepThreshold,
  integerSlot,
  jumpTwoLegBytes,
  loopStepBudget,
  runtimeRequest,
} from './k0-support.mjs';

// Measured on the landed slice-B base, never derived: the whole point of RT12J-D5 is that a
// formula in an oracle goes RED against a correct implementation. `C` is one condition evaluation
// and `EXIT_SLOT` the single loop-exit charge both exit paths share.
const TWIN_COSTS = Object.freeze({
  'twin-for-1-leaf': 14,
  'twin-for-1-two-leaves': 18,
  'twin-for-3-leaf': 24,
  'twin-nested-3x1-leaf': 42,
  'twin-nested-3x2-leaf': 57,
  'twin-two-lets': 6,
  'twin-while-1-leaf': 23,
  'twin-while-3-leaf': 47,
  'twin-while-never-entered': 11,
});

const WHILE_STATEMENT_AND_EXIT = 2;
const EXIT_SLOT = 1;

async function twinCost(name) {
  return (await loopStepBudget(JUMP_TWINS[name](), {}, `rt12j-${name}`)).execution;
}

async function jumpCost(name) {
  return (await loopStepBudget(JUMP_METER_POSITIONS[name](), {}, `rt12j-${name}`)).execution;
}

// The condition's per-evaluation cost, measured from the never-entered path: a `while` that never
// enters charges its own statement boundary, one condition evaluation and one exit slot.
async function conditionCost() {
  return (await twinCost('twin-while-never-entered')) - (await twinCost('twin-two-lets')) - WHILE_STATEMENT_AND_EXIT;
}

// GREEN at base, and the anchor every identity below is read against: if a twin's own cost moves,
// the identities are being measured against a different program than the one they were derived on.
test('the jump-free twins reproduce the base costs the identities are derived from', async () => {
  for (const [name, expected] of Object.entries(TWIN_COSTS)) {
    assert.equal(await twinCost(name), expected, `RT12J_TWIN_DRIFT: ${name} no longer costs ${expected} steps`);
  }
  assert.equal(await conditionCost(), 3, 'one `i < literal` evaluation costs three steps');
  assert.equal(
    (await twinCost('twin-for-1-two-leaves')) - (await twinCost('twin-for-1-leaf')),
    4,
    'one ordinary body statement costs four steps, so a jump charged as one costs four too if it owned an expression',
  );
});

// J1. `for 0..N { assign; break }` for N in {1, 3, 10}: three fixtures whose bodies are the
// identical two statements (one assign, one break) and whose bounds are all integer literals, so
// the only thing that varies is a number that a break makes unreachable. A break that did not
// actually leave the loop would scale with N; one that left too much would not link.
test('a break makes the trip count irrelevant, so the bound cannot change the charge', async () => {
  const one = await jumpCost('meter-for-1-leaf-break');
  const three = await jumpCost('meter-for-3-break-bound-3');
  const ten = await jumpCost('meter-for-3-break-bound-10');
  assert.equal(one, three, 'RT12J_BREAK_LEAK: a break on the first trip must not depend on the bound');
  assert.equal(three, ten, 'RT12J_BREAK_LEAK: widening the bound tenfold must change nothing');
});

// J2. Twin pair, hand-counted: `twin-for-1-leaf` body is ONE statement (assign acc = acc + 1);
// `meter-for-1-leaf-break` body is TWO statements (that same assign, then break). Both run exactly
// one trip. The twin leaves through a failed re-test, the jump fixture through the break, and both
// exit paths charge the one exit slot — so the whole difference is the break's own statement
// boundary. Charged zero gives 0, charged with a head re-entry gives 2, skipping the exit gives 0.
test('a break costs exactly one statement boundary and lands on the one shared exit slot', async () => {
  const twin = await twinCost('twin-for-1-leaf');
  const withBreak = await jumpCost('meter-for-1-leaf-break');
  assert.equal(
    withBreak - twin,
    1,
    'RT12J_BREAK_CHARGE: body 1 statement vs body 2 statements, one trip each, must differ by exactly one step',
  );
});

// J3. Twin pair, hand-counted: `twin-for-3-leaf` body is ONE statement; `meter-for-3-leaf-continue`
// body is TWO (that assign, then continue). Both run three trips and both return 3. A continue that
// skipped the counter advance would never terminate and `loopStepBudget` would find no threshold at
// all; one that charged the head twice would differ by six.
test('a continue costs one statement boundary per trip and still advances the counter', async () => {
  const twin = await twinCost('twin-for-3-leaf');
  const withContinue = await jumpCost('meter-for-3-leaf-continue');
  assert.equal(
    withContinue - twin,
    3,
    'RT12J_CONTINUE_CHARGE: body 1 statement vs body 2 statements, three trips each, must differ by exactly three',
  );
  const runs = await jumpTwoLegBytes(
    JUMP_METER_POSITIONS['meter-for-3-leaf-continue'](),
    runtimeRequest('rt12j-continue-terminates', {}),
  );
  assert.deepEqual(
    runs.legs.direct.envelope.result,
    integerSlot('3'),
    'RT12J_CONTINUE_CHARGE: the run must terminate with all three trips accounted for',
  );
});

// J4. Two twin pairs, hand-counted: each dead-tail fixture carries its partner's body plus exactly
// one unreachable `assign acc = acc + 1`. Equality is the claim, so a jump that fell through to the
// trailing statement pays for it and separates immediately.
test('a statement after an unconditional jump is charged nothing, in both jump kinds', async () => {
  assert.equal(
    await jumpCost('meter-for-3-continue-dead-tail'),
    await jumpCost('meter-for-3-continue'),
    'RT12J_DEAD_CODE_CHARGE: body 2 statements vs body 1 statement, the extra one unreachable',
  );
  assert.equal(
    await jumpCost('meter-for-3-break-dead-tail'),
    await jumpCost('meter-for-3-break'),
    'RT12J_DEAD_CODE_CHARGE: body 2 statements vs body 1 statement, the extra one unreachable',
  );
});

// J5, first half. Twin pair, hand-counted: `twin-while-3-leaf` body is TWO statements (the
// accumulate and the counter increment the condition form has to spell out); the continue fixture
// body is THREE (those two, then continue). Both run three trips and both return 3. The condition
// form reaches the head by re-reading its condition rather than by advancing a counter, so this row
// is the one that says the "jump the loop frame to its end" formulation works for both loop forms.
test('a continue in a condition loop costs one boundary per trip and re-tests the condition', async () => {
  const twin = await twinCost('twin-while-3-leaf');
  const withContinue = await jumpCost('meter-while-3-leaf-continue');
  assert.equal(
    withContinue - twin,
    3,
    'RT12J_CONTINUE_CHARGE: body 2 statements vs body 3 statements, three trips each, must differ by exactly three',
  );
});

// J5, second half, and the sharpest row in the file. Twin pair, hand-counted: `twin-while-1-leaf`
// body is TWO statements; `meter-while-1-leaf-break` body is THREE (those two, then break). Both
// run exactly one trip. The twin then pays one more condition evaluation (the failed re-test) and
// its exit slot; the jump fixture pays the break's boundary and its exit slot. So the twin costs
// exactly `C - 1` more, with `C` measured independently from the never-entered path. A break that
// re-tested the condition on its way out would make the difference `-1`; one that skipped the exit
// slot would make it `C`.
test('a break in a condition loop skips exactly one condition re-evaluation and no exit charge', async () => {
  const condition = await conditionCost();
  const twin = await twinCost('twin-while-1-leaf');
  const withBreak = await jumpCost('meter-while-1-leaf-break');
  assert.equal(
    twin - withBreak,
    condition - EXIT_SLOT,
    'RT12J_BREAK_CHARGE: body 2 statements vs body 3 statements, one trip each; the twin pays one extra condition',
  );
});

// J6. Two nested twin pairs, hand-counted. Break pair: `twin-nested-3x1-leaf`'s inner body is ONE
// statement and its inner bound 1, so the inner loop runs exactly one trip per outer pass;
// `meter-nested-3x5-leaf-break`'s inner body is TWO (that assign, then break) and its inner bound
// 5, so the break is what makes it one trip. Three outer passes, one break each, so exactly three
// steps. An inner break that popped the OUTER loop would end the run after one outer pass and cost
// far less; one that popped nothing would run five inner trips and cost far more.
test('an inner break is loop-local, costing one boundary per outer pass and nothing else', async () => {
  const twin = await twinCost('twin-nested-3x1-leaf');
  const withBreak = await jumpCost('meter-nested-3x5-leaf-break');
  assert.equal(
    withBreak - twin,
    3,
    'RT12J_LOCALITY_CHARGE: inner body 1 statement at bound 1 vs 2 statements at bound 5, one inner trip either way',
  );
});

// J6, continue half. Twin pair, hand-counted: identical inner bound 2, inner body ONE statement vs
// TWO (that assign, then continue). Three outer passes times two inner trips is six boundaries.
test('an inner continue is loop-local, costing one boundary per inner trip per outer pass', async () => {
  const twin = await twinCost('twin-nested-3x2-leaf');
  const withContinue = await jumpCost('meter-nested-3x2-leaf-continue');
  assert.equal(
    withContinue - twin,
    6,
    'RT12J_LOCALITY_CHARGE: inner body 1 statement vs 2 statements, both at bound 2, three outer passes',
  );
});

// J7. The leg-identity gate, one row per fixture family: both jump kinds, both loop forms, a nested
// pair, and a continue whose body is nothing but the jump. A leg that charged any single slot
// differently separates at that family's threshold, because the threshold is pinned from both
// sides — the artifact succeeds at RT-1's execution count and fails one step under it.
for (const name of JUMP_THRESHOLD_POSITIONS) {
  test(`${name} charges identically on RT-1 and the JavaScript leg at every budget`, async () => {
    await assertJumpStepThreshold(name, JUMP_METER_POSITIONS[name]());
  });
}

// The canonical importer shape gets its own threshold row: it is the only family whose loop has no
// exit but the jump, so a break charged wrongly there cannot be absorbed by a condition re-test.
test('the while-true importer shape charges identically on both legs at every budget', async () => {
  await assertJumpStepThreshold('while-true-break-counter', JUMP_POSITIONS['while-true-break-counter']());
});

// The exhaustion path no threshold can pin, because there is no budget at which it succeeds: a
// continue that skips its own increment must exhaust identically on both legs at every budget,
// which `jumpTwoLegBytes` asserts by comparing the two envelopes byte for byte.
test('a continue that skips its increment exhausts identically on both legs at every budget', async () => {
  for (const maxSteps of [16, 64, 512]) {
    const request = {
      ...runtimeRequest(`rt12j-diverge-${maxSteps}`, {}),
      limits: { ...LIMITS, maxSteps },
    };
    const runs = await jumpTwoLegBytes(JUMP_POSITIONS['while-continue-skips-increment'](), request);
    assert.equal(runs.legs.direct.envelope.outcome, 'failure', `maxSteps ${maxSteps}: RT-1 must exhaust`);
    assert.equal(
      runs.legs.direct.envelope.diagnostics[0]?.code,
      'runtime-limit-exceeded',
      `maxSteps ${maxSteps}: the step budget is what refuses`,
    );
  }
});
