import assert from 'node:assert/strict';

import {
  assertDirectParameterPrefix,
  parameterMigrationRoots,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';
import { m499ParameterMigration } from './coverage-m4-99-dual-row-promotion.mjs';

const POST_MIGRATION_QUEUE = {
  completeFunctions: 0,
  completeTools: 0,
  migratedParameterRows: 0,
  witnesses: [],
};

export const M4100_PARAMETER_MIGRATION_TARGET = {
  bodyDigest: 'af4ecfe26afbc017a828e64531f9f5aac2022348adbbe548ae84b520898dfecf',
  exported: false,
  functionOrdinal: 15,
  generatedMainSha256: '605d24185f9351205853087afc991fdd098a5d0bc54a171cbc3b8a4c311aedfd',
  id: 'examples/capstone-checker-subset/checker-while.kern#15:comparisonOperandsOk',
  name: 'comparisonOperandsOk',
  parameters: [
    ['row', 'number'],
    ['fnName', 'string'],
    ['operator', 'string'],
    ['stmtKind', 'string[]'],
    ['stmtFn', 'string[]'],
    ['stmtParent', 'number[]'],
    ['stmtName', 'string[]'],
    ['stmtTarget', 'string[]'],
    ['stmtExprKind', 'string[]'],
    ['stmtExprName', 'string[]'],
    ['stmtExprNum', 'string[]'],
    ['stmtExprLeftKind', 'string[]'],
    ['stmtExprLeftName', 'string[]'],
    ['stmtExprLeftNum', 'string[]'],
    ['stmtExprLeftMemberObject', 'string[]'],
    ['stmtExprLeftMemberProp', 'string[]'],
    ['stmtExprRightKind', 'string[]'],
    ['stmtExprRightName', 'string[]'],
    ['stmtExprRightNum', 'string[]'],
    ['stmtExprRightMemberObject', 'string[]'],
    ['stmtExprRightMemberProp', 'string[]'],
    ['paramFn', 'string[]'],
    ['paramName', 'string[]'],
    ['paramType', 'string[]'],
  ],
  path: 'examples/capstone-checker-subset/checker-while.kern',
  profileRows: { nodes: 53, properties: 95, values: 832 },
  quotedReturns: false,
  returns: 'boolean',
  sourceSha256: '1382f193941dd1767815d7f1b0eb6482898bd7bb36fcdb6159057fc1e2c28c1d',
  tool: 'checker',
};

export function assertM4100ParameterRoot(
  root,
  target = M4100_PARAMETER_MIGRATION_TARGET,
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
  return root;
}

export function assertM4100ParameterTarget(
  root,
  fact,
  target = M4100_PARAMETER_MIGRATION_TARGET,
) {
  assertM4100ParameterRoot(root, target);
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

export function m4100ParameterMigration() {
  return structuredClone(POST_MIGRATION_QUEUE);
}

export function assertM4100ParameterMigration(coverage, prerequisite) {
  const target = M4100_PARAMETER_MIGRATION_TARGET;
  assert.deepEqual(m499ParameterMigration(), {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: target.parameters.length,
    witnesses: [{
      id: target.id,
      parameterRows: target.parameters.length,
      profileRows: target.profileRows,
      tool: target.tool,
    }],
  }, 'M4.100 must consume the exact M4.99 parameter queue');

  const root = parameterMigrationRoots([target]).get(target.path)?.[target.functionOrdinal];
  const fact = coverage.functions.find(({ id }) => id === target.id);
  assertM4100ParameterTarget(root, fact, target);

  assert.equal(
    prerequisite.parameterMigration.witnesses.some(({ id }) => id === target.id),
    false,
    'M4.100 migrated comparisonOperandsOk must never re-enter a later parameter queue',
  );
  return fact;
}
