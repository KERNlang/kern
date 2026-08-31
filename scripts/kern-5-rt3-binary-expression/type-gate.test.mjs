import assert from 'node:assert/strict';
import test from 'node:test';

import { admission, executeKernKir, handlerSource, provider, runtimeRequest } from './k0-support.mjs';

const FLAGS = Object.freeze([
  { name: 'flag', type: 'boolean' },
  { name: 'other', type: 'boolean' },
]);
const LABEL = Object.freeze([{ name: 'label', type: 'string' }]);
const FLAG_LIST = Object.freeze([{ name: 'flags', type: 'boolean[]' }]);

function returnSource(parameters, expression) {
  return handlerSource('boolean', parameters, [`return value="${expression}"`]);
}

const MIXED_TYPE_SOURCES = Object.freeze({
  'boolean and integer equality': returnSource(FLAGS, 'flag == 1'),
  'boolean list operand': returnSource(FLAG_LIST, 'flags && flags'),
  'boolean ordering': returnSource(FLAGS, 'flag < other'),
  'chained comparison folds to a boolean operand': returnSource(FLAGS, '1 < 2 < 3'),
  'decimal ordering': returnSource(FLAGS, '1.5 < 2'),
  'integer and boolean conjunction': returnSource(FLAGS, 'flag && 1'),
  'integer and boolean ordering': returnSource(FLAGS, '1 < flag'),
  'text equality': returnSource(LABEL, 'label == label'),
  'text ordering': returnSource(LABEL, 'label > label'),
});

const UNSUPPORTED_OPERATOR_SOURCES = Object.freeze(
  Object.fromEntries(
    ['+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>', '===', '!==', '??'].map((operator) => [
      `operator ${operator}`,
      returnSource(FLAGS, `1 ${operator} 2`),
    ]),
  ),
);

const OUT_OF_PROFILE_SOURCES = Object.freeze({
  'capability-bound operand': handlerSource('boolean', FLAGS, [
    'capability namespace=fixture operation=resolve name=reply',
    'return value="reply == reply"',
  ]),
  'intrinsic result operand': handlerSource('boolean', LABEL, [
    'let name=payload value="Json.parse(label)"',
    'return value="payload == payload"',
  ]),
  'member read operand': handlerSource('boolean', LABEL, [
    'let name=payload value="Json.parse(label)"',
    'return value="payload.left == payload.right"',
  ]),
  'unary operator': returnSource(FLAGS, '!flag'),
});

const CONDITION_SOURCES = Object.freeze({
  'mixed-type binary condition': handlerSource('boolean', FLAGS, [
    'if cond="flag == 1"',
    '  return value="true"',
    'return value="false"',
  ]),
  'unsupported-operator binary condition': handlerSource('boolean', FLAGS, [
    'if cond="1 + 2"',
    '  return value="true"',
    'return value="false"',
  ]),
});

const LET_SOURCES = Object.freeze({
  'mixed-type binary initializer': handlerSource('boolean', FLAGS, [
    'let name=held value="flag == 1"',
    'return value="held"',
  ]),
  'unsupported-operator binary initializer': handlerSource('boolean', FLAGS, [
    'let name=held value="1 % 2"',
    'return value="held"',
  ]),
});

const NEGATIVE_CONTROLS = Object.freeze({
  ...CONDITION_SOURCES,
  ...LET_SOURCES,
  ...MIXED_TYPE_SOURCES,
  ...OUT_OF_PROFILE_SOURCES,
  ...UNSUPPORTED_OPERATOR_SOURCES,
});

for (const [name, source] of Object.entries(NEGATIVE_CONTROLS)) {
  test(`RT-3 fails closed at link on ${name}`, async () => {
    const codes = await admission(source);
    assert.equal(codes.projection, 'projected', 'the negative control must reach the linker through real F5');
    assert.deepEqual(
      { javascript: codes.javascript, python: codes.python, rt1: codes.rt1 },
      {
        javascript: 'handler-entry-unsupported',
        python: 'handler-entry-unsupported',
        rt1: 'handler-entry-unsupported',
      },
      'KIR_BINARY_OPERAND_TYPE: an out-of-profile binary must fail closed identically on all three legs',
    );
    const direct = await executeKernKir(
      codes.verified,
      runtimeRequest('rt3-negative', { flag: { tag: 'boolean', value: true } }),
      provider([]),
    );
    assert.deepEqual([...direct.events], [], 'a rejected binary must not commit an event');
    assert.deepEqual(direct.result, { presence: 'absent' });
  });
}

test('RT-3 keeps a branch-local binary binding out of the enclosing scope', async () => {
  const codes = await admission(
    handlerSource('boolean', FLAGS, [
      'if cond="flag"',
      '  let name=inner value="flag && other"',
      '  print value="\"branch\""',
      'return value="inner"',
    ]),
  );
  assert.deepEqual(
    { javascript: codes.javascript, python: codes.python, rt1: codes.rt1 },
    {
      javascript: 'handler-entry-unsupported',
      python: 'handler-entry-unsupported',
      rt1: 'handler-entry-unsupported',
    },
  );
});

test('RT-3 rejects a non-canonical integer operand before it reaches a comparison', async () => {
  const codes = await admission(returnSource(FLAGS, '00 < 1'));
  assert.equal(codes.projection, 'projection-rejected', 'F5 must reject a non-canonical integer literal');
});
