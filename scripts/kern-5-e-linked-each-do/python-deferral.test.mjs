import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFERRAL_LABEL, LEDGER_E_ROWS, POSITIONS, compilePython, project, repositoryText } from './k0-support.mjs';
import { PYTHON_DEFERRAL_LABEL_KINDS, SPEC_PATH } from './pins.mjs';

const LEDGER = 'scripts/kern-5-parity-ledger/parity-ledger.json';
const REQUEST = 'packages/core/src/compiler/kir-python/request.ts';

function ledger() {
  return JSON.parse(repositoryText(LEDGER));
}

test('the ledger carries a do row and an each row, sorted, since kern-5-e', () => {
  const rows = ledger().rows;
  const kinds = rows.map((row) => row.nodeKind);
  assert.deepEqual([...kinds], [...kinds].sort(), 'PARITY_LEDGER_UNSORTED: the ledger rows must stay sorted');
  for (const expected of LEDGER_E_ROWS) {
    const row = rows.find((candidate) => candidate.nodeKind === expected.nodeKind);
    assert.ok(row !== undefined, `E_LEDGER_ROW_MISSING: the ledger has no ${expected.nodeKind} row`);
    assert.deepEqual(
      { ...row, blockedBy: [...row.blockedBy] },
      { ...expected, blockedBy: [...expected.blockedBy] },
      `E_LEDGER_ROW_SHAPE: the ${expected.nodeKind} row is not the pinned row`,
    );
  }
  assert.equal(rows.length, 7, 'E_LEDGER_COUNT: slice E appends two rows to the five that stand');
});

test('every ledger row names a spec that exists, and the two new rows name this spec', () => {
  for (const row of ledger().rows) {
    assert.doesNotThrow(() => repositoryText(row.spec), `E_LEDGER_SPEC_MISSING: ${row.spec} does not exist`);
  }
  for (const kind of PYTHON_DEFERRAL_LABEL_KINDS) {
    const row = ledger().rows.find((candidate) => candidate.nodeKind === kind);
    assert.equal(row?.spec, SPEC_PATH, `E_LEDGER_SPEC: the ${kind} row must point at the slice-E spec`);
  }
});

// The exhaustive `satisfies` table in request.ts is what forces a lowered/deferred decision for
// every kind. A new kind that is simply absent there is a type error, so this row is about the
// DECISION being 'deferred' rather than an accidental 'lowered'.
test('the Python request table defers both new kinds explicitly', () => {
  const source = repositoryText(REQUEST);
  for (const kind of PYTHON_DEFERRAL_LABEL_KINDS) {
    assert.match(
      source,
      new RegExp(`${kind}:\\s*'deferred'`, 'u'),
      `E_PYTHON_TABLE: ${kind} must be marked 'deferred' in the Python request table`,
    );
  }
});

test('the Python leg refuses every do and each fixture', async () => {
  for (const name of ['do-bare', 'do-sync-call', 'each-plain', 'each-index', 'each-in-try']) {
    const verified = await project(POSITIONS[name]());
    assert.ok(verified !== undefined, `E_PROJECTION_LOST: ${name} must project`);
    const python = compilePython(verified);
    assert.equal(python.outcome, 'failure', `E_PYTHON_ADMITTED: ${name} must stay deferred on the Python leg`);
    assert.equal(python.code, DEFERRAL_LABEL, name);
  }
});
