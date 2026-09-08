import assert from 'node:assert/strict';
import test from 'node:test';

import { POSITIONS } from '../kern-5-rt10-for/k0-support.mjs';
import {
  WHILE_POSITIONS,
  WHILE_TABLE_ROWS,
  assertLinkLabel,
  assertWhileAdmitted,
  pythonLegAdmissionColumn,
} from './k0-support.mjs';

// Every row is (position, label). The link code is closed and identical for all of them, so the
// label text is the only thing that says which gate fired.
const REFUSALS = Object.freeze([
  ['neg-while-cond-integer-literal', 'KIR_WHILE_COND_NOT_BOOLEAN'],
  ['neg-while-cond-integer-param', 'KIR_WHILE_COND_NOT_BOOLEAN'],
  ['neg-while-cond-text-param', 'KIR_WHILE_COND_NOT_BOOLEAN'],
  ['neg-while-cond-binary-integer', 'KIR_WHILE_COND_NOT_BOOLEAN'],
  ['neg-while-empty-body', 'branch block is empty'],
  ['neg-while-let-escapes', 'unknown identifier'],
  ['neg-while-void-return-in-body', 'KIR_VOID_HANDLER_VALUE_RETURN'],
  ['neg-while-cond-async', 'KIR_ASYNC_CALL_EXPRESSION_POSITION'],
  ['neg-while-assign-in-body-async', 'KIR_ASYNC_CALL_EXPRESSION_POSITION'],
]);

const ADMITTED = Object.freeze([
  ...WHILE_TABLE_ROWS.map((row) => row.name),
  'while-cap-via-if',
  'while-print-via-if',
  'while-true-exhausts-steps',
  'neg-while-break-in-body',
  'neg-while-continue-in-body',
]);

for (const [position, label] of REFUSALS) {
  test(`${position} is refused at link with ${label}`, async () => {
    await assertLinkLabel(WHILE_POSITIONS[position](), label);
  });
}

test('every admitted while position links on RT-1 and the JavaScript leg', async () => {
  for (const position of ADMITTED) {
    await assertWhileAdmitted(position, WHILE_POSITIONS[position]());
  }
});

// Boolean only, no truthiness. Four condition shapes, each statically non-boolean for a different
// reason: a literal, a parameter, a parameter of another scalar type, and a computed expression. An
// implementation that only checked literals would pass one row and fail three.
test('a non-boolean condition is refused at link whatever makes it non-boolean', async () => {
  for (const position of [
    'neg-while-cond-integer-literal',
    'neg-while-cond-integer-param',
    'neg-while-cond-text-param',
    'neg-while-cond-binary-integer',
  ]) {
    const message = await assertLinkLabel(WHILE_POSITIONS[position](), 'KIR_WHILE_COND_NOT_BOOLEAN');
    assert.ok(
      !message.includes('KIR_IF_COND_NOT_BOOLEAN'),
      `RT11W_LABEL_DRIFT: ${position} must carry the while label, not the if label`,
    );
    assert.ok(
      !message.includes('KIR_FOR_BOUND_NOT_INTEGER'),
      `RT11W_LABEL_DRIFT: ${position} is a condition, not a bound`,
    );
  }
  await assertWhileAdmitted('while-flag-param-false', WHILE_POSITIONS['while-flag-param-false']());
});

// The empty body is the sharpest discriminator in the suite: at base it is the only `while` fixture
// that reaches `compileStatement`'s kind fallthrough rather than the leaf gate, because it has no
// children. After the slice the refusal must come from `compileBranch`, exactly as `for`'s does.
test('an empty while body is refused by the branch gate and never by the outside-RT-1 fallthrough', async () => {
  const message = await assertLinkLabel(WHILE_POSITIONS['neg-while-empty-body'](), 'branch block is empty');
  assert.ok(
    !message.includes('statement kind while is outside RT-1'),
    'RT11W_ROUTE_GAP: the empty body must be refused by the branch gate, so while is routed at all',
  );
  assert.ok(
    !message.includes('statement must be a leaf'),
    'RT11W_ROUTE_GAP: a childless while must not be mistaken for a leaf statement',
  );
});

// A `while` binds no name, so `scope.counters` is never written and the loop-counter label is
// unreachable from a while. An `assign` in the body is RT-9's ordinary decision and nothing else.
test('an assign inside a while body is governed by RT-9 alone, with no loop-counter label', async () => {
  const row = await assertWhileAdmitted('while-counted-3', WHILE_POSITIONS['while-counted-3']());
  pythonLegAdmissionColumn(row, 'while-counted-3');
  const counterMessage = await assertLinkLabel(POSITIONS['neg-assign-counter'](), 'KIR_ASSIGN_TO_LOOP_COUNTER');
  assert.ok(
    counterMessage.includes('KIR_ASSIGN_TO_LOOP_COUNTER'),
    'RT10F_REGRESSION: the for counter gate must still fire, so the while slice did not widen assignable',
  );
});

// The counter a `while` spells out is an ordinary `let`, so reusing its name in a second sequential
// loop is legal — the opposite of `for`, whose counter binding makes the same shape a duplicate.
test('a while counter is an ordinary let, so two sequential whiles may share its name', async () => {
  await assertWhileAdmitted('while-repeated-counter-name', WHILE_POSITIONS['while-repeated-counter-name']());
  await assertLinkLabel(POSITIONS['neg-shadow-let'](), 'duplicate binding');
});

// A body-local `let` is recomputed every trip and is invisible after the loop, which is what proves
// the body opened a copied scope rather than writing into the enclosing one.
test('a body-local let is admitted inside the loop and unknown after it', async () => {
  await assertWhileAdmitted('while-let-in-body', WHILE_POSITIONS['while-let-in-body']());
  const message = await assertLinkLabel(WHILE_POSITIONS['neg-while-let-escapes'](), 'unknown identifier');
  assert.ok(message.includes('unknown identifier d'), 'the refusal must name the escaped binding');
});

// RT-5's position gate is unchanged by nesting: a direct call as the whole statement value is
// admitted inside a while body exactly as outside one, while the same call embedded in a binary is
// still refused, and an async call in the condition takes the `if`-condition path.
test('an async helper call is admitted as a body statement value but refused in a condition or a binary', async () => {
  await assertWhileAdmitted('while-async-let-in-body', WHILE_POSITIONS['while-async-let-in-body']());
  for (const position of ['neg-while-cond-async', 'neg-while-assign-in-body-async']) {
    const message = await assertLinkLabel(WHILE_POSITIONS[position](), 'KIR_ASYNC_CALL_EXPRESSION_POSITION');
    assert.ok(message.includes('KIR_CALL_CALLEE_CAPABILITY'), `${position}: RT-5 emits both labels together`);
  }
});

// `each` shares the leaf refusal with an unrouted `while`, so the message alone cannot tell the two
// apart: at base the outer while is what fires it. The label path is the discriminator — a refusal
// attributed to the loop's body proves the loop itself was compiled.
test('each inside a while body is refused as a body child, attributed to the body', async () => {
  const message = await assertLinkLabel(WHILE_POSITIONS['neg-while-each-in-body'](), 'statement must be a leaf');
  assert.match(
    message,
    /\.body\.children\[/u,
    'RT11W_ROUTE_GAP: the refusal must be attributed to the while body, not to the while statement',
  );
});

// A synchronous user call in the condition is admitted, so the async refusal above is about
// suspension and not about calls. Codex's tribunal point: banning user calls in conditions would
// weaken the future importer for no Python-catch-up benefit.
test('a synchronous boolean user call is admitted as a condition', async () => {
  await assertWhileAdmitted('while-cond-user-call', WHILE_POSITIONS['while-cond-user-call']());
});

test('a while nested in every loop and branch position links', async () => {
  for (const position of [
    'while-nested-while',
    'while-for-in-body',
    'while-in-for-body',
    'while-in-if-then',
    'while-in-if-else',
    'while-in-helper-body',
  ]) {
    await assertWhileAdmitted(position, WHILE_POSITIONS[position]());
  }
});

// `containsReturn` is the walker that fails silently rather than loudly: without a `while` arm a
// void handler whose only `return` sits in a while body links and then faults at execution.
test('a void handler whose only return is inside a while body is refused at link', async () => {
  const message = await assertLinkLabel(
    WHILE_POSITIONS['neg-while-void-return-in-body'](),
    'KIR_VOID_HANDLER_VALUE_RETURN',
  );
  assert.ok(
    !message.includes('did not return'),
    'RT11W_RETURN_BLIND: the refusal must come from the link-time return walk, not from execution',
  );
});

// The for suite's own admitted positions, re-asserted here: a `while` route added to `compileBlock`
// must not disturb the `for` route it sits beside.
test('the for slice keeps every one of its admitted positions', async () => {
  for (const position of ['for-sum-0-3', 'for-nested-acc', 'for-if-in-body', 'for-early-return', 'for-in-helper-body']) {
    const row = await assertWhileAdmitted(position, POSITIONS[position]());
    assert.equal(row.python, 'admitted', `RT10F_REGRESSION: ${position} must still compile on the Python leg`);
  }
});
