import assert from 'node:assert/strict';

import {
  assertDirectParameterPrefix,
  parameterMigrationRoots,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';
import { m490ParameterMigration } from './coverage-m4-90-dual-row-promotion.mjs';

const POST_MIGRATION_QUEUE = {
  completeFunctions: 0,
  completeTools: 0,
  migratedParameterRows: 0,
  witnesses: [],
};

export const M491_PARAMETER_MIGRATION_TARGETS = [
  {
    bodyDigest: '4c6edccfacd31bff7de4c8d807248989d43e59d0305ffc65dcfc3a5ce91e3aea',
    exported: false,
    functionOrdinal: 17,
    id: 'examples/capstone-checker-subset/checker.kern#18:indexRejectDetail',
    name: 'indexRejectDetail',
    parameters: [
      ['fnName', 'string'],
      ['indexKind', 'string'],
      ['indexName', 'string'],
      ['stmtKind', 'string[]'],
      ['stmtFn', 'string[]'],
      ['stmtName', 'string[]'],
      ['stmtTarget', 'string[]'],
      ['callName', 'string[]'],
      ['callFn', 'string[]'],
      ['argCall', 'number[]'],
      ['argOrdinal', 'number[]'],
      ['argKind', 'string[]'],
      ['argName', 'string[]'],
      ['argNum', 'string[]'],
      ['argOp', 'string[]'],
      ['argLeftKind', 'string[]'],
      ['argLeftName', 'string[]'],
      ['argLeftNum', 'string[]'],
      ['argRightKind', 'string[]'],
      ['argRightName', 'string[]'],
      ['argRightNum', 'string[]'],
      ['paramFn', 'string[]'],
      ['paramName', 'string[]'],
      ['paramOrdinal', 'number[]'],
    ],
    path: 'examples/capstone-checker-subset/checker.kern',
    profileRows: { nodes: 41, properties: 67, values: 404 },
    quotedReturns: false,
    returns: 'string',
    tool: 'checker',
  },
  {
    bodyDigest: 'c2fa1c369693a7dee0bce6d5d64e0a7d6c3fee56e3163a05feae36e18d722d75',
    exported: false,
    functionOrdinal: 22,
    id: 'examples/capstone-checker-subset/checker.kern#23:callRejectCode',
    name: 'callRejectCode',
    parameters: [
      ['callId', 'number'],
      ['callName', 'string[]'],
      ['callStmtKind', 'string[]'],
      ['callMemberObject', 'string[]'],
      ['callMemberProp', 'string[]'],
      ['stmtKind', 'string[]'],
      ['stmtName', 'string[]'],
      ['stmtTarget', 'string[]'],
      ['callStmt', 'number[]'],
      ['callFn', 'string[]'],
      ['argCall', 'number[]'],
      ['argOrdinal', 'number[]'],
      ['argKind', 'string[]'],
      ['argName', 'string[]'],
      ['stmtFn', 'string[]'],
    ],
    path: 'examples/capstone-checker-subset/checker.kern',
    profileRows: { nodes: 47, properties: 64, values: 478 },
    quotedReturns: false,
    returns: 'string',
    tool: 'checker',
  },
  {
    bodyDigest: 'bf84b072a57127293b581d0bcc1901d7147f7e19dd2712596fb6059c367c4861',
    exported: true,
    functionOrdinal: 2,
    id: 'examples/kern-canonicalizer/canonicalizer.kern#2:exprsource',
    name: 'exprsource',
    parameters: [
      ['id', 'number'],
      ['valueTag', 'string[]'],
      ['valueParent', 'number[]'],
      ['valueRole', 'string[]'],
      ['valueOrder', 'number[]'],
      ['valueText', 'string[]'],
      ['valueBool', 'number[]'],
    ],
    path: 'examples/kern-canonicalizer/canonicalizer.kern',
    profileRows: { nodes: 13, properties: 23, values: 175 },
    quotedReturns: false,
    returns: 'string',
    tool: 'canonicalizer',
  },
  {
    bodyDigest: 'e473be1c4b6b70b8aec33c1a893a6839092024d29d4182f45f94b7e00c07e39a',
    exported: true,
    functionOrdinal: 2,
    id: 'examples/selfhost-validator/validator.kern#2:isreserved',
    name: 'isreserved',
    parameters: [['name', 'string']],
    path: 'examples/selfhost-validator/validator.kern',
    profileRows: { nodes: 74, properties: 77, values: 572 },
    quotedReturns: false,
    returns: 'boolean',
    tool: 'validator',
  },
];

export function assertM491ParameterTarget(root, fact, target) {
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

export function m491ParameterMigration() {
  return structuredClone(POST_MIGRATION_QUEUE);
}

export function assertM491ParameterMigrations(coverage) {
  const publishedQueue = m490ParameterMigration();
  assert.deepEqual(
    publishedQueue,
    {
      completeFunctions: M491_PARAMETER_MIGRATION_TARGETS.length,
      completeTools: new Set(M491_PARAMETER_MIGRATION_TARGETS.map(({ tool }) => tool)).size,
      migratedParameterRows: M491_PARAMETER_MIGRATION_TARGETS
        .reduce((sum, { parameters }) => sum + parameters.length, 0),
      witnesses: M491_PARAMETER_MIGRATION_TARGETS.map((target) => ({
        id: target.id,
        parameterRows: target.parameters.length,
        profileRows: target.profileRows,
        tool: target.tool,
      })),
    },
    'M4.91 must consume the exact M4.90 parameter queue',
  );

  const rootsByPath = parameterMigrationRoots(M491_PARAMETER_MIGRATION_TARGETS);
  for (const target of M491_PARAMETER_MIGRATION_TARGETS) {
    const root = rootsByPath.get(target.path)?.[target.functionOrdinal];
    const fact = coverage.functions.find(({ id }) => id === target.id);
    assertM491ParameterTarget(root, fact, target);
  }
  assert.equal(coverage.baseCompleteFunctions, 88);
  assert.equal(coverage.functions.length, 109);
  assert.equal(
    coverage.functions.filter(({ excludedProperties }) =>
      excludedProperties.includes('fn.params')).length,
    18,
  );
  return coverage;
}
