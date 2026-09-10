import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INT64_LIMIT,
  WHILE_POSITIONS,
  WHILE_TABLE_ROWS,
  integerSlot,
  compileJavaScript,
  compilePython,
  executeKernKir,
  project,
  provider,
  runtimeRequest,
  twoLegBytes,
  twoLegs,
  whilePositionArguments,
} from './k0-support.mjs';

async function legs(name, requestId) {
  return twoLegBytes(WHILE_POSITIONS[name](), runtimeRequest(requestId, whilePositionArguments(name)));
}

async function envelope(name, requestId) {
  return (await legs(name, requestId)).legs.direct.envelope;
}

test('every frozen row stays inside the signed 64-bit range the number model reserves', () => {
  for (const row of WHILE_TABLE_ROWS) {
    const value = BigInt(row.expected);
    assert.ok(value < INT64_LIMIT && value >= -INT64_LIMIT, `${row.name} result must stay inside i64`);
  }
});

test('the frozen table carries a trip count for every row and no duplicate names', () => {
  const names = WHILE_TABLE_ROWS.map((row) => row.name);
  assert.deepEqual([...new Set(names)], names, 'every row name must be unique');
  for (const row of WHILE_TABLE_ROWS) {
    assert.equal(typeof row.trips, 'number', `${row.name} must declare its trip count`);
    assert.ok(row.trips >= 0, `${row.name} trip count must be non-negative`);
    assert.ok(WHILE_POSITIONS[row.name] !== undefined, `${row.name} must have a fixture`);
  }
});

for (const row of WHILE_TABLE_ROWS) {
  test(`${row.name} returns the frozen integer ${row.expected} byte-identically on both legs`, async () => {
    const result = await envelope(row.name, `rt11w-${row.name}`);
    assert.equal(result.outcome, 'success', row.name);
    assert.deepEqual(
      result.result,
      integerSlot(row.expected),
      `RT11W_VALUE_DRIFT: ${row.program} must equal the frozen ${row.expected}`,
    );
  });
}

// The condition is tested before the first trip, not after it. A lowering that ran the body once
// before its first test would return 1 here and pass every other row in the table.
test('the condition is evaluated before the first trip, so a false condition runs no body', async () => {
  for (const [name, requestId] of [
    ['while-false-never-runs', 'rt11w-false-literal'],
    ['while-flag-param-false', 'rt11w-false-param'],
  ]) {
    const result = await envelope(name, requestId);
    assert.deepEqual(result.result, integerSlot('0'), `${name}: a false condition must run zero trips`);
    assert.deepEqual([...result.events], [], `${name}: a zero-trip loop commits nothing`);
  }
});

// `i < 3` over a counter seeded at 0 runs three trips, not four: the same off-by-one `for`'s
// exclusive `to` guards, expressed by the condition instead of by a bound.
test('a strict less-than condition runs exactly the trips below the bound', async () => {
  const three = await envelope('while-counted-3', 'rt11w-exclusive');
  assert.deepEqual(three.result, integerSlot('3'), 'sum 0..2 is 3; a fourth trip would make it 6');
});

// A `return` inside the body ends the handler at once, on both legs, and the trailing top-level
// return is never reached. That is the half of the single-return rule a nested return relies on.
test('a return inside the body ends the handler and the trailing return is unreachable', async () => {
  const result = await envelope('while-early-return', 'rt11w-early-return');
  assert.deepEqual(result.result, integerSlot('3'), 'the body return wins over the trailing -1');
});

// Print and capability are inadmissible as direct body children, so an `if` is the only way either
// reaches a loop body. Ordering is the claim: one event per trip, in trip order, identically on
// both legs.
test('a print and a capability nested under an if inside the body commit per trip, in order', async () => {
  const printed = await twoLegs(WHILE_POSITIONS['while-print-via-if'](), runtimeRequest('rt11w-print', {}));
  for (const leg of ['direct', 'javascript']) {
    const events = [...printed[leg].envelope.events];
    assert.equal(events.length, 2, `${leg}: one stdout event per trip`);
    assert.deepEqual(
      events.map((event) => event.op),
      ['stdout', 'stdout'],
      `${leg}: both events are stdout`,
    );
    assert.deepEqual(
      events.map((event) => event.text),
      ['tick', 'tick'],
      `RT11W_ORDER_DRIFT: ${leg} must print once per trip`,
    );
  }
  const capability = await twoLegs(WHILE_POSITIONS['while-cap-via-if'](), runtimeRequest('rt11w-cap', {}));
  for (const leg of ['direct', 'javascript']) {
    assert.equal(capability[leg].calls.length, 1, `${leg}: one capability invocation on the single trip`);
    assert.equal(capability[leg].envelope.events[0]?.op, 'capability', `${leg}: the event is a capability event`);
  }
});

// An `assign` to an outer `let` survives the trip boundary; a body-local `let` does not. Together
// they pin the copied-scope model: the body sees the enclosing bindings and adds its own.
test('an assign to an outer let accumulates across trips while a body let is per-trip', async () => {
  assert.deepEqual((await envelope('while-assign-outer-persists', 'rt11w-outer')).result, integerSlot('30'));
  assert.deepEqual((await envelope('while-let-in-body', 'rt11w-body-let')).result, integerSlot('6'));
});

// The only budget a loop has is `maxSteps`, so an unbounded loop must exhaust it rather than hang,
// and must do so with the existing limit fault on both legs — no new code, no new label.
test('an infinite while exhausts maxSteps and faults runtime-limit-exceeded on both legs', async () => {
  const runs = await twoLegs(
    WHILE_POSITIONS['while-true-exhausts-steps'](),
    runtimeRequest('rt11w-infinite', {}),
  );
  for (const leg of ['direct', 'javascript']) {
    const result = runs[leg].envelope;
    assert.equal(result.outcome, 'failure', `${leg}: an unbounded loop must not succeed`);
    assert.equal(result.diagnostics[0]?.code, 'runtime-limit-exceeded', `${leg}: the step budget is what refuses`);
    assert.equal(result.diagnostics[0]?.phase, 'execution', leg);
    assert.deepEqual(result.result, { presence: 'absent' }, `${leg}: a fault cannot carry a value`);
    assert.deepEqual([...result.events], [], `${leg}: the body commits no event`);
  }
});

// The boolean gate, asserted exactly as RT-2 asserts the `if` gate and no further: every leg fails
// closed under the one closed link code, and the run commits nothing. RT-2's own row is
// `branch-behavior.test.mjs:150-174`; it makes no claim about emitted text, because
// `staticExpressionType` is total and no projectable fixture reaches the runtime tag check. A
// regex on the emitted artifact would have been a stricter claim than the precedent it cites.
test('a non-boolean condition fails closed on every leg and commits nothing', async () => {
  for (const name of [
    'neg-while-cond-integer-literal',
    'neg-while-cond-integer-param',
    'neg-while-cond-text-param',
    'neg-while-cond-binary-integer',
  ]) {
    const source = WHILE_POSITIONS[name]();
    const verified = await project(source);
    assert.ok(verified !== undefined, `${name} must project so the refusal is a link decision`);
    const direct = await executeKernKir(verified, runtimeRequest(`rt11w-${name}`, whilePositionArguments(name)), provider([]));
    assert.deepEqual(
      {
        javascript: compileJavaScript(verified).code,
        python: compilePython(verified).code,
        rt1: direct.diagnostics[0]?.code,
      },
      {
        javascript: 'handler-entry-unsupported',
        python: 'handler-entry-unsupported',
        rt1: 'handler-entry-unsupported',
      },
      `KIR_WHILE_COND_NOT_BOOLEAN: ${name} must fail closed identically on all three legs`,
    );
    assert.deepEqual([...direct.events], [], `${name} must commit no event`);
  }
});
