import assert from 'node:assert/strict';
import {
  assertDirectParameterPrefix,
  parameterMigrationRoots,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';

export const M477_PARAMETER_MIGRATION_TARGET = {
  bodyDigest: '5284b5dc166f0bdd4ad020615e2ad8e6077689dfb316a4fe00fd5a202e4882dc',
  exported: true,
  functionOrdinal: 0,
  id: 'examples/kern-canonicalizer/canonicalizer.kern#0:typesource',
  name: 'typesource',
  parameters: [
    ['id', 'number'],
    ['allowVoid', 'boolean'],
    ['valueTag', 'string[]'],
    ['valueParent', 'number[]'],
    ['valueRole', 'string[]'],
    ['valueText', 'string[]'],
  ],
  path: 'examples/kern-canonicalizer/canonicalizer.kern',
  profileRows: { nodes: 38, properties: 51, values: 455 },
  quotedReturns: false,
  returns: 'string',
};

export function assertM477ParameterTarget(
  root,
  fact,
  target = M477_PARAMETER_MIGRATION_TARGET,
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

export function assertM477ParameterMigration(receipt) {
  const target = M477_PARAMETER_MIGRATION_TARGET;
  const roots = parameterMigrationRoots([target]).get(target.path);
  const fact = receipt.functions.find(({ id }) => id === target.id);
  assertM477ParameterTarget(roots[target.functionOrdinal], fact, target);
}
