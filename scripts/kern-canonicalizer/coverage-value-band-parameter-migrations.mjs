import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';

const TARGETS = [
  {
    bodyDigest: '4a56ddb3d9aa545e5b2aecc69989930c88b3aedfecfbfac95754796f116e99bb',
    functionOrdinal: 3,
    id: 'examples/capstone-assertion-engine/compare.kern#5:compareTrees',
    name: 'compareTrees',
    parameters: [
      ['pA', 'number[]'], ['kA', 'string[]'], ['xA', 'number[]'], ['tA', 'string[]'],
      ['vA', 'string[]'], ['pB', 'number[]'], ['kB', 'string[]'], ['xB', 'number[]'],
      ['tB', 'string[]'], ['vB', 'string[]'],
    ],
    path: 'examples/capstone-assertion-engine/compare.kern',
    profileRows: { nodes: 13, properties: 25, values: 106 },
  },
  {
    bodyDigest: '636a92969f7d0544b237fac9029437a90425a6c98d2d564263c5000221c115a1',
    functionOrdinal: 3,
    id: 'examples/capstone-checker-subset/checker-while.kern#3:previousSiblingKind',
    name: 'previousSiblingKind',
    parameters: [['row', 'number'], ['stmtKind', 'string[]'], ['stmtParent', 'number[]']],
    path: 'examples/capstone-checker-subset/checker-while.kern',
    profileRows: { nodes: 10, properties: 18, values: 77 },
  },
  {
    bodyDigest: '5193b1e06d57aaf3e177a3d4e7c43bbd5efbba8d003e4fa4e4a4031daef8cdbb',
    functionOrdinal: 7,
    id: 'examples/capstone-checker-subset/checker-while.kern#7:functionRow',
    name: 'functionRow',
    parameters: [['fnName', 'string'], ['stmtKind', 'string[]'], ['stmtName', 'string[]']],
    path: 'examples/capstone-checker-subset/checker-while.kern',
    profileRows: { nodes: 9, properties: 15, values: 85 },
  },
  {
    bodyDigest: 'ff1f566c095e212b9a32ca81445c02a89439febf8189e03e88ee568ed0c84170',
    functionOrdinal: 9,
    id: 'examples/capstone-checker-subset/checker.kern#10:isForCounter',
    name: 'isForCounter',
    parameters: [
      ['fnName', 'string'], ['binding', 'string'], ['stmtKind', 'string[]'],
      ['stmtFn', 'string[]'], ['stmtName', 'string[]'],
    ],
    path: 'examples/capstone-checker-subset/checker.kern',
    profileRows: { nodes: 13, properties: 21, values: 104 },
  },
  {
    bodyDigest: '31d3ca9532367d3ed6fa42e6c004322232e9997fd8559fd2aec23099653281f2',
    functionOrdinal: 10,
    id: 'examples/capstone-checker-subset/checker.kern#11:isAssigned',
    name: 'isAssigned',
    parameters: [
      ['fnName', 'string'], ['binding', 'string'], ['stmtKind', 'string[]'],
      ['stmtFn', 'string[]'], ['stmtTarget', 'string[]'],
    ],
    path: 'examples/capstone-checker-subset/checker.kern',
    profileRows: { nodes: 13, properties: 21, values: 104 },
  },
  {
    bodyDigest: '91938de5a861d1c787d4dfd6f1e89d4cd82989b30918386d63349d9c55a3207e',
    functionOrdinal: 12,
    id: 'examples/capstone-checker-subset/checker.kern#13:paramOrdinalOf',
    name: 'paramOrdinalOf',
    parameters: [
      ['fnName', 'string'], ['binding', 'string'], ['paramFn', 'string[]'],
      ['paramName', 'string[]'], ['paramOrdinal', 'number[]'],
    ],
    path: 'examples/capstone-checker-subset/checker.kern',
    profileRows: { nodes: 12, properties: 20, values: 96 },
  },
  {
    bodyDigest: '5d4e99743a2953ee1cdcf5899127c27748d9f87c5d5c70419ee0cb9846519e76',
    functionOrdinal: 14,
    id: 'examples/capstone-checker-subset/checker.kern#15:argIndexOf',
    name: 'argIndexOf',
    parameters: [['callId', 'number'], ['ordinal', 'number'], ['argCall', 'number[]'], ['argOrdinal', 'number[]']],
    path: 'examples/capstone-checker-subset/checker.kern',
    profileRows: { nodes: 11, properties: 18, values: 84 },
  },
  {
    bodyDigest: '89f846a970b29d981e42cb3c11b6bc4f436e5ae9e09ce3ed48a1d45b238f99f4',
    functionOrdinal: 0,
    id: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#0:validfirst',
    name: 'validfirst',
    parameters: [['c', 'string']],
    path: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern',
    profileRows: { nodes: 8, properties: 11, values: 100 },
  },
  {
    bodyDigest: 'a014ce94940e3d42f85de6bb4cee27058e286819e5deac0fd56dff7c83096047',
    functionOrdinal: 6,
    id: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#6:structuralname',
    name: 'structuralname',
    parameters: [['value', 'string']],
    path: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern',
    profileRows: { nodes: 10, properties: 16, values: 108 },
  },
  {
    bodyDigest: 'ef591ebe676adfa16adf50f0a95aeb26bc94fb95b20b9b95f435842384179f38',
    functionOrdinal: 0,
    id: 'examples/selfhost-validator/validator.kern#0:charokfirst',
    name: 'charokfirst',
    parameters: [['c', 'string']],
    path: 'examples/selfhost-validator/validator.kern',
    profileRows: { nodes: 10, properties: 13, values: 92 },
  },
  {
    bodyDigest: 'f020fd1d0231c7545b80ea4dee5974b341a4b110def1b6b70598bd96b60ee19f',
    functionOrdinal: 16,
    id: 'examples/selfhost-validator/validator.kern#16:classrow',
    name: 'classrow',
    parameters: [
      ['module', 'number'], ['name', 'string'], ['classModule', 'number[]'], ['className', 'string[]'],
    ],
    path: 'examples/selfhost-validator/validator.kern',
    profileRows: { nodes: 11, properties: 19, values: 89 },
  },
  {
    bodyDigest: '1be5c25a8b2f704e4233a3e3310fd9e46ccb7d6024d41227bb6bcd9f3fe10797',
    functionOrdinal: 8,
    id: 'examples/selfhost-validator/validator.kern#8:contained',
    name: 'contained',
    parameters: [['root', 'string'], ['candidate', 'string']],
    path: 'examples/selfhost-validator/validator.kern',
    profileRows: { nodes: 9, properties: 13, values: 73 },
  },
];

export const M433_VALUE_BAND_NAMES_BY_PATH = new Map();
for (const target of TARGETS) {
  const names = M433_VALUE_BAND_NAMES_BY_PATH.get(target.path) ?? [];
  names.push(target.name);
  M433_VALUE_BAND_NAMES_BY_PATH.set(target.path, names);
}

export function semanticBodyDigest(root) {
  const props = { ...root.props };
  delete props.params;
  const stripLocations = (value) => {
    if (Array.isArray(value)) return value.map(stripLocations);
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== 'loc')
      .map(([key, child]) => [key, stripLocations(child)]));
  };
  const body = root.children.filter(({ type }) => type !== 'param').map(stripLocations);
  return createHash('sha256').update(JSON.stringify({ body, props })).digest('hex');
}

export function assertDirectParameterPrefix(root, expectedParameters) {
  const message = 'parameter children must be the exact function prefix followed by the handler';
  assert.ok(root, message);
  assert.deepEqual(
    root.children.slice(0, expectedParameters.length).map(({ props, type }) =>
      type === 'param' ? [props.name, props.type] : [type]),
    expectedParameters,
    message,
  );
  assert.equal(root.children[expectedParameters.length]?.type, 'handler', message);
  assert.equal(
    root.children.filter(({ type }) => type === 'param').length,
    expectedParameters.length,
    message,
  );
}

export function parameterMigrationRoots(targets) {
  const rootsByPath = new Map();
  for (const path of new Set(targets.map(({ path }) => path))) {
    const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
    const document = parseDocumentWithDiagnostics(source);
    assert.deepEqual(document.diagnostics, []);
    rootsByPath.set(path, document.root.children.filter(({ type }) => type === 'fn'));
  }
  return rootsByPath;
}

export function assertValueBandParameterMigrations(receipt) {
  const rootsByPath = parameterMigrationRoots(TARGETS);

  let parameterRows = 0;
  for (const target of TARGETS) {
    const root = rootsByPath.get(target.path)?.[target.functionOrdinal];
    assert.equal(root?.props.name, target.name);
    assert.equal(root?.props.params, undefined);
    assertDirectParameterPrefix(root, target.parameters);
    assert.equal(semanticBodyDigest(root), target.bodyDigest);

    const fact = receipt.functions.find(({ id }) => id === target.id);
    assert.ok(fact);
    assert.equal(fact.excludedProperties.includes('fn.params'), false);
    assert.deepEqual(fact.profileBlockers, []);
    assert.deepEqual(fact.profileRows, target.profileRows);
    assert.equal(
      fact.nodeOccurrences.filter((kind) => kind === 'param').length,
      target.parameters.length,
    );
    parameterRows += target.parameters.length;
  }
  assert.equal(parameterRows, 44);

  const compareRoots = rootsByPath.get('examples/capstone-assertion-engine/compare.kern');
  assert.equal(compareRoots.length, 4);
  assert.equal(compareRoots.slice(0, 2).every(({ props, children }) =>
    typeof props.params === 'string' &&
    props.params.length > 0 &&
    children.every(({ type }) => type !== 'param')), true);
}
