import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INT64_LIMIT,
  POSITIONS,
  POSITION_ARGUMENTS,
  PRECISION_ROWS,
  SQUARING_CHAIN,
  TABLE_ROWS,
  between,
  emittedArtifacts,
  integerResult,
  limitRequest,
  route,
  runtimeRequest,
  squaringChainValue,
  tableSource,
  threeLegBytes,
} from './k0-support.mjs';

async function envelope(source, args, requestId) {
  const { legs } = await threeLegBytes(source, runtimeRequest(requestId, args));
  return legs.direct.envelope;
}

test('every gating row stays inside the signed 64-bit range the number model reserves', () => {
  for (const row of TABLE_ROWS) {
    const value = BigInt(row.expected);
    assert.ok(value < INT64_LIMIT && value >= -INT64_LIMIT, `${row.name} result must stay inside i64`);
    for (const operand of row.expression.matchAll(/[0-9]{10,}/gu)) {
      assert.ok(BigInt(operand[0]) < INT64_LIMIT, `${row.name} operand ${operand[0]} must stay inside i64`);
    }
  }
});

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

// Non-gating by ruling: the range contract beyond i64 belongs to the resource-governance
// slice, which may turn these into fault rows. The probe still runs on all three legs and
// prints observed against frozen so a divergence is visible without gating this slice.
test('the beyond-i64 precision probe reports observed against frozen and asserts nothing', async () => {
  const observations = [];
  for (const row of PRECISION_ROWS) {
    let observed;
    try {
      const result = await envelope(tableSource(row), {}, `rt10-pre-precision-${row.name}`);
      observed =
        result.outcome === 'success' ? (result.result?.value?.value ?? '<no integer payload>') : `<${result.diagnostics[0]?.code}>`;
    } catch (error) {
      observed = `<${error.message.split('\n')[0]}>`;
    }
    observations.push(`${row.name}\t${row.expression}\tfrozen=${row.expected}\tobserved=${observed}`);
  }
  console.log(['RT10PRE_PRECISION_PROBE (non-gating)', ...observations].join('\n'));
  assert.equal(observations.length, PRECISION_ROWS.length);
});

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

test('an assign rebinds a let through an arithmetic value on all three legs', async () => {
  const selfReferential = await envelope(POSITIONS['assign-arith'](), {}, 'rt10-pre-assign-arith');
  assert.deepEqual(selfReferential.result, integerResult('2'), 'the target is read before it is written');
  const negated = await envelope(POSITIONS['assign-neg'](), {}, 'rt10-pre-assign-neg');
  assert.deepEqual(negated.result, integerResult('-5'));
  const fromParameters = await envelope(
    POSITIONS['assign-arith-params'](),
    POSITION_ARGUMENTS['assign-arith-params'](),
    'rt10-pre-assign-params',
  );
  assert.deepEqual(fromParameters.result, integerResult('9'));
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

test('all four helpers appear on both emitted legs across one arithmetic corpus', async () => {
  const sources = [
    tableSource(TABLE_ROWS.find((row) => row.name === 'add-small')),
    tableSource(TABLE_ROWS.find((row) => row.name === 'sub-small')),
    tableSource(TABLE_ROWS.find((row) => row.name === 'mul-small')),
    POSITIONS['neg-in-return'](),
  ];
  const javascript = [];
  const python = [];
  for (const source of sources) {
    const regions = specializedRegions(await emittedArtifacts(source));
    javascript.push(regions.javascript);
    python.push(regions.python);
  }
  const joinedJavaScript = javascript.join('\n');
  const joinedPython = python.join('\n');
  for (const helper of ['__add(', '__sub(', '__mul(', '__neg(']) {
    assert.ok(joinedJavaScript.includes(helper), `the emitted JavaScript must call ${helper}`);
  }
  for (const helper of ['_add(', '_sub(', '_mul(', '_neg(']) {
    assert.ok(joinedPython.includes(helper), `the emitted Python must call ${helper}`);
  }
});

// A host-infix lowering would put a bare arithmetic operator between two tagged operands in
// the statement region. Diagnostic codes carry hyphens inside string literals, so the scan
// strips quoted text first; helper *names* carry no arithmetic character at all, which is why
// the arithmetic-free control measures zero and every arithmetic region must too.
function hostArithmetic(region) {
  return region.replace(/'[^']*'/gu, "''").replace(/"[^"]*"/gu, '""').match(/[+*-]/gu);
}

test('neither emitted leg applies a host arithmetic operator to a KIR integer', async () => {
  const control = specializedRegions(await emittedArtifacts(route(['return value="7"'], { returns: 'integer' })));
  for (const leg of ['javascript', 'python']) {
    assert.deepEqual(hostArithmetic(control[leg]), null, `the ${leg} control region must be operator free`);
  }
  const fixtures = ['add-small', 'sub-small', 'mul-small', 'mixed-deep'].map((name) =>
    tableSource(TABLE_ROWS.find((row) => row.name === name)),
  );
  for (const source of [...fixtures, POSITIONS['neg-in-return']()]) {
    const regions = specializedRegions(await emittedArtifacts(source));
    for (const leg of ['javascript', 'python']) {
      assert.deepEqual(
        hostArithmetic(regions[leg]),
        null,
        `RT10PRE_HOST_INFIX: the emitted ${leg} used a host operator instead of a named helper`,
      );
    }
  }
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

const SIZE_LIMIT_BYTES = 20;
const LIMIT_DIAGNOSTIC = Object.freeze({ category: 'runtime', code: 'runtime-limit-exceeded', phase: 'execution' });

test('an arithmetic result exactly at maxStringBytes is admitted on all three legs', async () => {
  const { legs } = await threeLegBytes(
    POSITIONS['size-at-limit'](),
    limitRequest('rt10p-size-ok', SIZE_LIMIT_BYTES),
  );
  const result = legs.direct.envelope;
  assert.equal(result.outcome, 'success');
  assert.deepEqual(result.result, integerResult('99999999980000000001'));
  assert.equal(result.result.value.value.length, SIZE_LIMIT_BYTES);
});

test('one byte over maxStringBytes faults with the same limit envelope on all three legs', async () => {
  const { legs } = await threeLegBytes(
    POSITIONS['size-over-limit'](),
    limitRequest('rt10p-size-over', SIZE_LIMIT_BYTES),
  );
  const result = legs.direct.envelope;
  assert.equal(
    result.outcome,
    'failure',
    'RT10PRE_RESULT_SIZE_UNBOUNDED: arithmetic minted an integer payload past maxStringBytes',
  );
  assert.deepEqual([...result.diagnostics], [LIMIT_DIAGNOSTIC]);
  assert.deepEqual(result.result, { presence: 'absent' });
});

test('the size fault is raised at the operator node, so the following statement never runs', async () => {
  const { legs } = await threeLegBytes(
    POSITIONS['size-fault-position'](),
    limitRequest('rt10p-size-pin', SIZE_LIMIT_BYTES),
  );
  const result = legs.direct.envelope;
  assert.equal(result.outcome, 'failure');
  assert.deepEqual([...result.diagnostics], [LIMIT_DIAGNOSTIC]);
  assert.deepEqual(
    [...result.events],
    [{ op: 'stdout', text: 'a' }],
    'RT10PRE_SIZE_FAULT_POSITION: the limit must fire at the arithmetic node, not at the envelope boundary',
  );
});

test('an exact result past CPython\'s 4300-digit conversion cap agrees on all three legs', async () => {
  const expected = squaringChainValue().toString();
  assert.ok(expected.length > 4300, 'the chain must clear the CPython conversion cap to be a probe at all');
  const { legs } = await threeLegBytes(POSITIONS['digits-beyond-cpython-cap'](), runtimeRequest('rt10-pre-digits', {}));
  const result = legs.direct.envelope;
  assert.equal(
    result.outcome,
    'success',
    'RT10PRE_INT_STR_DIGIT_CAP: the emitted Python kernel must lift sys.set_int_max_str_digits',
  );
  assert.deepEqual(result.result, integerResult(expected));
  assert.equal(SQUARING_CHAIN.depth, 9);
});
