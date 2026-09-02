import assert from 'node:assert/strict';
import test from 'node:test';

import {
  POSITIONS,
  POSITION_ARGUMENTS,
  TABLE_ROWS,
  between,
  emittedArtifacts,
  integerResult,
  runtimeRequest,
  tableSource,
  threeLegBytes,
} from './k0-support.mjs';

async function envelope(source, args, requestId) {
  const { legs } = await threeLegBytes(source, runtimeRequest(requestId, args));
  return legs.direct.envelope;
}

for (const row of TABLE_ROWS) {
  test(`${row.expression} evaluates to the frozen constant ${row.expected} on all three legs`, async () => {
    const result = await envelope(tableSource(row), {}, `rt10-pre-${row.name}`);
    assert.equal(result.outcome, 'success', row.name);
    assert.deepEqual(
      result.result,
      integerResult(row.expected),
      `RT10PRE_VALUE_DRIFT: ${row.expression} must equal the frozen ${row.expected}`,
    );
    assert.deepEqual([...result.events], []);
  });
}

test('the only reachable neg(0) canonicalizes to "0", never to "-0"', async () => {
  const result = await envelope(POSITIONS['neg-through-binding-zero'](), {}, 'rt10-pre-neg-zero');
  assert.deepEqual(result.result, integerResult('0'));
});

test('integer parameters are arithmetic operands, so the operands can come through the request', async () => {
  const result = await envelope(
    POSITIONS['param-add'](),
    POSITION_ARGUMENTS['param-add'](),
    'rt10-pre-param-add',
  );
  assert.deepEqual(result.result, integerResult('9007199254740994'));
  const negated = await envelope(
    POSITIONS['param-neg'](),
    POSITION_ARGUMENTS['param-neg'](),
    'rt10-pre-param-neg',
  );
  assert.deepEqual(negated.result, integerResult('-9007199254740993'));
});

test('an arithmetic result is admissible under a comparison in every condition position', async () => {
  const inLet = await envelope(POSITIONS['add-under-comparison-in-let'](), {}, 'rt10-pre-cmp-let');
  assert.deepEqual(inLet.result, { presence: 'value', value: { tag: 'boolean', value: true } });
  const inIf = await envelope(POSITIONS['add-under-comparison-in-if'](), {}, 'rt10-pre-cmp-if');
  assert.deepEqual([...inIf.events], [{ op: 'stdout', text: 'y' }]);
  const withParameters = await envelope(
    POSITIONS['param-add-under-comparison-in-if'](),
    POSITION_ARGUMENTS['param-add-under-comparison-in-if'](),
    'rt10-pre-cmp-param-if',
  );
  assert.deepEqual([...withParameters.events], [{ op: 'stdout', text: 'y' }]);
});

test('arithmetic inside a helper body is admitted and the caller observes the result', async () => {
  const result = await envelope(POSITIONS['helper-body-arith'](), {}, 'rt10-pre-helper-body');
  assert.deepEqual(result.result, { presence: 'value', value: { tag: 'boolean', value: true } });
  assert.deepEqual([...result.events], []);
});

test('an arithmetic result is tagged integer, so a boolean return position fails at execution', async () => {
  const result = await envelope(POSITIONS['arith-return-type-mismatch'](), {}, 'rt10-pre-return-tag');
  assert.equal(result.outcome, 'failure');
  assert.equal(result.diagnostics[0]?.code, 'invalid-handler-result');
  assert.deepEqual(result.result, { presence: 'absent' });
  assert.deepEqual([...result.events], []);
});

test('an arithmetic result is not text, so printing it fails at execution on every leg', async () => {
  const result = await envelope(POSITIONS['add-in-print-tag'](), {}, 'rt10-pre-print-tag');
  assert.equal(result.outcome, 'failure');
  assert.equal(result.diagnostics[0]?.code, 'unsupported-runtime-input');
  assert.deepEqual([...result.events], []);
});

function specializedRegions(artifacts) {
  return {
    javascript: between(
      between(
        artifacts.javascript,
        'const __runSpecialized=',
        'const execute=async(input,executionOptions)',
        'the emitted JavaScript specialized handler',
      ),
      'try {',
      '} finally {',
      'the emitted JavaScript statement region',
    ),
    python: between(
      between(
        artifacts.python,
        'async def _run_specialized(',
        'async def execute(',
        'the emitted Python specialized handler',
      ),
      '    try:\n',
      '    finally:',
      'the emitted Python statement region',
    ),
  };
}

function occurrences(region, token) {
  return region.split(token).length - 1;
}

test('every arithmetic node lowers to its declared named helper, one call per node', async () => {
  const deep = TABLE_ROWS.find((row) => row.name === 'mixed-deep');
  const regions = specializedRegions(await emittedArtifacts(tableSource(deep)));
  for (const [helper, count] of [
    ['__mul(', 1],
    ['__add(', 1],
    ['__sub(', 1],
  ]) {
    assert.equal(occurrences(regions.javascript, helper), count, `emitted JavaScript must call ${helper} ${count}x`);
  }
  for (const [helper, count] of [
    ['_mul(', 1],
    ['_add(', 1],
    ['_sub(', 1],
  ]) {
    assert.equal(occurrences(regions.python, helper), count, `emitted Python must call ${helper} ${count}x`);
  }
});

test('unary negation lowers to the named helper on both emitted legs', async () => {
  const regions = specializedRegions(await emittedArtifacts(POSITIONS['neg-in-return']()));
  assert.equal(occurrences(regions.javascript, '__neg('), 1);
  assert.equal(occurrences(regions.python, '_neg('), 1);
});

// Order is unobservable behaviourally in this slice — every operator is total and no operand
// can carry an effect — so the emitted operand order is what pins left-before-right.
test('the emitted operands stay in source order, left before right', async () => {
  const row = TABLE_ROWS.find((entry) => entry.name === 'sub-small');
  const regions = specializedRegions(await emittedArtifacts(tableSource(row)));
  assert.ok(
    regions.javascript.indexOf('value:"7"') < regions.javascript.indexOf('value:"3"'),
    'the emitted JavaScript must evaluate the left operand first',
  );
  assert.ok(
    regions.python.indexOf('_chars([55])') < regions.python.indexOf('_chars([51])'),
    'the emitted Python must evaluate the left operand first',
  );
});
