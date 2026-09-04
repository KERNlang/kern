import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  POSITIONS,
  SIZE_LIMIT_BYTES,
  limitRequest,
  POSITION_ARGUMENTS,
  TABLE_ROWS,
  between,
  compileJavaScript,
  directStepBudget,
  emittedArtifacts,
  envelopeBytes,
  executeJavaScriptChild,
  executeKernKir,
  intArgs,
  project,
  provider,
  queueAbort,
  route,
  runtimeRequest,
  tableSource,
} from './k0-support.mjs';

const RT1_EXPRESSION_URL = new URL('../../packages/core/src/kir-runtime/expression.ts', import.meta.url);

const SIZE_BUDGETS = Object.freeze(Array.from({ length: 90 }, (_unused, index) => index + 1));

function tableRow(name) {
  const row = TABLE_ROWS.find((entry) => entry.name === name);
  assert.ok(row !== undefined, `the behavior table must carry ${name}`);
  return row;
}

const METERING = Object.freeze({
  'add-in-let': { args: () => ({}), source: POSITIONS['add-in-let']() },
  'add-in-return': { args: () => ({}), source: POSITIONS['add-in-return']() },
  'assign-arith': { args: () => ({}), source: POSITIONS['assign-arith']() },
  'local-add': { args: () => ({}), source: POSITIONS['local-add']() },
  'mixed-neg-mul': { args: () => ({}), source: tableSource(tableRow('mixed-neg-mul')) },
  'neg-in-return': { args: () => ({}), source: POSITIONS['neg-in-return']() },
  'neg-of-sum': { args: () => ({}), source: tableSource(tableRow('neg-of-sum')) },
  'neg-through-binding-zero': { args: () => ({}), source: POSITIONS['neg-through-binding-zero']() },
  'param-add': { args: () => intArgs({ a: '4', b: '5' }), source: POSITIONS['param-add']() },
  'param-neg': { args: () => POSITION_ARGUMENTS['param-neg'](), source: POSITIONS['param-neg']() },
  'prec-mul-then-add': { args: () => ({}), source: tableSource(tableRow('prec-mul-then-add')) },
  'prec-paren-add-first': { args: () => ({}), source: tableSource(tableRow('prec-paren-add-first')) },
  'let-literal-control': {
    args: () => ({}),
    source: route(['let name=n value="1"', 'return value="n"'], { returns: 'integer' }),
  },
  'return-binary-control': { args: () => ({}), source: route(['return value="1 < 2"'], { returns: 'boolean' }) },
  'return-literal-control': { args: () => ({}), source: route(['return value="1"'], { returns: 'integer' }) },
  'size-at-limit': { args: () => ({}), source: POSITIONS['size-at-limit']() },
  'size-nested-control': { args: () => ({}), source: POSITIONS['size-nested-control']() },
});

// Hand-derived from the base-measured model: execution steps are one per executed statement
// (`return` included on the entry), one per evaluated expression node, and one per *declared*
// parameter for request inspection. A binary node costs 1 + its two operands, a unary node
// 1 + its argument, and no helper call costs a tick of its own.
const EXECUTION_STEPS = Object.freeze({
  'add-in-let': 6,
  'add-in-return': 4,
  'assign-arith': 8,
  'let-literal-control': 4,
  'local-add': 8,
  'mixed-neg-mul': 6,
  'neg-in-return': 3,
  'neg-of-sum': 5,
  'neg-through-binding-zero': 7,
  'param-add': 6,
  'param-neg': 4,
  'prec-mul-then-add': 6,
  'prec-paren-add-first': 6,
  'return-binary-control': 4,
  'return-literal-control': 2,
  'size-at-limit': 4,
  'size-nested-control': 8,
});

test('every RT-10-pre metering fixture consumes exactly the pinned number of execution steps', async () => {
  const observed = {};
  for (const name of Object.keys(METERING).sort()) {
    const { args, source } = METERING[name];
    observed[name] = (await directStepBudget(source, args(), `rt10-pre-meter-${name}`)).execution;
  }
  assert.deepEqual(
    observed,
    EXECUTION_STEPS,
    'RT10PRE_METER_DRIFT: an absolute step count moved, so the arithmetic metering model changed',
  );
});

test('an arithmetic binary costs exactly what a comparison binary costs: there is no helper tick', () => {
  assert.equal(EXECUTION_STEPS['add-in-return'], EXECUTION_STEPS['return-binary-control']);
});

test('a unary node costs exactly one tick plus its argument', () => {
  assert.equal(EXECUTION_STEPS['neg-in-return'], EXECUTION_STEPS['return-literal-control'] + 1);
});

test('the meter is precedence-blind, which is why the frozen value table is the precedence oracle', () => {
  assert.equal(EXECUTION_STEPS['prec-mul-then-add'], EXECUTION_STEPS['prec-paren-add-first']);
});

test('an arithmetic initializer costs its let plus exactly its two operand nodes', () => {
  assert.equal(EXECUTION_STEPS['add-in-let'] - EXECUTION_STEPS['let-literal-control'], 2);
});

test('an arithmetic assign is metered as one statement tick plus its value, exactly as a let is', () => {
  assert.equal(EXECUTION_STEPS['assign-arith'] - EXECUTION_STEPS['add-in-let'], 2, 'one extra let plus its literal');
  assert.equal(EXECUTION_STEPS['assign-arith'] - EXECUTION_STEPS['let-literal-control'], 4, 'one tick plus three nodes');
});

test('an integer parameter operand is charged once for inspection and once per read', () => {
  assert.equal(EXECUTION_STEPS['param-add'] - EXECUTION_STEPS['add-in-return'], 2, 'two declared parameters');
  assert.equal(EXECUTION_STEPS['param-neg'] - EXECUTION_STEPS['neg-in-return'], 1, 'one declared parameter');
});

test('RT-1 arithmetic dispatch adds no await point, and exactly two cancellation checkpoints remain', async () => {
  const source = await readFile(RT1_EXPRESSION_URL, 'utf8');
  const evaluator = between(
    source,
    'const BINARY_EVALUATORS = Object.freeze({',
    'export function calleeBindings',
    'the RT-1 operator evaluator tables',
  );
  for (const token of ['await', 'Promise', 'queueMicrotask', 'setImmediate', 'checkAbort']) {
    assert.equal(evaluator.includes(token), false, `RT-1 operator dispatch must not mention ${token}`);
  }
  for (const operator of ["'+'", "'-'", "'*'"]) {
    assert.ok(evaluator.includes(operator), `RT10PRE_DISPATCH_GAP: the RT-1 evaluator table must carry ${operator}`);
  }
  assert.ok(
    source.includes('UNARY_EVALUATORS'),
    'RT10PRE_DISPATCH_GAP: RT-1 must dispatch unary through its own closed table',
  );
  assert.equal(
    source.split('checkAbort()').length - 1,
    2,
    'the statement-boundary and the for loop-head checkpoints are the only two; a third must fail this',
  );
  const statementBoundary = between(
    source,
    'const statement = frame.statements[frame.index];',
    "if (statement.kind === 'let')",
    'the statement-boundary checkpoint site',
  );
  assert.equal(
    statementBoundary.split('checkAbort()').length - 1,
    1,
    'the statement-boundary site must check abort exactly once',
  );
  const loopHead = between(
    source,
    'const enterTrip = (loop: LoopState): void => {',
    'while (frames.length > 0) {',
    'the for loop-head checkpoint site',
  );
  assert.equal(loopHead.split('checkAbort()').length - 1, 1, 'the for loop-head site must check abort exactly once');
});

test('the arithmetic helpers exist in both target kernels and neither is asynchronous', async () => {
  const artifacts = await emittedArtifacts(POSITIONS['add-in-return']());
  const javascript = between(
    artifacts.javascript,
    'const __boolOperand',
    'const __chars',
    'the emitted JavaScript operator helpers',
  );
  const python = between(
    artifacts.python,
    'def _bool_operand',
    'def _expression(',
    'the emitted Python operator helpers',
  );
  for (const helper of ['__add', '__sub', '__mul', '__neg']) {
    assert.ok(javascript.includes(helper), `RT10PRE_HELPER_GAP: the JavaScript kernel must define ${helper}`);
  }
  for (const helper of ['_add', '_sub', '_mul', '_neg']) {
    assert.ok(python.includes(`def ${helper}(`), `RT10PRE_HELPER_GAP: the Python kernel must define ${helper}`);
  }
  for (const token of ['await', 'async', 'Promise']) {
    assert.equal(javascript.includes(token), false, `the JavaScript operator helpers must not mention ${token}`);
  }
  for (const token of ['await', 'async']) {
    assert.equal(python.includes(token), false, `the Python operator helpers must not mention ${token}`);
  }
});

async function checkpointCensus(source) {
  const artifacts = await emittedArtifacts(source);
  const javascript = between(
    between(
      artifacts.javascript,
      'const __runSpecialized=',
      'const execute=async(input,executionOptions)',
      'the emitted JavaScript specialized handler',
    ),
    'try {',
    '} finally {',
    'the emitted JavaScript statement region',
  );
  const python = between(
    between(
      artifacts.python,
      'async def _run_specialized(',
      'async def execute(',
      'the emitted Python specialized handler',
    ),
    '    try:\n',
    '    finally:',
    'the emitted Python statement region',
  );
  return {
    javascript: (javascript.match(/__checkAbort\(\)/gu) ?? []).length,
    python: (python.match(/_check_abort\(\)/gu) ?? []).length,
  };
}

// Arithmetic adds no statement, so an arithmetic fixture must carry exactly the cancellation
// checkpoints of the arithmetic-free control of the same statement shape.
const CHECKPOINT_PAIRS = Object.freeze({
  'add-in-let': {
    arithmetic: POSITIONS['add-in-let'](),
    control: route(['let name=n value="1"', 'return value="n"'], { returns: 'integer' }),
  },
  'neg-through-binding-zero': {
    arithmetic: POSITIONS['neg-through-binding-zero'](),
    control: route(['let name=z value="0"', 'let name=n value="z"', 'return value="n"'], { returns: 'integer' }),
  },
});

test('an arithmetic expression carries exactly the checkpoints of its arithmetic-free control', async () => {
  for (const name of Object.keys(CHECKPOINT_PAIRS).sort()) {
    const { arithmetic, control } = CHECKPOINT_PAIRS[name];
    assert.deepEqual(
      await checkpointCensus(arithmetic),
      await checkpointCensus(control),
      `RT10PRE_CHECKPOINT_CENSUS_DRIFT: ${name} must check cancellation once per emitted statement, no more`,
    );
  }
});

const QUEUE_DEPTHS = Object.freeze([0, 1, 2, 3, 4]);

async function comparedUnderQueuedAbort(source, args, abortAfterMicrotasks, requestId) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'F5 must project the tick-discipline source');
  const compiled = compileJavaScript(verified);
  assert.equal(compiled.outcome, 'success', `javascript compile failed: ${compiled.code}`);
  const request = runtimeRequest(`${requestId}-${abortAfterMicrotasks}`, args);
  const direct = await executeKernKir(verified, request, {
    ...provider([]),
    signal: queueAbort(abortAfterMicrotasks),
  });
  const emitted = await executeJavaScriptChild(compiled.artifact.bytes, request, { abortAfterMicrotasks });
  return { direct, emitted };
}

for (const depth of QUEUE_DEPTHS) {
  test(`arithmetic adds no RT-1-only checkpoint: abort queued at microtask depth ${depth}`, async () => {
    const { direct, emitted } = await comparedUnderQueuedAbort(
      POSITIONS['add-in-let'](),
      {},
      depth,
      'rt10-pre-tick-add',
    );
    assert.deepEqual(
      Buffer.from(envelopeBytes(emitted.envelope)),
      Buffer.from(envelopeBytes(direct)),
      'RT10PRE_TICK_DISCIPLINE_DIVERGENCE: arithmetic must not add an RT-1-only await point',
    );
  });
}

for (const depth of QUEUE_DEPTHS) {
  test(`an arithmetic condition adds no RT-1-only checkpoint: abort queued at microtask depth ${depth}`, async () => {
    const { direct, emitted } = await comparedUnderQueuedAbort(
      POSITIONS['add-under-comparison-in-if'](),
      {},
      depth,
      'rt10-pre-tick-cond',
    );
    assert.deepEqual(
      Buffer.from(envelopeBytes(emitted.envelope)),
      Buffer.from(envelopeBytes(direct)),
      'RT10PRE_TICK_DISCIPLINE_DIVERGENCE: branch depth must not change the arithmetic checkpoint',
    );
  });
}

test('pre-cancellation fails closed before arithmetic runs, byte-identically on both JavaScript legs', async () => {
  const source = POSITIONS['add-in-let']();
  const verified = await project(source);
  assert.ok(verified !== undefined);
  const compiled = compileJavaScript(verified);
  assert.equal(compiled.outcome, 'success');
  const request = runtimeRequest('rt10-pre-tick-pre-cancel', {}, { preCancelled: true, timeoutMs: null });
  const direct = await executeKernKir(verified, request, provider([]));
  const emitted = await executeJavaScriptChild(compiled.artifact.bytes, request);
  assert.equal(direct.outcome, 'failure');
  assert.equal(direct.diagnostics[0]?.code, 'execution-cancelled');
  assert.deepEqual([...direct.events], []);
  assert.deepEqual(Buffer.from(envelopeBytes(emitted.envelope)), Buffer.from(envelopeBytes(direct)));
});

// The size fault and the step-limit fault share one code and one envelope shape, so the step at
// which a nested intermediate faults is not separable from the envelope. What is pinned instead:
// the structurally identical in-limit twin costs exactly 8 execution steps (EXECUTION_STEPS), and
// neither overflowing variant succeeds at any budget in the scanned range - so the fault is the
// result bound, never a step budget the fixture happened to exhaust.
test('a nested intermediate that overflows never succeeds at any step budget', async () => {
  for (const position of ['size-nested-left', 'size-nested-right']) {
    const verified = await project(POSITIONS[position]());
    assert.ok(verified !== undefined, `${position} must project`);
    const events = [];
    for (const maxSteps of SIZE_BUDGETS) {
      const base = limitRequest(`nest-${maxSteps}`, SIZE_LIMIT_BYTES);
      const envelope = await executeKernKir(
        verified,
        { ...base, limits: { ...base.limits, maxSteps } },
        provider([]),
      );
      assert.equal(
        envelope.outcome,
        'failure',
        `RT10PRE_NESTED_SIZE_ESCAPE: ${position} succeeded at maxSteps ${maxSteps}`,
      );
      assert.equal(envelope.diagnostics[0]?.code, 'runtime-limit-exceeded', position);
      events.push(envelope.events.length);
    }
    assert.deepEqual(
      [...new Set(events)].sort(),
      [0, 1],
      `${position} must commit the print ahead of the fault once the budget reaches it`,
    );
    assert.ok(
      events.every((count, index) => index === 0 || count >= events[index - 1]),
      'committed events must be monotonic in the step budget',
    );
    assert.equal(
      events[events.length - 1],
      1,
      `RT10PRE_SIZE_FAULT_POSITION: ${position} must never commit the print after the arithmetic`,
    );
  }
});

test('the in-limit nested twin succeeds exactly once its pinned budget is reached', async () => {
  const verified = await project(POSITIONS['size-nested-control']());
  assert.ok(verified !== undefined, 'the nested control must project');
  const outcomes = [];
  for (const maxSteps of SIZE_BUDGETS) {
    const base = limitRequest(`nest-ok-${maxSteps}`, SIZE_LIMIT_BYTES);
    const envelope = await executeKernKir(
      verified,
      { ...base, limits: { ...base.limits, maxSteps } },
      provider([]),
    );
    outcomes.push(envelope.outcome);
  }
  const first = outcomes.indexOf('success');
  assert.ok(first >= 0, 'the nested control must succeed inside the scanned budget range');
  assert.ok(
    outcomes.slice(first).every((outcome) => outcome === 'success'),
    'step consumption must be monotonic in the step budget',
  );
  assert.equal(
    (await directStepBudget(POSITIONS['size-nested-control'](), {}, 'rt10p-nest-link')).execution,
    EXECUTION_STEPS['size-nested-control'],
    'RT10PRE_METER_DRIFT: the nested control must cost its pinned execution steps',
  );
});
