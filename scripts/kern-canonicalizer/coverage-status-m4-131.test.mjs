import assert from 'node:assert/strict';
import test from 'node:test';

import { formatM4131ParameterMigrationStatus } from './coverage-status-m4-131.mjs';

const exactInput = {
  baseCompleteFunctions: 104,
  legacyParameterBlockers: 3,
  parameterMigration: {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 41,
    witnesses: [{
      id: 'examples/selfhost-validator/validator.kern#20:validate',
      parameterRows: 41,
      profileRows: { nodes: 202, properties: 308, values: 4_493 },
      tool: 'validator',
    }],
  },
  totalFunctions: 112,
};

test('M4.131 status formats only the exact validate migration handoff', () => {
  assert.equal(
    formatM4131ParameterMigrationStatus(exactInput),
    'M4.131 consumes the exact M4.130 1-function/41-row validate queue and advances the ' +
      'cumulative base to 104/112 with 3 legacy-parameter blockers; M4.132 remeasures the ' +
      'bounded residual frontier.',
  );
});

test('M4.131 status rejects substituted migration data', () => {
  for (const mutate of [
    (copy) => { copy.baseCompleteFunctions = 103; },
    (copy) => { copy.legacyParameterBlockers = 4; },
    (copy) => { copy.parameterMigration.completeFunctions = 0; },
    (copy) => { copy.parameterMigration.completeTools = 2; },
    (copy) => { copy.parameterMigration.migratedParameterRows = 40; },
    (copy) => { copy.parameterMigration.witnesses[0].id = 'substituted'; },
    (copy) => { copy.parameterMigration.witnesses[0].profileRows.values = 4_492; },
    (copy) => { copy.totalFunctions = 111; },
  ]) {
    const copy = structuredClone(exactInput);
    mutate(copy);
    assert.throws(
      () => formatM4131ParameterMigrationStatus(copy),
      /M4\.131 status requires the exact validate parameter migration/u,
    );
  }
});
