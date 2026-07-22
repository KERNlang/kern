import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPublishedCanonicalizerPrerequisiteM448 } from './coverage-prerequisite-m4-48.mjs';
import {
  loadPublishedCanonicalizerNodeRowHeadroomM447,
  validatePublishedCanonicalizerNodeRowHeadroomM447,
} from './node-row-headroom-m4-47.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import { PROFILE_LIMIT_FIXTURES } from './profile-limit-fixtures.mjs';

const EXPECTED_QUEUE = {
  completeFunctions: 4,
  completeTools: 3,
  migratedParameterRows: 12,
  witnesses: [
    {
      id: 'examples/capstone-checker-subset/checker.kern#12:isIndexRebound',
      parameterRows: 6,
      profileRows: { nodes: 17, properties: 26, values: 152 },
      tool: 'checker',
    },
    {
      id: 'examples/capstone-checker-subset/checker.kern#9:isUserCallable',
      parameterRows: 4,
      profileRows: { nodes: 19, properties: 26, values: 185 },
      tool: 'checker',
    },
    {
      id: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#4:validinteger',
      parameterRows: 1,
      profileRows: { nodes: 19, properties: 28, values: 290 },
      tool: 'canonicalizer',
    },
    {
      id: 'examples/selfhost-validator/validator.kern#3:isportable',
      parameterRows: 1,
      profileRows: { nodes: 18, properties: 24, values: 217 },
      tool: 'validator',
    },
  ],
};

function sha256(path) {
  return createHash('sha256').update(readFileSync(new URL(`../../${path}`, import.meta.url))).digest('hex');
}

test('M4.48 promotes only the authenticated node-row ceiling', () => {
  const policy = loadCanonicalizerPolicy();
  assert.deepEqual(policy.profileLimits, {
    maxNodeRows: 19,
    maxPropertyRows: 30,
    maxValueRows: 388,
  });
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  assert.equal(policy.kirLimits.maxDepth, 64);

  const overNode = PROFILE_LIMIT_FIXTURES.find(({ id }) => id === 'over-node-row-limit');
  assert.deepEqual(overNode?.expectedRows, { nodes: 20, properties: 22, values: 30 });
});

test('M4.48 publishes exactly the frozen four-function parameter queue', () => {
  const handoff = loadPublishedCanonicalizerPrerequisiteM448();
  assert.equal(handoff.digest, 'fbc4b671f665d1ed2ebb709201a4c3f4be27d9cec4f18708ce7130fd2b2a7b0a');
  assert.equal(handoff.sourceCommit, 'c16ab453b49d850d58022160a577c23eb70a2142');
  assert.equal(handoff.record.baseline.baseCompleteFunctions, 60);
  assert.equal(handoff.record.baseline.legacyParameterBlockers, 43);
  assert.deepEqual(handoff.record.parameterMigration, EXPECTED_QUEUE);
  assert.equal(handoff.record.exhaustion?.residualFunctionCount, 39);
});

test('M4.48 freezes exact M4.47 runtime evidence before policy moves', () => {
  const handoff = loadPublishedCanonicalizerNodeRowHeadroomM447();
  assert.equal(handoff.digest, '0da8ef5be1be0ea2ac12ef739bd6cc38070d60b7b3a775f45602857d40979af1');
  assert.equal(handoff.sourceCommit, '233e71a84fe7afdd7566e19a5545a885ffc36e8f');
  assert.equal(handoff.record.artifactScope, 'structural-kir-function');
  assert.deepEqual(handoff.record.limits.candidateProfile, {
    maxNodeRows: 19,
    maxPropertyRows: 30,
    maxValueRows: 388,
  });
  assert.equal(handoff.record.summary.witnessCount, 4);
  assert.equal(handoff.record.summary.maxExactFloor, 15_236);
  assert.equal(handoff.record.moduleEnvelope.disposition, 'not-claimed');
  assert.deepEqual(
    handoff.record.witnesses.map(({ exactFloor, id, parameterRows, profileRows }) => ({
      exactFloor, id, parameterRows, profileRows,
    })),
    EXPECTED_QUEUE.witnesses.map(({ id, parameterRows, profileRows }, index) => ({
      exactFloor: [8_303, 10_361, 15_236, 10_591][index],
      id,
      parameterRows,
      profileRows,
    })),
  );
});

test('M4.47 published receipt rejects canonical and decorated drift', () => {
  const record = loadPublishedCanonicalizerNodeRowHeadroomM447().record;
  for (const mutate of [
    (copy) => { copy.limits.candidateProfile.maxNodeRows = 20; },
    (copy) => { copy.witnesses.reverse(); },
    (copy) => { copy.witnesses[0].exactFloor += 1; },
    (copy) => { copy.moduleEnvelope.disposition = 'proven'; },
  ]) {
    const copy = structuredClone(record);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerNodeRowHeadroomM447(copy),
      /coverage M4\.47 node-row headroom rejection/u,
    );
  }
  const decorated = structuredClone(record);
  decorated[Symbol('hidden')] = true;
  assert.throws(
    () => validatePublishedCanonicalizerNodeRowHeadroomM447(decorated),
    /coverage M4\.47 node-row headroom rejection/u,
  );
});

test('M4.48 preserves exact M4.46 and M4.47 historical receipt bytes', () => {
  assert.equal(
    sha256('scripts/kern-canonicalizer/node-row-headroom-m4-47.json'),
    '0da8ef5be1be0ea2ac12ef739bd6cc38070d60b7b3a775f45602857d40979af1',
  );
  assert.equal(
    sha256('scripts/kern-canonicalizer/coverage-residual-analysis-m4-46.json'),
    '67ed659c709adfc5cd51095a3ac5f9549b0384d9651ac3d74894ad4b3aab3402',
  );
});
