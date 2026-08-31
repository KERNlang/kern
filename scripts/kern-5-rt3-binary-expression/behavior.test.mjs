import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OPERATORS,
  admission,
  boolArgs,
  envelopeBytes,
  handlerSource,
  project,
  runtimeRequest,
  threeLegs,
} from './k0-support.mjs';

const FLAGS = Object.freeze([
  { name: 'flag', type: 'boolean' },
  { name: 'other', type: 'boolean' },
]);

const BOOLEAN_COMBINATIONS = Object.freeze([
  { flag: false, other: false },
  { flag: false, other: true },
  { flag: true, other: false },
  { flag: true, other: true },
]);

function returnPosition(expression) {
  return handlerSource('boolean', FLAGS, [`return value="${expression}"`]);
}

function letPosition(expression) {
  return handlerSource('boolean', FLAGS, [`let name=held value="${expression}"`, 'return value="held"']);
}

function ifPosition(expression) {
  return handlerSource('boolean', FLAGS, [
    `if cond="${expression}"`,
    '  return value="true"',
    'return value="false"',
  ]);
}

const POSITIONS = Object.freeze({ if: ifPosition, let: letPosition, return: returnPosition });

function hasBinaryExpression(value) {
  if (Array.isArray(value)) return value.some(hasBinaryExpression);
  if (value === null || typeof value !== 'object') return false;
  if (value.tag === 'text' && value.value === 'binary') return true;
  return Object.values(value).some(hasBinaryExpression);
}

test('F5 projects a binary expression node that RT-1 and both compilers own', async () => {
  const verified = await project(returnPosition('flag && other'));
  assert.ok(verified !== undefined, 'F5 must project a binary expression');
  assert.ok(
    verified.artifact.modules.some((module) => module.roots.some(hasBinaryExpression)),
    'the projected artifact must carry an expression of kind binary',
  );
  const codes = await admission(returnPosition('flag && other'));
  assert.deepEqual(
    { javascript: codes.javascript, python: codes.python, rt1: codes.rt1 },
    { javascript: 'admitted', python: 'admitted', rt1: 'admitted' },
    'RT3_BINARY_OWNER_MISSING: a real F5 binary expression must be admitted by RT-1, JavaScript, and Python',
  );
});

const BOOLEAN_CASES = Object.freeze([
  { expression: 'flag && other', result: (values) => values.flag && values.other },
  { expression: 'flag || other', result: (values) => values.flag || values.other },
  { expression: 'flag == other', result: (values) => values.flag === values.other },
  { expression: 'flag != other', result: (values) => values.flag !== values.other },
]);

for (const [position, build] of Object.entries(POSITIONS)) {
  for (const testCase of BOOLEAN_CASES) {
    for (const values of BOOLEAN_COMBINATIONS) {
      test(`RT-3 ${position} position agrees on ${testCase.expression} for ${JSON.stringify(values)}`, async () => {
        const requestId = `rt3-${position}-${testCase.expression.replaceAll(' ', '')}-${values.flag}-${values.other}`;
        const legs = await threeLegs(build(testCase.expression), runtimeRequest(requestId, boolArgs(values)));
        const direct = envelopeBytes(legs.direct.envelope);
        assert.equal(legs.direct.envelope.outcome, 'success');
        assert.deepEqual(legs.direct.envelope.result.value, {
          tag: 'boolean',
          value: testCase.result(values),
        });
        assert.deepEqual(
          Buffer.from(envelopeBytes(legs.javascript.envelope)),
          Buffer.from(direct),
          'RT3_THREE_LEG_DIVERGENCE: the emitted JavaScript envelope is not byte-identical to RT-1',
        );
        assert.deepEqual(
          Buffer.from(envelopeBytes(legs.python.envelope)),
          Buffer.from(direct),
          'RT3_THREE_LEG_DIVERGENCE: the emitted Python envelope is not byte-identical to RT-1',
        );
      });
    }
  }
}

const INTEGER_CASES = Object.freeze([
  { expression: '1 < 2', result: true },
  { expression: '2 < 1', result: false },
  { expression: '2 < 2', result: false },
  { expression: '1 <= 2', result: true },
  { expression: '2 <= 1', result: false },
  { expression: '2 <= 2', result: true },
  { expression: '1 > 2', result: false },
  { expression: '2 > 1', result: true },
  { expression: '2 > 2', result: false },
  { expression: '1 >= 2', result: false },
  { expression: '2 >= 1', result: true },
  { expression: '2 >= 2', result: true },
  { expression: '2 == 2', result: true },
  { expression: '1 == 2', result: false },
  { expression: '1 != 2', result: true },
  { expression: '2 != 2', result: false },
  { expression: '9007199254740993 == 9007199254740992', result: false },
  { expression: '9007199254740993 > 9007199254740992', result: true },
  { expression: '900719925474099123456 > 900719925474099123455', result: true },
  { expression: '900719925474099123455 >= 900719925474099123456', result: false },
]);

for (const testCase of INTEGER_CASES) {
  test(`RT-3 tagged integer comparison agrees on ${testCase.expression}`, async () => {
    const requestId = `rt3-int-${testCase.expression.replaceAll(' ', '')}`;
    const legs = await threeLegs(
      returnPosition(testCase.expression),
      runtimeRequest(requestId, boolArgs({ flag: true, other: true })),
    );
    const direct = envelopeBytes(legs.direct.envelope);
    assert.equal(legs.direct.envelope.outcome, 'success');
    assert.deepEqual(legs.direct.envelope.result.value, { tag: 'boolean', value: testCase.result });
    assert.deepEqual(Buffer.from(envelopeBytes(legs.javascript.envelope)), Buffer.from(direct));
    assert.deepEqual(Buffer.from(envelopeBytes(legs.python.envelope)), Buffer.from(direct));
  });
}

test('RT-3 nests a binary of binaries and keeps precedence on all three legs', async () => {
  const legs = await threeLegs(
    returnPosition('(1 < 2) == (flag || other)'),
    runtimeRequest('rt3-nested-precedence', boolArgs({ flag: false, other: false })),
  );
  assert.equal(legs.direct.envelope.outcome, 'success');
  assert.deepEqual(legs.direct.envelope.result.value, { tag: 'boolean', value: false });
  const direct = envelopeBytes(legs.direct.envelope);
  assert.deepEqual(Buffer.from(envelopeBytes(legs.javascript.envelope)), Buffer.from(direct));
  assert.deepEqual(Buffer.from(envelopeBytes(legs.python.envelope)), Buffer.from(direct));
});

test('RT-3 admits a binary condition to the RT-2 static boolean gate', async () => {
  const source = handlerSource('string', FLAGS, [
    'if cond="flag && other"',
    '  capability namespace=fixture operation=resolve name=reply',
    '  return value="reply"',
    'return value="\"skipped\""',
  ]);
  const taken = await threeLegs(source, runtimeRequest('rt3-gate-taken', boolArgs({ flag: true, other: true })));
  assert.equal(taken.direct.envelope.result.value.value, 'reply-value');
  assert.equal(taken.direct.calls.length, 1);
  assert.deepEqual(taken.javascript.calls, [{ namespace: 'fixture', operation: 'resolve' }]);
  assert.deepEqual(taken.python.calls, [{ namespace: 'fixture', operation: 'resolve' }]);
  const skipped = await threeLegs(source, runtimeRequest('rt3-gate-skipped', boolArgs({ flag: true, other: false })));
  assert.equal(skipped.direct.envelope.result.value.value, 'skipped');
  assert.equal(skipped.direct.calls.length, 0);
  assert.deepEqual(skipped.javascript.calls, []);
  assert.deepEqual(skipped.python.calls, []);
  assert.deepEqual(
    Buffer.from(envelopeBytes(skipped.javascript.envelope)),
    Buffer.from(envelopeBytes(skipped.direct.envelope)),
  );
  assert.deepEqual(
    Buffer.from(envelopeBytes(skipped.python.envelope)),
    Buffer.from(envelopeBytes(skipped.direct.envelope)),
  );
});

test('RT-3 covers every operator in the closed set', () => {
  const covered = new Set([
    ...BOOLEAN_CASES.map((testCase) => testCase.expression.split(' ')[1]),
    ...INTEGER_CASES.map((testCase) => testCase.expression.split(' ')[1]),
  ]);
  assert.deepEqual([...covered].sort(), [...OPERATORS].sort());
});
