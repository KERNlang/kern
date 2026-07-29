import assert from 'node:assert/strict';

import {
  assertDirectParameterPrefix,
  parameterMigrationRoots,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';
import { m4118ParameterMigration } from './coverage-m4-118-triple-row-promotion.mjs';

const POST_MIGRATION_QUEUE = {
  completeFunctions: 0,
  completeTools: 0,
  migratedParameterRows: 0,
  witnesses: [],
};

export const M4119_PARAMETER_MIGRATION_TARGET = {
  bodyDigest: '175eff26d52cefeebe38af0a57b9c7b1fdce649c8e46c4c48e36ee2dbb983644',
  exported: true,
  functionOrdinal: 23,
  id: 'examples/capstone-checker-subset/checker.kern#24:checkModule',
  name: 'checkModule',
  parameters: [
    ['path', 'string'],
    ['stmtKind', 'string[]'], ['stmtFn', 'string[]'], ['stmtParent', 'number[]'],
    ['stmtLine', 'number[]'], ['stmtCol', 'number[]'], ['stmtName', 'string[]'],
    ['stmtTarget', 'string[]'], ['stmtValue', 'string[]'], ['stmtTemplate', 'string[]'],
    ['stmtExprKind', 'string[]'], ['stmtExprName', 'string[]'],
    ['stmtExprLeftKind', 'string[]'], ['stmtExprLeftName', 'string[]'],
    ['stmtExprLeftNum', 'string[]'], ['stmtExprLeftMemberObject', 'string[]'],
    ['stmtExprLeftMemberProp', 'string[]'], ['stmtExprRightKind', 'string[]'],
    ['stmtExprRightName', 'string[]'], ['stmtExprRightNum', 'string[]'],
    ['stmtExprRightMemberObject', 'string[]'], ['stmtExprRightMemberProp', 'string[]'],
    ['stmtExprNum', 'string[]'], ['stmtExprCall', 'string[]'],
    ['stmtExprMemberObject', 'string[]'], ['stmtExprMemberProp', 'string[]'],
    ['stmtExprArgCount', 'number[]'], ['idxStmt', 'number[]'], ['idxFn', 'string[]'],
    ['idxLine', 'number[]'], ['idxCol', 'number[]'], ['idxIndexKind', 'string[]'],
    ['idxIndexName', 'string[]'], ['callStmt', 'number[]'], ['callFn', 'string[]'],
    ['callStmtKind', 'string[]'], ['callLine', 'number[]'], ['callCol', 'number[]'],
    ['callName', 'string[]'], ['callMemberObject', 'string[]'],
    ['callMemberProp', 'string[]'], ['callArgCount', 'number[]'],
    ['argCall', 'number[]'], ['argOrdinal', 'number[]'], ['argKind', 'string[]'],
    ['argName', 'string[]'], ['argNum', 'string[]'], ['argOp', 'string[]'],
    ['argLeftKind', 'string[]'], ['argLeftName', 'string[]'],
    ['argLeftNum', 'string[]'], ['argRightKind', 'string[]'],
    ['argRightName', 'string[]'], ['argRightNum', 'string[]'],
    ['paramFn', 'string[]'], ['paramName', 'string[]'], ['paramType', 'string[]'],
    ['paramOrdinal', 'number[]'],
  ],
  path: 'examples/capstone-checker-subset/checker.kern',
  profileRows: { nodes: 122, properties: 193, values: 2411 },
  quotedReturns: false,
  returns: 'string[]',
  tool: 'checker',
};

export function m4119ParameterMigration() {
  return structuredClone(POST_MIGRATION_QUEUE);
}

export function assertM4119ParameterTarget(root, fact, target = M4119_PARAMETER_MIGRATION_TARGET) {
  assert.ok(root);
  assert.equal(root.props.name, target.name);
  assert.equal(root.props.params, undefined);
  assert.equal(root.props.returns, target.returns);
  assert.equal(root.props.export === 'true', target.exported);
  assert.equal(root.__quotedProps?.includes('returns') ?? false, target.quotedReturns);
  assertDirectParameterPrefix(root, target.parameters);
  assert.equal(semanticBodyDigest(root), target.bodyDigest);
  assert.ok(fact);
  assert.equal(fact.id, target.id);
  assert.deepEqual(fact.excludedProperties, []);
  assert.equal(fact.firstUnsupported, null);
  assert.deepEqual(fact.profileBlockers, []);
  assert.deepEqual(fact.profileRows, target.profileRows);
  assert.equal(
    fact.nodeOccurrences.filter((kind) => kind === 'param').length,
    target.parameters.length,
  );
  return fact;
}

export function assertM4119ParameterMigration(coverage) {
  const target = M4119_PARAMETER_MIGRATION_TARGET;
  assert.deepEqual(m4118ParameterMigration(), {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: target.parameters.length,
    witnesses: [{
      id: target.id,
      parameterRows: target.parameters.length,
      profileRows: target.profileRows,
      tool: target.tool,
    }],
  }, 'M4.119 must consume the exact M4.118 parameter queue');
  const root = parameterMigrationRoots([target]).get(target.path)?.[target.functionOrdinal];
  const fact = coverage.functions.find(({ id }) => id === target.id);
  assertM4119ParameterTarget(root, fact, target);
  return fact;
}
