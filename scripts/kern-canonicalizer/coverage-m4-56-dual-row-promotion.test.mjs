import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  loadPublishedCanonicalizerDualRowHeadroomM455,
  validatePublishedCanonicalizerDualRowHeadroomM455,
} from './dual-row-headroom-m4-55.mjs';
import { loadPublishedCanonicalizerPrerequisiteM456 } from './coverage-prerequisite-m4-56.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import { PROFILE_LIMIT_FIXTURES } from './profile-limit-fixtures.mjs';

const EXPECTED_QUEUE = {
  completeFunctions: 7,
  completeTools: 4,
  migratedParameterRows: 102,
  witnesses: [
    {
      id: 'examples/capstone-assertion-engine/compare.kern#4:compareNode',
      parameterRows: 13,
      profileRows: { nodes: 24, properties: 39, values: 373 },
      tool: 'assertion-engine',
    },
    {
      id: 'examples/capstone-checker-subset/checker-while.kern#14:literalTrue',
      parameterRows: 7,
      profileRows: { nodes: 23, properties: 33, values: 244 },
      tool: 'checker',
    },
    {
      id: 'examples/capstone-checker-subset/checker-while.kern#17:checkerWhileRejectDetail',
      parameterRows: 22,
      profileRows: { nodes: 25, properties: 49, values: 189 },
      tool: 'checker',
    },
    {
      id: 'examples/capstone-checker-subset/checker.kern#14:termProvenanced',
      parameterRows: 11,
      profileRows: { nodes: 24, properties: 36, values: 237 },
      tool: 'checker',
    },
    {
      id: 'examples/capstone-checker-subset/checker.kern#6:whileRejectDetail',
      parameterRows: 22,
      profileRows: { nodes: 25, properties: 48, values: 188 },
      tool: 'checker',
    },
    {
      id: 'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#3:emitstatementlist',
      parameterRows: 15,
      profileRows: { nodes: 25, properties: 50, values: 235 },
      tool: 'canonicalizer',
    },
    {
      id: 'examples/selfhost-validator/validator.kern#11:owncallable',
      parameterRows: 12,
      profileRows: { nodes: 24, properties: 42, values: 212 },
      tool: 'validator',
    },
  ],
};

function sha256(path) {
  return createHash('sha256')
    .update(readFileSync(new URL(`../../${path}`, import.meta.url)))
    .digest('hex');
}

test('M4.56 promotes only the authenticated node-row and property-row ceilings', () => {
  const policy = loadCanonicalizerPolicy();
  assert.deepEqual(policy.profileLimits, {
    maxNodeRows: 30,
    maxPropertyRows: 50,
    maxValueRows: 388,
  });
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  assert.equal(policy.kirLimits.maxDepth, 64);

  const overNode = PROFILE_LIMIT_FIXTURES.find(({ id }) => id === 'over-node-row-limit');
  assert.deepEqual(overNode?.expectedRows, { nodes: 31, properties: 35, values: 48 });
  const overProperty = PROFILE_LIMIT_FIXTURES.find(({ id }) => id === 'over-property-row-limit');
  assert.deepEqual(overProperty?.expectedRows, { nodes: 25, properties: 51, values: 80 });
});

test('M4.56 publishes exactly the frozen seven-function parameter queue', () => {
  const prerequisite = loadPublishedCanonicalizerPrerequisiteM456().record;
  assert.equal(prerequisite.baseline.baseCompleteFunctions, 65);
  assert.equal(prerequisite.baseline.legacyParameterBlockers, 38);
  assert.deepEqual(prerequisite.parameterMigration, EXPECTED_QUEUE);
  assert.equal(prerequisite.outcome, 'selected');
  assert.equal(prerequisite.minimumFamilyCount, 1);
  assert.equal(prerequisite.exhaustion, null);
  assert.deepEqual(prerequisite.selectedPrerequisite, {
    catalogFacts: 2,
    family: 'while-iteration',
    occurrences: 2,
  });
  assert.deepEqual(prerequisite.ranking, [{
    completeFunctions: 1,
    completeTools: 1,
    families: ['while-iteration'],
    migratedParameterRows: 1,
    occurrences: 2,
    witnesses: [{
      id: 'examples/selfhost-validator/validator.kern#19:sortstrings',
      parameterRows: 1,
      profileRows: { nodes: 25, properties: 43, values: 266 },
      tool: 'validator',
    }],
  }]);
  assert.ok(prerequisite.parameterMigration.completeFunctions > 0,
    'parameter migration must retain priority over the subsequent prerequisite');
});

test('M4.56 freezes exact M4.55 runtime evidence before either policy limit moves', () => {
  const handoff = loadPublishedCanonicalizerDualRowHeadroomM455();
  assert.equal(handoff.digest, '10e36abdda5e7de48c65689f9d2a318a6095497bdd3cff81aa64e3ab4e6e535b');
  assert.equal(handoff.sourceCommit, '56a45251663840d2d8ab60a8c8ee84ae5b29975b');
  assert.equal(handoff.record.artifactScope, 'structural-kir-function');
  assert.deepEqual(handoff.record.limits.candidateProfile, {
    maxNodeRows: 25,
    maxPropertyRows: 50,
    maxValueRows: 388,
  });
  assert.equal(handoff.record.summary.witnessCount, 7);
  assert.equal(handoff.record.summary.maxExactFloor, 26_356);
  assert.equal(handoff.record.moduleEnvelope.disposition, 'not-claimed');
  assert.deepEqual(
    handoff.record.witnesses.map(({ exactFloor, id, parameterRows, profileRows }) => ({
      exactFloor, id, parameterRows, profileRows,
    })),
    EXPECTED_QUEUE.witnesses.map(({ id, parameterRows, profileRows }, index) => ({
      exactFloor: [26_356, 15_094, 19_763, 17_423, 19_622, 21_985, 17_931][index],
      id,
      parameterRows,
      profileRows,
    })),
  );
});

test('M4.55 published receipt rejects canonical and decorated drift', () => {
  const record = loadPublishedCanonicalizerDualRowHeadroomM455().record;
  for (const mutate of [
    (copy) => { copy.limits.candidateProfile.maxNodeRows = 26; },
    (copy) => { copy.limits.candidateProfile.maxPropertyRows = 51; },
    (copy) => { copy.witnesses.reverse(); },
    (copy) => { copy.witnesses[0].exactFloor += 1; },
    (copy) => { copy.moduleEnvelope.disposition = 'proven'; },
  ]) {
    const copy = structuredClone(record);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerDualRowHeadroomM455(copy),
      /coverage M4\.55 dual-row headroom rejection/u,
    );
  }
  const decorated = structuredClone(record);
  decorated[Symbol('hidden')] = true;
  assert.throws(
    () => validatePublishedCanonicalizerDualRowHeadroomM455(decorated),
    /coverage M4\.55 dual-row headroom rejection/u,
  );
});

test('M4.56 preserves exact M4.54 and M4.55 historical receipt bytes', () => {
  assert.equal(
    sha256('scripts/kern-canonicalizer/dual-row-headroom-m4-55.json'),
    '10e36abdda5e7de48c65689f9d2a318a6095497bdd3cff81aa64e3ab4e6e535b',
  );
  assert.equal(
    sha256('scripts/kern-canonicalizer/coverage-residual-analysis-m4-54.json'),
    '9c8507a4fe5bacf1048bfc1f6946c3e493ee35cd7fb63ce3a2a7ced474ad1423',
  );
});
