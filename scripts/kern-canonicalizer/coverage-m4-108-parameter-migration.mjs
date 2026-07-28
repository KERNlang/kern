import assert from 'node:assert/strict';

import { parameterMigrationRoots } from './coverage-value-band-parameter-migrations.mjs';
import { m4107ParameterMigration } from './coverage-m4-107-triple-row-promotion.mjs';
import {
  assertValidstatementDirectRoot,
  VALIDSTATEMENT_DIRECT_TARGET,
} from './validstatement-target.mjs';

const POST_MIGRATION_QUEUE = {
  completeFunctions: 0,
  completeTools: 0,
  migratedParameterRows: 0,
  witnesses: [],
};

export const M4108_PARAMETER_MIGRATION_TARGET = VALIDSTATEMENT_DIRECT_TARGET;

export function assertM4108ParameterTarget(
  root,
  fact,
  target = M4108_PARAMETER_MIGRATION_TARGET,
) {
  assertValidstatementDirectRoot(root, target);
  assert.ok(fact);
  assert.equal(fact.id, target.id);
  assert.deepEqual(fact.excludedProperties, []);
  assert.equal(fact.firstUnsupported, null);
  assert.deepEqual(fact.profileBlockers, []);
  assert.deepEqual(fact.profileRows, target.profileRows);
  assert.equal(
    fact.nodeOccurrences.filter((kind) => kind === 'param').length,
    target.parameters.length,
  );
  return fact;
}

export function m4108ParameterMigration() {
  return structuredClone(POST_MIGRATION_QUEUE);
}

export function assertM4108ParameterMigration(coverage, prerequisite) {
  const target = M4108_PARAMETER_MIGRATION_TARGET;
  assert.deepEqual(m4107ParameterMigration(), {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: target.parameters.length,
    witnesses: [{
      id: target.id,
      parameterRows: target.parameters.length,
      profileRows: target.profileRows,
      tool: target.tool,
    }],
  }, 'M4.108 must consume the exact M4.107 parameter queue');

  const root = parameterMigrationRoots([target]).get(target.path)?.[target.functionOrdinal];
  const fact = coverage.functions.find(({ id }) => id === target.id);
  assertM4108ParameterTarget(root, fact, target);

  assert.equal(coverage.baseCompleteFunctions, 101);
  assert.equal(coverage.functions.length, 111);
  assert.equal(
    coverage.functions.filter(({ excludedProperties }) =>
      excludedProperties.includes('fn.params')).length,
    6,
  );
  assert.equal(
    prerequisite.parameterMigration.witnesses.some(({ id }) => id === target.id),
    false,
    'M4.108 migrated validstatement must never re-enter a later parameter queue',
  );
  assert.equal(prerequisite.outcome, 'bounded-exhaustion');
  return fact;
}
