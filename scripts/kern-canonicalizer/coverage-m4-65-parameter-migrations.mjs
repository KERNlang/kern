import assert from 'node:assert/strict';
import {
  assertDirectParameterPrefix,
  parameterMigrationRoots,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';

export const M465_PARAMETER_MIGRATION_TARGETS = [
  {
    bodyDigest: 'c59ee3eaea805e80363c3ce62b8ab4af3786f77fda9364f94eaa5d47d75b511b',
    exported: false,
    functionOrdinal: 1,
    id: 'examples/capstone-checker-subset/checker-while.kern#1:isSafeMagnitude',
    name: 'isSafeMagnitude',
    parameters: [['raw', 'string'], ['start', 'number']],
    path: 'examples/capstone-checker-subset/checker-while.kern',
    profileRows: { nodes: 27, properties: 39, values: 288 },
    returns: 'boolean',
  },
  {
    bodyDigest: '072e5e4f3e8d483b5f86db3eb6b041a195cac734a65e30e66ccff9d7581999ba',
    exported: false,
    functionOrdinal: 21,
    id: 'examples/capstone-checker-subset/checker.kern#22:mapCallRejectDetail',
    name: 'mapCallRejectDetail',
    parameters: [
      ['callId', 'number'], ['callStmtKind', 'string[]'], ['callMemberProp', 'string[]'],
      ['callStmt', 'number[]'], ['callFn', 'string[]'], ['callMemberObject', 'string[]'],
      ['argCall', 'number[]'], ['argOrdinal', 'number[]'], ['argKind', 'string[]'],
      ['argName', 'string[]'], ['stmtKind', 'string[]'], ['stmtFn', 'string[]'],
      ['stmtTarget', 'string[]'],
    ],
    path: 'examples/capstone-checker-subset/checker.kern',
    profileRows: { nodes: 28, properties: 42, values: 309 },
    returns: 'string',
  },
  {
    bodyDigest: '396cb0c68e779689979d21d774a27db0df5cd05588b3a3f469bc05de3a25dd87',
    exported: true,
    functionOrdinal: 10,
    id: 'examples/selfhost-validator/validator.kern#10:fnokat',
    name: 'fnokat',
    parameters: [
      ['idx', 'number'], ['fnName', 'string[]'], ['fnReturns', 'string[]'],
      ['fnAsync', 'number[]'], ['fnStream', 'number[]'], ['fnHandlers', 'number[]'],
      ['fnParams', 'string[]'], ['paramFn', 'number[]'],
    ],
    path: 'examples/selfhost-validator/validator.kern',
    profileRows: { nodes: 28, properties: 38, values: 270 },
    returns: 'boolean',
  },
  {
    bodyDigest: 'b9939d73ba23e8e52beb618584d80074a5ada3248914f12bc0fe2505d76be083',
    exported: true,
    functionOrdinal: 12,
    id: 'examples/selfhost-validator/validator.kern#12:ownexportkind',
    name: 'ownexportkind',
    parameters: [
      ['module', 'number'], ['name', 'string'], ['fnModule', 'number[]'],
      ['fnName', 'string[]'], ['fnReturns', 'string[]'], ['fnAsync', 'number[]'],
      ['fnStream', 'number[]'], ['fnHandlers', 'number[]'], ['fnParams', 'string[]'],
      ['fnExport', 'number[]'], ['paramFn', 'number[]'], ['classModule', 'number[]'],
      ['className', 'string[]'], ['classExport', 'number[]'],
    ],
    path: 'examples/selfhost-validator/validator.kern',
    profileRows: { nodes: 28, properties: 48, values: 260 },
    returns: 'string',
  },
];

export function assertM465ParameterTarget(root, fact, target) {
  assert.ok(root);
  assert.equal(root.props.name, target.name);
  assert.equal(root.props.params, undefined);
  assert.equal(root.props.returns, target.returns);
  assert.equal(root.props.export, target.exported ? 'true' : undefined);
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

export function assertM465ParameterMigrations(receipt) {
  const rootsByPath = parameterMigrationRoots(M465_PARAMETER_MIGRATION_TARGETS);
  for (const target of M465_PARAMETER_MIGRATION_TARGETS) {
    const root = rootsByPath.get(target.path)?.[target.functionOrdinal];
    const fact = receipt.functions.find(({ id }) => id === target.id);
    assertM465ParameterTarget(root, fact, target);
  }

  assert.equal(
    M465_PARAMETER_MIGRATION_TARGETS.reduce((sum, target) => sum + target.parameters.length, 0),
    37,
  );
}
