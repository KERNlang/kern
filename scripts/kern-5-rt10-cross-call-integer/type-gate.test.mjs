import assert from 'node:assert/strict';
import test from 'node:test';

import { POSITIONS, admission, assertLinkLabel } from './k0-support.mjs';

// Every row is (position, label). The closed link code is the same for all of them, so the
// label text is the only thing that says which gate fired.
const REFUSALS = Object.freeze([
  ['refuse-text-into-int-param', 'KIR_CALL_ARGUMENT_TYPE'],
  ['refuse-bool-into-int-param', 'KIR_CALL_ARGUMENT_TYPE'],
  ['refuse-decimal-into-int-param', 'KIR_CALL_ARGUMENT_TYPE'],
  ['refuse-bool-call-into-int-param', 'KIR_CALL_ARGUMENT_TYPE'],
  ['refuse-int-list-literal-argument', 'KIR_CALL_ARGUMENT_TYPE'],
  ['refuse-int-into-text-param', 'KIR_CALL_ARGUMENT_TYPE'],
  ['refuse-int-into-bool-param', 'KIR_CALL_ARGUMENT_TYPE'],
  ['refuse-int-list-param', 'KIR_CALL_SIGNATURE_TYPE'],
  ['refuse-int-list-return', 'KIR_CALL_SIGNATURE_TYPE'],
  ['refuse-int-arity', 'KIR_CALL_ARITY'],
  ['refuse-int-call-if-cond', 'KIR_IF_COND_NOT_BOOLEAN'],
  ['refuse-int-into-bool-assign', 'KIR_ASSIGN_TYPE_MISMATCH'],
  ['refuse-async-int-operand', 'KIR_ASYNC_CALL_EXPRESSION_POSITION'],
  ['refuse-async-int-argument', 'KIR_ASYNC_CALL_EXPRESSION_POSITION'],
  ['refuse-text-call-operand', 'KIR_BINARY_OPERAND_TYPE'],
]);

const ADMITTED = Object.freeze([
  'bool-argument-control',
  'int-accumulator',
  'int-accumulator-twice',
  'int-arith-argument',
  'int-arith-on-result',
  'int-assign-value',
  'int-async-let',
  'int-async-return',
  'int-big-argument',
  'int-big-through-helper',
  'int-both',
  'int-helper-chain',
  'int-let-passthrough',
  'int-mixed-signature',
  'int-negative-argument',
  'int-nested-call',
  'int-param-only',
  'int-param-passthrough',
  'int-print-tag',
  'int-result-as-operand',
  'int-return',
  'int-return-tag-mismatch',
  'int-two-args',
  'int-uncalled-helper',
  'int-under-comparison',
  'int-unary-on-result',
  'number-spelling',
  'text-argument-control',
]);

async function assertAdmitted(position) {
  const row = await admission(POSITIONS[position]());
  assert.equal(row.projection, 'projected', position);
  assert.equal(row.rt1, 'admitted', position);
  assert.equal(row.javascript, 'admitted', position);
  assert.equal(row.python, 'admitted', position);
  return row;
}

for (const [position, label] of REFUSALS) {
  test(`${position} is refused at link with ${label}`, async () => {
    await assertLinkLabel(POSITIONS[position](), label);
  });
}

test('every admitted integer cross-call position links on all three legs', async () => {
  for (const position of ADMITTED) {
    await assertAdmitted(position);
  }
});

// The pairing that makes each argument refusal non-vacuous: the same helper accepts its own type
// in the same position, so the refusal is about the argument and not about the helper.
test('an argument refusal is paired with the admitted call of the same helper', async () => {
  await assertAdmitted('int-both');
  await assertLinkLabel(POSITIONS['refuse-text-into-int-param'](), 'KIR_CALL_ARGUMENT_TYPE');
  await assertLinkLabel(POSITIONS['refuse-bool-into-int-param'](), 'KIR_CALL_ARGUMENT_TYPE');
  await assertAdmitted('text-argument-control');
  await assertLinkLabel(POSITIONS['refuse-int-into-text-param'](), 'KIR_CALL_ARGUMENT_TYPE');
  await assertAdmitted('bool-argument-control');
  await assertLinkLabel(POSITIONS['refuse-int-into-bool-param'](), 'KIR_CALL_ARGUMENT_TYPE');
});

// `list<integer>` is the deferred half of this slice. Both fences report the *signature* label,
// which is what separates "no row in the table" from "the argument has the wrong type".
test('an integer list signature is refused for its signature, never for its argument', async () => {
  for (const position of ['refuse-int-list-param', 'refuse-int-list-return']) {
    const message = await assertLinkLabel(POSITIONS[position](), 'KIR_CALL_SIGNATURE_TYPE');
    assert.ok(
      !message.includes('KIR_CALL_ARGUMENT_TYPE'),
      `${position}: the signature is checked before the arguments, so only the signature label may fire`,
    );
  }
  const literal = await assertLinkLabel(POSITIONS['refuse-int-list-literal-argument'](), 'KIR_CALL_ARGUMENT_TYPE');
  assert.ok(
    !literal.includes('KIR_CALL_SIGNATURE_TYPE'),
    'an integer list literal handed to a scalar integer parameter is an argument refusal',
  );
});

// This slice makes the async-position label reachable for arithmetic, which RT-10-pre recorded as
// impossible: an async *boolean* call died on its operand type first. Both halves are asserted.
test('an async integer call in a non-statement position reports the position label alone', async () => {
  for (const position of ['refuse-async-int-operand', 'refuse-async-int-argument']) {
    const message = await assertLinkLabel(POSITIONS[position](), 'KIR_ASYNC_CALL_EXPRESSION_POSITION');
    assert.ok(message.includes('KIR_CALL_CALLEE_CAPABILITY'), `${position}: RT-5 emits both labels together`);
    assert.ok(!message.includes('KIR_BINARY_OPERAND_TYPE'), `${position}: the operand gate must not fire`);
    assert.ok(!message.includes('KIR_CALL_ARGUMENT_TYPE'), `${position}: the argument gate must not fire`);
  }
  await assertAdmitted('int-async-let');
  await assertAdmitted('int-async-return');
});

test('arity is checked before either signature check, so an integer helper reports arity', async () => {
  const message = await assertLinkLabel(POSITIONS['refuse-int-arity'](), 'KIR_CALL_ARITY');
  assert.ok(!message.includes('KIR_CALL_SIGNATURE_TYPE'), 'arity precedes the signature gate');
  assert.ok(!message.includes('KIR_CALL_ARGUMENT_TYPE'), 'arity precedes the argument gate');
});

// The static table's exclusive readers. An integer call result must be `integer` statically —
// admitted under a comparison, refused as a condition — and a resolver that answered `boolean`
// would pass the second row while failing the third.
test('the static half of the gate sees integer, not boolean, through a call', async () => {
  await assertAdmitted('int-under-comparison');
  await assertAdmitted('int-arith-on-result');
  await assertLinkLabel(POSITIONS['refuse-int-call-if-cond'](), 'KIR_IF_COND_NOT_BOOLEAN');
});

// The cross-call table's exclusive reader is the argument gate; the assign gate reads both. A
// resolver that admitted the call and left its type absent would fail at run time instead.
test('the cross-call half of the gate refuses an integer call value in a boolean binding', async () => {
  await assertAdmitted('int-assign-value');
  await assertLinkLabel(POSITIONS['refuse-int-into-bool-assign'](), 'KIR_ASSIGN_TYPE_MISMATCH');
});

// A text-returning helper must stay out of the RT-3 operand gate. This is the row that dies if
// the user-call arm answers `integer` for every callee instead of reading the declared kind.
test('a text-returning callee is still not an arithmetic operand', async () => {
  const message = await assertLinkLabel(POSITIONS['refuse-text-call-operand'](), 'KIR_BINARY_OPERAND_TYPE');
  assert.ok(!message.includes('KIR_CALL_SIGNATURE_TYPE'), 'a text call links; only its operand position is refused');
  await assertAdmitted('text-argument-control');
});

test('an integer helper is callable from a helper body and through two call frames', async () => {
  await assertAdmitted('int-helper-chain');
  await assertAdmitted('int-nested-call');
});

test('an integer helper that is never called is inert, so admission is about the call site', async () => {
  await assertAdmitted('int-uncalled-helper');
});

test('both RT-8 spellings are admitted identically in call position', async () => {
  await assertAdmitted('int-both');
  await assertAdmitted('number-spelling');
});
