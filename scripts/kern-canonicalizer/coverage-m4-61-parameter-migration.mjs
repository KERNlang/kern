import assert from 'node:assert/strict';
import {
  assertDirectParameterPrefix,
  parameterMigrationRoots,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';

export const M461_PARAMETER_MIGRATION_TARGET = {
  bodyDigest: '2a5418abe4f41fc08fdf17b6822de65dfd444015884ed9f63093dbb7b1946bdf',
  exported: true,
  functionOrdinal: 19,
  id: 'examples/selfhost-validator/validator.kern#19:sortstrings',
  name: 'sortstrings',
  parameters: [['xs', 'string[]']],
  path: 'examples/selfhost-validator/validator.kern',
  profileRows: { nodes: 25, properties: 43, values: 266 },
  quotedReturns: false,
  returns: 'string[]',
};

export function assertM461ParameterTarget(root, fact, target = M461_PARAMETER_MIGRATION_TARGET) {
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

export function assertM461ParameterMigration(receipt) {
  const target = M461_PARAMETER_MIGRATION_TARGET;
  const roots = parameterMigrationRoots([target]).get(target.path);
  const fact = receipt.functions.find(({ id }) => id === target.id);
  assertM461ParameterTarget(roots[target.functionOrdinal], fact, target);
}
