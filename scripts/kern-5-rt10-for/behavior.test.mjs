import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUDGET_TRIPS,
  INT64_LIMIT,
  POSITIONS,
  TABLE_ROWS,
  admission,
  between,
  emittedArtifacts,
  envelopeBytes,
  integerSlot,
  positionArguments,
  rawRuntimeFaultMessage,
  runtimeRequest,
  stepRequest,
  threeLegBytes,
} from './k0-support.mjs';

const GENEROUS_STEPS = 1_000_000;

function specializedRegions(artifacts) {
  return {
    javascript: between(
      artifacts.javascript,
      'const __runSpecialized=',
      'const execute=async(input,executionOptions)',
      'the emitted JavaScript specialized handler',
    ),
    python: between(
      artifacts.python,
      'async def _run_specialized(',
      'async def execute(',
      'the emitted Python specialized handler',
    ),
  };
}

async function legs(name, requestId, request) {
  return threeLegBytes(POSITIONS[name](), request ?? runtimeRequest(requestId, positionArguments(name)));
}

async function envelope(name, requestId) {
  return (await legs(name, requestId)).legs.direct.envelope;
}

test('every frozen row stays inside the signed 64-bit range the number model reserves', () => {
  for (const row of TABLE_ROWS) {
    const value = BigInt(row.expected);
    assert.ok(value < INT64_LIMIT && value >= -INT64_LIMIT, `${row.name} result must stay inside i64`);
  }
});

test('the frozen table carries a trip count for every row and no duplicate names', () => {
  const names = TABLE_ROWS.map((row) => row.name);
  assert.deepEqual([...new Set(names)], names, 'every row name must be unique');
  for (const row of TABLE_ROWS) {
    assert.equal(typeof row.trips, 'number', `${row.name} must declare its trip count`);
    assert.ok(row.trips >= 0, `${row.name} trip count must be non-negative`);
    assert.ok(POSITIONS[row.name] !== undefined, `${row.name} must have a fixture`);
  }
});

for (const row of TABLE_ROWS) {
  test(`${row.name} returns the frozen integer ${row.expected} byte-identically on all three legs`, async () => {
    const result = await envelope(row.name, `rt10f-${row.name}`);
    assert.equal(result.outcome, 'success', row.name);
    assert.deepEqual(
      result.result,
      integerSlot(row.expected),
      `RT10F_VALUE_DRIFT: ${row.program} must equal the frozen ${row.expected}`,
    );
    assert.deepEqual([...result.events], [], `${row.name} must commit no event`);
  });
}

// `to` exclusive is the whole difference between 3 and 6 on the smallest loop in the table, so this
// row is the one that dies first if the head test becomes `<=`.
test('to is exclusive, so the smallest sum is 3 and never 6', async () => {
  const result = await envelope('for-sum-0-3', 'rt10f-exclusive');
  assert.deepEqual(result.result, integerSlot('3'), 'RT10F_INCLUSIVE_DRIFT: 6 means the upper bound was included');
});

// Three ways to describe an empty range, so an implementation that special-cased one of them still
// has to get the other two right.
test('every empty range runs the body zero times', async () => {
  for (const [name, requestId] of [
    ['for-empty-range', 'rt10f-empty-equal'],
    ['for-reversed-positive-step', 'rt10f-empty-reversed'],
    ['for-empty-negative', 'rt10f-empty-negative'],
  ]) {
    const result = await envelope(name, requestId);
    assert.deepEqual(result.result, integerSlot('0'), `${name}: the body must not run`);
  }
});

// A bound the body mutates. The trip count is decided before the first head test, so the loop still
// runs three times even though the `let` the bound read is zero from the first iteration onward.
test('bounds are evaluated once, so a body that clears the bound still completes its trips', async () => {
  const result = await envelope('for-bounds-once', 'rt10f-bounds-once');
  assert.deepEqual(
    result.result,
    integerSlot('3'),
    'RT10F_BOUND_REREAD: a bound re-read per iteration would stop the loop after one trip',
  );
});

test('the nested accumulation golden is 18, the product of the two triangular sums', async () => {
  const nested = await envelope('for-nested-acc', 'rt10f-nested');
  assert.deepEqual(nested.result, integerSlot('18'), 'RT10F_NESTED_DRIFT: 36 means the outer sum was doubled');
  const triple = await envelope('for-triple-nested', 'rt10f-triple');
  assert.deepEqual(triple.result, integerSlot('8'));
});

test('a return inside a loop body exits early with an identical envelope on all three legs', async () => {
  const { legs: runs } = await legs('for-early-return', 'rt10f-early-return');
  for (const leg of ['direct', 'javascript', 'python']) {
    assert.deepEqual(runs[leg].envelope.result, integerSlot('3'), `${leg} must return the counter at the exit`);
    assert.equal(runs[leg].envelope.completion.kind, 'return', `${leg} must complete by returning`);
  }
});

// The counter is a host bignum on every leg. The magnitude separates a double: 2^63 - 3 and 2^63 - 1
// are the same double, so a coerced counter would either loop forever or never enter the body.
test('the counter is a bignum, so an i64-adjacent range runs exactly its two iterations', async () => {
  const result = await envelope('for-i64-near-limit', 'rt10f-i64');
  assert.deepEqual(result.result, integerSlot('2'), 'RT10F_PRECISION_LOSS: a host double cannot separate these bounds');
});

// This row separates on the *absence of the coercion* rather than on a magnitude, so it catches a
// leg that would only diverge on a value no fixture happens to carry.
test('neither emitted specialized region coerces the counter through a host number', async () => {
  for (const name of ['for-sum-0-3', 'for-i64-near-limit', 'for-nested-acc', 'for-negative-step']) {
    const regions = specializedRegions(await emittedArtifacts(POSITIONS[name]()));
    for (const token of ['Number(', 'parseInt', 'parseFloat', 'valueOf(']) {
      assert.equal(regions.javascript.includes(token), false, `${name}: the JavaScript leg must not use ${token}`);
    }
    for (const token of ['float(', 'int(', 'round(', 'range(']) {
      assert.equal(regions.python.includes(token), false, `${name}: the Python leg must not use ${token}`);
    }
  }
});

// RT-5 admits an async helper called directly as a `let`/`assign` statement value; nothing in
// `compileBlock`/`compileFor` special-cases that gate for a loop body, so the same call the body
// vocabulary already allows outside a loop must link and run identically inside one, invoking its
// capability once per trip.
test('an async helper call admitted as a let value inside a for body runs once per trip on all three legs', async () => {
  const { legs: runs } = await legs('for-async-let-in-body', 'rt10f-async-body');
  for (const leg of ['direct', 'javascript', 'python']) {
    assert.deepEqual(runs[leg].envelope.result, integerSlot('9'), `${leg} must sum three async calls to 9`);
    assert.equal(runs[leg].calls.length, 3, `${leg} must invoke the capability exactly once per trip`);
  }
});

test('a computed zero step links and then faults identically on all three legs', async () => {
  const { legs: runs } = await legs('for-step-zero-computed', 'rt10f-zero-computed');
  for (const leg of ['direct', 'javascript', 'python']) {
    const result = runs[leg].envelope;
    assert.equal(result.outcome, 'failure', `${leg} must refuse a zero step at run time`);
    assert.equal(result.diagnostics[0]?.code, 'unsupported-runtime-input', leg);
    assert.equal(result.diagnostics[0]?.phase, 'execution', leg);
    assert.deepEqual(result.result, { presence: 'absent' }, leg);
    assert.deepEqual([...result.events], [], leg);
  }
});

test('a dynamic zero step through a parameter faults, and the same fixture with a one succeeds', async () => {
  const zero = await envelope('for-step-zero-dynamic-param', 'rt10f-zero-param');
  assert.equal(zero.outcome, 'failure');
  assert.equal(zero.diagnostics[0]?.code, 'unsupported-runtime-input');
  const nonZero = await threeLegBytes(
    POSITIONS['for-step-zero-dynamic-param'](),
    runtimeRequest('rt10f-nonzero-param', { a: { tag: 'integer', value: '1' } }),
  );
  assert.deepEqual(
    nonZero.legs.direct.envelope.result,
    integerSlot('3'),
    'the zero-step fault must be about the value, not about the parameter position',
  );
});

// The envelope's diagnostic never carries a message (`{category, code, phase}` only), so `code` and
// `phase` alone cannot tell ERR_KIR_LOOP_ZERO_STEP apart from any other labelled fault sharing the
// same code and phase. The label is observable on RT-1 only by driving the raw walk directly, and
// on the two emitted legs only by the literal each embeds at its own zero-step raise site.
test('the zero-step fault carries the exact label ERR_KIR_LOOP_ZERO_STEP on all three legs', async () => {
  for (const [name, args] of [
    ['for-step-zero-computed', {}],
    ['for-step-zero-dynamic-param', { a: { tag: 'integer', value: '0' } }],
  ]) {
    const message = await rawRuntimeFaultMessage(POSITIONS[name](), args);
    assert.equal(message, 'ERR_KIR_LOOP_ZERO_STEP', `${name}: RT-1 must raise the exact label, not a superstring`);
    const regions = specializedRegions(await emittedArtifacts(POSITIONS[name]()));
    assert.match(
      regions.javascript,
      /__Fault\('unsupported-runtime-input','execution','ERR_KIR_LOOP_ZERO_STEP'\)/u,
      `${name}: the JavaScript leg must raise the exact label at the zero-step site`,
    );
    assert.match(
      regions.python,
      /raise _Fault\("unsupported-runtime-input", "execution", "ERR_KIR_LOOP_ZERO_STEP"\)/u,
      `${name}: the Python leg must raise the exact label at the zero-step site`,
    );
  }
});

test('the zero-step fault is raised before the first head test, so no partial accumulation escapes', async () => {
  const result = await envelope('for-step-zero-computed', 'rt10f-zero-before-head');
  assert.deepEqual(result.result, { presence: 'absent' }, 'a fault cannot carry a value');
  assert.deepEqual([...result.events], [], 'a fault before the head cannot have committed anything');
});

// The loop's only budget is `maxSteps` — there is no iteration limit — so an oversized loop must
// terminate with the step fault rather than run to completion or hang. The claim is monotone rather
// than an exact threshold: RT-1 meters linking at run time while an emitted artifact has its
// linking baked in, so one `maxSteps` value buys a different amount of execution on each leg.
test('an oversized loop is bounded by maxSteps alone on all three legs', async () => {
  const source = POSITIONS['for-budget-loop']();
  const exhausted = await threeLegBytes(source, runtimeRequest('rt10f-budget-out', {}));
  for (const leg of ['direct', 'javascript', 'python']) {
    const result = exhausted.legs[leg].envelope;
    assert.equal(result.outcome, 'failure', `${leg} must exhaust its step budget`);
    assert.equal(result.diagnostics[0]?.code, 'runtime-limit-exceeded', leg);
  }
  const generous = await threeLegBytes(source, stepRequest('rt10f-budget-in', {}, GENEROUS_STEPS));
  assert.deepEqual(
    generous.legs.direct.envelope.result,
    integerSlot(String(BUDGET_TRIPS)),
    'the same loop must complete under a sufficient budget, so the row is not satisfied by a refusal',
  );
});

test('every value row links on all three legs, so no row is satisfied by a shared refusal', async () => {
  for (const row of TABLE_ROWS) {
    const admitted = await admission(POSITIONS[row.name]());
    assert.equal(admitted.rt1, 'admitted', row.name);
    assert.equal(admitted.javascript, 'admitted', row.name);
    assert.equal(admitted.python, 'admitted', row.name);
  }
});

test('the envelope of a loop result carries its integer as a JSON string, never as a number', async () => {
  const { bytes } = await legs('for-i64-near-limit', 'rt10f-wire');
  const wire = Buffer.from(bytes).toString('utf8');
  assert.ok(wire.includes('"value":"2"'), 'RT10F_WIRE_DRIFT: the result must reach the wire as quoted decimal text');
  assert.deepEqual(
    Buffer.from(envelopeBytes(JSON.parse(wire))),
    Buffer.from(bytes),
    'the envelope must round-trip through its own canonical serialization',
  );
});
