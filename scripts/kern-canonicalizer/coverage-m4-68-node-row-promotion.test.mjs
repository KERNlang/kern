import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { measureCanonicalizerCoverage } from './coverage.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import {
  loadPublishedCanonicalizerNodeRowHeadroomM467,
  validatePublishedCanonicalizerNodeRowHeadroomM467,
} from './node-row-headroom-m4-67.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import { PROFILE_LIMIT_FIXTURES } from './profile-limit-fixtures.mjs';

const EXPECTED_QUEUE = {
  completeFunctions: 1,
  completeTools: 1,
  migratedParameterRows: 1,
  witnesses: [
    {
      id: 'examples/capstone-checker-subset/checker.kern#3:isSurfaceKind',
      parameterRows: 1,
      profileRows: { nodes: 30, properties: 32, values: 219 },
      tool: 'checker',
    },
  ],
};

function sha256(path) {
  return createHash('sha256')
    .update(readFileSync(new URL(`../../${path}`, import.meta.url)))
    .digest('hex');
}

test('M4.68 promotes only the authenticated node-row ceiling', () => {
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
});

test('M4.77 preserves M4.68 after consuming the next queue', () => {
  const coverage = measureCanonicalizerCoverage();
  assert.equal(coverage.baseCompleteFunctions, 81);
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
  assert.equal(prerequisite.exhaustion?.residualFunctionCount, 23);
});

test('M4.68 freezes exact M4.67 runtime evidence before policy moves', () => {
  const handoff = loadPublishedCanonicalizerNodeRowHeadroomM467();
  assert.equal(handoff.digest,
    '61e2c3b388160035d5764efcc2037c408eca8fc30f12010430168dd2b3bf9bca');
  assert.equal(handoff.sourceCommit, '40b6961bbd41f3b60e346ef3246d6587c0c3a1f4');
  assert.equal(handoff.record.artifactScope, 'structural-kir-function');
  assert.deepEqual(handoff.record.limits.candidateProfile, {
    maxNodeRows: 30,
    maxPropertyRows: 50,
    maxValueRows: 388,
  });
  assert.deepEqual(handoff.record.summary, {
    maxExactFloor: 17_552,
    minimumProductionHeadroom: 47_984,
    minimumPromotionHeadroom: 31_600,
    witnessCount: 1,
  });
  assert.deepEqual(handoff.record.moduleEnvelope, { disposition: 'not-claimed', maxDepth: 64 });
  assert.deepEqual(
    handoff.record.witnesses.map(({ exactFloor, id, parameterRows, profileRows }) => ({
      exactFloor, id, parameterRows, profileRows,
    })),
    [{
      exactFloor: 17_552,
      id: EXPECTED_QUEUE.witnesses[0].id,
      parameterRows: 1,
      profileRows: EXPECTED_QUEUE.witnesses[0].profileRows,
    }],
  );
});

test('M4.67 published receipt rejects canonical and decorated drift', () => {
  const record = loadPublishedCanonicalizerNodeRowHeadroomM467().record;
  for (const mutate of [
    (copy) => { copy.limits.candidateProfile.maxNodeRows = 31; },
    (copy) => { copy.witnesses[0].exactFloor += 1; },
    (copy) => { copy.witnesses[0].id = 'future'; },
    (copy) => { copy.moduleEnvelope.disposition = 'proven'; },
  ]) {
    const copy = structuredClone(record);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerNodeRowHeadroomM467(copy),
      /coverage M4\.67 node-row headroom rejection/u,
    );
  }
  const decorated = structuredClone(record);
  decorated[Symbol('hidden')] = true;
  assert.throws(
    () => validatePublishedCanonicalizerNodeRowHeadroomM467(decorated),
    /coverage M4\.67 node-row headroom rejection/u,
  );
});

test('M4.68 preserves exact M4.66 and M4.67 historical receipt bytes', () => {
  assert.equal(
    sha256('scripts/kern-canonicalizer/node-row-headroom-m4-67.json'),
    '61e2c3b388160035d5764efcc2037c408eca8fc30f12010430168dd2b3bf9bca',
  );
  assert.equal(
    sha256('scripts/kern-canonicalizer/coverage-residual-analysis-m4-66.json'),
    '7c3748692b35c5c30c9241b70de86af69ff5046382dba8b07963bd1c6e7c5736',
  );
});
