import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FRONTEND_WALLS,
  OVERSIZED_INTEGER_LITERAL,
  POSITIONS,
  SIZE_LIMIT_BYTES,
  admission,
  assertLinkLabel,
  limitRequest,
  threeLegBytes,
} from './k0-support.mjs';

// Every row is (position, label). The closed link code is the same for all of them, so the
// label text is the only thing that says which gate fired.
const REFUSALS = Object.freeze([
  ['refuse-div', 'KIR_BINARY_OP_UNSUPPORTED'],
  ['refuse-mod', 'KIR_BINARY_OP_UNSUPPORTED'],
  ['refuse-pow', 'KIR_BINARY_OP_UNSUPPORTED'],
  ['refuse-shift', 'KIR_BINARY_OP_UNSUPPORTED'],
  ['refuse-unary-not', 'KIR_UNARY_OP_UNSUPPORTED'],
  ['refuse-unary-plus', 'KIR_UNARY_OP_UNSUPPORTED'],
  ['refuse-text-operands', 'KIR_BINARY_OPERAND_TYPE'],
  ['refuse-int-text', 'KIR_BINARY_OPERAND_TYPE'],
  ['refuse-text-int', 'KIR_BINARY_OPERAND_TYPE'],
  ['refuse-bool-operands', 'KIR_BINARY_OPERAND_TYPE'],
  ['refuse-bool-param-left', 'KIR_BINARY_OPERAND_TYPE'],
  ['refuse-bool-param-right', 'KIR_BINARY_OPERAND_TYPE'],
  ['refuse-decimal-operand', 'KIR_BINARY_OPERAND_TYPE'],
  ['refuse-list-operand', 'KIR_BINARY_OPERAND_TYPE'],
  ['refuse-text-param-operands', 'KIR_BINARY_OPERAND_TYPE'],
  ['refuse-capability-operand', 'KIR_BINARY_OPERAND_TYPE'],
  ['refuse-call-operand', 'KIR_BINARY_OPERAND_TYPE'],
  ['refuse-binary-async-operand', 'KIR_BINARY_OPERAND_TYPE'],
  ['refuse-binary-async-operand-right', 'KIR_BINARY_OPERAND_TYPE'],
  ['refuse-chained-comparison', 'KIR_BINARY_OPERAND_TYPE'],
  ['refuse-unary-text-param', 'KIR_UNARY_OPERAND_TYPE'],
  ['refuse-unary-bool-param', 'KIR_UNARY_OPERAND_TYPE'],
  ['refuse-unary-decimal', 'KIR_UNARY_OPERAND_TYPE'],
  ['refuse-unary-list-param', 'KIR_UNARY_OPERAND_TYPE'],
  ['refuse-unary-capability', 'KIR_UNARY_OPERAND_TYPE'],
  ['refuse-unary-call', 'KIR_UNARY_OPERAND_TYPE'],
  ['refuse-unary-over-async-call', 'KIR_UNARY_OPERAND_TYPE'],
  ['refuse-arith-if-cond', 'KIR_IF_COND_NOT_BOOLEAN'],
  ['refuse-arith-call-argument', 'KIR_CALL_ARGUMENT_TYPE'],
]);

const ADMITTED = Object.freeze([
  'add-in-let',
  'add-in-print-tag',
  'add-in-return',
  'add-under-comparison-in-if',
  'add-under-comparison-in-let',
  'arith-return-type-mismatch',
  'assign-arith',
  'assign-arith-params',
  'assign-neg',
  'helper-body-arith',
  'local-add',
  'mul-in-return',
  'neg-in-let',
  'neg-in-return',
  'neg-of-local',
  'neg-through-binding-zero',
  'param-add',
  'param-add-under-comparison-in-if',
  'param-neg',
  'param-ordering',
  'refuse-integer-helper-call',
  'refuse-integer-helper-operand',
  'refuse-integer-param-helper-call',
  'sub-in-return',
]);

for (const [position, label] of REFUSALS) {
  test(`${position} is refused at link with ${label}`, async () => {
    await assertLinkLabel(POSITIONS[position](), label);
  });
}

test('every admitted arithmetic position links on all three legs', async () => {
  for (const position of ADMITTED) {
    const row = await admission(POSITIONS[position]());
    assert.equal(row.projection, 'projected', position);
    assert.equal(row.rt1, 'admitted', position);
    assert.equal(row.javascript, 'admitted', position);
    assert.equal(row.python, 'admitted', position);
  }
});

test('an out-of-profile binary operator reports the operator label, never the operand label', async () => {
  for (const position of ['refuse-div', 'refuse-mod', 'refuse-pow', 'refuse-shift']) {
    const message = await assertLinkLabel(POSITIONS[position](), 'KIR_BINARY_OP_UNSUPPORTED');
    assert.ok(
      !message.includes('KIR_BINARY_OPERAND_TYPE'),
      `${position}: the operator is checked before the operands, so only the operator label may fire`,
    );
  }
});

test('an out-of-profile unary operator reports the operator label, never the operand label', async () => {
  for (const position of ['refuse-unary-not', 'refuse-unary-plus']) {
    const message = await assertLinkLabel(POSITIONS[position](), 'KIR_UNARY_OP_UNSUPPORTED');
    assert.ok(!message.includes('KIR_UNARY_OPERAND_TYPE'), position);
  }
});

test('a unary over a non-integer operand reports the operand label, never the operator label', async () => {
  for (const position of ['refuse-unary-text-param', 'refuse-unary-bool-param', 'refuse-unary-call']) {
    const message = await assertLinkLabel(POSITIONS[position](), 'KIR_UNARY_OPERAND_TYPE');
    assert.ok(!message.includes('KIR_UNARY_OP_UNSUPPORTED'), position);
  }
});

// The two rows that separate the static-type answer from the cross-call answer: an arithmetic
// result must be `integer` statically (so a comparison accepts it and an `if` does not) and
// must have no cross-call type at all (so a boolean parameter refuses it at link, not at run
// time). A gate that answers `boolean` for an arithmetic binary passes both of these.
test('the arithmetic result type is integer statically and absent across a call boundary', async () => {
  const admittedUnderComparison = await admission(POSITIONS['add-under-comparison-in-let']());
  assert.equal(admittedUnderComparison.rt1, 'admitted');
  await assertLinkLabel(POSITIONS['refuse-arith-if-cond'](), 'KIR_IF_COND_NOT_BOOLEAN');
  await assertLinkLabel(POSITIONS['refuse-arith-call-argument'](), 'KIR_CALL_ARGUMENT_TYPE');
});

// The integer-parameter static type (RT10P-C6) is the one gate whose base refusal is the
// operand gate rather than the operator gate, so it gets its own non-vacuous pairing: the
// ordering operator RT-3 already owns must accept two integer parameters.
test('an integer parameter is a legal operand for both an RT-3 comparison and an RT-10-pre operator', async () => {
  for (const position of ['param-ordering', 'param-add', 'param-neg']) {
    const row = await admission(POSITIONS[position]());
    assert.equal(row.rt1, 'admitted', position);
    assert.equal(row.javascript, 'admitted', position);
    assert.equal(row.python, 'admitted', position);
  }
  await assertLinkLabel(POSITIONS['refuse-bool-param-left'](), 'KIR_BINARY_OPERAND_TYPE');
  await assertLinkLabel(POSITIONS['refuse-unary-bool-param'](), 'KIR_UNARY_OPERAND_TYPE');
});

// The static-type resolver has to see through the call before the async position gate is
// consulted: `compileLinkedExpression` finishes the whole operand tree, and only then does
// `link.ts` call `assertAsyncCallPosition`. So an async call under a unary or as an arithmetic
// operand is refused for its *type*, and the async-position label is unreachable for
// arithmetic in this slice. Both rows fail if the unary arm forgets to resolve its argument.
test('an async call under a unary or as an arithmetic operand is refused by the type gate first', async () => {
  for (const position of ['refuse-unary-over-async-call']) {
    const message = await assertLinkLabel(POSITIONS[position](), 'KIR_UNARY_OPERAND_TYPE');
    assert.ok(!message.includes('KIR_ASYNC_CALL_EXPRESSION_POSITION'), position);
  }
  for (const position of ['refuse-binary-async-operand', 'refuse-binary-async-operand-right']) {
    const message = await assertLinkLabel(POSITIONS[position](), 'KIR_BINARY_OPERAND_TYPE');
    assert.ok(!message.includes('KIR_ASYNC_CALL_EXPRESSION_POSITION'), position);
  }
});

test('an arithmetic value is admitted in an assign, the position rt10 accumulation needs', async () => {
  for (const position of ['assign-arith', 'assign-arith-params', 'assign-neg']) {
    const row = await admission(POSITIONS[position]());
    assert.equal(row.projection, 'projected', position);
    assert.equal(row.rt1, 'admitted', position);
    assert.equal(row.javascript, 'admitted', position);
    assert.equal(row.python, 'admitted', position);
  }
});

test('the two negative-literal and leading-zero forms are frontend walls, not link decisions', async () => {
  for (const position of FRONTEND_WALLS) {
    const row = await admission(POSITIONS[position]());
    assert.equal(row.projection, 'not-projected', position);
  }
});

// The result bound (RT10P-C15) is only half a bound: an oversized integer *literal* must not be
// able to enter the runtime either, or the operand side is unbounded. It cannot — `canonicalScalar`
// (`linked-kir-program/expression.ts:39-50`) already runs every integer literal's canonical text
// through `meter.text`, so the refusal is the existing per-string limit fault at link.
test('an integer literal longer than maxStringBytes is refused before it can be an operand', async () => {
  assert.ok(
    OVERSIZED_INTEGER_LITERAL.length > SIZE_LIMIT_BYTES,
    'the fixture literal must exceed the limit it is tested against',
  );
  const { legs } = await threeLegBytes(
    POSITIONS['refuse-oversized-integer-literal'](),
    limitRequest('rt10p-big-literal', SIZE_LIMIT_BYTES),
  );
  const result = legs.direct.envelope;
  assert.equal(
    result.outcome,
    'failure',
    'RT10PRE_LITERAL_UNBOUNDED: an oversized integer literal reached the runtime',
  );
  assert.deepEqual(
    [...result.diagnostics],
    [{ category: 'runtime', code: 'runtime-limit-exceeded', phase: 'execution' }],
  );
  assert.deepEqual([...result.events], []);
});

test('the same literal is admitted under the suite default limit, so the gate is the limit', async () => {
  const row = await admission(POSITIONS['refuse-oversized-integer-literal']());
  assert.equal(row.projection, 'projected');
  assert.equal(row.rt1, 'admitted');
  assert.equal(row.javascript, 'admitted');
  assert.equal(row.python, 'admitted');
});

test('every magnitude-amplifying operator stays fail closed, so the bound cannot be dodged', async () => {
  for (const position of ['refuse-pow', 'refuse-shift']) {
    await assertLinkLabel(POSITIONS[position](), 'KIR_BINARY_OP_UNSUPPORTED');
  }
});
