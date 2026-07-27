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
  generatedMainSha256: '7c04980d7b1de3ba6f683a138a53c4f70b4de014ab204822ab64175a67513ce2',
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
  sourceSha256: 'df856b8a6a674b0803273a65a755e64ebb13f699fed692fc7dd7db88bee8c802',
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

  assert.equal(coverage.baseCompleteFunctions, 91);
  assert.equal(coverage.functions.length, 111);
  assert.equal(
    coverage.functions.filter(({ excludedProperties }) =>
      excludedProperties.includes('fn.params')).length,
    16,
  );
  assert.equal(
    prerequisite.parameterMigration.witnesses.some(({ id }) => id === target.id),
    false,
    'M4.100 migrated comparisonOperandsOk must never re-enter a later parameter queue',
  );
  assert.equal(prerequisite.outcome, 'bounded-exhaustion');
  assert.equal(prerequisite.exhaustion?.residualFunctionCount, 15);
  assert.equal(
    prerequisite.exhaustion?.reasonAssignmentsDigest,
    'f200b876c0ed6dd9cd75cfebe1c46c3d6cf97b13e0422886bc13b0f02f46b203',
  );
  return fact;
}
