import assert from 'node:assert/strict';
import {
  assertDirectParameterPrefix,
  parameterMigrationRoots,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';

export const M469_PARAMETER_MIGRATION_TARGET = {
  bodyDigest: '991be5df8acc62f68778b8c74efe2013b2d621cbe6c5423dbfdff60e28797e34',
  exported: false,
  functionOrdinal: 2,
  id: 'examples/capstone-checker-subset/checker.kern#3:isSurfaceKind',
  name: 'isSurfaceKind',
  parameters: [['kind', 'string']],
  path: 'examples/capstone-checker-subset/checker.kern',
  profileRows: { nodes: 30, properties: 32, values: 219 },
  quotedReturns: false,
  returns: 'boolean',
};

export function assertM469ParameterTarget(
  root,
  fact,
  target = M469_PARAMETER_MIGRATION_TARGET,
) {
  assert.ok(root);
  assert.equal(root.props.name, target.name);
  assert.equal(root.props.params, undefined);
  assert.equal(root.props.returns, target.returns);
  assert.equal(root.props.export, target.exported ? 'true' : undefined);
  assert.equal(root.__quotedProps?.includes('params') ?? false, false);
  assert.equal(root.__quotedProps?.includes('returns') ?? false, target.quotedReturns);
  assertDirectParameterPrefix(root, target.parameters);
  assert.equal(semanticBodyDigest(root), target.bodyDigest);

  assert.ok(fact);
  assert.equal(fact.id, target.id);
  assert.equal(fact.excludedProperties.includes('fn.params'), false);
  assert.deepEqual(fact.profileBlockers, []);
  assert.deepEqual(fact.profileRows, target.profileRows);
  assert.equal(
    fact.nodeOccurrences.filter((kind) => kind === 'param').length,
    target.parameters.length,
  );
}

export function assertM469ParameterMigration(receipt) {
  const target = M469_PARAMETER_MIGRATION_TARGET;
  const roots = parameterMigrationRoots([target]).get(target.path);
  const fact = receipt.functions.find(({ id }) => id === target.id);
  assertM469ParameterTarget(roots[target.functionOrdinal], fact, target);
}
