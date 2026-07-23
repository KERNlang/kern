import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import {
  assertDirectParameterPrefix,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';

export const M457_PARAMETER_MIGRATION_TARGETS = [
  {
    bodyDigest: '17ef719136a9e43c6cda57dde1890f4102047c6871b408ccb13dad867bff5128',
    exported: true,
    functionOrdinal: 2,
    id: 'examples/capstone-assertion-engine/compare.kern#4:compareNode',
    name: 'compareNode',
    parameters: [
      ['pA', 'number[]'], ['kA', 'string[]'], ['xA', 'number[]'], ['tA', 'string[]'],
      ['vA', 'string[]'], ['pB', 'number[]'], ['kB', 'string[]'], ['xB', 'number[]'],
      ['tB', 'string[]'], ['vB', 'string[]'], ['idxA', 'number'], ['idxB', 'number'],
      ['path', 'string'],
    ],
    path: 'examples/capstone-assertion-engine/compare.kern',
    profileRows: { nodes: 24, properties: 39, values: 373 },
    quotedReturns: false,
    returns: 'string',
  },
  {
    bodyDigest: 'e9c15f2baaac82053f45b9c0ca95b3e637dd016314e47c268e3b2e38c185f4a8',
    exported: false,
    functionOrdinal: 14,
    id: 'examples/capstone-checker-subset/checker-while.kern#14:literalTrue',
    name: 'literalTrue',
    parameters: [
      ['operator', 'string'], ['leftKind', 'string'], ['leftName', 'string'],
      ['leftNum', 'string'], ['rightKind', 'string'], ['rightName', 'string'],
      ['rightNum', 'string'],
    ],
    path: 'examples/capstone-checker-subset/checker-while.kern',
    profileRows: { nodes: 23, properties: 33, values: 244 },
    quotedReturns: false,
    returns: 'boolean',
  },
  {
    bodyDigest: '3f163af6a8e9a0ae3af05a06101620cc17a9ab3555d9a31d63cc91d508f33726',
    exported: true,
    functionOrdinal: 17,
    id: 'examples/capstone-checker-subset/checker-while.kern#17:checkerWhileRejectDetail',
    name: 'checkerWhileRejectDetail',
    parameters: [
      ['row', 'number'], ['stmtKind', 'string[]'], ['stmtFn', 'string[]'],
      ['stmtParent', 'number[]'], ['stmtName', 'string[]'], ['stmtTarget', 'string[]'],
      ['stmtExprKind', 'string[]'], ['stmtExprName', 'string[]'], ['stmtExprNum', 'string[]'],
      ['stmtExprLeftKind', 'string[]'], ['stmtExprLeftName', 'string[]'],
      ['stmtExprLeftNum', 'string[]'], ['stmtExprLeftMemberObject', 'string[]'],
      ['stmtExprLeftMemberProp', 'string[]'], ['stmtExprRightKind', 'string[]'],
      ['stmtExprRightName', 'string[]'], ['stmtExprRightNum', 'string[]'],
      ['stmtExprRightMemberObject', 'string[]'], ['stmtExprRightMemberProp', 'string[]'],
      ['paramFn', 'string[]'], ['paramName', 'string[]'], ['paramType', 'string[]'],
    ],
    path: 'examples/capstone-checker-subset/checker-while.kern',
    profileRows: { nodes: 25, properties: 49, values: 189 },
    quotedReturns: false,
    returns: 'string',
  },
  {
    bodyDigest: '32c34af066a6b35da6252ca3bde176e095a319a8b5d52166983e025535716eb2',
    exported: false,
    functionOrdinal: 13,
    id: 'examples/capstone-checker-subset/checker.kern#14:termProvenanced',
    name: 'termProvenanced',
    parameters: [
      ['fnName', 'string'], ['kind', 'string'], ['name', 'string'], ['num', 'string'],
      ['stmtKind', 'string[]'], ['stmtFn', 'string[]'], ['stmtName', 'string[]'],
      ['stmtTarget', 'string[]'], ['paramFn', 'string[]'], ['paramName', 'string[]'],
      ['paramOrdinal', 'number[]'],
    ],
    path: 'examples/capstone-checker-subset/checker.kern',
    profileRows: { nodes: 24, properties: 36, values: 237 },
    quotedReturns: false,
    returns: 'boolean',
  },
  {
    bodyDigest: '557c47e6043b1fc2e4e1db4b5daac94e3c2e4e9b1d01343502ed062d7673ef67',
    exported: false,
    functionOrdinal: 5,
    id: 'examples/capstone-checker-subset/checker.kern#6:whileRejectDetail',
    name: 'whileRejectDetail',
    parameters: [
      ['row', 'number'], ['stmtKind', 'string[]'], ['stmtFn', 'string[]'],
      ['stmtParent', 'number[]'], ['stmtName', 'string[]'], ['stmtTarget', 'string[]'],
      ['stmtExprKind', 'string[]'], ['stmtExprName', 'string[]'], ['stmtExprNum', 'string[]'],
      ['stmtExprLeftKind', 'string[]'], ['stmtExprLeftName', 'string[]'],
      ['stmtExprLeftNum', 'string[]'], ['stmtExprLeftMemberObject', 'string[]'],
      ['stmtExprLeftMemberProp', 'string[]'], ['stmtExprRightKind', 'string[]'],
      ['stmtExprRightName', 'string[]'], ['stmtExprRightNum', 'string[]'],
      ['stmtExprRightMemberObject', 'string[]'], ['stmtExprRightMemberProp', 'string[]'],
      ['paramFn', 'string[]'], ['paramName', 'string[]'], ['paramType', 'string[]'],
    ],
    path: 'examples/capstone-checker-subset/checker.kern',
    profileRows: { nodes: 25, properties: 48, values: 188 },
    quotedReturns: false,
    returns: 'string',
  },
  {
    bodyDigest: '8d9b989c16ac8ff08da1e7bd924a12fc96c7a87659054c93f6f3aada9298447a',
    exported: true,
    functionOrdinal: 3,
    id: 'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#3:emitstatementlist',
    name: 'emitstatementlist',
    parameters: [
      ['parent', 'number'], ['level', 'number'], ['returnType', 'string'],
      ['nodeKind', 'string[]'], ['nodeParent', 'number[]'], ['nodeOrder', 'number[]'],
      ['propNode', 'number[]'], ['propKey', 'string[]'], ['propValue', 'number[]'],
      ['valueTag', 'string[]'], ['valueParent', 'number[]'], ['valueRole', 'string[]'],
      ['valueOrder', 'number[]'], ['valueText', 'string[]'], ['valueBool', 'number[]'],
    ],
    path: 'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern',
    profileRows: { nodes: 25, properties: 50, values: 235 },
    quotedReturns: true,
    returns: 'string[]',
  },
  {
    bodyDigest: '06f454cb54bc227a0c2e80fe74ae8bbf285c6bba30bfbd9106eedfeb147faf4c',
    exported: true,
    functionOrdinal: 11,
    id: 'examples/selfhost-validator/validator.kern#11:owncallable',
    name: 'owncallable',
    parameters: [
      ['module', 'number'], ['name', 'string'], ['fnModule', 'number[]'],
      ['fnName', 'string[]'], ['fnReturns', 'string[]'], ['fnAsync', 'number[]'],
      ['fnStream', 'number[]'], ['fnHandlers', 'number[]'], ['fnParams', 'string[]'],
      ['paramFn', 'number[]'], ['classModule', 'number[]'], ['className', 'string[]'],
    ],
    path: 'examples/selfhost-validator/validator.kern',
    profileRows: { nodes: 24, properties: 42, values: 212 },
    quotedReturns: false,
    returns: 'boolean',
  },
];

const FILE_CONTRACTS = new Map([
  ['examples/capstone-assertion-engine/compare.kern', {
    lines: 126,
    remainingLegacy: ['compareList', 'compareMap'],
    roots: 4,
    sha256: '1bbcff9ce986ec644d22bfe0a6b358c124ba078a43f9b17fdce4d79ff15cde7e',
  }],
  ['examples/capstone-checker-subset/checker-while.kern', {
    lines: 301,
    remainingLegacy: [
      'isSafeMagnitude', 'numericBindingProven', 'lengthReceiverProven',
      'comparisonOperandsOk', 'checkWhileCore',
    ],
    roots: 18,
    sha256: '424a5a3fc76a149efd6ba4ae8358dc025e06bed6873d466ba42d4fba19e8c46b',
  }],
  ['examples/capstone-checker-subset/checker.kern', {
    lines: 434,
    remainingLegacy: [
      'rejectLine', 'isSurfaceKind', 'argProvenanced', 'paramCallsitesOk',
      'indexRejectDetail', 'mapKeyToken', 'mapKnownBefore', 'mapCallRejectDetail',
      'callRejectCode', 'checkModule',
    ],
    roots: 24,
    sha256: '61453a2f2aec5de05973bf0c6a0c9e84e9f00d7d501a80993ea02f57a518fd2d',
  }],
  ['examples/kern-canonicalizer/canonicalizer-statement-helpers.kern', {
    lines: 182,
    remainingLegacy: ['validstatementlist', 'validstatement', 'emitstatement'],
    roots: 5,
    sha256: 'adfa0c49cee230106ba7cff2249a0306f98aefc009d7e2581a3ffc622f6e9ff7',
  }],
  ['examples/selfhost-validator/validator.kern', {
    lines: 513,
    remainingLegacy: [
      'isreserved', 'fnokat', 'ownexportkind', 'exportkind', 'sortstrings', 'validate',
    ],
    roots: 21,
    sha256: 'b8f2e779ced7577804686ac953cf555fffbc271b974bb29d64310245aa6270e2',
  }],
]);

const GENERATED_ARTIFACT_CONTRACTS = new Map([
  ['examples/capstone-assertion-engine/main.kern',
    'a9df3dca6aa1eb6aa705446e4bb37ee7934ce507fb059e791ca42ed624cc9a03'],
  ['examples/capstone-checker-subset/main.kern',
    'efebd94b0fc27368eb9f69ae60491d11d6dc0540937a430f4abdf96db45620bb'],
  ['examples/capstone-checker-subset/numeric-main.kern',
    '4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a'],
  ['examples/kern-canonicalizer/canonicalizer.composed.kern',
    '94ed7ac5d33f30d776f4171ee60d3c50fcf703fad97cf3734e629f9974007f56'],
  ['examples/kern-canonicalizer/canonicalizer.kern',
    'a04ae8f9af4f61c1560889277247963572de6a1c32c2f2cf63e4c341525b7019'],
  ['examples/selfhost-validator/main.kern',
    '9ac7774a50ad9bcb7852340baf6844f130066f7eb004aa3b56e1974ce2a469b7'],
  ['scripts/kern-canonicalizer/composition.json',
    'cab6c1e38591e0a75cf717691c9d7247b623ddc849bc65bdf021cdcd3b914995'],
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertM457ParameterTarget(root, fact, target) {
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

export function assertM457ParameterMigrations(receipt) {
  const rootsByPath = new Map();
  for (const [path, contract] of FILE_CONTRACTS) {
    const sourceBytes = readFileSync(new URL(`../../${path}`, import.meta.url));
    const source = sourceBytes.toString('utf8');
    const document = parseDocumentWithDiagnostics(source);
    assert.deepEqual(document.diagnostics, []);
    assert.equal(sha256(sourceBytes), contract.sha256);
    assert.equal(source.split('\n').length - 1, contract.lines);
    const roots = document.root.children.filter(({ type }) => type === 'fn');
    assert.equal(roots.length, contract.roots);
    assert.deepEqual(
      roots.filter(({ props }) => typeof props.params === 'string').map(({ props }) => props.name),
      contract.remainingLegacy,
    );
    rootsByPath.set(path, roots);
  }

  let migratedRows = 0;
  for (const target of M457_PARAMETER_MIGRATION_TARGETS) {
    const root = rootsByPath.get(target.path)?.[target.functionOrdinal];
    const fact = receipt.functions.find(({ id }) => id === target.id);
    assertM457ParameterTarget(root, fact, target);
    migratedRows += target.parameters.length;
  }
  assert.equal(migratedRows, 102);

  for (const [path, digest] of GENERATED_ARTIFACT_CONTRACTS) {
    assert.equal(sha256(readFileSync(new URL(`../../${path}`, import.meta.url))), digest);
  }
}
