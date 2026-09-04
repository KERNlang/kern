import assert from 'node:assert/strict';
import test from 'node:test';

import { POSITIONS, TABLE_ROWS, admission, assertLinkLabel } from './k0-support.mjs';

// Every row is (position, label). The link code is closed and identical for all of them, so the
// label text is the only thing that says which gate fired.
const REFUSALS = Object.freeze([
  ['neg-step-zero-literal', 'KIR_FOR_ZERO_STEP'],
  ['neg-bound-text-to', 'KIR_FOR_BOUND_NOT_INTEGER'],
  ['neg-bound-bool-from', 'KIR_FOR_BOUND_NOT_INTEGER'],
  ['neg-bound-decimal-to', 'KIR_FOR_BOUND_NOT_INTEGER'],
  ['neg-step-bool', 'KIR_FOR_BOUND_NOT_INTEGER'],
  ['neg-assign-counter', 'KIR_ASSIGN_TO_LOOP_COUNTER'],
  ['neg-shadow-let', 'duplicate binding'],
  ['neg-shadow-parameter', 'duplicate binding'],
  ['neg-shadow-nested-counter', 'duplicate binding'],
  ['neg-counter-after-loop', 'unknown identifier'],
  ['neg-empty-body', 'branch block is empty'],
  ['neg-void-return-in-body', 'KIR_VOID_HANDLER_VALUE_RETURN'],
  ['neg-async-bound-to', 'KIR_ASYNC_CALL_EXPRESSION_POSITION'],
  ['neg-async-bound-from', 'KIR_ASYNC_CALL_EXPRESSION_POSITION'],
  ['neg-async-assign-in-body', 'KIR_ASYNC_CALL_EXPRESSION_POSITION'],
  ['neg-break-in-body', 'statement kind break is outside RT-1'],
  ['neg-continue-in-body', 'statement kind continue is outside RT-1'],
]);

// `while` and `each` are refused by `assertLeaf` before any kind branch runs, and this slice must
// not change that: they stay outside RT-1 with the same message they carry at base.
const LEAF_REFUSALS = Object.freeze([
  ['neg-while', 'statement must be a leaf'],
  ['neg-each', 'statement must be a leaf'],
]);

const ADMITTED = Object.freeze([
  ...TABLE_ROWS.map((row) => row.name),
  'for-step-zero-computed',
  'for-step-zero-dynamic-param',
  'for-async-let-in-body',
]);

async function assertAdmitted(position) {
  const row = await admission(POSITIONS[position]());
  assert.equal(row.projection, 'projected', position);
  assert.equal(row.rt1, 'admitted', position);
  assert.equal(row.javascript, 'admitted', position);
  assert.equal(row.python, 'admitted', position);
  return row;
}

for (const [position, label] of [...REFUSALS, ...LEAF_REFUSALS]) {
  test(`${position} is refused at link with ${label}`, async () => {
    await assertLinkLabel(POSITIONS[position](), label);
  });
}

test('every admitted loop position links on all three legs, so no row is satisfied by a shared refusal', async () => {
  for (const position of ADMITTED) {
    await assertAdmitted(position);
  }
});

// The zero-step rule has two halves that must not collapse into one: a literal dies at link, a
// computed one links and dies at run time. A single implementation that constant-folded the bound
// would refuse both at link and pass the first row while failing this one.
test('a literal zero step is a link refusal while a computed zero step links', async () => {
  const message = await assertLinkLabel(POSITIONS['neg-step-zero-literal'](), 'KIR_FOR_ZERO_STEP');
  assert.ok(!message.includes('KIR_FOR_BOUND_NOT_INTEGER'), 'a literal zero is an integer; only the zero gate fires');
  await assertAdmitted('for-step-zero-computed');
  await assertAdmitted('for-step-zero-dynamic-param');
});

// One gate, two labels. RT-9's `scope.assignable` decides; the counter only changes which label the
// refusal carries, so an implementation that built a second mechanism would report both.
test('assigning the counter reports the loop label and never the let label', async () => {
  const message = await assertLinkLabel(POSITIONS['neg-assign-counter'](), 'KIR_ASSIGN_TO_LOOP_COUNTER');
  assert.ok(
    !message.includes('KIR_ASSIGN_TARGET_NOT_LET'),
    'RT10F_LABEL_DRIFT: the counter refusal must replace the let label, not append to it',
  );
  assert.ok(!message.includes('KIR_ASSIGN_UNDECLARED'), 'the counter is declared; only its assignability is refused');
});

// The bound gate must be attributable to a position. Each row moves exactly one bound off integer
// and leaves the other two integer, so a gate that only checked `to` would pass two of the four.
test('each bound position is gated independently', async () => {
  for (const position of ['neg-bound-text-to', 'neg-bound-bool-from', 'neg-bound-decimal-to', 'neg-step-bool']) {
    const message = await assertLinkLabel(POSITIONS[position](), 'KIR_FOR_BOUND_NOT_INTEGER');
    assert.ok(!message.includes('KIR_FOR_ZERO_STEP'), `${position}: the zero gate must not fire on a non-integer`);
  }
  await assertAdmitted('for-sum-0-3');
});

// The counter lives in the body's scope only. The post-loop read is refused as an unknown
// identifier rather than as a type error, which is what proves it was never bound outside.
test('the counter is unobservable after the loop and shadows nothing', async () => {
  const after = await assertLinkLabel(POSITIONS['neg-counter-after-loop'](), 'unknown identifier');
  assert.ok(after.includes('unknown identifier i'), 'the refusal must name the counter');
  for (const position of ['neg-shadow-let', 'neg-shadow-parameter', 'neg-shadow-nested-counter']) {
    await assertLinkLabel(POSITIONS[position](), 'duplicate binding');
  }
  await assertAdmitted('for-repeated-counter-name');
});

// A bound is not a statement value, so it takes the `if`-condition path through the async position
// gate rather than the `let`-value path. Both labels arrive together, as RT-5 emits them.
test('an async call in a bound reports the position label alone', async () => {
  for (const position of ['neg-async-bound-to', 'neg-async-bound-from']) {
    const message = await assertLinkLabel(POSITIONS[position](), 'KIR_ASYNC_CALL_EXPRESSION_POSITION');
    assert.ok(message.includes('KIR_CALL_CALLEE_CAPABILITY'), `${position}: RT-5 emits both labels together`);
    assert.ok(!message.includes('KIR_FOR_BOUND_NOT_INTEGER'), `${position}: an async integer call is still an integer`);
  }
});

// `break` and `continue` project and reach the body block, so their refusal proves the body is
// compiled by the ordinary statement path and not by a permissive loop-local one.
test('break and continue reach the ordinary statement refusal inside a loop body', async () => {
  for (const [position, keyword] of [
    ['neg-break-in-body', 'break'],
    ['neg-continue-in-body', 'continue'],
  ]) {
    const message = await assertLinkLabel(POSITIONS[position](), `statement kind ${keyword} is outside RT-1`);
    assert.ok(
      !message.includes('statement must be a leaf'),
      `${position}: the body must be compiled, so the leaf gate cannot be what refuses`,
    );
  }
});

test('a nested loop and a loop inside a helper body both link', async () => {
  await assertAdmitted('for-nested-acc');
  await assertAdmitted('for-triple-nested');
  await assertAdmitted('for-in-helper-body');
});

test('a let and an if inside a loop body both link', async () => {
  await assertAdmitted('for-let-in-body');
  await assertAdmitted('for-if-in-body');
  await assertAdmitted('for-early-return');
});

// RT-5's position gate is unchanged by nesting: a direct call as the whole statement value is
// admitted inside a loop body exactly as it is outside one, while the same call embedded in a
// binary expression is still refused, because `assertAsyncCallPosition` never special-cases `for`.
test('an async helper call is admitted as a body statement value but refused embedded in one', async () => {
  await assertAdmitted('for-async-let-in-body');
  const message = await assertLinkLabel(POSITIONS['neg-async-assign-in-body'](), 'KIR_ASYNC_CALL_EXPRESSION_POSITION');
  assert.ok(message.includes('KIR_CALL_CALLEE_CAPABILITY'), 'RT-5 emits both labels together');
});
