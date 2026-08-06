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

test('runner-synthetic ledger rows cannot disappear, reorder, or impersonate source rows', () => {
  assert.throws(
    () => validateCoverageLedger(mutate((copy) => copy.runnerSyntheticNodes.pop()), constitution),
    /counts/u,
  );
  assert.throws(
    () =>
      validateCoverageLedger(
        mutate((copy) => { copy.runnerSyntheticNodes[0].id = copy.nodes[0].id; }),
        constitution,
      ),
    /runner-synthetic ordered/u,
  );
  assert.throws(
    () =>
      validateCoverageLedger(
        mutate((copy) => { copy.runnerSyntheticProperties[0].nodeKind = copy.nodes[0].id; }),
        constitution,
      ),
    /nodeKind drifted/u,
  );
  assert.throws(
    () =>
      validateCoverageLedger(
        mutate((copy) => { copy.runnerSyntheticProperties[0].witnessIds = []; }),
        constitution,
      ),
    /witness count drifted/u,
  );
});

test('branch path provenance witness count follows property optionality', () => {
  const requiredConstitution = structuredClone(constitution);
  const requiredLedger = structuredClone(ledger);
  const constitutionPathValue = requiredConstitution.properties.find(
    (row) => row.nodeKind === 'path' && row.propertyName === 'value',
  );
  const ledgerPathValue = requiredLedger.properties.find(
    (row) => row.nodeKind === 'path' && row.propertyName === 'value',
  );
  assert.ok(constitutionPathValue);
  assert.ok(ledgerPathValue);
  constitutionPathValue.required = true;
  ledgerPathValue.required = true;
  ledgerPathValue.witnessIds = ledgerPathValue.witnessIds.slice(0, 2);
  assert.doesNotThrow(() => validateCoverageLedger(requiredLedger, requiredConstitution));
});
