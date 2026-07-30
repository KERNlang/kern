import assert from 'node:assert/strict';

import {
  assertM4146CombinedPromotion,
  m4146ParameterMigration,
} from './coverage-m4-146-combined-promotion.mjs';
import {
  formatM4147ParameterMigrationStatus,
} from './coverage-status-m4-147.mjs';
import {
  assertDirectParameterPrefix,
  parameterMigrationRoots,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';
import {
  EXPRESSIONSOURCES_PARAMETER_TARGET_M4147,
} from './expressionsources-parameter-target.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

const EMPTY_QUEUE = {
  completeFunctions: 0,
  completeTools: 0,
  migratedParameterRows: 0,
  witnesses: [],
};
const RESIDUAL_IDS = [
  'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource',
];

export function m4147ParameterMigration() {
  return structuredClone(EMPTY_QUEUE);
}

export function assertM4147ParameterTarget(
  root,
  fact,
  target = EXPRESSIONSOURCES_PARAMETER_TARGET_M4147,
) {
  assert.ok(root);
  assert.deepEqual(Reflect.ownKeys(root.props).toSorted(), ['export', 'name', 'returns']);
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

export function assertM4147ParameterMigration(coverage) {
  const policy = loadCanonicalizerPolicy();
  assertM4146CombinedPromotion(policy);
  const target = EXPRESSIONSOURCES_PARAMETER_TARGET_M4147;
  assert.deepEqual(m4146ParameterMigration(), {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: target.parameters.length,
    witnesses: [{
      id: target.id,
      parameterRows: target.parameters.length,
      profileRows: target.profileRows,
      tool: target.tool,
    }],
  }, 'M4.147 must consume the exact M4.146 parameter queue');
  const root = parameterMigrationRoots([target]).get(target.path)?.[target.functionOrdinal];
  const fact = coverage.functions.find(({ id }) => id === target.id);
  assertM4147ParameterTarget(root, fact, target);
  assert.equal(coverage.baseCompleteFunctions, 111);
  assert.equal(coverage.functions.length, 112);
  const residualIds = coverage.functions
    .filter(({ excludedProperties }) => excludedProperties.includes('fn.params'))
    .map(({ id }) => id)
    .toSorted();
  assert.deepEqual(residualIds, RESIDUAL_IDS);
  return formatM4147ParameterMigrationStatus({
    baseCompleteFunctions: coverage.baseCompleteFunctions,
    legacyParameterBlockers: residualIds.length,
    parameterMigration: m4146ParameterMigration(),
    postMigrationQueue: m4147ParameterMigration(),
    totalFunctions: coverage.functions.length,
  });
}
