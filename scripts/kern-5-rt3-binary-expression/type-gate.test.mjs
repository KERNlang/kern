import assert from 'node:assert/strict';
import test from 'node:test';

import { readFile } from 'node:fs/promises';

import { LINKED_KIR_BINARY_OPERATORS } from '../../packages/core/dist/kir-runtime/linked-kir-program/index.js';
import {
  OPERATORS,
  admission,
  compileJavaScript,
  compilePython,
  executeKernKir,
  handlerSource,
  project,
  provider,
  runtimeRequest,
} from './k0-support.mjs';

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
    ['/', '%', '&', '|', '^', '<<', '>>', '===', '!==', '??'].map((operator) => [
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

const REBINDING_SOURCES = Object.freeze({
  'capability rebinds a boolean let then feeds a binary': handlerSource('boolean', FLAGS, [
    'let name=x value="true"',
    'capability namespace=fixture operation=resolve name=x',
    'return value="x && true"',
  ]),
  'capability rebinds a boolean let then feeds an if condition': handlerSource('string', FLAGS, [
    'let name=x value="true"',
    'capability namespace=fixture operation=resolve name=x',
    'if cond="x && flag"',
    '  print value="\"taken\""',
    'return value="\"done\""',
  ]),
  'capability rebinds a boolean parameter': handlerSource('boolean', FLAGS, [
    'capability namespace=fixture operation=resolve name=flag',
    'return value="flag && other"',
  ]),
  'capability rebinds inside a branch and is used in that branch': handlerSource('string', FLAGS, [
    'let name=x value="true"',
    'if cond="flag"',
    '  capability namespace=fixture operation=resolve name=x',
    '  if cond="x && flag"',
    '    print value="\"deep\""',
    'return value="\"done\""',
  ]),
  'let rebinds a boolean let with an untyped initializer': handlerSource('boolean', LABEL, [
    'let name=x value="true"',
    'let name=x value="Json.parse(label)"',
    'return value="x && true"',
  ]),
  'let rebinds an integer let with text': handlerSource('boolean', LABEL, [
    'let name=n value="3"',
    'let name=n value="label"',
    'return value="n < 5"',
  ]),
  'sibling branch rebinds a branch-local name': handlerSource('string', FLAGS, [
    'if cond="flag"',
    '  let name=y value="true"',
    '  print value="\"then\""',
    'else',
    '  capability namespace=fixture operation=resolve name=y',
    '  if cond="y && flag"',
    '    print value="\"else-deep\""',
    'return value="\"done\""',
  ]),
  'branch rebinds an outer boolean let with text': handlerSource('string', FLAGS, [
    'let name=x value="true"',
    'if cond="flag"',
    '  let name=x value="\"text\""',
    '  print value="x"',
    'return value="\"done\""',
  ]),
});

for (const [name, source] of Object.entries(REBINDING_SOURCES)) {
  test(`RT-3 never carries a stale static type across a re-binding: ${name}`, async () => {
    const codes = await admission(source);
    assert.equal(codes.projection, 'projected', 'the re-binding control must reach the linker through real F5');
    assert.deepEqual(
      { javascript: codes.javascript, python: codes.python, rt1: codes.rt1 },
      {
        javascript: 'handler-entry-unsupported',
        python: 'handler-entry-unsupported',
        rt1: 'handler-entry-unsupported',
      },
      'KIR_BINARY_OPERAND_TYPE: a re-bound name must never keep the static type of its previous binding',
    );
  });
}

test('RT-3 carries the operand-type label at the runtime guard on all three legs', async () => {
  const verified = await project(returnSource(FLAGS, '1 < 2'));
  const javascript = compileJavaScript(verified);
  const python = compilePython(verified);
  assert.equal(javascript.outcome, 'success', `javascript compile failed: ${javascript.code}`);
  assert.equal(python.outcome, 'success', `python compile failed: ${python.code}`);
  const decoder = new TextDecoder();
  const legs = {
    javascript: decoder.decode(javascript.artifact.bytes),
    python: decoder.decode(python.artifact.bytes),
    rt1: await readFile(new URL('../../packages/core/dist/kir-runtime/expression.js', import.meta.url), 'utf8'),
  };
  for (const [leg, text] of Object.entries(legs)) {
    assert.match(
      text,
      /KIR_BINARY_OPERAND_TYPE/u,
      `the ${leg} operand guard must carry the KIR_BINARY_OPERAND_TYPE label beside the closed wire code`,
    );
    assert.match(
      text,
      /unsupported-runtime-input/u,
      `the ${leg} operand guard must keep the closed unsupported-runtime-input wire code`,
    );
  }
});

test('RT-3 derives every operator table from one shared contract', () => {
  const contract = LINKED_KIR_BINARY_OPERATORS;
  for (const operator of OPERATORS) {
    assert.ok(Object.hasOwn(contract, operator), `${operator} must stay in the shared operator contract`);
  }
  assert.ok(Object.isFrozen(contract), 'the shared operator contract must be frozen');
  const helpers = new Set();
  for (const operator of OPERATORS) {
    const entry = contract[operator];
    assert.ok(['logical', 'equality', 'ordering'].includes(entry.family), `${operator} needs a closed family`);
    assert.ok(['boolean', 'integer', 'either'].includes(entry.operandType), `${operator} needs a closed operand type`);
    assert.match(entry.javascriptHelper, /^__[a-z]+$/u);
    assert.match(entry.pythonHelper, /^_[a-z]+$/u);
    helpers.add(entry.javascriptHelper);
    helpers.add(entry.pythonHelper);
  }
  assert.equal(helpers.size, OPERATORS.length * 2, 'every operator needs its own helper on each target');
});
