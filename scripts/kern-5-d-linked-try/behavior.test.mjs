import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INT64_LIMIT,
  TRY_POSITIONS,
  TRY_TABLE_ROWS,
  integerSlot,
  runtimeRequest,
  tryPositionArguments,
  tryTwoLegBytes,
  tryTwoLegs,
} from './k0-support.mjs';
import { COMMIT_TAGS } from './pins.mjs';

async function legs(name, requestId) {
  return tryTwoLegBytes(TRY_POSITIONS[name](), runtimeRequest(requestId, tryPositionArguments(name)));
}

async function envelope(name, requestId) {
  return (await legs(name, requestId)).legs.direct.envelope;
}

test('every frozen row stays inside the signed 64-bit range the number model reserves', () => {
  for (const row of TRY_TABLE_ROWS) {
    const value = BigInt(row.expected);
    assert.ok(value < INT64_LIMIT && value >= -INT64_LIMIT, `${row.name} result must stay inside i64`);
  }
});

test('the frozen table names a fixture and a commit tag for every row, with no duplicate name', () => {
  const names = TRY_TABLE_ROWS.map((row) => row.name);
  assert.deepEqual([...new Set(names)], names, 'D_TABLE_SHAPE: every row name must be unique');
  for (const row of TRY_TABLE_ROWS) {
    assert.ok(TRY_POSITIONS[row.name] !== undefined, `D_TABLE_SHAPE: ${row.name} must have a fixture`);
    assert.ok(COMMIT_TAGS.includes(row.commit), `D_TABLE_SHAPE: ${row.name} must carry a known commit tag`);
    assert.equal(typeof row.entersCatch, 'boolean', `D_TABLE_SHAPE: ${row.name} must declare whether the catch runs`);
  }
});

for (const row of TRY_TABLE_ROWS) {
  test(`${row.name} returns the frozen integer ${row.expected} byte-identically on both legs`, async () => {
    const result = await envelope(row.name, `d-${row.name}`);
    assert.equal(result.outcome, 'success', `D_VALUE_DRIFT: ${row.name} must complete successfully`);
    assert.deepEqual(
      result.result,
      integerSlot(row.expected),
      `D_VALUE_DRIFT: ${row.program} must equal the frozen ${row.expected}`,
    );
  });
}

// The catch column of the frozen table, driven as its own row: a fixture whose catch must not run
// is what separates "the try body completed" from "the catch quietly ran too".
test('the catch body runs exactly on the rows the table marks, and on no other', async () => {
  for (const row of TRY_TABLE_ROWS.filter((candidate) => candidate.commit !== 'D5')) {
    const result = await envelope(row.name, `d-catch-${row.name}`);
    assert.equal(result.outcome, 'success', `D_VALUE_DRIFT: ${row.name} must complete`);
  }
});

test('a caught throw truncates the frame stack to the trap depth and does not resume the loop', async () => {
  const result = await envelope('for-try-break', 'd-trap-depth');
  assert.deepEqual(
    result.result,
    integerSlot('1'),
    'D_TRAP_DEPTH: a break inside a try body must leave the loop after one trip, not resume it',
  );
});

// D-8c, the falsifier for D-8b's structural argument. A spurious catch entry here would be exactly
// the silent miscatch the spec claims is impossible, so the positive row is what proves it.
test('a try around a helper call that completes normally runs the try body and never enters the catch', async () => {
  const { legs: both } = await legs('try-await-helper-completes', 'd-await-no-miscatch');
  assert.deepEqual(
    both.direct.envelope.result,
    integerSlot('1'),
    'D_SILENT_MISCATCH: the catch must not run when the callee completes normally',
  );
  assert.equal(both.javascript.envelope.outcome, 'success');
});

// D-4d's discriminating row, and the half the coordinator override rests on: the importer's hottest
// defensive loop must link AND behave, byte for byte, on both legs. A one-sided oracle here would
// let the override through on assertion alone.
test('the importer defensive-loop shape behaves byte-identically on both legs with no finally', async () => {
  for (const name of ['for-try-continue', 'for-try-guarded-continue', 'for-try-break', 'try-for-break']) {
    const { legs: both } = await legs(name, `d-jump-${name}`);
    assert.equal(both.direct.envelope.outcome, 'success', `D_JUMP_REFUSED: ${name} must link and run on RT-1`);
    assert.equal(both.javascript.envelope.outcome, 'success', `D_JUMP_REFUSED: ${name} must run on the JavaScript leg`);
  }
});

test('a break inside a while inside a try inside a for is admitted and advances the outer loop', async () => {
  const result = await envelope('try-while-in-for-break', 'd-nested-jump');
  assert.deepEqual(
    result.result,
    integerSlot('2'),
    'D_JUMP_DEPTH: the inner break must leave only the while, so the outer for still runs both trips',
  );
});

// The payload-reading rows return text rather than an integer, so they sit outside the frozen table
// and carry their expected value here.
test('the catch binding reads message and code as ordinary member expressions on both legs', async () => {
  const message = await envelope('try-catch-reads-message', 'd-reads-message');
  assert.deepEqual(
    message.result,
    { presence: 'value', value: { tag: 'text', value: 'boom' } },
    'D_PAYLOAD_READ: e.message must evaluate to the thrown text',
  );
  const code = await envelope('try-catch-reads-code', 'd-reads-code');
  assert.deepEqual(
    code.result,
    { presence: 'value', value: { tag: 'text', value: 'E1' } },
    'D_PAYLOAD_READ: e.code must evaluate to the thrown code',
  );
});

// D-1a2's consequence, stated as a behaviour: because the linker inserts the default, `e.code` never
// takes the missing-member path -- it finds an entry whose value is `{tag:'null'}`.
test('an omitted code reads back as an explicit null rather than taking the missing-member path', async () => {
  const { legs: both } = await legs('try-catch-reads-omitted-code', 'd-null-code-read');
  assert.equal(
    both.direct.envelope.outcome,
    'success',
    'D_PAYLOAD_DEFAULT: reading an omitted code must find the inserted null, not fault on a missing member',
  );
  assert.deepEqual(
    both.direct.envelope.result,
    integerSlot('2'),
    'D_PAYLOAD_DEFAULT: the catch body must run to completion after binding the null code',
  );
});

test('a member miss on the catch binding keeps the existing missing-member fault on both legs', async () => {
  const legsRun = await tryTwoLegs(
    TRY_POSITIONS['try-catch-reads-missing'](),
    runtimeRequest('d-missing-member', {}),
  );
  assert.equal(
    legsRun.direct.envelope.outcome,
    'failure',
    'D_MEMBER_ARM: e.missing must keep faulting through the existing member arm',
  );
  assert.equal(legsRun.javascript.envelope.outcome, 'failure');
});
