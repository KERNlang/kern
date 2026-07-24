import assert from 'node:assert/strict';
import {
  assertDirectParameterPrefix,
  parameterMigrationRoots,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';

export const M445_PARAMETER_MIGRATION_TARGETS = [
  {
    bodyDigest: '6bb07b0387477b389d1d65d8e7e9a11669ea7574be3a5e2f4a49b547188fe026',
    functionOrdinal: 2,
    id: 'examples/capstone-checker-subset/checker-while.kern#2:checkerSafeIntText',
    name: 'checkerSafeIntText',
    parameters: [['raw', 'string']],
    path: 'examples/capstone-checker-subset/checker-while.kern',
    profileRows: { nodes: 14, properties: 20, values: 161 },
    returns: 'boolean',
  },
  {
    bodyDigest: 'f89118ca7fbca49d8abe04fb187f1cdca5484e7c9c49eaddd82a86ee079d748d',
    functionOrdinal: 1,
    id: 'examples/kern-canonicalizer/canonicalizer.kern#1:validbinaryop',
    name: 'validbinaryop',
    parameters: [['op', 'string']],
    path: 'examples/kern-canonicalizer/canonicalizer.kern',
    profileRows: { nodes: 12, properties: 15, values: 388 },
    returns: 'boolean',
  },
];

export const M445_PARAMETER_NAMES_BY_PATH = new Map();
for (const target of M445_PARAMETER_MIGRATION_TARGETS) {
  const names = M445_PARAMETER_NAMES_BY_PATH.get(target.path) ?? [];
  names.push(target.name);
  M445_PARAMETER_NAMES_BY_PATH.set(target.path, names);
}

export function assertM445ParameterTarget(root, fact, target) {
  assert.ok(root);
  assert.equal(root.props.name, target.name);
  assert.equal(root.props.params, undefined);
  assert.equal(root.props.returns, target.returns);
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

export function assertM445ParameterMigrations(receipt) {
  const rootsByPath = parameterMigrationRoots(M445_PARAMETER_MIGRATION_TARGETS);

  let migratedRows = 0;
  for (const target of M445_PARAMETER_MIGRATION_TARGETS) {
    const root = rootsByPath.get(target.path)?.[target.functionOrdinal];
    const fact = receipt.functions.find(({ id }) => id === target.id);
    assertM445ParameterTarget(root, fact, target);
    migratedRows += target.parameters.length;
  }
  assert.equal(migratedRows, 2);
}
