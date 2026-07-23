import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { measureCanonicalizerCoverage } from './coverage.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import {
  loadPublishedCanonicalizerDualRowHeadroomM471,
  validatePublishedCanonicalizerDualRowHeadroomM471,
} from './dual-row-headroom-m4-71.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import { PROFILE_LIMIT_FIXTURES } from './profile-limit-fixtures.mjs';

const EXPECTED_QUEUE = {
  completeFunctions: 1,
  completeTools: 1,
  migratedParameterRows: 14,
  witnesses: [
    {
      id: 'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#1:validstatementlist',
      parameterRows: 14,
      profileRows: { nodes: 31, properties: 53, values: 370 },
      tool: 'canonicalizer',
    },
  ],
};

function sha256(path) {
  return createHash('sha256')
    .update(readFileSync(new URL(`../../${path}`, import.meta.url)))
    .digest('hex');
}

test('M4.72 promotes only the authenticated node-row and property-row ceilings', () => {
  const policy = loadCanonicalizerPolicy();
  assert.deepEqual(policy.profileLimits, {
    maxNodeRows: 31,
    maxPropertyRows: 53,
    maxValueRows: 388,
  });
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  assert.equal(policy.kirLimits.maxDepth, 64);

  const overNode = PROFILE_LIMIT_FIXTURES.find(({ id }) => id === 'over-node-row-limit');
  assert.equal(overNode?.expectedRows.nodes, 32);
  assert.deepEqual(overNode?.admittedProfileLimits, {
    maxNodeRows: 32,
    maxPropertyRows: 53,
    maxValueRows: 388,
  });
  const overProperty = PROFILE_LIMIT_FIXTURES.find(({ id }) => id === 'over-property-row-limit');
  assert.deepEqual(overProperty?.expectedRows, { nodes: 27, properties: 54, values: 87 });
  assert.deepEqual(overProperty?.admittedProfileLimits, {
    maxNodeRows: 31,
    maxPropertyRows: 54,
    maxValueRows: 388,
  });
  const overValue = PROFILE_LIMIT_FIXTURES.find(({ id }) => id === 'over-value-row-limit');
  assert.equal(overValue?.expectedRows.values, 389);
  assert.deepEqual(overValue?.admittedProfileLimits, {
    maxNodeRows: 31,
    maxPropertyRows: 53,
    maxValueRows: 389,
  });
});

test('M4.73 preserves the M4.72 profile after consuming its frozen queue', () => {
  const coverage = measureCanonicalizerCoverage();
  assert.equal(coverage.baseCompleteFunctions, 79);
  assert.equal(coverage.functions.length, 104);
  assert.equal(
    coverage.functions.filter(({ excludedProperties }) => excludedProperties.includes('fn.params')).length,
    24,
  );
  const prerequisite = measureCanonicalizerPrerequisite();
  assert.deepEqual(prerequisite.parameterMigration, {
    completeFunctions: 0,
    completeTools: 0,
    migratedParameterRows: 0,
    witnesses: [],
  });
  assert.equal(prerequisite.outcome, 'bounded-exhaustion');
  assert.equal(prerequisite.exhaustion?.residualFunctionCount, 24);
});

test('M4.72 freezes exact M4.71 runtime evidence before either policy limit moves', () => {
  const handoff = loadPublishedCanonicalizerDualRowHeadroomM471();
  assert.equal(handoff.digest,
    '8be340082e3a5de479b015d4f0f4248486286290ed981cbf5715538069638c12');
  assert.equal(handoff.sourceCommit, '75a927c4faf36d4c18530ff30b4f877fdc411628');
  assert.equal(handoff.record.artifactScope, 'structural-kir-function');
  assert.deepEqual(handoff.record.limits.candidateProfile, {
    maxNodeRows: 31,
    maxPropertyRows: 53,
    maxValueRows: 388,
  });
  assert.deepEqual(handoff.record.summary, {
    maxExactFloor: 36_193,
    minimumProductionHeadroom: 29_343,
    minimumPromotionHeadroom: 12_959,
    witnessCount: 1,
  });
  assert.deepEqual(handoff.record.moduleEnvelope, { disposition: 'not-claimed', maxDepth: 64 });
  assert.deepEqual(
    handoff.record.witnesses.map(({ exactFloor, id, parameterRows, profileRows }) => ({
      exactFloor, id, parameterRows, profileRows,
    })),
    [{
      exactFloor: 36_193,
      id: EXPECTED_QUEUE.witnesses[0].id,
      parameterRows: 14,
      profileRows: EXPECTED_QUEUE.witnesses[0].profileRows,
    }],
  );
});

test('M4.71 published receipt rejects canonical and decorated drift', () => {
  const record = loadPublishedCanonicalizerDualRowHeadroomM471().record;
  for (const mutate of [
    (copy) => { copy.limits.candidateProfile.maxNodeRows = 32; },
    (copy) => { copy.limits.candidateProfile.maxPropertyRows = 54; },
    (copy) => { copy.witnesses[0].exactFloor += 1; },
    (copy) => { copy.witnesses[0].id = 'future'; },
    (copy) => { copy.witnesses[0].roundTrip = false; },
    (copy) => { copy.moduleEnvelope.disposition = 'proven'; },
  ]) {
    const copy = structuredClone(record);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerDualRowHeadroomM471(copy),
      /coverage M4\.71 dual-row headroom rejection/u,
    );
  }
  const decorated = structuredClone(record);
  decorated[Symbol('hidden')] = true;
  assert.throws(
    () => validatePublishedCanonicalizerDualRowHeadroomM471(decorated),
    /coverage M4\.71 dual-row headroom rejection/u,
  );
});

test('M4.72 preserves exact M4.70 and M4.71 historical receipt bytes', () => {
  assert.equal(
    sha256('scripts/kern-canonicalizer/dual-row-headroom-m4-71.json'),
    '8be340082e3a5de479b015d4f0f4248486286290ed981cbf5715538069638c12',
  );
  assert.equal(
    sha256('scripts/kern-canonicalizer/coverage-residual-analysis-m4-70.json'),
    '2e1b2dea394f8a238b2f63b4a7045576b1843948740b3a6666b0c002971d8401',
  );
});
