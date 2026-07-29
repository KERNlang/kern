import assert from 'node:assert/strict';
import test from 'node:test';

import { formatM4124ParameterMigrationStatus } from './coverage-status-m4-124.mjs';

const exactInput = {
  baseCompleteFunctions: 103,
  legacyParameterBlockers: 4,
  parameterMigration: {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 5,
    witnesses: [{
      id: 'examples/capstone-checker-subset/checker.kern#2:rejectLine',
      parameterRows: 5,
      profileRows: { nodes: 8, properties: 15, values: 106 },
      tool: 'checker',
    }],
  },
  totalFunctions: 112,
};

test('coverage status records the exact M4.124 rejectLine migration', () => {
  assert.equal(
    formatM4124ParameterMigrationStatus(exactInput),
    'M4.124 consumes the exact M4.123 1-function/5-row rejectLine queue and advances the ' +
      'cumulative base to 103/112 with 4 legacy-parameter blockers; M4.125 remeasures the ' +
      'bounded residual frontier.',
  );
});

test('M4.124 coverage status fails closed on frontier drift', () => {
  for (const mutate of [
    (copy) => { copy.baseCompleteFunctions = 102; },
    (copy) => { copy.legacyParameterBlockers = 5; },
    (copy) => { copy.parameterMigration.completeFunctions = 0; },
    (copy) => { copy.parameterMigration.completeTools = 0; },
    (copy) => { copy.parameterMigration.migratedParameterRows = 4; },
    (copy) => { copy.parameterMigration.witnesses[0].id = 'substituted'; },
    (copy) => { copy.parameterMigration.witnesses[0].parameterRows = 4; },
    (copy) => { copy.parameterMigration.witnesses[0].profileRows.nodes = 9; },
    (copy) => { copy.parameterMigration.witnesses[0].tool = 'substituted'; },
    (copy) => { delete copy.parameterMigration.witnesses; },
    (copy) => { copy.totalFunctions = 111; },
  ]) {
    const copy = structuredClone(exactInput);
    mutate(copy);
    assert.throws(
      () => formatM4124ParameterMigrationStatus(copy),
      /M4\.124 status requires the exact rejectLine migration handoff/u,
    );
  }
});
