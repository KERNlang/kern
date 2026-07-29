import assert from 'node:assert/strict';

import {
  assertDirectParameterPrefix,
  parameterMigrationRoots,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';
import { m4130ParameterMigration } from './coverage-m4-130-combined-promotion.mjs';
import { formatM4131ParameterMigrationStatus } from './coverage-status-m4-131.mjs';

const POST_MIGRATION_QUEUE = {
  completeFunctions: 0,
  completeTools: 0,
  migratedParameterRows: 0,
  witnesses: [],
};

export const M4131_PARAMETER_MIGRATION_TARGET = {
  bodyDigest: 'a4c62d180c5f7522bd6566310ed8c3991329996e1c367d9f55cfa475f3011cb7',
  exported: true,
  functionOrdinal: 20,
  id: 'examples/selfhost-validator/validator.kern#20:validate',
  name: 'validate',
  parameters: [
    ['schemaVersion', 'number'],
    ['moduleId', 'number[]'],
    ['moduleRoot', 'string[]'],
    ['moduleStatus', 'string[]'],
    ['fnModule', 'number[]'],
    ['fnName', 'string[]'],
    ['fnReturns', 'string[]'],
    ['fnAsync', 'number[]'],
    ['fnStream', 'number[]'],
    ['fnHandlers', 'number[]'],
    ['fnParams', 'string[]'],
    ['fnExport', 'number[]'],
    ['paramFn', 'number[]'],
    ['paramName', 'string[]'],
    ['paramHasChildren', 'number[]'],
    ['paramHasValue', 'number[]'],
    ['paramHasDefault', 'number[]'],
    ['paramOptional', 'number[]'],
    ['paramVariadic', 'number[]'],
    ['classModule', 'number[]'],
    ['className', 'string[]'],
    ['classExtends', 'string[]'],
    ['classExport', 'number[]'],
    ['fieldClass', 'number[]'],
    ['fieldName', 'string[]'],
    ['memberClass', 'number[]'],
    ['memberKind', 'string[]'],
    ['memberName', 'string[]'],
    ['memberAsync', 'number[]'],
    ['memberStream', 'number[]'],
    ['memberStatic', 'number[]'],
    ['memberHandlers', 'number[]'],
    ['useModule', 'number[]'],
    ['usePath', 'string[]'],
    ['useTarget', 'number[]'],
    ['useCandidate', 'string[]'],
    ['fromUse', 'number[]'],
    ['fromName', 'string[]'],
    ['fromAs', 'string[]'],
    ['fromKind', 'string[]'],
    ['fromExport', 'number[]'],
  ],
  path: 'examples/selfhost-validator/validator.kern',
  profileRows: { nodes: 202, properties: 308, values: 4_493 },
  quotedReturns: false,
  returns: 'string[]',
  tool: 'validator',
};

export function m4131ParameterMigration() {
  return structuredClone(POST_MIGRATION_QUEUE);
}

export function m4131CoverageStatus() {
  return formatM4131ParameterMigrationStatus({
    baseCompleteFunctions: 104,
    legacyParameterBlockers: 3,
    parameterMigration: m4130ParameterMigration(),
    totalFunctions: 112,
  });
}

export function assertM4131ParameterTarget(
  root,
  fact,
  target = M4131_PARAMETER_MIGRATION_TARGET,
) {
  assert.ok(root);
  assert.equal(root.props.name, target.name);
  assert.equal(root.props.params, undefined);
  assert.equal(root.props.returns, target.returns);
  assert.equal(root.props.export === 'true', target.exported);
  assert.equal(root.__quotedProps?.includes('returns') ?? false, target.quotedReturns);
  assertDirectParameterPrefix(root, target.parameters);
  assert.equal(semanticBodyDigest(root), target.bodyDigest);
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

export function assertM4131ParameterMigration(coverage) {
  const target = M4131_PARAMETER_MIGRATION_TARGET;
  assert.deepEqual(m4130ParameterMigration(), {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: target.parameters.length,
    witnesses: [{
      id: target.id,
      parameterRows: target.parameters.length,
      profileRows: target.profileRows,
      tool: target.tool,
    }],
  }, 'M4.131 must consume the exact M4.130 parameter queue');
  const root = parameterMigrationRoots([target]).get(target.path)?.[target.functionOrdinal];
  const fact = coverage.functions.find(({ id }) => id === target.id);
  assertM4131ParameterTarget(root, fact, target);
  return fact;
}
