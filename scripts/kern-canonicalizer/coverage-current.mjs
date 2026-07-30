import assert from 'node:assert/strict';

import {
  assertM4131ParameterMigration,
} from './coverage-m4-131-parameter-migration.mjs';
import {
  m4146ActiveKirLimits,
  m4146ActiveProfile,
  m4146ActiveRuntimeByteLimits,
} from './coverage-m4-146-combined-promotion.mjs';
import {
  assertM4147ParameterMigration,
  m4147ParameterMigration,
} from './coverage-m4-147-parameter-migration.mjs';
import {
  assertExactPlainData,
} from './coverage-prerequisite-shape.mjs';
import {
  validateCanonicalizerPrerequisiteSummaryStructure,
} from './coverage-prerequisite-structure.mjs';

export function currentM493ParameterMigration() {
  return {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 12,
    witnesses: [{
      id: 'examples/kern-canonicalizer/canonicalizer.kern#4:tablesok',
      parameterRows: 12,
      profileRows: { nodes: 19, properties: 33, values: 156 },
      tool: 'canonicalizer',
    }],
  };
}

export function assertCurrentCanonicalizerPolicy(policy) {
  assert.deepEqual(
    {
      maxBytes: policy.kirLimits.maxBytes,
      maxDepth: policy.kirLimits.maxDepth,
      maxNodes: policy.kirLimits.maxNodes,
    },
    m4146ActiveKirLimits(),
  );
  assert.deepEqual(policy.profileLimits, m4146ActiveProfile());
  assert.deepEqual(
    {
      maxBytes: policy.runtimeLimits.maxBytes,
      maxStringBytes: policy.runtimeLimits.maxStringBytes,
    },
    m4146ActiveRuntimeByteLimits(),
  );
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  assert.equal(policy.runtimeLimits.maxDepth, 64);
  return policy;
}

export function assertCurrentProfileLimitFixtures(fixtures) {
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  assert.deepEqual(byId.get('over-node-row-limit')?.expectedRows, {
    nodes: 206,
    properties: 206,
    values: 816,
  });
  assert.deepEqual(byId.get('over-node-row-limit')?.admittedProfileLimits, {
    maxNodeRows: 206,
    maxPropertyRows: 332,
    maxValueRows: 6304,
  });
  assert.deepEqual(byId.get('over-property-row-limit')?.expectedRows, {
    nodes: 112,
    properties: 333,
    values: 994,
  });
  assert.deepEqual(byId.get('over-property-row-limit')?.admittedProfileLimits, {
    maxNodeRows: 205,
    maxPropertyRows: 333,
    maxValueRows: 6304,
  });
  assert.deepEqual(byId.get('over-value-row-limit')?.expectedRows, {
    nodes: 4,
    properties: 4,
    values: 6305,
  });
  assert.deepEqual(byId.get('over-value-row-limit')?.admittedProfileLimits, {
    maxNodeRows: 205,
    maxPropertyRows: 332,
    maxValueRows: 6305,
  });
  return fixtures;
}

export function assertCurrentCanonicalizerFrontier(
  coverage,
  prerequisite,
) {
  assertExactPlainData(prerequisite, 'current prerequisite summary');
  validateCanonicalizerPrerequisiteSummaryStructure(prerequisite);
  assert.deepEqual(prerequisite.baseline, {
    baseCompleteFunctions: coverage.baseCompleteFunctions,
    baseId: coverage.base.id,
    canonicalizerDigest: coverage.canonicalizerDigest,
    canonicalizerPolicyDigest: coverage.canonicalizerPolicyDigest,
    compiledCoreDigest: coverage.compiledCoreDigest,
    corpusDigest: coverage.corpusDigest,
    coverageImplementationDigest: coverage.coverageImplementationDigest,
    coveragePolicyDigest: coverage.coveragePolicyDigest,
    familyRegistryDigest: coverage.familyRegistryDigest,
    functionCount: coverage.functions.length,
    functionFactsDigest: coverage.functionFactsDigest,
    legacyParameterBlockers: coverage.functions.filter(({ excludedProperties }) =>
      excludedProperties.includes('fn.params')).length,
    profileDigest: coverage.profileDigest,
    toolCount: new Set(coverage.corpus.map(({ tool }) => tool)).size,
  });
  assert.equal(prerequisite.format, 'kern.kir-canonicalizer.prerequisite-summary.3');
  assert.deepEqual(prerequisite.parameterMigration, m4147ParameterMigration());
  assert.equal(prerequisite.outcome, 'bounded-exhaustion');
  assert.equal(prerequisite.minimumFamilyCount, null);
  assert.equal(prerequisite.selectedPrerequisite, null);
  assert.deepEqual(prerequisite.prerequisiteRanking, []);
  assert.deepEqual(prerequisite.ranking, []);
  assert.deepEqual(prerequisite.exhaustion, {
    activeFamilies: [],
    completingClosureCount: 0,
    evaluatedNonEmptyClosureCount: 0,
    reasonAssignmentsDigest:
      'e953208c40e51714c3e0338455f67437fb6a6fda6c3f9fb42df0870dda003720',
    reasonCounts: [
      {
        count: 1,
        id: 'if.properties.cond.expression.text.character-u007f',
      },
      {
        count: 1,
        id: 'if.properties.cond.expression.text.character-u0080',
      },
      {
        count: 1,
        id: 'if.properties.cond.expression.text.character-u009f',
      },
      {
        count: 1,
        id: 'if.properties.cond.expression.text.character-u2028',
      },
      {
        count: 1,
        id: 'if.properties.cond.expression.text.character-u2029',
      },
      {
        count: 1,
        id: 'if.properties.cond.expression.text.character-ufeff',
      },
    ],
    residualFunctionCount: 1,
    scope: 'current-bounded-profile',
  });
  assertM4131ParameterMigration(coverage);
  const status = assertM4147ParameterMigration(coverage);
  return status;
}
