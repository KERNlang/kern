import assert from 'node:assert/strict';
import {
  assertDirectParameterPrefix,
  parameterMigrationRoots,
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

const M4106_EMITSTATEMENTLIST_ID =
  'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#3:emitstatementlist';
const M4106_EMITSTATEMENTLIST_LIVE_FACTS = {
  bodyDigest: 'e733217b70bba3f58f904836457f1fde36febb8abfe99315de1c7b1190f7998e',
  profileRows: { nodes: 26, properties: 52, values: 260 },
};

function currentM457Target(target) {
  // The exported M4.57 queue is immutable historical evidence. M4.106 changed
  // only this function body/profile, so live-source guards bind its new facts
  // explicitly without rewriting the published queue.
  return target.id === M4106_EMITSTATEMENTLIST_ID
    ? { ...target, ...M4106_EMITSTATEMENTLIST_LIVE_FACTS }
    : target;
}

export function assertM457ParameterTarget(root, fact, target) {
  const currentTarget = currentM457Target(target);
  assert.ok(root);
  assert.equal(root.props.name, currentTarget.name);
  assert.equal(root.props.params, undefined);
  assert.equal(root.props.returns, currentTarget.returns);
  assert.equal(root.props.export, currentTarget.exported ? 'true' : undefined);
  assert.equal(root.__quotedProps?.includes('params') ?? false, false);
  assert.equal(root.__quotedProps?.includes('returns') ?? false, currentTarget.quotedReturns);
  assertDirectParameterPrefix(root, currentTarget.parameters);
  assert.equal(semanticBodyDigest(root), currentTarget.bodyDigest);

  assert.ok(fact);
  assert.equal(fact.id, currentTarget.id);
  assert.equal(fact.excludedProperties.includes('fn.params'), false);
  assert.deepEqual(fact.profileBlockers, []);
  assert.deepEqual(fact.profileRows, currentTarget.profileRows);
  assert.equal(
    fact.nodeOccurrences.filter((kind) => kind === 'param').length,
    currentTarget.parameters.length,
  );
}

export function assertM457ParameterMigrations(receipt) {
  const rootsByPath = parameterMigrationRoots(M457_PARAMETER_MIGRATION_TARGETS);

  let migratedRows = 0;
  for (const target of M457_PARAMETER_MIGRATION_TARGETS) {
    const root = rootsByPath.get(target.path)?.[target.functionOrdinal];
    const fact = receipt.functions.find(({ id }) => id === target.id);
    assertM457ParameterTarget(root, fact, target);
    migratedRows += target.parameters.length;
  }
  assert.equal(migratedRows, 102);
}
