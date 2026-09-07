import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  DEFERRAL_LABEL,
  LEDGER,
  LEDGER_ROW_VALUES,
  ROW_KEYS,
  WHILE_POSITIONS,
  WHILE_SPEC_URL,
  assertWhileAdmitted,
  pythonCompile,
  validateLedger,
} from './k0-support.mjs';

const PYTHON_FORMAT = 'kern.compiler.kir-python.v1';

// Every catalog-permitted position a `while` reaches. The refusal must fire in all of them, so
// nothing smuggles a while through a nesting path a shallow walk would miss.
const DEFERRED_POSITIONS = Object.freeze([
  'while-counted-3',
  'while-in-if-then',
  'while-in-if-else',
  'while-in-for-body',
  'while-nested-while',
  'while-in-helper-body',
]);

// The row this slice owns, validated through slice A's own schema gate rather than a local copy of
// it, and with its key set asserted against slice A's `ROW_KEYS` rather than hardcoded — slice A
// still owns the column list and has already changed it once.
test('the while row satisfies the parity ledger schema slice A defines', () => {
  const keys = Object.keys(LEDGER_ROW_VALUES).sort();
  assert.deepEqual(
    keys,
    [...ROW_KEYS].sort(),
    `RT11W_LEDGER_SHAPE: the proposed while row must carry exactly ${[...ROW_KEYS].sort().join(', ')}`,
  );
  assert.equal(LEDGER_ROW_VALUES.nodeKind, 'while');
  assert.equal(LEDGER_ROW_VALUES.label, DEFERRAL_LABEL, 'the row label is the compile failure code');
  assert.deepEqual([...LEDGER_ROW_VALUES.blockedBy], [], 'the first row is blocked by nothing');
  assert.equal(LEDGER_ROW_VALUES.since, 'kern-5-rt11-linked-while');
  assert.ok(
    existsSync(fileURLToPath(WHILE_SPEC_URL)),
    'the row provenance must name a spec that exists, since the blame digest column is gone',
  );
  validateLedger({ ...LEDGER, rows: [{ ...LEDGER_ROW_VALUES }] });
});

test('the parity ledger carries the while row', () => {
  const row = LEDGER.rows.find((candidate) => candidate.nodeKind === 'while');
  assert.ok(row !== undefined, 'RT11W_LEDGER_ROW_MISSING: the parity ledger must carry the while row');
  assert.deepEqual({ ...row }, { ...LEDGER_ROW_VALUES }, 'RT11W_LEDGER_ROW_DRIFT: the while row is not as specified');
  validateLedger(LEDGER);
});

// Two slices meet here, so the order of the assertions is the whole design: the JavaScript
// admission is asserted first, which means at base this test fails on the `while` side (the linker
// refuses) and only once `while` links does it fail on the deferral side. Slice A's absence can
// never masquerade as a while failure, or the reverse.
test('a while program is admitted on the JavaScript leg and refused on the Python leg', async () => {
  for (const position of DEFERRED_POSITIONS) {
    const source = WHILE_POSITIONS[position]();
    await assertWhileAdmitted(position, source);
    const result = await pythonCompile(source);
    assert.equal(result.outcome, 'failure', `RT11W_PY_NOT_DEFERRED: ${position} must not compile to Python`);
    assert.equal(
      result.code,
      DEFERRAL_LABEL,
      `RT11W_PY_NOT_DEFERRED: expected ${DEFERRAL_LABEL} for ${position}, received ${result.code}`,
    );
    assert.equal(result.format, PYTHON_FORMAT, `${position}: the compiler format moved`);
    assert.deepEqual(Object.keys(result).sort(), ['code', 'format', 'outcome'], `${position}: the refusal shape moved`);
    assert.equal(Object.hasOwn(result, 'artifact'), false, `${position}: a refusal must carry no Python artifact`);
    assert.equal(Object.hasOwn(result, 'manifest'), false, `${position}: a refusal must carry no Python manifest`);
  }
});
