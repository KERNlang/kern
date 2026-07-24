import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { measureCanonicalizerCoverage } from './coverage.mjs';
import {
  assertCurrentCanonicalizerFrontier,
  assertCurrentCanonicalizerPolicy,
  assertCurrentProfileLimitFixtures,
} from './coverage-current.mjs';
import {
  assertM485ValueRowPromotion,
  m485ParameterMigration,
} from './coverage-m4-85-value-row-promotion.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import { PROFILE_LIMIT_FIXTURES } from './profile-limit-fixtures.mjs';
import {
  loadCanonicalizerValueRowHeadroomM484,
  validateCanonicalizerValueRowHeadroomM484,
} from './value-row-headroom-m4-84.mjs';

function sha256(path) {
  return createHash('sha256')
    .update(readFileSync(new URL(`../../${path}`, import.meta.url)))
    .digest('hex');
}

test('M4.85 promotes only the authenticated value-row ceiling', () => {
  const policy = loadCanonicalizerPolicy();
  const coverage = measureCanonicalizerCoverage();
  const prerequisite = measureCanonicalizerPrerequisite();
  assertM485ValueRowPromotion(coverage, prerequisite, policy);
  assertCurrentCanonicalizerPolicy(policy);
  assertCurrentProfileLimitFixtures(PROFILE_LIMIT_FIXTURES);
  assertCurrentCanonicalizerFrontier(coverage, prerequisite);
});

test('M4.85 publishes the exact one-function parameter queue', () => {
  assert.deepEqual(m485ParameterMigration(), {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 19,
    witnesses: [{
      id: 'examples/capstone-checker-subset/checker.kern#16:argProvenanced',
      parameterRows: 19,
      profileRows: { nodes: 35, properties: 55, values: 580 },
      tool: 'checker',
    }],
  });
});

test('M4.85 freezes exact M4.84 runtime evidence before the policy limit moves', () => {
  const receipt = loadCanonicalizerValueRowHeadroomM484();
  assert.equal(
    sha256('scripts/kern-canonicalizer/value-row-headroom-m4-84.json'),
    '4b92ced7a43f4aa938a9fe303edcd5fb17b423a61d99b9a8c476ccdc653b8065',
  );
  assert.deepEqual(receipt.limits.candidateProfile, {
    maxNodeRows: 38,
    maxPropertyRows: 61,
    maxValueRows: 580,
  });
  assert.deepEqual(receipt.summary, {
    maxExactFloor: 38_773,
    minimumProductionHeadroom: 26_763,
    minimumPromotionHeadroom: 10_379,
    witnessCount: 1,
  });
  assert.deepEqual(receipt.promotion, { disposition: 'approved', nextMilestone: 'M4.85' });
  assert.deepEqual(receipt.moduleEnvelope, { disposition: 'not-claimed', maxDepth: 64 });
  assert.deepEqual(
    receipt.witnesses.map(({ exactFloor, id, parameterRows, profileRows }) => ({
      exactFloor, id, parameterRows, profileRows,
    })),
    [{
      exactFloor: 38_773,
      id: m485ParameterMigration().witnesses[0].id,
      parameterRows: 19,
      profileRows: { nodes: 35, properties: 55, values: 580 },
    }],
  );
});

test('M4.84 evidence remains immutable after M4.85 promotion', () => {
  const receipt = loadCanonicalizerValueRowHeadroomM484();
  for (const mutate of [
    (copy) => { copy.limits.candidateProfile.maxValueRows += 1; },
    (copy) => { copy.witnesses[0].exactFloor += 1; },
    (copy) => { copy.promotion.disposition = 'rejected-over-budget'; },
    (copy) => { copy.moduleEnvelope.disposition = 'proven'; },
  ]) {
    const copy = structuredClone(receipt);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerValueRowHeadroomM484(copy),
      /coverage M4\.84 value-row headroom rejection/u,
    );
  }
});
