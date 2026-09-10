import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFERRAL_LABEL,
  POSITIONS,
  WITH_POSITIONS,
  compilePython,
  project,
  repositoryText,
} from './k0-support.mjs';
import { LEDGER_KINDS_AFTER_F, LEDGER_ROW_COUNT_AFTER_F } from './pins.mjs';

const LEDGER = 'scripts/kern-5-parity-ledger/parity-ledger.json';
const REQUEST = 'packages/core/src/compiler/kir-python/request.ts';

function ledger() {
  return JSON.parse(repositoryText(LEDGER));
}

// The ledger row and the lowering-table entry are the same fact, and `with` is neither: it dissolves
// into `let` and `try` at link, so there is no kind to defer and a row would be unbacked.
test('the parity ledger gains no with row and keeps its seven kinds', () => {
  const rows = ledger().rows;
  const kinds = rows.map((row) => row.nodeKind);
  assert.deepEqual([...kinds], [...kinds].sort(), 'PARITY_LEDGER_UNSORTED: the ledger rows must stay sorted');
  assert.deepEqual(kinds, [...LEDGER_KINDS_AFTER_F], 'F_LEDGER_DRIFT: the ledger kind set moved');
  assert.equal(
    rows.length,
    LEDGER_ROW_COUNT_AFTER_F,
    'F_LEDGER_COUNT: an expanded with adds no linked kind, so it adds no deferral row',
  );
  assert.equal(
    kinds.includes('with'),
    false,
    'F_LEDGER_ROW_UNBACKED: a with row would name a kind the linked union does not carry',
  );
});

test('the Python lowering table names no with key, because no linked statement is a with', () => {
  const source = repositoryText(REQUEST);
  assert.equal(
    /^\s*with:\s*'(?:lowered|deferred)',/mu.test(source),
    false,
    "F_PYTHON_TABLE: the exhaustive lowering table is keyed by LinkedKernKirStatement['kind'], which never includes with",
  );
  for (const kind of ['do', 'try']) {
    assert.match(
      source,
      new RegExp(`${kind}:\\s*'deferred'`, 'u'),
      `F_PYTHON_TABLE: ${kind} must stay deferred -- it is what a with defers through`,
    );
  }
});

// F-8c: the refusal is real, not inherited from a link failure. Every admitted with fixture reaches
// the Python compiler and is turned away by the ledger's own label.
test('every with fixture refuses on the Python leg with the deferral label', async () => {
  for (const name of Object.keys(WITH_POSITIONS)) {
    const verified = await project(POSITIONS[name]());
    assert.ok(verified !== undefined, `F_PROJECTION_LOST: ${name} must project`);
    const python = compilePython(verified);
    assert.equal(python.outcome, 'failure', `F_PYTHON_ADMITTED: ${name} must stay deferred on the Python leg`);
    assert.equal(python.code, DEFERRAL_LABEL, `F_PYTHON_LABEL: ${name} must refuse with ${DEFERRAL_LABEL}`);
  }
});

test('every ledger row still names a spec that exists', () => {
  for (const row of ledger().rows) {
    assert.doesNotThrow(() => repositoryText(row.spec), `F_LEDGER_SPEC_MISSING: ${row.spec} does not exist`);
  }
});
