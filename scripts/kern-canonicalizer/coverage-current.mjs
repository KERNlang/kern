import assert from 'node:assert/strict';

import {
  assertM4131ParameterMigration,
} from './coverage-m4-131-parameter-migration.mjs';
import {
  assertM4142ParameterMigration,
  m4142ParameterMigration,
} from './coverage-m4-142-parameter-migration.mjs';
import {
  m4130ActiveKirLimits,
  m4130ActiveProfile,
  m4130ActiveRuntimeByteLimits,
} from './coverage-m4-130-combined-promotion.mjs';
import {
  assertExactPlainData,
} from './coverage-prerequisite-shape.mjs';
import {
  validateCanonicalizerPrerequisiteSummaryStructure,
} from './coverage-prerequisite-structure.mjs';
import { loadPublishedM4142CoverageInput } from './coverage-input-m4-142.mjs';

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
    m4130ActiveKirLimits(),
  );
  assert.deepEqual(policy.profileLimits, m4130ActiveProfile());
  assert.deepEqual(
    {
      maxBytes: policy.runtimeLimits.maxBytes,
      maxStringBytes: policy.runtimeLimits.maxStringBytes,
    },
    m4130ActiveRuntimeByteLimits(),
  );
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  assert.equal(policy.runtimeLimits.maxDepth, 64);
  return policy;
}

export function assertCurrentProfileLimitFixtures(fixtures) {
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  assert.deepEqual(byId.get('over-node-row-limit')?.expectedRows, {
    nodes: 203,
    properties: 203,
    values: 804,
  });
  assert.deepEqual(byId.get('over-node-row-limit')?.admittedProfileLimits, {
    maxNodeRows: 203,
    maxPropertyRows: 308,
    maxValueRows: 4493,
  });
  assert.deepEqual(byId.get('over-property-row-limit')?.expectedRows, {
    nodes: 104,
    properties: 309,
    values: 922,
  });
  assert.deepEqual(byId.get('over-property-row-limit')?.admittedProfileLimits, {
    maxNodeRows: 202,
    maxPropertyRows: 309,
    maxValueRows: 4493,
  });
  assert.deepEqual(byId.get('over-value-row-limit')?.expectedRows, {
    nodes: 4,
    properties: 4,
    values: 4494,
  });
  assert.deepEqual(byId.get('over-value-row-limit')?.admittedProfileLimits, {
    maxNodeRows: 202,
    maxPropertyRows: 308,
    maxValueRows: 4494,
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
  assert.deepEqual(prerequisite.parameterMigration, m4142ParameterMigration());
  assert.equal(prerequisite.outcome, 'bounded-exhaustion');
  assert.equal(prerequisite.minimumFamilyCount, null);
  assert.equal(prerequisite.selectedPrerequisite, null);
  assert.deepEqual(prerequisite.prerequisiteRanking, []);
  assert.deepEqual(prerequisite.ranking, []);
  assert.deepEqual(
    prerequisite.exhaustion,
    loadPublishedM4142CoverageInput().prerequisite.exhaustion,
  );
  assertM4131ParameterMigration(coverage);
  const status = assertM4142ParameterMigration(coverage);
  return status;
}
