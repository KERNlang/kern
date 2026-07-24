import assert from 'node:assert/strict';
import {
  assertDirectParameterPrefix,
  parameterMigrationRoots,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';

export const M449_PARAMETER_MIGRATION_TARGETS = [
  {
    bodyDigest: '39c146c913925457ec457895f4c52e8a7c3138ccbc26aa4fc281018f77080bfa',
    functionOrdinal: 11,
    id: 'examples/capstone-checker-subset/checker.kern#12:isIndexRebound',
    name: 'isIndexRebound',
    parameters: [
      ['fnName', 'string'], ['binding', 'string'], ['stmtKind', 'string[]'],
      ['stmtFn', 'string[]'], ['stmtName', 'string[]'], ['stmtTarget', 'string[]'],
    ],
    path: 'examples/capstone-checker-subset/checker.kern',
    profileRows: { nodes: 17, properties: 26, values: 152 },
    returns: 'boolean',
  },
  {
    bodyDigest: 'f7881f6af604243aa53372ad92012fece7eada5ff720715036a0008145523fef',
    functionOrdinal: 8,
    id: 'examples/capstone-checker-subset/checker.kern#9:isUserCallable',
    name: 'isUserCallable',
    parameters: [
      ['name', 'string'], ['stmtKind', 'string[]'], ['stmtName', 'string[]'],
      ['stmtTarget', 'string[]'],
    ],
    path: 'examples/capstone-checker-subset/checker.kern',
    profileRows: { nodes: 19, properties: 26, values: 185 },
    returns: 'boolean',
  },
  {
    bodyDigest: '5b9f89a40af34a1e9100162ccfe2ccffb95f460a5ce5b22c0b840cbea9e04e8b',
    functionOrdinal: 4,
    id: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#4:validinteger',
    name: 'validinteger',
    parameters: [['value', 'string']],
    path: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern',
    profileRows: { nodes: 19, properties: 28, values: 290 },
    returns: 'boolean',
  },
  {
    bodyDigest: 'dc76caed49b207b6d6369ac259b51a05837b41ffa73cfb5beb83e11e634bb6f2',
    functionOrdinal: 3,
    id: 'examples/selfhost-validator/validator.kern#3:isportable',
    name: 'isportable',
    parameters: [['name', 'string']],
    path: 'examples/selfhost-validator/validator.kern',
    profileRows: { nodes: 18, properties: 24, values: 217 },
    returns: 'boolean',
  },
];

export function assertM449ParameterTarget(root, fact, target) {
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

export function assertM449ParameterMigrations(receipt) {
  const rootsByPath = parameterMigrationRoots(M449_PARAMETER_MIGRATION_TARGETS);

  let migratedRows = 0;
  for (const target of M449_PARAMETER_MIGRATION_TARGETS) {
    const root = rootsByPath.get(target.path)?.[target.functionOrdinal];
    const fact = receipt.functions.find(({ id }) => id === target.id);
    assertM449ParameterTarget(root, fact, target);
    migratedRows += target.parameters.length;
  }
  assert.equal(migratedRows, 12);
}
