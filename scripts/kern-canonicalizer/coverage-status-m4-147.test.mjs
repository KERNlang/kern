import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatM4147ParameterMigrationStatus,
} from './coverage-status-m4-147.mjs';

const INPUT = {
  baseCompleteFunctions: 111,
  legacyParameterBlockers: 1,
  parameterMigration: {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 6,
    witnesses: [{
      id: 'examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources',
      parameterRows: 6,
      profileRows: { nodes: 205, properties: 332, values: 6_304 },
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

test('M4.147 status reports exact queue consumption and M4.148 handoff', () => {
  assert.equal(
    formatM4147ParameterMigrationStatus(INPUT),
    'M4.147 consumes the exact M4.146 1-function/6-row expressionsources queue and ' +
      'advances the cumulative base to 111/112 with 1 legacy-parameter blocker and an ' +
      'empty parameter queue; M4.148 remeasures the bounded quotesource residual frontier.',
  );
});

test('M4.147 status rejects migration or frontier drift and decorated data', () => {
  for (const mutate of [
    (copy) => { copy.baseCompleteFunctions -= 1; },
    (copy) => { copy.legacyParameterBlockers += 1; },
    (copy) => { copy.parameterMigration.migratedParameterRows -= 1; },
    (copy) => { copy.parameterMigration.witnesses[0].profileRows.values -= 1; },
    (copy) => { copy.postMigrationQueue.completeFunctions = 1; },
    (copy) => { copy.totalFunctions += 1; },
    (copy) => { Object.defineProperty(copy.parameterMigration, 'future', { value: true }); },
  ]) {
    const drifted = structuredClone(INPUT);
    mutate(drifted);
    assert.throws(
      () => formatM4147ParameterMigrationStatus(drifted),
      /M4\.147 status requires/u,
    );
  }
});
