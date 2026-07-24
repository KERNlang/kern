import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { measureCanonicalizerCoverage } from './coverage.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import {
  loadPublishedCanonicalizerDualRowHeadroomM475,
  validatePublishedCanonicalizerDualRowHeadroomM475,
} from './dual-row-headroom-m4-75.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import { PROFILE_LIMIT_FIXTURES } from './profile-limit-fixtures.mjs';

const M476_PUBLISHED_QUEUE = {
  completeFunctions: 1,
  completeTools: 1,
  migratedParameterRows: 6,
  witnesses: [
    {
      id: 'examples/kern-canonicalizer/canonicalizer.kern#0:typesource',
      parameterRows: 6,
      profileRows: { nodes: 38, properties: 51, values: 461 },
      tool: 'canonicalizer',
    },
  ],
};

function sha256(path) {
  return createHash('sha256')
    .update(readFileSync(new URL(`../../${path}`, import.meta.url)))
    .digest('hex');
}

test('M4.76 promotes only the authenticated node-row and value-row ceilings', () => {
  const policy = loadCanonicalizerPolicy();
  assert.deepEqual(policy.profileLimits, {
    maxNodeRows: 38,
    maxPropertyRows: 53,
    maxValueRows: 461,
  });
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  assert.equal(policy.kirLimits.maxDepth, 64);

  const overNode = PROFILE_LIMIT_FIXTURES.find(({ id }) => id === 'over-node-row-limit');
  assert.deepEqual(overNode?.expectedRows, { nodes: 39, properties: 45, values: 62 });
  assert.deepEqual(overNode?.admittedProfileLimits, {
    maxNodeRows: 39,
    maxPropertyRows: 53,
    maxValueRows: 461,
  });
  const overProperty = PROFILE_LIMIT_FIXTURES.find(({ id }) => id === 'over-property-row-limit');
  assert.deepEqual(overProperty?.expectedRows, { nodes: 27, properties: 54, values: 87 });
  assert.deepEqual(overProperty?.admittedProfileLimits, {
    maxNodeRows: 38,
    maxPropertyRows: 54,
    maxValueRows: 461,
  });
  const overValue = PROFILE_LIMIT_FIXTURES.find(({ id }) => id === 'over-value-row-limit');
  assert.deepEqual(overValue?.expectedRows, { nodes: 18, properties: 21, values: 462 });
  assert.deepEqual(overValue?.admittedProfileLimits, {
    maxNodeRows: 38,
    maxPropertyRows: 53,
    maxValueRows: 462,
  });
});

test('M4.77 consumes the one-function queue exposed by M4.76', () => {
  const coverage = measureCanonicalizerCoverage();
  assert.equal(coverage.baseCompleteFunctions, 80);
  assert.equal(coverage.functions.length, 104);
  assert.equal(
    coverage.functions.filter(({ excludedProperties }) => excludedProperties.includes('fn.params')).length,
    23,
  );
  const prerequisite = measureCanonicalizerPrerequisite();
  assert.deepEqual(prerequisite.parameterMigration, {
    completeFunctions: 0,
    completeTools: 0,
    migratedParameterRows: 0,
    witnesses: [],
  });
  assert.equal(prerequisite.outcome, 'bounded-exhaustion');
  assert.equal(prerequisite.exhaustion?.residualFunctionCount, 23);
});

test('M4.76 freezes exact M4.75 runtime evidence before either policy limit moves', () => {
  const handoff = loadPublishedCanonicalizerDualRowHeadroomM475();
  assert.equal(handoff.digest,
    'c70022af6c90620c9ade8c03cff85eba41c53966f515b5523bd774985cb877f6');
  assert.equal(handoff.sourceCommit, '177212fc4cc1ba0c15f04e1092657b4d335067e9');
  assert.equal(handoff.record.artifactScope, 'structural-kir-function');
  assert.deepEqual(handoff.record.limits.candidateProfile, {
    maxNodeRows: 38,
    maxPropertyRows: 53,
    maxValueRows: 461,
  });
  assert.deepEqual(handoff.record.summary, {
    maxExactFloor: 46_255,
    minimumProductionHeadroom: 19_281,
    minimumPromotionHeadroom: 2_897,
    witnessCount: 1,
  });
  assert.deepEqual(handoff.record.moduleEnvelope, { disposition: 'not-claimed', maxDepth: 64 });
  assert.deepEqual(
    handoff.record.witnesses.map(({ exactFloor, id, parameterRows, profileRows }) => ({
      exactFloor, id, parameterRows, profileRows,
    })),
    [{
      exactFloor: 46_255,
      id: M476_PUBLISHED_QUEUE.witnesses[0].id,
      parameterRows: 6,
      profileRows: M476_PUBLISHED_QUEUE.witnesses[0].profileRows,
    }],
  );
});

test('M4.75 published receipt rejects canonical and decorated drift', () => {
  const record = loadPublishedCanonicalizerDualRowHeadroomM475().record;
  for (const mutate of [
    (copy) => { copy.limits.candidateProfile.maxNodeRows = 39; },
    (copy) => { copy.limits.candidateProfile.maxValueRows = 462; },
    (copy) => { copy.witnesses[0].exactFloor += 1; },
    (copy) => { copy.witnesses[0].id = 'future'; },
    (copy) => { copy.witnesses[0].roundTrip = false; },
    (copy) => { copy.moduleEnvelope.disposition = 'proven'; },
  ]) {
    const copy = structuredClone(record);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerDualRowHeadroomM475(copy),
      /coverage M4\.75 dual-row headroom rejection/u,
    );
  }
  const decorated = structuredClone(record);
  decorated[Symbol('hidden')] = true;
  assert.throws(
    () => validatePublishedCanonicalizerDualRowHeadroomM475(decorated),
    /coverage M4\.75 dual-row headroom rejection/u,
  );
});

test('M4.76 preserves exact M4.74 and M4.75 historical receipt bytes', () => {
  assert.equal(
    sha256('scripts/kern-canonicalizer/dual-row-headroom-m4-75.json'),
    'c70022af6c90620c9ade8c03cff85eba41c53966f515b5523bd774985cb877f6',
  );
  assert.equal(
    sha256('scripts/kern-canonicalizer/coverage-residual-analysis-m4-74.json'),
    'dae5ecfb09bd07575a8436771ff770c6ea544ea5efecba16ae45010b8f0df6e0',
  );
});
