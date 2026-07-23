import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPublishedCanonicalizerResidualAnalysisM466 } from './coverage-residual-analysis-m4-66.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM470,
  validatePublishedCanonicalizerResidualAnalysisM470,
} from './coverage-residual-analysis-m4-70.mjs';
import { formatM470ResidualAnalysisStatus } from './coverage-status.mjs';

const summaryUrl = new URL('./coverage-residual-analysis-m4-70.json', import.meta.url);
const PUBLISHED_DIGEST = '2e1b2dea394f8a238b2f63b4a7045576b1843948740b3a6666b0c002971d8401';
const EXPECTED_SELECTION = {
  changedLimits: ['maxNodeRows', 'maxPropertyRows'],
  completeFunctions: 1,
  completeTools: 1,
  limits: { maxNodeRows: 31, maxPropertyRows: 53, maxValueRows: 388 },
  totalDelta: 4,
  witnesses: [
    'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#1:validstatementlist',
  ],
};

test('M4.70 freezes the exact published residual frontier', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerResidualAnalysisM470();
  assert.equal(createHash('sha256').update(source).digest('hex'), PUBLISHED_DIGEST);
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, 'e5069dc45a9d849ce02dbdc047cdfb78d0c55270');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.residual-analysis.3');
  assert.deepEqual(handoff.record.baseline, {
    baseCompleteFunctions: 78,
    baseId: 'kern.kir-canonicalizer.profile.m4.60',
    coverageImplementationDigest: 'fd676b3f50986582e76ee96ea93df91d02f36772234770359f35a2bcf5546251',
    coveragePolicyDigest: '10f2a65c811aef65be7cf0190017010f0bd79d5c6c5245221135ed9e2ca31fda',
    currentProfileLimits: { maxNodeRows: 30, maxPropertyRows: 50, maxValueRows: 388 },
    functionFactsDigest: '869bfeb7d4694f22ae9c088c649be1c3750a4ca576eef651c7244c31bec0ddee',
    legacyParameterBlockers: 25,
    residualFunctionCount: 25,
  });
  assert.equal(
    handoff.record.assignmentsDigest,
    '42ea4f41e325a8743710cb29b4f3b275dc2df7e2a233662d1e952df0568f8685',
  );
  assert.equal(handoff.record.assignments.length, 25);
  assert.equal(handoff.record.frontier.profileRowsAvailableFunctions, 9);
  assert.equal(handoff.record.frontier.evaluatedObservedSettings, 9);
  assert.equal(handoff.record.frontier.actionableCandidates.length, 9);
  assert.deepEqual(handoff.record.selectedNextAction, EXPECTED_SELECTION);
  assert.equal(
    handoff.record.assignments
      .filter(({ id }) => EXPECTED_SELECTION.witnesses.includes(id))
      .reduce((total, { parameterRows }) => total + parameterRows, 0),
    14,
  );
  assert.equal(
    formatM470ResidualAnalysisStatus(handoff.record.selectedNextAction),
    'M4.70 published analysis selected 1 function by maxNodeRows+maxPropertyRows widening; M4.71 authenticates structural runtime headroom.',
  );
});

test('M4.70 published digest rejects canonical and decorated drift', () => {
  const published = loadPublishedCanonicalizerResidualAnalysisM470().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.residual-analysis.4'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.assignments.pop(); },
    (copy) => { copy.frontier.actionableCandidates.reverse(); },
    (copy) => { copy.baseline.currentProfileLimits.maxPropertyRows = 52; },
    (copy) => { copy.selectedNextAction.limits.maxNodeRows = 32; },
    (copy) => { copy.selectedNextAction.witnesses.pop(); },
  ]) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerResidualAnalysisM470(copy),
      /coverage M4\.70 residual analysis rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM470(decorated),
    /coverage M4\.70 residual analysis rejection/u,
  );

  const shared = structuredClone(published);
  shared.selectedNextAction = shared.frontier.actionableCandidates[0];
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM470(shared),
    /coverage M4\.70 residual analysis rejection/u,
  );

  const cyclic = structuredClone(published);
  cyclic.selectedNextAction.future = cyclic;
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM470(cyclic),
    /coverage M4\.70 residual analysis rejection/u,
  );
});

test('M4.70 preserves M4.66 and loads byte-identically in a fresh process', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM466().digest,
    '7c3748692b35c5c30c9241b70de86af69ff5046382dba8b07963bd1c6e7c5736',
  );
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerResidualAnalysisM470 as load} from './scripts/kern-canonicalizer/coverage-residual-analysis-m4-70.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerResidualAnalysisM470());
});
