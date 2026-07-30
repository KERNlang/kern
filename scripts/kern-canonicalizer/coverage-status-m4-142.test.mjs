import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANONICALIZE_PARAMETER_TARGET_M4142,
} from './canonicalize-parameter-target.mjs';
import {
  formatM4142ParameterMigrationStatus,
} from './coverage-status-m4-142.mjs';

const exactInput = {
  baseCompleteFunctions: 110,
  legacyParameterBlockers: 2,
  parameterMigration: {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 15,
    witnesses: [{
      id: CANONICALIZE_PARAMETER_TARGET_M4142.id,
      parameterRows: 15,
      profileRows: { nodes: 100, properties: 159, values: 2556 },
      tool: 'canonicalizer',
    }],
  },
  postMigrationQueue: {
    completeFunctions: 0,
    completeTools: 0,
    migratedParameterRows: 0,
    witnesses: [],
  },
  totalFunctions: 112,
};

test('M4.142 status formats only the exact canonicalize migration', () => {
  assert.equal(
    formatM4142ParameterMigrationStatus(exactInput),
    'M4.142 consumes the exact M4.141 1-function/15-row canonicalize queue and advances ' +
      'the cumulative base to 110/112 with 2 legacy-parameter blockers and an empty parameter ' +
      'queue; M4.143 remeasures the bounded residual frontier.',
  );
});

test('M4.142 status rejects substituted migration data', () => {
  for (const mutate of [
    (copy) => { copy.baseCompleteFunctions = 109; },
    (copy) => { copy.legacyParameterBlockers = 3; },
    (copy) => { copy.parameterMigration.completeFunctions = 0; },
    (copy) => { copy.parameterMigration.completeTools = 2; },
    (copy) => { copy.parameterMigration.migratedParameterRows = 14; },
    (copy) => { copy.parameterMigration.witnesses[0].id = 'substituted'; },
    (copy) => { copy.parameterMigration.witnesses[0].profileRows.values = 2555; },
    (copy) => { copy.postMigrationQueue.completeFunctions = 1; },
    (copy) => { copy.postMigrationQueue.witnesses.push({ id: 'substituted' }); },
    (copy) => { copy.totalFunctions = 111; },
  ]) {
    const copy = structuredClone(exactInput);
    mutate(copy);
    assert.throws(
      () => formatM4142ParameterMigrationStatus(copy),
      /M4\.142 status requires the exact canonicalize parameter migration/u,
    );
  }
});
