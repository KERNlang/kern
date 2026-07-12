import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { validateCoverageLedger } from './validate-coverage-ledger.mjs';

const constitution = JSON.parse(readFileSync('scripts/kir-structural/constitution.json', 'utf8'));
const ledger = JSON.parse(readFileSync('scripts/kir-v1/coverage-witness-ledger.json', 'utf8'));

function mutate(change) {
  const copy = structuredClone(ledger);
  change(copy);
  return copy;
}

test('checked-in ledger exactly binds every constitution row and witness id', () => {
  const result = validateCoverageLedger(ledger, constitution);
  assert.equal(result.witnessIds.size > 1451, true);
});

test('missing, reordered, or duplicated node witnesses fail closed', () => {
  assert.throws(() => validateCoverageLedger(mutate((copy) => copy.nodes.pop()), constitution), /counts/u);
  assert.throws(() => validateCoverageLedger(mutate((copy) => copy.nodes.reverse()), constitution), /source ordered/u);
  assert.throws(
    () => validateCoverageLedger(mutate((copy) => { copy.nodes[1].witnessId = copy.nodes[0].witnessId; }), constitution),
    /witness is invalid/u,
  );
});

test('disposition and property contract mutations fail closed', () => {
  assert.throws(
    () => validateCoverageLedger(mutate((copy) => { copy.nodes[0].disposition = 'lowered-semantic'; }), constitution),
    /disposition mismatches/u,
  );
  assert.throws(
    () => validateCoverageLedger(mutate((copy) => { copy.properties[0].required = !copy.properties[0].required; }), constitution),
    /required drifted/u,
  );
  assert.throws(
    () => validateCoverageLedger(mutate((copy) => { copy.properties[0].witnessIds = []; }), constitution),
    /witness count drifted/u,
  );
});
