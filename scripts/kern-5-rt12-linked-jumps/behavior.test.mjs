import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INT64_LIMIT,
  JUMP_POSITIONS,
  JUMP_TABLE_ROWS,
  LIMITS,
  integerSlot,
  jumpPositionArguments,
  jumpTwoLegBytes,
  jumpTwoLegs,
  runtimeRequest,
} from './k0-support.mjs';

async function legs(name, requestId) {
  return jumpTwoLegBytes(JUMP_POSITIONS[name](), runtimeRequest(requestId, jumpPositionArguments(name)));
}

async function envelope(name, requestId) {
  return (await legs(name, requestId)).legs.direct.envelope;
}

test('every frozen row stays inside the signed 64-bit range the number model reserves', () => {
  for (const row of JUMP_TABLE_ROWS) {
    const value = BigInt(row.expected);
    assert.ok(value < INT64_LIMIT && value >= -INT64_LIMIT, `${row.name} result must stay inside i64`);
  }
});

test('the frozen table carries a trip count for every row and no duplicate names', () => {
  const names = JUMP_TABLE_ROWS.map((row) => row.name);
  assert.deepEqual([...new Set(names)], names, 'every row name must be unique');
  for (const row of JUMP_TABLE_ROWS) {
    assert.equal(typeof row.trips, 'number', `${row.name} must declare its trip count`);
    assert.ok(row.trips >= 0, `${row.name} trip count must be non-negative`);
    assert.ok(JUMP_POSITIONS[row.name] !== undefined, `${row.name} must have a fixture`);
  }
});

for (const row of JUMP_TABLE_ROWS) {
  test(`${row.name} returns the frozen integer ${row.expected} byte-identically on both legs`, async () => {
    const result = await envelope(row.name, `rt12j-${row.name}`);
    assert.equal(result.outcome, 'success', row.name);
    assert.deepEqual(
      result.result,
      integerSlot(row.expected),
      `RT12J_VALUE_DRIFT: ${row.program} must equal the frozen ${row.expected}`,
    );
  });
}

// The locality claim, in values rather than ticks. If an inner `break` popped the outer loop the
// answer would be 1 for the counted pair and 2 for the mixed ones; if it popped nothing the inner
// bound would decide instead. Every one of the three nesting shapes separates those two failures.
test('a break leaves the innermost loop only, so the outer loop keeps running', async () => {
  assert.deepEqual(
    (await envelope('nested-inner-break', 'rt12j-locality-for')).result,
    integerSlot('3'),
    'RT12J_LOCALITY_DRIFT: three outer trips must each run exactly one inner trip',
  );
  assert.deepEqual(
    (await envelope('for-in-while-break', 'rt12j-locality-for-in-while')).result,
    integerSlot('2'),
    'RT12J_LOCALITY_DRIFT: an inner for break must not end the enclosing while',
  );
  assert.deepEqual(
    (await envelope('while-in-for-break', 'rt12j-locality-while-in-for')).result,
    integerSlot('2'),
    'RT12J_LOCALITY_DRIFT: an inner while break must not end the enclosing for',
  );
  assert.deepEqual(
    (await envelope('nested-outer-break', 'rt12j-locality-outer')).result,
    integerSlot('2'),
    'RT12J_LOCALITY_DRIFT: a break beside the inner loop binds to the outer loop, not the inner one',
  );
});

// `continue` must advance the counter and re-test the condition, which the two loop forms reach by
// different routes: the counted form has an advance to run, the condition form has a condition to
// re-read. A jump that skipped either would show up as a wrong trip count here, not as a fault.
test('continue ends the trip and re-enters the loop head in both loop forms', async () => {
  assert.deepEqual(
    (await envelope('for-continue-after-leaf', 'rt12j-continue-for')).result,
    integerSlot('3'),
    'RT12J_CONTINUE_DRIFT: the counted form must advance and run all three trips',
  );
  assert.deepEqual(
    (await envelope('while-continue', 'rt12j-continue-while')).result,
    integerSlot('3'),
    'RT12J_CONTINUE_DRIFT: the condition form must re-test and run all three trips',
  );
  assert.deepEqual(
    (await envelope('for-continue-last-trip', 'rt12j-continue-last')).result,
    integerSlot('23'),
    'RT12J_CONTINUE_DRIFT: a continue on the final trip must exit through the ordinary loop exit',
  );
});

// The half of `continue` a trip count alone cannot see: the statements after it never run. Both
// forms are here because the counted one merely loses work while the condition one loses its own
// increment and diverges, which is the sharper of the two failures.
test('continue skips the rest of the trip, and skipping the increment is what diverges', async () => {
  const skipped = await envelope('for-continue-dead-tail', 'rt12j-continue-dead');
  assert.deepEqual(
    skipped.result,
    integerSlot('0'),
    'RT12J_CONTINUE_FALLTHROUGH: the statement after a continue must never run',
  );
  for (const maxSteps of [16, 64, 512]) {
    const request = {
      ...runtimeRequest(`rt12j-continue-diverge-${maxSteps}`, {}),
      limits: { ...LIMITS, maxSteps },
    };
    const runs = await jumpTwoLegBytes(JUMP_POSITIONS['while-continue-skips-increment'](), request);
    assert.equal(
      runs.legs.direct.envelope.outcome,
      'failure',
      `maxSteps ${maxSteps}: a continue that skips its own increment must not terminate`,
    );
    assert.equal(
      runs.legs.direct.envelope.diagnostics[0]?.code,
      'runtime-limit-exceeded',
      `maxSteps ${maxSteps}: the step budget is what refuses`,
    );
  }
});

// A break on the very first trip: nothing in the body after it has run even once, so the loop is
// indistinguishable from one that never entered — except that its head charge did happen, which the
// metering suite pins separately.
test('a break on the first trip leaves the accumulator untouched', async () => {
  for (const [name, requestId] of [
    ['for-break', 'rt12j-break-first-for'],
    ['while-break', 'rt12j-break-first-while'],
    ['for-break-dead-tail', 'rt12j-break-first-dead'],
  ]) {
    const result = await envelope(name, requestId);
    assert.deepEqual(result.result, integerSlot('0'), `${name}: nothing after the break may take effect`);
    assert.deepEqual([...result.events], [], `${name}: a first-trip break commits nothing`);
  }
});

// The canonical importer shape: a condition loop whose only exit is a guarded jump. This is the
// program the whole slice exists to admit, and the one where a `while(true)` lowering's own exit
// break and the user's break are emitted side by side.
test('a while-true loop exits through its guarded break with the counter it built', async () => {
  const result = await envelope('while-true-break-counter', 'rt12j-importer-shape');
  assert.deepEqual(
    result.result,
    integerSlot('3'),
    'RT12J_IMPORTER_SHAPE: the guarded break must exit on the third trip',
  );
});

// A `return` after an unconditional `break` is admitted and never taken, so the trailing top-level
// return is what answers. That is the whole content of the unreachable-code decision, in values.
test('a return after a break never fires, and the top-level return answers instead', async () => {
  assert.deepEqual(
    (await envelope('for-break-dead-return', 'rt12j-dead-return')).result,
    integerSlot('0'),
    'RT12J_DEAD_CODE: the unreachable return must not decide the envelope',
  );
});

// A void handler with a jump in its loop body links and drains, on both legs, with no value.
test('a void handler whose loop body only breaks drains identically on both legs', async () => {
  const runs = await jumpTwoLegs(JUMP_POSITIONS['void-break-in-loop'](), runtimeRequest('rt12j-void-break', {}));
  for (const leg of ['direct', 'javascript']) {
    const result = runs[leg].envelope;
    assert.equal(result.outcome, 'success', `${leg}: a void handler with a break must drain`);
    assert.deepEqual(result.result, { presence: 'absent' }, `${leg}: a void handler carries no value`);
    assert.deepEqual([...result.events], [], `${leg}: the body commits no event`);
  }
});

// The two jump kinds under a branch, in every branch position: then, else, and a bare guard. The
// value is what separates "the branch was taken" from "the jump bound to the branch instead of the
// loop", which no label can show.
test('a jump under a branch decides only that trip, whichever branch carries it', async () => {
  for (const [name, expected] of [
    ['for-break-under-if', '2'],
    ['for-break-if-else', '2'],
    ['for-continue-under-if', '3'],
    ['for-continue-if-else', '3'],
    ['while-break-under-if', '1'],
    ['while-continue-under-if', '3'],
  ]) {
    const result = await envelope(name, `rt12j-branch-${name}`);
    assert.deepEqual(result.result, integerSlot(expected), `RT12J_BRANCH_DRIFT: ${name} must equal ${expected}`);
  }
});
