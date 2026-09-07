import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { pythonLoweringDeferral } from '../../packages/core/dist/compiler/kir-python/request.js';
import {
  DEFERRAL_LABEL,
  JUMP_POSITIONS,
  JUMP_SPEC_URL,
  LEDGER,
  LEDGER_BREAK_ROW,
  LEDGER_CONTINUE_ROW,
  LEDGER_JUMP_ROWS,
  ROW_KEYS,
  assertJumpAdmitted,
  jumpPythonCompile,
  linkedProgram,
  validateLedger,
} from './k0-support.mjs';

const PYTHON_FORMAT = 'kern.compiler.kir-python.v1';

// Every catalog-permitted position a jump reaches through the linker. The refusal must fire in all
// of them, so nothing smuggles a jump through a nesting path a shallow walk would miss.
const DEFERRED_POSITIONS = Object.freeze([
  'for-break',
  'for-continue',
  'for-break-under-if',
  'for-continue-if-else',
  'while-break',
  'while-continue',
  'while-break-under-if',
  'nested-inner-break',
  'nested-inner-continue',
  'while-in-for-break',
  'for-in-while-break',
  'jump-in-loop-in-helper',
]);

// The rows this slice owns, validated through slice A's own schema gate rather than a local copy of
// it, and with their key sets asserted against slice A's `ROW_KEYS` rather than hardcoded.
test('both jump rows satisfy the parity ledger schema slice A defines', () => {
  for (const row of LEDGER_JUMP_ROWS) {
    assert.deepEqual(
      Object.keys(row).sort(),
      [...ROW_KEYS].sort(),
      `RT12J_LEDGER_SHAPE: the ${row.nodeKind} row must carry exactly ${[...ROW_KEYS].sort().join(', ')}`,
    );
    assert.equal(row.label, DEFERRAL_LABEL, 'the row label is the compile failure code');
    assert.equal(row.since, 'kern-5-rt12-linked-jumps');
    assert.equal(row.surface, 'statement');
    assert.deepEqual([...row.blockedBy], ['while'], 'the repayment evidence needs a linkable while position first');
  }
  assert.equal(LEDGER_BREAK_ROW.nodeKind, 'break');
  assert.equal(LEDGER_CONTINUE_ROW.nodeKind, 'continue');
  assert.ok(
    existsSync(fileURLToPath(JUMP_SPEC_URL)),
    'the row provenance must name a spec that exists, since the blame digest column is gone',
  );
});

// `blockedBy` names an existing row, so these two rows are only valid *after* slice B's `while` row
// exists — which is exactly the catch-up ordering the column is for. Validating the whole document
// rather than the rows alone is what checks that.
test('the parity ledger carries the break and continue rows, sorted before the while row', () => {
  validateLedger(LEDGER);
  assert.deepEqual(
    LEDGER.rows.map((row) => row.nodeKind),
    ['break', 'continue', 'while'],
    'RT12J_LEDGER_ROW_MISSING: the ledger must carry three rows in nodeKind order',
  );
  for (const expected of LEDGER_JUMP_ROWS) {
    const row = LEDGER.rows.find((candidate) => candidate.nodeKind === expected.nodeKind);
    assert.ok(row !== undefined, `RT12J_LEDGER_ROW_MISSING: the ${expected.nodeKind} row is absent`);
    assert.deepEqual(
      { ...row, blockedBy: [...row.blockedBy] },
      { ...expected, blockedBy: [...expected.blockedBy] },
      `RT12J_LEDGER_ROW_DRIFT: the ${expected.nodeKind} row is not as specified`,
    );
  }
});

// Two slices meet here, so the order of the assertions is the whole design: the JavaScript
// admission is asserted first, which means at base this test fails on the jump side (the linker
// refuses) and only once a jump links does it fail on the deferral side. Slice A's absence can
// never masquerade as a jump failure, or the reverse.
test('a jump program is admitted on the JavaScript leg and refused on the Python leg', async () => {
  for (const position of DEFERRED_POSITIONS) {
    const source = JUMP_POSITIONS[position]();
    await assertJumpAdmitted(position, source);
    const result = await jumpPythonCompile(source);
    assert.equal(result.outcome, 'failure', `RT12J_PY_NOT_DEFERRED: ${position} must not compile to Python`);
    assert.equal(
      result.code,
      DEFERRAL_LABEL,
      `RT12J_PY_NOT_DEFERRED: expected ${DEFERRAL_LABEL} for ${position}, received ${result.code}`,
    );
    assert.equal(result.format, PYTHON_FORMAT, `${position}: the compiler format moved`);
    assert.deepEqual(Object.keys(result).sort(), ['code', 'format', 'outcome'], `${position}: the refusal shape moved`);
    assert.equal(Object.hasOwn(result, 'artifact'), false, `${position}: a refusal must carry no Python artifact`);
    assert.equal(Object.hasOwn(result, 'manifest'), false, `${position}: a refusal must carry no Python manifest`);
  }
});

// Which kind gets reported is first-in-pre-order, not most-specific: a `for` body carrying a jump
// reports the jump, because `for` is lowered and the walk descends into it; a `while` body carrying
// the same jump reports `while`, because the `while` row fires before the walk ever reaches the
// body. The code is the same either way, and a row that asserted the reported kind without this
// distinction would be wrong for half its fixtures.
test('the reported deferral is the first deferred kind in pre-order, not the innermost one', async () => {
  for (const [position, expected] of [
    ['for-break', 'break'],
    ['for-continue', 'continue'],
    ['nested-inner-break', 'break'],
    ['while-break', 'while'],
    ['while-continue', 'while'],
    ['while-in-for-break', 'while'],
  ]) {
    const linked = await linkedProgram(JUMP_POSITIONS[position]());
    assert.equal(
      pythonLoweringDeferral(linked),
      expected,
      `RT12J_PY_REPORT_DRIFT: ${position} must report ${expected} as its first deferred kind`,
    );
  }
});
