import assert from 'node:assert/strict';
import {
  assertDirectParameterPrefix,
  parameterMigrationRoots,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';

export const M473_PARAMETER_MIGRATION_TARGET = {
  bodyDigest: '477cf24c525529da58576d47f0fc00a7d4439ff5653193460f65efea57929b53',
  exported: true,
  functionOrdinal: 1,
  id: 'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#1:validstatementlist',
  name: 'validstatementlist',
  parameters: [
    ['parent', 'number'],
    ['returnType', 'string'],
    ['nodeKind', 'string[]'],
    ['nodeParent', 'number[]'],
    ['nodeOrder', 'number[]'],
    ['propNode', 'number[]'],
    ['propKey', 'string[]'],
    ['propValue', 'number[]'],
    ['valueTag', 'string[]'],
    ['valueParent', 'number[]'],
    ['valueRole', 'string[]'],
    ['valueOrder', 'number[]'],
    ['valueText', 'string[]'],
    ['valueBool', 'number[]'],
  ],
  path: 'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern',
  profileRows: { nodes: 31, properties: 53, values: 370 },
  quotedReturns: false,
  returns: 'boolean',
};

export function assertM473ParameterTarget(
  root,
  fact,
  target = M473_PARAMETER_MIGRATION_TARGET,
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

export function assertM473ParameterMigration(receipt) {
  const target = M473_PARAMETER_MIGRATION_TARGET;
  const roots = parameterMigrationRoots([target]).get(target.path);
  const fact = receipt.functions.find(({ id }) => id === target.id);
  assertM473ParameterTarget(roots[target.functionOrdinal], fact, target);
}
