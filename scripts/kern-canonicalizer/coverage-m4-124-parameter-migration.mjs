import assert from 'node:assert/strict';

import {
  assertDirectParameterPrefix,
  parameterMigrationRoots,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';
import { m4123ParameterMigration } from './coverage-m4-123-kir-depth-promotion.mjs';
import { formatM4124ParameterMigrationStatus } from './coverage-status-m4-124.mjs';

const POST_MIGRATION_QUEUE = {
  completeFunctions: 0,
  completeTools: 0,
  migratedParameterRows: 0,
  witnesses: [],
};

export const M4124_PARAMETER_MIGRATION_TARGET = {
  bodyDigest: '7b2f5559696893bce5e402958d8f4e99fe3dd82bd8ef92d4cb06878694fe1938',
  exported: true,
  functionOrdinal: 1,
  id: 'examples/capstone-checker-subset/checker.kern#2:rejectLine',
  name: 'rejectLine',
  parameters: [
    ['path', 'string'],
    ['line', 'number'],
    ['col', 'number'],
    ['code', 'string'],
    ['detail', 'string'],
  ],
  path: 'examples/capstone-checker-subset/checker.kern',
  profileRows: { nodes: 8, properties: 15, values: 106 },
  quotedReturns: false,
  returns: 'string',
  sourceSha256: '44a7ac9c556c0e876ec65c8a25ebca406c75346ab091ac70e9e8bc46fa56a614',
  tool: 'checker',
};

export function m4124ParameterMigration() {
  return structuredClone(POST_MIGRATION_QUEUE);
}

export function m4124CoverageStatus() {
  return formatM4124ParameterMigrationStatus({
    baseCompleteFunctions: 103,
    legacyParameterBlockers: 4,
    parameterMigration: m4123ParameterMigration(),
    totalFunctions: 112,
  });
}

export function assertM4124ParameterTarget(
  root,
  fact,
  target = M4124_PARAMETER_MIGRATION_TARGET,
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

export function assertM4124ParameterMigration(coverage) {
  const target = M4124_PARAMETER_MIGRATION_TARGET;
  assert.deepEqual(m4123ParameterMigration(), {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: target.parameters.length,
    witnesses: [{
      id: target.id,
      parameterRows: target.parameters.length,
      profileRows: target.profileRows,
      tool: target.tool,
    }],
  }, 'M4.124 must consume the exact M4.123 parameter queue');
  const root = parameterMigrationRoots([target]).get(target.path)?.[target.functionOrdinal];
  const fact = coverage.functions.find(({ id }) => id === target.id);
  assertM4124ParameterTarget(root, fact, target);
  return fact;
}
