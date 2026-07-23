import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPublishedCanonicalizerPrerequisiteM452 } from './coverage-prerequisite-m4-52.mjs';
import {
  loadPublishedCanonicalizerPropertyRowHeadroomM451,
  validatePublishedCanonicalizerPropertyRowHeadroomM451,
} from './property-row-headroom-m4-51.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import { PROFILE_LIMIT_FIXTURES } from './profile-limit-fixtures.mjs';

const EXPECTED_QUEUE = {
  completeFunctions: 1,
  completeTools: 1,
  migratedParameterRows: 6,
  witnesses: [
    {
      id: 'examples/selfhost-validator/validator.kern#17:classcyclefrom',
      parameterRows: 6,
      profileRows: { nodes: 19, properties: 31, values: 202 },
      tool: 'validator',
    },
  ],
};

function sha256(path) {
  return createHash('sha256').update(readFileSync(new URL(`../../${path}`, import.meta.url))).digest('hex');
}

test('the current policy preserves M4.52 property-row evidence after later promotions', () => {
  const policy = loadCanonicalizerPolicy();
  assert.deepEqual(policy.profileLimits, {
    maxNodeRows: 30,
    maxPropertyRows: 50,
    maxValueRows: 388,
  });
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  assert.equal(policy.kirLimits.maxDepth, 64);

  const overProperty = PROFILE_LIMIT_FIXTURES.find(({ id }) => id === 'over-property-row-limit');
  assert.deepEqual(overProperty?.expectedRows, { nodes: 25, properties: 51, values: 80 });
});

test('M4.52 publishes exactly the frozen one-function parameter queue', () => {
  const handoff = loadPublishedCanonicalizerPrerequisiteM452();
  assert.equal(handoff.digest, '220becc58afa59bb35f1fef2246038d7c7763b49db65d615f6c5725c87659c76');
  assert.equal(handoff.sourceCommit, '99905b044c3d981998a3beef846da283dac4a94c');
  assert.equal(handoff.record.baseline.baseCompleteFunctions, 64);
  assert.equal(handoff.record.baseline.legacyParameterBlockers, 39);
  assert.deepEqual(handoff.record.parameterMigration, EXPECTED_QUEUE);
  assert.equal(handoff.record.exhaustion?.residualFunctionCount, 38);
});

test('M4.52 freezes exact M4.51 runtime evidence before policy moves', () => {
  const handoff = loadPublishedCanonicalizerPropertyRowHeadroomM451();
  assert.equal(handoff.digest, 'c36711a885495d41b879bdcc364122f380dfde1a720a0985cdafbd78e067dfbe');
  assert.equal(handoff.sourceCommit, '2e363bab008fd2f03ef21fdc1bcb0a2488bd0637');
  assert.equal(handoff.record.artifactScope, 'structural-kir-function');
  assert.deepEqual(handoff.record.limits.candidateProfile, {
    maxNodeRows: 19,
    maxPropertyRows: 31,
    maxValueRows: 388,
  });
  assert.equal(handoff.record.summary.witnessCount, 1);
  assert.equal(handoff.record.summary.maxExactFloor, 11_951);
  assert.equal(handoff.record.moduleEnvelope.disposition, 'not-claimed');
  assert.deepEqual(
    handoff.record.witnesses.map(({ exactFloor, id, parameterRows, profileRows }) => ({
      exactFloor, id, parameterRows, profileRows,
    })),
    [{
      exactFloor: 11_951,
      id: EXPECTED_QUEUE.witnesses[0].id,
      parameterRows: 6,
      profileRows: { nodes: 19, properties: 31, values: 202 },
    }],
  );
});

test('M4.51 published receipt rejects canonical and decorated drift', () => {
  const record = loadPublishedCanonicalizerPropertyRowHeadroomM451().record;
  for (const mutate of [
    (copy) => { copy.limits.candidateProfile.maxPropertyRows = 32; },
    (copy) => { copy.witnesses[0].exactFloor += 1; },
    (copy) => { copy.witnesses[0].profileRows.properties = 32; },
    (copy) => { copy.moduleEnvelope.disposition = 'proven'; },
  ]) {
    const copy = structuredClone(record);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerPropertyRowHeadroomM451(copy),
      /coverage M4\.51 property-row headroom rejection/u,
    );
  }
  const decorated = structuredClone(record);
  decorated[Symbol('hidden')] = true;
  assert.throws(
    () => validatePublishedCanonicalizerPropertyRowHeadroomM451(decorated),
    /coverage M4\.51 property-row headroom rejection/u,
  );
});

test('M4.52 preserves exact M4.50 and M4.51 historical receipt bytes', () => {
  assert.equal(
    sha256('scripts/kern-canonicalizer/property-row-headroom-m4-51.json'),
    'c36711a885495d41b879bdcc364122f380dfde1a720a0985cdafbd78e067dfbe',
  );
  assert.equal(
    sha256('scripts/kern-canonicalizer/coverage-residual-analysis-m4-50.json'),
    '14fdff4dce865a79215eabdb02b05a29c62a66c633561e9643e2a46f38020e4f',
  );
});
