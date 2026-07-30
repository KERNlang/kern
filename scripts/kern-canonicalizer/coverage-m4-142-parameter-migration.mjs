import assert from 'node:assert/strict';

import {
  CANONICALIZE_PARAMETER_TARGET_M4142,
} from './canonicalize-parameter-target.mjs';
import {
  assertPublishedM4141ExceptionFlowPromotion,
} from './coverage-m4-141-central.mjs';
import {
  m4141ParameterMigration,
} from './coverage-status-m4-141.mjs';
import {
  formatM4142ParameterMigrationStatus,
} from './coverage-status-m4-142.mjs';
import {
  assertDirectParameterPrefix,
  parameterMigrationRoots,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';

const EMPTY_QUEUE = {
  completeFunctions: 0,
  completeTools: 0,
  migratedParameterRows: 0,
  witnesses: [],
};
const RESIDUAL_IDS = [
  'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource',
  'examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources',
];

export function m4142ParameterMigration() {
  return structuredClone(EMPTY_QUEUE);
}

export function assertM4142ParameterTarget(
  root,
  fact,
  target = CANONICALIZE_PARAMETER_TARGET_M4142,
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

export function assertM4142ParameterMigration(coverage) {
  assert.equal(
    assertPublishedM4141ExceptionFlowPromotion(),
    'M4.141 promotes exception-flow through the exact M4.138 prerequisite and M4.140 ' +
      'implementation handoff; the cumulative base remains 109/112 and exposes the exact ' +
      '1-function/15-row canonicalize parameter queue; the structural-family frontier is ' +
      'exhausted and M4.142 owns queue consumption.',
  );
  const target = CANONICALIZE_PARAMETER_TARGET_M4142;
  assert.deepEqual(m4141ParameterMigration(), {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: target.parameters.length,
    witnesses: [{
      id: target.id,
      parameterRows: target.parameters.length,
      profileRows: target.profileRows,
      tool: target.tool,
    }],
  }, 'M4.142 must consume the exact M4.141 parameter queue');
  const root = parameterMigrationRoots([target]).get(target.path)?.[target.functionOrdinal];
  const fact = coverage.functions.find(({ id }) => id === target.id);
  assertM4142ParameterTarget(root, fact, target);
  assert.equal(coverage.baseCompleteFunctions, 110);
  assert.equal(coverage.functions.length, 112);
  const residualIds = coverage.functions
    .filter(({ excludedProperties }) => excludedProperties.includes('fn.params'))
    .map(({ id }) => id)
    .toSorted();
  assert.deepEqual(residualIds, RESIDUAL_IDS);
  return formatM4142ParameterMigrationStatus({
    baseCompleteFunctions: coverage.baseCompleteFunctions,
    legacyParameterBlockers: residualIds.length,
    parameterMigration: m4141ParameterMigration(),
    postMigrationQueue: m4142ParameterMigration(),
    totalFunctions: coverage.functions.length,
  });
}
