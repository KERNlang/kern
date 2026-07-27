import assert from 'node:assert/strict';
import {
  assertDirectParameterPrefix,
  parameterMigrationRoots,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';

export const M441_PARAMETER_MIGRATION_TARGETS = [
  {
    bodyDigest: 'f2d774aea4930784072e6908eebee5fda3120ed8d34087b30fe6168071746e5a',
    functionOrdinal: 10,
    id: 'examples/capstone-checker-subset/checker-while.kern#10:isLengthType',
    name: 'isLengthType',
    parameters: [['raw', 'string']],
    path: 'examples/capstone-checker-subset/checker-while.kern',
    profileRows: { nodes: 9, properties: 12, values: 138 },
  },
  {
    bodyDigest: '518ce1354c0dd81dc3513a9dda739d763a1c9eec32dfb14dce2bc25456d2d36b',
    functionOrdinal: 5,
    id: 'examples/capstone-checker-subset/checker-while.kern#5:checkerElseRejectDetail',
    name: 'checkerElseRejectDetail',
    parameters: [['row', 'number'], ['stmtKind', 'string[]'], ['stmtParent', 'number[]']],
    path: 'examples/capstone-checker-subset/checker-while.kern',
    profileRows: { nodes: 15, properties: 21, values: 115 },
  },
  {
    bodyDigest: 'fb0738f6be0cd1e3e24035ec993a980ab5c84cf843834cf7db1494ed613f58a8',
    functionOrdinal: 18,
    id: 'examples/capstone-checker-subset/checker.kern#19:mapArgToken',
    name: 'mapArgToken',
    parameters: [
      ['callId', 'number'], ['ordinal', 'number'], ['argCall', 'number[]'],
      ['argOrdinal', 'number[]'], ['argKind', 'string[]'], ['argName', 'string[]'],
    ],
    path: 'examples/capstone-checker-subset/checker.kern',
    profileRows: { nodes: 15, properties: 24, values: 120 },
  },
  {
    bodyDigest: '17356d484ad79ae173987d1d70b211b5dbec44ff896efe0070fb25ec85448c7b',
    functionOrdinal: 7,
    id: 'examples/capstone-checker-subset/checker.kern#8:isArrayBinding',
    name: 'isArrayBinding',
    parameters: [
      ['fnName', 'string'], ['binding', 'string'], ['stmtKind', 'string[]'],
      ['stmtFn', 'string[]'], ['stmtName', 'string[]'], ['stmtExprKind', 'string[]'],
    ],
    path: 'examples/capstone-checker-subset/checker.kern',
    profileRows: { nodes: 15, properties: 24, values: 128 },
  },
  {
    bodyDigest: 'a4056136b79bbb1c2f02a62661fffa48c4089cd7ecadf673a6f05e9e04eadd7b',
    functionOrdinal: 10,
    id: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#10:propid',
    name: 'propid',
    parameters: [
      ['node', 'number'], ['key', 'string'], ['propNode', 'number[]'],
      ['propKey', 'string[]'], ['propValue', 'number[]'],
    ],
    path: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern',
    profileRows: { nodes: 16, properties: 27, values: 150 },
  },
  {
    bodyDigest: '1c945218c6dfbd07e0f9d61273f825af79f5721e70524ae5c446c8386052824b',
    functionOrdinal: 12,
    id: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#12:childat',
    name: 'childat',
    parameters: [
      ['parent', 'number'], ['order', 'number'],
      ['nodeParent', 'number[]'], ['nodeOrder', 'number[]'],
    ],
    path: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern',
    profileRows: { nodes: 13, properties: 23, values: 122 },
  },
  {
    bodyDigest: '5654ef1a65d25108fe40e9d7ad75da4145b26518e7ff1efd5e6d2fc41effa9b1',
    functionOrdinal: 14,
    id: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#14:valuechildat',
    name: 'valuechildat',
    parameters: [
      ['parent', 'number'], ['order', 'number'],
      ['valueParent', 'number[]'], ['valueOrder', 'number[]'],
    ],
    path: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern',
    profileRows: { nodes: 13, properties: 23, values: 122 },
  },
  {
    bodyDigest: 'f3fef1b32ff6e84c2b6a8ad32f92489332f09025df2852ea768f598ba4aa181d',
    functionOrdinal: 15,
    id: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#15:recordfield',
    name: 'recordfield',
    parameters: [
      ['parent', 'number'], ['key', 'string'],
      ['valueParent', 'number[]'], ['valueRole', 'string[]'],
    ],
    path: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern',
    profileRows: { nodes: 14, properties: 25, values: 135 },
  },
  {
    bodyDigest: '39fc483a003816cd3fe22b30f4f77570fd84acfe285c3045b24a0d29e797b83e',
    functionOrdinal: 2,
    id: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#2:valididentifier',
    name: 'valididentifier',
    parameters: [['value', 'string']],
    path: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern',
    profileRows: { nodes: 10, properties: 16, values: 148 },
  },
  {
    bodyDigest: '141fe36995d9130748005c8e6e003c6ee480371704a8555dd81f17525edf154c',
    functionOrdinal: 3,
    id: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#3:validexpressionidentifier',
    name: 'validexpressionidentifier',
    parameters: [['value', 'string']],
    path: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern',
    profileRows: { nodes: 8, properties: 11, values: 149 },
  },
  {
    bodyDigest: '65aaa36a54a3f7f70b7b9ffa5edda8e3e67d16570bef2b6fd62eeeba8cf46398',
    functionOrdinal: 18,
    id: 'examples/selfhost-validator/validator.kern#18:hasimportcyclefrom',
    name: 'hasimportcyclefrom',
    parameters: [
      ['module', 'number'], ['useModule', 'number[]'],
      ['useTarget', 'number[]'], ['path', 'number[]'],
    ],
    path: 'examples/selfhost-validator/validator.kern',
    profileRows: { nodes: 15, properties: 24, values: 154 },
  },
];

export const M441_PARAMETER_NAMES_BY_PATH = new Map();
for (const target of M441_PARAMETER_MIGRATION_TARGETS) {
  const names = M441_PARAMETER_NAMES_BY_PATH.get(target.path) ?? [];
  names.push(target.name);
  M441_PARAMETER_NAMES_BY_PATH.set(target.path, names);
}

export function assertM441ParameterTarget(root, fact, target) {
  assert.ok(root);
  assert.equal(root.props.name, target.name);
  assert.equal(root.props.params, undefined);
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

export function assertM441ParameterMigrations(receipt) {
  const rootsByPath = parameterMigrationRoots(M441_PARAMETER_MIGRATION_TARGETS);

  let migratedRows = 0;
  for (const target of M441_PARAMETER_MIGRATION_TARGETS) {
    const root = rootsByPath.get(target.path)?.[target.functionOrdinal];
    const fact = receipt.functions.find(({ id }) => id === target.id);
    assertM441ParameterTarget(root, fact, target);
    migratedRows += target.parameters.length;
  }
  assert.equal(migratedRows, 39);
}
