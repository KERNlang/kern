import assert from 'node:assert/strict';

import { assertM4150QuotesourceImplementation } from './coverage-m4-150-central.mjs';
import { measureM4150FrontierForM4151 } from './coverage-m4-151-input.mjs';
import { formatM4151QuotesourceParameterStatus } from './coverage-status-m4-151.mjs';
import {
  assertDirectParameterPrefix,
  parameterMigrationRoots,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';
import {
  QUOTESOURCE_PARAMETER_TARGET_M4151,
} from './quotesource-parameter-m4-151-target.mjs';

const EMPTY_QUEUE = {
  completeFunctions: 0,
  completeTools: 0,
  migratedParameterRows: 0,
  witnesses: [],
};

export function assertM4151QuotesourceParameterTarget(
  root,
  fact,
  target = QUOTESOURCE_PARAMETER_TARGET_M4151,
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

export function assertM4151QuotesourceParameterMigration(coverage, prerequisite) {
  const predecessor = measureM4150FrontierForM4151();
  assertM4150QuotesourceImplementation(predecessor.coverage, predecessor.prerequisite);
  const target = QUOTESOURCE_PARAMETER_TARGET_M4151;
  const root = parameterMigrationRoots([target]).get(target.path)?.[target.functionOrdinal];
  const fact = coverage.functions.find(({ id }) => id === target.id);
  assertM4151QuotesourceParameterTarget(root, fact, target);
  assert.equal(coverage.baseCompleteFunctions, 112);
  assert.equal(coverage.functions.length, 112);
  assert.deepEqual(
    coverage.functions.filter(({ excludedProperties }) => excludedProperties.length > 0),
    [],
  );
  assert.equal(prerequisite.format, 'kern.kir-canonicalizer.prerequisite-summary.4');
  assert.equal(prerequisite.outcome, 'complete');
  assert.equal(prerequisite.baseline.legacyParameterBlockers, 0);
  assert.equal(prerequisite.baseline.baseCompleteFunctions, prerequisite.baseline.functionCount);
  assert.deepEqual(prerequisite.parameterMigration, EMPTY_QUEUE);
  assert.equal(prerequisite.exhaustion, null);
  assert.equal(prerequisite.minimumFamilyCount, null);
  assert.equal(prerequisite.selectedPrerequisite, null);
  assert.deepEqual(prerequisite.prerequisiteRanking, []);
  assert.deepEqual(prerequisite.ranking, []);
  return formatM4151QuotesourceParameterStatus({
    baseCompleteFunctions: coverage.baseCompleteFunctions,
    functionCount: coverage.functions.length,
    legacyParameterBlockers: prerequisite.baseline.legacyParameterBlockers,
    parameterMigration: prerequisite.parameterMigration,
    target,
  });
}
