import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { measureCanonicalizerCoverage } from './coverage.mjs';
import { loadPublishedCanonicalizerPrerequisiteM464 } from './coverage-prerequisite-m4-64.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import {
  loadPublishedCanonicalizerNodeRowHeadroomM463,
  validatePublishedCanonicalizerNodeRowHeadroomM463,
} from './node-row-headroom-m4-63.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import { PROFILE_LIMIT_FIXTURES } from './profile-limit-fixtures.mjs';

const EXPECTED_QUEUE = {
  completeFunctions: 4,
  completeTools: 2,
  migratedParameterRows: 37,
  witnesses: [
    {
      id: 'examples/capstone-checker-subset/checker-while.kern#1:isSafeMagnitude',
      parameterRows: 2,
      profileRows: { nodes: 27, properties: 39, values: 288 },
      tool: 'checker',
    },
    {
      id: 'examples/capstone-checker-subset/checker.kern#22:mapCallRejectDetail',
      parameterRows: 13,
      profileRows: { nodes: 28, properties: 42, values: 309 },
      tool: 'checker',
    },
    {
      id: 'examples/selfhost-validator/validator.kern#10:fnokat',
      parameterRows: 8,
      profileRows: { nodes: 28, properties: 38, values: 270 },
      tool: 'validator',
    },
    {
      id: 'examples/selfhost-validator/validator.kern#12:ownexportkind',
      parameterRows: 14,
      profileRows: { nodes: 28, properties: 48, values: 260 },
      tool: 'validator',
    },
  ],
};

function sha256(path) {
  return createHash('sha256')
    .update(readFileSync(new URL(`../../${path}`, import.meta.url)))
    .digest('hex');
}

test('M4.64 promotes only the authenticated node-row ceiling', () => {
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

test('M4.76 preserves M4.65 consumption while exposing the next queue', () => {
  const coverage = measureCanonicalizerCoverage();
  assert.equal(coverage.baseCompleteFunctions, 79);
  assert.equal(
    coverage.functions.filter(({ excludedProperties }) => excludedProperties.includes('fn.params')).length,
    24,
  );
  const prerequisite = measureCanonicalizerPrerequisite();
  assert.deepEqual(prerequisite.parameterMigration, {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 6,
    witnesses: [{
      id: 'examples/kern-canonicalizer/canonicalizer.kern#0:typesource',
      parameterRows: 6,
      profileRows: { nodes: 38, properties: 51, values: 461 },
      tool: 'canonicalizer',
    }],
  });
  assert.equal(prerequisite.exhaustion?.residualFunctionCount, 23);
  assert.deepEqual(
    loadPublishedCanonicalizerPrerequisiteM464().record.parameterMigration,
    EXPECTED_QUEUE,
  );
});

test('M4.64 freezes exact M4.63 runtime evidence before policy moves', () => {
  const handoff = loadPublishedCanonicalizerNodeRowHeadroomM463();
  assert.equal(handoff.digest,
    '110260eb3a2c9ed942e309d5b6e1331f2752bc486bfe99840c887e2a6ef7e7c3');
  assert.equal(handoff.sourceCommit, '6aba5e056c833e7dd2e613a21ac52e3f718d9673');
  assert.equal(handoff.record.artifactScope, 'structural-kir-function');
  assert.deepEqual(handoff.record.limits.candidateProfile, {
    maxNodeRows: 28,
    maxPropertyRows: 50,
    maxValueRows: 388,
  });
  assert.deepEqual(handoff.record.summary, {
    maxExactFloor: 27_076,
    minimumProductionHeadroom: 38_460,
    minimumPromotionHeadroom: 22_076,
    witnessCount: 4,
  });
  assert.deepEqual(handoff.record.moduleEnvelope, { disposition: 'not-claimed', maxDepth: 64 });
  assert.deepEqual(
    handoff.record.witnesses.map(({ exactFloor, id, parameterRows, profileRows }) => ({
      exactFloor, id, parameterRows, profileRows,
    })),
    EXPECTED_QUEUE.witnesses.map(({ id, parameterRows, profileRows }, index) => ({
      exactFloor: [21_736, 27_076, 21_825, 24_993][index],
      id,
      parameterRows,
      profileRows,
    })),
  );
});

test('M4.63 published receipt rejects canonical and decorated drift', () => {
  const record = loadPublishedCanonicalizerNodeRowHeadroomM463().record;
  for (const mutate of [
    (copy) => { copy.limits.candidateProfile.maxNodeRows = 29; },
    (copy) => { copy.witnesses.reverse(); },
    (copy) => { copy.witnesses[0].exactFloor += 1; },
    (copy) => { copy.moduleEnvelope.disposition = 'proven'; },
  ]) {
    const copy = structuredClone(record);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerNodeRowHeadroomM463(copy),
      /coverage M4\.63 node-row headroom rejection/u,
    );
  }
  const decorated = structuredClone(record);
  decorated[Symbol('hidden')] = true;
  assert.throws(
    () => validatePublishedCanonicalizerNodeRowHeadroomM463(decorated),
    /coverage M4\.63 node-row headroom rejection/u,
  );
});

test('M4.64 preserves exact M4.62 and M4.63 historical receipt bytes', () => {
  assert.equal(
    sha256('scripts/kern-canonicalizer/node-row-headroom-m4-63.json'),
    '110260eb3a2c9ed942e309d5b6e1331f2752bc486bfe99840c887e2a6ef7e7c3',
  );
  assert.equal(
    sha256('scripts/kern-canonicalizer/coverage-residual-analysis-m4-62.json'),
    '5339ffa5c128efbe857b53e64a67092d72b8b6b6cbe6cc3ea16c96f4939e79cc',
  );
});
