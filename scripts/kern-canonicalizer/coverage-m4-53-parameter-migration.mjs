import assert from 'node:assert/strict';
import {
  assertDirectParameterPrefix,
  parameterMigrationRoots,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';

export const M453_PARAMETER_MIGRATION_TARGET = {
  bodyDigest: '888c6809b7e88542783352ed8001d8617b72af76d3f692ad87789b3a327dec3b',
  functionOrdinal: 17,
  id: 'examples/selfhost-validator/validator.kern#17:classcyclefrom',
  name: 'classcyclefrom',
  parameters: [
    ['module', 'number'], ['name', 'string'], ['classModule', 'number[]'],
    ['className', 'string[]'], ['classExtends', 'string[]'], ['path', 'number[]'],
  ],
  path: 'examples/selfhost-validator/validator.kern',
  profileRows: { nodes: 19, properties: 31, values: 202 },
  returns: 'boolean',
};

export function assertM453ParameterTarget(root, fact, target = M453_PARAMETER_MIGRATION_TARGET) {
  assert.ok(root);
  assert.equal(root.props.name, target.name);
  assert.equal(root.props.params, undefined);
  assert.equal(root.props.returns, target.returns);
  assert.equal(root.props.export, 'true');
  assert.equal(root.__quotedProps?.includes('params') ?? false, false);
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

export function assertM453ParameterMigration(receipt) {
  const roots = parameterMigrationRoots([M453_PARAMETER_MIGRATION_TARGET])
    .get(M453_PARAMETER_MIGRATION_TARGET.path);
  const fact = receipt.functions.find(({ id }) => id === M453_PARAMETER_MIGRATION_TARGET.id);
  assertM453ParameterTarget(roots[M453_PARAMETER_MIGRATION_TARGET.functionOrdinal], fact);
}
